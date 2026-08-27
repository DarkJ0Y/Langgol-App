'use server'

/**
 * Farmer profile server actions.
 *
 * Thin by design: authenticate, parse, call the use case, translate the result. No farming rule
 * lives here — the vocabulary, the land conversions and the irrigation consistency check are all
 * in `@langgol/domain/farming`, where they can be tested without a browser.
 *
 * No user id is taken or accepted. The subject is the signed-in actor, so there is no argument
 * here that could edit somebody else's profile.
 *
 * Refs: docs/03_ARCHITECTURE.md §4, docs/07_SECURITY.md §4
 */

import { revalidatePath } from 'next/cache'
import { updateMyFarmerProfile } from '@langgol/application'
import { isErr } from '@langgol/shared'
import { farmerDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { FarmerFormError, readFarmerForm } from './form'
import type { FarmerActionState } from './state'

/**
 * Map a domain error onto a message key.
 *
 * The specific validation messages are deliberately collapsed into per-field keys rather than
 * echoed from the domain: the domain's messages are English developer-facing sentences, and this
 * app is Bangla-first. The `field` travels so the form can put the message beside the right
 * question.
 */
function toActionState(code: string, meta: Record<string, unknown>): FarmerActionState {
  const field = typeof meta['field'] === 'string' ? meta['field'] : undefined

  switch (code) {
    case 'VALIDATION_FAILED':
      return {
        status: 'error',
        errorKey:
          field === 'farmingExperienceYears'
            ? 'errors.experienceInvalid'
            : field === 'totalLandArea' || field === 'landUnit'
              ? 'errors.landInvalid'
              : field === 'irrigationMethod' || field === 'waterSource'
                ? 'errors.irrigationInconsistent'
                : 'errors.unexpected',
        field,
      }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    case 'NOT_FOUND':
      return { status: 'error', errorKey: 'errors.notFound' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

export async function saveFarmerProfileAction(
  _previous: FarmerActionState,
  formData: FormData,
): Promise<FarmerActionState> {
  const actor = await currentActor()

  let command
  try {
    command = readFarmerForm(formData)
  } catch (cause) {
    if (cause instanceof FarmerFormError) {
      return { status: 'error', errorKey: 'errors.experienceInvalid', field: cause.field }
    }
    // `parseLandAmount` throws a LandError for anything that is not a number. Same treatment:
    // point at the field rather than showing an internal message.
    return { status: 'error', errorKey: 'errors.landInvalid', field: 'totalLandArea' }
  }

  const result = await updateMyFarmerProfile(actor, command, await farmerDeps())
  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  // The dashboard shows the completion meter, which this submission has just moved.
  revalidatePath('/farmer')
  revalidatePath('/farmer/onboarding')

  return { status: 'ok' }
}
