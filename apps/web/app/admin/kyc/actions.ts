'use server'

/**
 * Reviewer actions.
 *
 * Every one calls the use case, which authorizes independently. The pages below render only for
 * an actor the policy engine admits, but a hidden form is a courtesy rather than a control and is
 * not treated as one: an operator who forged their way to this module still cannot get past
 * `kyc:review`.
 *
 * Refs: docs/07_SECURITY.md §4, §5
 */

import { revalidatePath } from 'next/cache'
import { issueDocumentGrant, reviewVerification } from '@langgol/application'
import { isErr } from '@langgol/shared'
import type { MessageKey } from '@langgol/i18n'
import { kycDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import type { KycActionState } from '../../account/verification/state'

import { DECISION_FIELD, REASON_FIELD, VERIFICATION_ID_FIELD } from './fields'

function toActionState(code: string, meta: Record<string, unknown>): KycActionState {
  switch (code) {
    case 'VALIDATION_FAILED':
      // The only validation a reviewer can trip is a rejection with no reason, which is worth
      // saying plainly rather than generically.
      return {
        status: 'error',
        errorKey:
          meta['code'] === 'REASON_REQUIRED' ? 'errors.kycReasonRequired' : 'errors.unexpected',
        field: REASON_FIELD,
      }
    case 'CONFLICT':
      return { status: 'error', errorKey: 'errors.kycAlreadyDecided' }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
    case 'NOT_FOUND':
      // One answer for all three. Telling a caller which of them applied would confirm whether a
      // record exists and whether they are merely unauthorized.
      return { status: 'error', errorKey: 'errors.notAllowed' as MessageKey }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

export async function reviewAction(
  _previous: KycActionState,
  formData: FormData,
): Promise<KycActionState> {
  const actor = await currentActor()

  const verificationId = String(formData.get(VERIFICATION_ID_FIELD) ?? '')
  const decision = String(formData.get(DECISION_FIELD) ?? '')
  const reason = String(formData.get(REASON_FIELD) ?? '')

  if (decision !== 'APPROVE' && decision !== 'REJECT' && decision !== 'CLAIM') {
    return { status: 'error', errorKey: 'errors.unexpected' }
  }

  const result = await reviewVerification(
    actor,
    verificationId,
    { action: decision, reason },
    await kycDeps(),
  )
  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  revalidatePath('/admin/kyc')
  return { status: 'ok' }
}

/**
 * Mint a viewing grant and hand back the path that redeems it.
 *
 * The token is produced server-side and never travels as a query the browser composed. A reviewer
 * clicks a link; they do not construct one.
 */
export async function documentLinkAction(
  verificationId: string,
  side: 'FRONT' | 'BACK',
): Promise<string | null> {
  const actor = await currentActor()
  const result = await issueDocumentGrant(actor, verificationId, side, await kycDeps())
  return isErr(result) ? null : `/api/kyc/documents/${encodeURIComponent(result.value.token)}`
}
