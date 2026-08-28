/**
 * A farmer's farms and plots.
 *
 * Every operation is scoped to the actor. Note what these signatures do NOT contain: a
 * `farmerId`, an `ownerId`, or any way to name whose farm is meant. The subject is always the
 * session, so there is no argument an attacker could put somebody else's id into.
 *
 * `farmId` and `plotId` ARE parameters, because a farmer legitimately names which of their own
 * holdings they mean. That is exactly the shape IDOR exploits, so the id never selects a row on
 * its own: the repository puts the owner in the same WHERE clause, and an id belonging to a
 * stranger resolves to nothing. A miss is reported as NOT_FOUND rather than FORBIDDEN, because
 * telling an attacker "that farm exists but is not yours" confirms the id — the two cases are
 * indistinguishable from outside, deliberately.
 *
 * Refs: docs/07_SECURITY.md §4; docs/03_ARCHITECTURE.md §4
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import {
  HoldingError,
  MAX_FARMS_PER_FARMER,
  MAX_PLOTS_PER_FARM,
  resolvePlot,
  validateHolding,
  type HoldingUpdate,
} from '@langgol/domain/farming'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  Coordinates,
  FarmRecord,
  FarmRepository,
  PlotRecord,
  PlotRepository,
} from '../../ports/index.js'

export interface FarmDeps {
  readonly clock: Clock
  readonly farms: FarmRepository
  readonly plots: PlotRepository
  readonly audit: AuditPort
}

function validationError(cause: unknown): AppError {
  if (cause instanceof HoldingError) {
    return Errors.validation(cause.message, { field: cause.field, code: cause.code })
  }
  throw cause
}

/* --------------------------------------------------------------------- farms */

export async function listMyFarms(
  actor: MaybeActor,
  deps: FarmDeps,
): Promise<Result<readonly FarmRecord[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())
  return ok(await deps.farms.listForUser(actor.userId))
}

export async function getMyFarm(
  actor: MaybeActor,
  farmId: string,
  deps: FarmDeps,
): Promise<Result<FarmRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  const farm = await deps.farms.findForUser(actor.userId, farmId)
  // Not found and not yours are the same answer. Distinguishing them confirms the id exists.
  return farm === null ? err(Errors.notFound('Farm')) : ok(farm)
}

export interface CreateFarmCommand extends HoldingUpdate {
  readonly name: string
  readonly adminAreaId: string
  readonly villageOrArea?: string | null
  readonly addressLine?: string | null
  readonly addressId?: string | null
  readonly coordinates?: Coordinates | null
}

export async function createFarm(
  actor: MaybeActor,
  command: CreateFarmCommand,
  deps: FarmDeps,
): Promise<Result<FarmRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  let changes: Record<string, unknown>
  try {
    changes = validateHolding(command, {})
  } catch (cause) {
    return err(validationError(cause))
  }

  // A guard against a loop filling the table, not an agricultural judgement.
  if ((await deps.farms.countForUser(actor.userId)) >= MAX_FARMS_PER_FARMER) {
    return err(Errors.preconditionFailed('You cannot add any more farms'))
  }

  const created = await deps.farms.createForUser(actor.userId, {
    name: String(changes['name'] ?? command.name),
    adminAreaId: command.adminAreaId,
    villageOrArea: command.villageOrArea ?? null,
    addressLine: command.addressLine ?? null,
    addressId: command.addressId ?? null,
    coordinates: command.coordinates ?? null,
  })

  // Anything descriptive supplied at creation is applied as an update, so one validator governs
  // both paths rather than a second, looser one for creation.
  const descriptive = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'name'))
  const farm =
    Object.keys(descriptive).length === 0
      ? created
      : ((await deps.farms.updateForUser(actor.userId, created.id, descriptive)) ?? created)

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'FARM_CREATED',
    entityType: 'farm',
    entityId: farm.id,
  })

  return ok(farm)
}

export async function updateFarm(
  actor: MaybeActor,
  farmId: string,
  command: HoldingUpdate,
  deps: FarmDeps,
): Promise<Result<FarmRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  const current = await deps.farms.findForUser(actor.userId, farmId)
  if (current === null) return err(Errors.notFound('Farm'))

  let changes: Record<string, unknown>
  try {
    // Validated against the MERGED state, so a two-step edit cannot reach a contradiction that
    // neither step could reach alone.
    changes = validateHolding(command, current)
  } catch (cause) {
    return err(validationError(cause))
  }

  const edited = Object.keys(changes).filter(
    (key) => changes[key] !== (current as unknown as Record<string, unknown>)[key],
  )
  if (edited.length === 0) return ok(current)

  const updated = await deps.farms.updateForUser(
    actor.userId,
    farmId,
    Object.fromEntries(edited.map((k) => [k, changes[k]])),
  )
  if (updated === null) return err(Errors.notFound('Farm'))

  // Field NAMES only. What changed is what an investigation needs; the values belong to the row.
  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'FARM_UPDATED',
    entityType: 'farm',
    entityId: farmId,
    reason: [...edited].sort().join(','),
  })

  return ok(updated)
}

