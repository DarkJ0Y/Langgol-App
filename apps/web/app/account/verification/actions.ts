'use server'

/**
 * KYC server actions.
 *
 * Thin by design: authenticate, read the form, call the use case, translate the result. No user
 * id is taken or accepted — the subject is the signed-in actor, so there is no argument here that
 * could submit a document on somebody else's behalf.
 *
 * The identity number passes through this module and is never written anywhere by it. In
 * particular the error path returns a message KEY rather than echoing the submitted value, which
 * is the usual way a rejected input ends up in a log.
 *
 * Refs: docs/03_ARCHITECTURE.md §4, docs/07_SECURITY.md §4, §11
 */

import { revalidatePath } from 'next/cache'
import { submitIdentity } from '@langgol/application'
import { isErr } from '@langgol/shared'
import type { MessageKey } from '@langgol/i18n'
import { kycDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { readKycForm } from './form'
import type { KycActionState } from './state'

/**
 * Map a domain failure code onto a message key.
 *
 * The domain's messages are English developer-facing sentences and this app is Bangla-first, so
 * the CODE travels and the words are chosen here.
 */
function messageFor(code: unknown): MessageKey {
  switch (code) {
    case 'IDENTITY_NUMBER_REQUIRED':
      return 'errors.kycNumberRequired'
    case 'NID_NOT_NUMERIC':
    case 'NID_IMPLAUSIBLE':
      return 'errors.kycNumberInvalid'
    case 'NID_LENGTH':
      return 'errors.kycNumberLength'
    case 'IDENTITY_TYPE_UNSUPPORTED':
      return 'errors.kycTypeUnsupported'
    case 'IDENTITY_ALREADY_REGISTERED':
      return 'errors.kycDocumentUnusable'
    case 'DOCUMENT_FRONT_REQUIRED':
      return 'errors.kycFrontRequired'
    case 'DOCUMENT_BACK_REQUIRED':
      return 'errors.kycBackRequired'
    case 'DOCUMENT_TOO_LARGE':
      return 'errors.kycFileTooLarge'
    case 'DOCUMENT_TOO_SMALL':
      return 'errors.kycFileTooSmall'
    case 'DOCUMENT_TYPE_NOT_ALLOWED':
      return 'errors.kycFileType'
    case 'DOCUMENT_CONTENT_MISMATCH':
      return 'errors.kycFileMismatch'
    default:
      return 'errors.unexpected'
  }
}

function toActionState(code: string, meta: Record<string, unknown>): KycActionState {
  const field = typeof meta['field'] === 'string' ? meta['field'] : undefined

  switch (code) {
    case 'VALIDATION_FAILED':
      return { status: 'error', errorKey: messageFor(meta['code']), field }
    case 'CONFLICT':
      return { status: 'error', errorKey: 'errors.kycAlreadyPending' }
    case 'PROVIDER_UNAVAILABLE':
      // The key is missing or storage is down. The person is told to try later rather than being
      // shown an operational detail they cannot act on.
      return { status: 'error', errorKey: 'errors.kycUnavailable' }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

export async function submitIdentityAction(
  _previous: KycActionState,
  formData: FormData,
): Promise<KycActionState> {
  const actor = await currentActor()
  const command = await readKycForm(formData)

  const result = await submitIdentity(actor, command, await kycDeps())
  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  revalidatePath('/account')
  revalidatePath('/account/verification')

  return { status: 'ok' }
}
