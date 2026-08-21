'use server'

/**
 * Consent server actions.
 *
 * Two operations, deliberately separate:
 *
 *  - `saveConsentPreferencesAction` — the optional permissions, each with its own answer.
 *  - `acceptTermsAction` — the terms and the privacy policy, which are not preferences and do not
 *    belong on the same screen or in the same submission.
 *
 * Neither takes a user id. The subject is the signed-in actor, so there is no argument here that
 * could record a decision on somebody else's behalf.
 *
 * Refs: docs/07_SECURITY.md §9.2, §9.4
 */

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { acceptRequiredConsents, recordConsentDecisions } from '@langgol/application'
import { consentDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { readConsentForm } from './form'
import type { ConsentActionState } from './state'

/** Client-supplied metadata is never trusted; the request's own is. */
async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const list = await headers()
  const forwarded = list.get('x-forwarded-for')
  return {
    ipAddress: forwarded === null ? null : (forwarded.split(',')[0]?.trim() ?? null),
    userAgent: list.get('user-agent'),
  }
}

function toActionState(error: { code: string }): ConsentActionState {
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return { status: 'error', errorKey: 'errors.consentInvalid' }
    case 'CONFIG_NOT_SET':
      return { status: 'error', errorKey: 'errors.unexpected' }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

export async function saveConsentPreferencesAction(
  _previous: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
  const { answers } = readConsentForm(formData)

  const deps = await consentDeps()
  const result = await recordConsentDecisions(
    await currentActor(),
    { answers, source: 'ACCOUNT_SETTINGS', ...(await requestMeta()) },
    deps,
  )

  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/privacy')
  return { status: 'ok', noticeKey: 'consent.saved' }
}

export async function acceptTermsAction(
  _previous: ConsentActionState,
  _formData: FormData,
): Promise<ConsentActionState> {
  const deps = await consentDeps()
  const result = await acceptRequiredConsents(
    await currentActor(),
    { source: 'REPROMPT', ...(await requestMeta()) },
    deps,
  )

  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/privacy')
  return { status: 'ok', noticeKey: 'consent.accepted' }
}
