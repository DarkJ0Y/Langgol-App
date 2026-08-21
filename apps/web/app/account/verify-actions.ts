'use server'

/**
 * Verification server actions.
 *
 * Same three steps as every other action in this app, in the same order: validate with Zod,
 * authorize through the policy engine by way of the use case, delegate. Nothing here decides
 * anything — the rate limits, the cooldowns and the attempt caps all live in the use case, which
 * a future job or CLI will call without passing through this file.
 *
 * The one thing worth stating explicitly: **no action here returns a code or a token**, and
 * neither does any error path. A code in a response is a code in a browser history, a proxy log
 * and a support screenshot.
 *
 * Refs: docs/07_SECURITY.md §3.1, §5
 */

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import {
  confirmPhoneVerification,
  requestEmailVerification,
  requestPhoneVerification,
} from '@langgol/application'
import { emailVerificationDeps, phoneVerificationDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import type { AccountActionState } from './state'

/** Client-supplied addresses are never trusted; the request's own metadata is. */
async function requestIp(): Promise<string | null> {
  const list = await headers()
  const forwarded = list.get('x-forwarded-for')
  return forwarded === null ? null : (forwarded.split(',')[0]?.trim() ?? null)
}

const CodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
})

function rateLimitedState(retryAfterSeconds: unknown): AccountActionState {
  return {
    status: 'error',
    errorKey: 'errors.rateLimited',
    errorValues: {
      seconds: typeof retryAfterSeconds === 'number' ? retryAfterSeconds : 60,
    },
  }
}

/**
 * Map a domain error onto a message key.
 *
 * Every OTP failure — wrong, expired, already used, never issued — collapses to one message.
 * That is not laziness: distinguishing them would let a caller probe whether a guess was right
 * but late, which is most of the value of guessing.
 */
function toActionState(error: {
  code: string
  meta: Record<string, string | number | boolean>
}): AccountActionState {
  switch (error.code) {
    case 'RATE_LIMITED':
      return rateLimitedState(error.meta['retryAfterSeconds'])
    case 'VALIDATION_FAILED':
      return { status: 'error', errorKey: 'errors.codeInvalid', field: 'code' }
    case 'PROVIDER_UNAVAILABLE':
      return { status: 'error', errorKey: 'errors.smsUnavailable' }
    case 'PRECONDITION_FAILED':
      return { status: 'error', errorKey: 'errors.accountSuspended' }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

/* ------------------------------------------------------------ phone: request */

export async function sendPhoneCodeAction(
  _previous: AccountActionState,
  _formData: FormData,
): Promise<AccountActionState> {
  const deps = await phoneVerificationDeps()
  const result = await requestPhoneVerification(
    await currentActor(),
    { ipAddress: await requestIp(), locale: await getLocale() },
    deps,
  )

  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/verify-phone')
  /*
   * The masked number is deliberately NOT returned for display. The page already renders it from
   * the profile it loaded server-side, so echoing it here would put a second copy of a phone
   * number into a payload for no gain.
   */
  return {
    status: 'ok',
    noticeKey: result.value.alreadyVerified ? 'verify.phoneVerified' : 'verify.codeSent',
  }
}

/* ------------------------------------------------------------ phone: confirm */

export async function confirmPhoneCodeAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = CodeSchema.safeParse({ code: formData.get('code') })
  if (!parsed.success) {
    return { status: 'error', errorKey: 'errors.codeInvalid', field: 'code' }
  }

  const deps = await phoneVerificationDeps()
  const result = await confirmPhoneVerification(
    await currentActor(),
    { code: parsed.data.code, ipAddress: await requestIp() },
    deps,
  )

  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account')
  revalidatePath('/account/verify-phone')
  return { status: 'ok', noticeKey: 'verify.phoneVerified' }
}

/* ------------------------------------------------------------------ email */

export async function sendEmailLinkAction(
  _previous: AccountActionState,
  _formData: FormData,
): Promise<AccountActionState> {
  const deps = await emailVerificationDeps()
  const result = await requestEmailVerification(
    await currentActor(),
    { ipAddress: await requestIp(), locale: await getLocale() },
    deps,
  )

  if (!result.ok) {
    if (result.error.code === 'PROVIDER_UNAVAILABLE') {
      return { status: 'error', errorKey: 'verify.emailUnavailable' }
    }
    return toActionState(result.error)
  }

  revalidatePath('/account')
  return {
    status: 'ok',
    noticeKey: result.value.alreadyVerified ? 'verify.emailVerified' : 'verify.emailSent',
  }
}
