/**
 * Carrying the phone number between "send me a code" and "here is the code".
 *
 * `verifyOtp` needs the number in order to find the challenge, and the two steps are separate
 * requests with a redirect in between. Three ways to bridge that, and only one of them is
 * acceptable:
 *
 *  - **In the URL.** Rejected. A phone number in a query string reaches browser history, the
 *    `Referer` header of every asset the page loads, and any proxy log in between. This is why
 *    `requestOtpAction` puts only the MASKED number in the redirect.
 *  - **In a hidden form field.** This is what the code used to claim to do, and it is why OTP
 *    login was broken: the field existed with a hard-coded empty value, because the page only
 *    ever had the masked number to put in it. A hidden field would also be attacker-controlled,
 *    so a stolen code could be redeemed against a different number.
 *  - **In a short-lived HttpOnly cookie.** What this module does. Server-set, unreadable from
 *    JavaScript, scoped to the same browser that asked for the code, and expiring with it.
 *
 * The cookie holds the user's own number, in their own browser, for a few minutes — the same
 * standing as the session cookie that follows it. It is cleared the moment it is spent.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.3
 */

import 'server-only'
import { cookies } from 'next/headers'
import { env } from '@langgol/shared'
import {
  OTP_HANDOFF_COOKIE,
  OTP_HANDOFF_COOKIE_DEV,
  decodeHandoff,
  encodeHandoff,
  type OtpHandoff,
} from './otp-handoff-policy'

export {
  HANDOFF_GRACE_SECONDS,
  destinationAfterSignIn,
  handoffExpiry,
  type OtpHandoff,
  type SignupIntent,
} from './otp-handoff-policy'

export function otpHandoffCookieName(): string {
  return env().isProduction || env().APP_ENV === 'staging'
    ? OTP_HANDOFF_COOKIE
    : OTP_HANDOFF_COOKIE_DEV
}

/**
 * Remember which number a code was just sent to, and — for a registration — who said they were
 * sending it. Overwrites any previous attempt.
 *
 * The signup intent rides in the same cookie rather than in a hidden field on the verify form.
 * A hidden field would let a caller attach a different role to a verification they had already
 * started, and the server would have no way to know which one the person actually saw.
 */
export async function rememberOtpHandoff(handoff: OtpHandoff, expiresAt: Date): Promise<void> {
  const store = await cookies()
  const secure = env().isProduction || env().APP_ENV === 'staging'
  store.set(otpHandoffCookieName(), encodeHandoff(handoff), {
    httpOnly: true,
    secure,
    // `lax` rather than `strict`: the value has to survive the redirect from the request step.
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function readOtpHandoff(): Promise<OtpHandoff | null> {
  const store = await cookies()
  return decodeHandoff(store.get(otpHandoffCookieName())?.value)
}

/** Spend it. Called on success and on any terminal failure, so a stale number cannot linger. */
export async function forgetOtpHandoff(): Promise<void> {
  const store = await cookies()
  store.delete(otpHandoffCookieName())
}
