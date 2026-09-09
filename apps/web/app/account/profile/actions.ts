'use server'

/**
 * Role profile server actions.
 *
 * Thin by design: authenticate, read the form, call the use case, translate the result. One
 * action for all six roles — the role travels in the form, and the use case checks the caller
 * actually holds it against their LIVE roles.
 *
 * No user id is taken or accepted. The subject is the signed-in actor, so there is no argument
 * here that could edit somebody else's profile. The role in the form is untrusted input and is
 * treated as such: posting `WHOLESALER` from the consumer screen is refused, not obeyed.
 *
 * Refs: docs/03_ARCHITECTURE.md §4, docs/07_SECURITY.md §4
 */

import { revalidatePath } from 'next/cache'
import { updateMyRoleProfile } from '@langgol/application'
import { isErr } from '@langgol/shared'
import type { MessageKey } from '@langgol/i18n'
import { roleProfileDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { readProfileForm } from './form'
import type { ProfileActionState } from './state'

/**
 * Map a domain failure code onto a message key.
 *
 * The domain's own messages are English developer-facing sentences and this app is Bangla-first,
 * so the CODE travels and the words are chosen here. The `field` travels too, so the form can put
 * the message beside the question it is about rather than at the top of a long page.
 */
function messageFor(code: unknown): MessageKey {
  switch (code) {
    case 'REQUIRED':
    case 'NAME_EMPTY':
      return 'errors.profileRequired'
    case 'TOO_LONG':
    case 'NAME_TOO_LONG':
    case 'LICENCE_TOO_LONG':
      return 'errors.profileTooLong'
    case 'NOT_INTEGER':
      return 'errors.profileNotNumber'
    case 'OUT_OF_RANGE':
      return 'errors.profileOutOfRange'
    case 'NOT_MONEY':
      return 'errors.profileNotAmount'
    case 'UNKNOWN_VALUE':
      return 'errors.profileUnknownValue'
    case 'TOO_MANY':
      return 'errors.profileTooMany'
    case 'TIN_FORMAT':
      return 'errors.profileTinInvalid'
    case 'BIN_FORMAT':
      return 'errors.profileBinInvalid'
    case 'LICENCE_FORMAT':
      return 'errors.profileLicenceInvalid'
    // Both the malformed id and the one belonging to somebody else. Deliberately the SAME
    // message: telling the second case apart would confirm that an id exists, which is the
    // question an attacker was asking.
    case 'NOT_ADDRESS':
      return 'errors.profileAddressUnknown'
    case 'GEO_PAIR':
      return 'errors.profileGeoPair'
    case 'GEO_INVALID':
      return 'errors.profileGeoInvalid'
    case 'GEO_SWAPPED':
      return 'errors.profileGeoSwapped'
    case 'GEO_OUT_OF_BOUNDS':
      return 'errors.profileGeoOutOfBounds'
    default:
      return 'errors.unexpected'
  }
}

function toActionState(code: string, meta: Record<string, unknown>): ProfileActionState {
  const field = typeof meta['field'] === 'string' ? meta['field'] : undefined

  switch (code) {
    case 'VALIDATION_FAILED':
      return { status: 'error', errorKey: messageFor(meta['code']), field }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    case 'NOT_FOUND':
      return { status: 'error', errorKey: 'errors.notFound' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

export async function saveRoleProfileAction(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await currentActor()
  const { role, command } = readProfileForm(formData)

  const result = await updateMyRoleProfile(actor, role, command, await roleProfileDeps())
  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  // The account page shows the completion meter, which this submission has just moved.
  revalidatePath('/account')
  revalidatePath('/account/profile')

  return { status: 'ok' }
}
