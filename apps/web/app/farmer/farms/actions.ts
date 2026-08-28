'use server'

/**
 * Farm and plot server actions.
 *
 * Thin: parse, call the use case, translate the result. Note what is NOT here — no ownership
 * check. That is deliberate rather than an omission: ownership is enforced in the use case and,
 * underneath it, in the SQL. A check repeated here would be a fourth place to keep in step, and
 * the one that drifts is always the one guarding something.
 *
 * The ids in these forms are attacker-controlled by definition — anyone can type a different
 * `farmId` into a hidden field. That is fine, and it is the whole point of the owner-scoped
 * query: a stranger's id simply matches no row.
 *
 * Refs: docs/03_ARCHITECTURE.md §4; docs/07_SECURITY.md §4
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createFarm,
  createPlot,
  deleteFarm,
  deletePlot,
  updateFarm,
  updatePlot,
} from '@langgol/application'
import { parseLandAmount } from '@langgol/domain/farming'
import { isErr } from '@langgol/shared'
import { farmDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import type { FarmActionState } from './state'

function toState(code: string, meta: Record<string, unknown>): FarmActionState {
  const field = typeof meta['field'] === 'string' ? meta['field'] : undefined
  switch (code) {
    case 'VALIDATION_FAILED':
      return {
        status: 'error',
        errorKey:
          field === 'name'
            ? 'errors.nameEmpty'
            : field === 'area' || field === 'areaUnit'
              ? 'errors.landInvalid'
              : field === 'irrigationMethod' || field === 'waterSource'
                ? 'errors.irrigationInconsistent'
                : 'errors.unexpected',
        field,
      }
    case 'NOT_FOUND':
      return { status: 'error', errorKey: 'errors.notFound' }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    case 'PRECONDITION_FAILED':
      return { status: 'error', errorKey: 'errors.addressLimit' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

/** A select or text field, read as `null` when left alone — never as invalid. */
function optional(data: FormData, name: string): string | null {
  const raw = data.get(name)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The descriptive answers shared by farms and plots.
 *
 * Every key is always present, because an unanswered question must be distinguishable from one
 * the form never sent — otherwise clearing an answer would be impossible.
 */
function readHolding(data: FormData, opts: { withIrrigation: boolean }) {
  const amountRaw = optional(data, 'areaAmount')
  const areaAmountMilli = amountRaw === null ? null : parseLandAmount(amountRaw)

  const irrigationRaw = optional(data, 'irrigationAvailable')
  const irrigationAvailable = irrigationRaw === 'YES' ? true : irrigationRaw === 'NO' ? false : null

  // With no irrigation the form hides the follow-ups, so the browser still posts whatever was
  // selected before the farmer changed their mind. Clearing them here turns a confusing
  // validation error into the obvious behaviour.
  const irrigationMethod = irrigationAvailable === false ? null : optional(data, 'irrigationMethod')
  const waterSourceRaw = optional(data, 'waterSource')
  const waterSource =
    irrigationAvailable === false && waterSourceRaw !== 'RAIN' ? null : waterSourceRaw

  return {
    areaAmountMilli,
    areaUnit: areaAmountMilli === null ? null : (optional(data, 'areaUnit') ?? 'DECIMAL'),
    soilType: optional(data, 'soilType'),
    ...(opts.withIrrigation
      ? {
          ownershipType: optional(data, 'ownershipType'),
          irrigationAvailable,
          irrigationMethod,
          waterSource,
          farmingMethod: optional(data, 'farmingMethod'),
        }
      : { irrigationMethod: optional(data, 'irrigationMethod') }),
  }
}

/* ---------------------------------------------------------------------- farms */

export async function createFarmAction(
  _previous: FarmActionState,
  data: FormData,
): Promise<FarmActionState> {
  const actor = await currentActor()
  const areaId = String(data.get('adminAreaId') ?? '')
  if (areaId === '')
    return { status: 'error', errorKey: 'errors.areaRequired', field: 'adminAreaId' }

  let result
  try {
    result = await createFarm(
      actor,
      {
        name: String(data.get('name') ?? ''),
        adminAreaId: areaId,
        villageOrArea: optional(data, 'villageOrArea'),
        ...readHolding(data, { withIrrigation: true }),
      },
      await farmDeps(),
    )
  } catch {
    return { status: 'error', errorKey: 'errors.landInvalid', field: 'area' }
  }

  if (isErr(result)) return toState(result.error.code, result.error.meta)

  revalidatePath('/farmer/farms')
  redirect(`/farmer/farms/${result.value.id}`)
}

export async function updateFarmAction(
  _previous: FarmActionState,
  data: FormData,
): Promise<FarmActionState> {
  const actor = await currentActor()
  const farmId = String(data.get('farmId') ?? '')

  let result
  try {
    result = await updateFarm(
      actor,
      farmId,
      { name: String(data.get('name') ?? ''), ...readHolding(data, { withIrrigation: true }) },
      await farmDeps(),
    )
  } catch {
    return { status: 'error', errorKey: 'errors.landInvalid', field: 'area' }
  }

  if (isErr(result)) return toState(result.error.code, result.error.meta)

  revalidatePath('/farmer/farms')
  revalidatePath(`/farmer/farms/${farmId}`)
  return { status: 'ok' }
}

export async function deleteFarmAction(data: FormData): Promise<void> {
  const result = await deleteFarm(
    await currentActor(),
    String(data.get('farmId') ?? ''),
    await farmDeps(),
  )
  revalidatePath('/farmer/farms')
  // A refused delete is a farm that is not theirs. Sending them back to their own list is the
  // honest answer and reveals nothing about whether the id exists.
  redirect(isErr(result) ? '/farmer/farms' : '/farmer/farms')
}

/* ---------------------------------------------------------------------- plots */

export async function createPlotAction(
  _previous: FarmActionState,
  data: FormData,
): Promise<FarmActionState> {
  const farmId = String(data.get('farmId') ?? '')

  let result
  try {
    result = await createPlot(
      await currentActor(),
      farmId,
      { name: String(data.get('name') ?? ''), ...readHolding(data, { withIrrigation: false }) },
      await farmDeps(),
    )
  } catch {
    return { status: 'error', errorKey: 'errors.landInvalid', field: 'area' }
  }

  if (isErr(result)) return toState(result.error.code, result.error.meta)

  revalidatePath(`/farmer/farms/${farmId}`)
  return { status: 'ok' }
}

export async function updatePlotAction(
  _previous: FarmActionState,
  data: FormData,
): Promise<FarmActionState> {
  const farmId = String(data.get('farmId') ?? '')

  let result
  try {
    result = await updatePlot(
      await currentActor(),
      String(data.get('plotId') ?? ''),
      { name: String(data.get('name') ?? ''), ...readHolding(data, { withIrrigation: false }) },
      await farmDeps(),
    )
  } catch {
    return { status: 'error', errorKey: 'errors.landInvalid', field: 'area' }
  }

  if (isErr(result)) return toState(result.error.code, result.error.meta)

  revalidatePath(`/farmer/farms/${farmId}`)
  return { status: 'ok' }
}

export async function deletePlotAction(data: FormData): Promise<void> {
  const farmId = String(data.get('farmId') ?? '')
  await deletePlot(await currentActor(), String(data.get('plotId') ?? ''), await farmDeps())
  revalidatePath(`/farmer/farms/${farmId}`)
  redirect(`/farmer/farms/${farmId}`)
}