export async function deleteFarm(
  actor: MaybeActor,
  farmId: string,
  deps: FarmDeps,
): Promise<Result<{ readonly deleted: true }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  const removed = await deps.farms.softDeleteForUser(actor.userId, farmId)
  if (!removed) return err(Errors.notFound('Farm'))

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'FARM_DELETED',
    entityType: 'farm',
    entityId: farmId,
  })

  return ok({ deleted: true })
}

/* --------------------------------------------------------------------- plots */

export interface PlotView extends PlotRecord {
  /** Fields showing the farm's value because the plot did not override it. */
  readonly inherited: readonly string[]
}

/** A plot read in isolation under-reports itself; `null` means "same as the farm". */
function withInheritance(plot: PlotRecord, farm: FarmRecord): PlotView {
  const resolved = resolvePlot(plot, farm)
  return {
    ...plot,
    soilType: resolved.soilType,
    irrigationMethod: resolved.irrigationMethod,
    areaUnit: resolved.areaUnit,
    inherited: resolved.inherited,
  }
}

export async function listPlots(
  actor: MaybeActor,
  farmId: string,
  deps: FarmDeps,
): Promise<Result<readonly PlotView[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  const farm = await deps.farms.findForUser(actor.userId, farmId)
  if (farm === null) return err(Errors.notFound('Farm'))

  const plots = await deps.plots.listForFarm(actor.userId, farmId)
  return ok(plots.map((plot) => withInheritance(plot, farm)))
}

export interface CreatePlotCommand extends HoldingUpdate {
  readonly name: string
  readonly coordinates?: Coordinates | null
}

export async function createPlot(
  actor: MaybeActor,
  farmId: string,
  command: CreatePlotCommand,
  deps: FarmDeps,
): Promise<Result<PlotRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  let changes: Record<string, unknown>
  try {
    changes = validateHolding(command, {})
  } catch (cause) {
    return err(validationError(cause))
  }

  if ((await deps.plots.countForFarm(actor.userId, farmId)) >= MAX_PLOTS_PER_FARM) {
    return err(Errors.preconditionFailed('You cannot add any more plots to this farm'))
  }

  const created = await deps.plots.createForUser(actor.userId, farmId, {
    name: String(changes['name'] ?? command.name),
    coordinates: command.coordinates ?? null,
  })
  // null means the farm is not theirs — same answer as it not existing.
  if (created === null) return err(Errors.notFound('Farm'))

  const descriptive = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'name'))
  const plot =
    Object.keys(descriptive).length === 0
      ? created
      : ((await deps.plots.updateForUser(actor.userId, created.id, descriptive)) ?? created)

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'PLOT_CREATED',
    entityType: 'plot',
    entityId: plot.id,
  })

  return ok(plot)
}

export async function updatePlot(
  actor: MaybeActor,
  plotId: string,
  command: HoldingUpdate,
  deps: FarmDeps,
): Promise<Result<PlotRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  const current = await deps.plots.findForUser(actor.userId, plotId)
  if (current === null) return err(Errors.notFound('Plot'))

  let changes: Record<string, unknown>
  try {
    changes = validateHolding(command, current)
  } catch (cause) {
    return err(validationError(cause))
  }

  const edited = Object.keys(changes).filter(
    (key) => changes[key] !== (current as unknown as Record<string, unknown>)[key],
  )
  if (edited.length === 0) return ok(current)

  const updated = await deps.plots.updateForUser(
    actor.userId,
    plotId,
    Object.fromEntries(edited.map((k) => [k, changes[k]])),
  )
  if (updated === null) return err(Errors.notFound('Plot'))

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'PLOT_UPDATED',
    entityType: 'plot',
    entityId: plotId,
    reason: [...edited].sort().join(','),
  })

  return ok(updated)
}

export async function deletePlot(
  actor: MaybeActor,
  plotId: string,
  deps: FarmDeps,
): Promise<Result<{ readonly deleted: true }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farm:manage-own')) return err(Errors.forbidden())

  const removed = await deps.plots.softDeleteForUser(actor.userId, plotId)
  if (!removed) return err(Errors.notFound('Plot'))

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'PLOT_DELETED',
    entityType: 'plot',
    entityId: plotId,
  })

  return ok({ deleted: true })
}
