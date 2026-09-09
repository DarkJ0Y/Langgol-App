/**
 * The testable half of the OTP handoff.
 *
 * Split from `otp-handoff.ts` because that module carries `import 'server-only'`, which is a
 * build-time guard against a client component importing it — and which also makes everything
 * inside it unreachable from a test runner. The same shape as `app/account/addresses/form.ts`
 * next to its `'use server'` actions, and for the same reason: a guard that protects the build
 * should not decide what can be verified.
 */

/**
 * `__Host-` forces Secure, path `/`, and forbids a Domain attribute, so a subdomain cannot set
 * or overwrite it. The prefix only works over HTTPS, so plain-HTTP local development falls back.
 * Mirrors the session cookie deliberately: two cookie-naming schemes is one too many.
 */
import { SELF_SELECTABLE_ROLES, type SelfSelectableRole } from '@langgol/domain/identity'

export const OTP_HANDOFF_COOKIE = '__Host-langgol_otp'
export const OTP_HANDOFF_COOKIE_DEV = 'langgol_otp'

/**
 * A little longer than the code itself lives.
 *
 * If the cookie expired first the user would type a code that is still valid and be told it is
 * not, which is the most confusing failure this flow can produce.
 */
export const HANDOFF_GRACE_SECONDS = 60

export function handoffExpiry(now: Date, otpTtlSeconds: number): Date {
  return new Date(now.getTime() + (otpTtlSeconds + HANDOFF_GRACE_SECONDS) * 1000)
}

/**
 * Roles somebody may choose for themselves while registering.
 *
 * Taken from the domain rather than mirrored. It was a hand-written copy until the P14 audit found
 * three separate definitions of the same allowlist; the others agreed with it, which is precisely
 * why nobody had noticed that widening one would not widen the rest.
 *
 * The `satisfies` is doing real work: it makes this a compile error if the domain list ever holds a
 * role this module's own type cannot express, rather than a silent narrowing at runtime.
 */
export const REGISTERABLE_ROLES = SELF_SELECTABLE_ROLES
export type RegisterableRole = SelfSelectableRole

export const MAX_FULL_NAME_LENGTH = 120

/**
 * What a person told us BEFORE we sent them a code.
 *
 * Registration collects the name and the role up front rather than after verification, because
 * the alternative needs a session to hang the half-made account on — and a brand-new user does
 * not have one. Asking first means the account is created complete, in a single write, or not at
 * all: there is no window in which a nameless, roleless user row exists.
 */
export interface SignupIntent {
  readonly fullName: string
  readonly role: RegisterableRole
}

export interface OtpHandoff {
  readonly phone: string
  /** Absent for a sign-in. Present only when the person came through the register screen. */
  readonly signup?: SignupIntent
}

export function isRegisterableRole(value: unknown): value is RegisterableRole {
  return typeof value === 'string' && (REGISTERABLE_ROLES as readonly string[]).includes(value)
}

/**
 * Why the intent travels in the cookie rather than in a hidden field on the verify form.
 *
 * The phone is in the cookie because a client-supplied number would let a stolen code be
 * redeemed against somebody else's challenge. The name and role ride along for a quieter reason:
 * a hidden field would let a caller attach a *different* role to a verification they had already
 * started — choosing CONSUMER on the visible form and posting RETAILER — and the server would
 * have no way to tell which one the person actually saw and agreed to.
 *
 * `verifyOtp` still re-checks the role against its own allowlist. This is the outer of two
 * gates, not a substitute for it.
 */
export function encodeHandoff(handoff: OtpHandoff): string {
  return JSON.stringify(handoff)
}

/**
 * Read a handoff cookie back.
 *
 * Returns `null` for anything that is not a well-formed handoff — corrupt, truncated, or an
 * unknown role. A null sends the user back to request a new code, which is mildly annoying and
 * always safe; guessing at a half-parsed value is neither.
 *
 * A bare (non-JSON) string is accepted as a phone with no signup intent. That is not
 * defensiveness for its own sake: it is the format this cookie used before registration existed,
 * and somebody mid-flow across a deploy should sign in rather than see an error they cannot act
 * on.
 */
export function decodeHandoff(raw: string | null | undefined): OtpHandoff | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null

  if (!raw.startsWith('{')) return { phone: raw }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>

  const phone = candidate['phone']
  if (typeof phone !== 'string' || phone.trim() === '') return null

  const signup = candidate['signup']
  if (signup === undefined || signup === null) return { phone }

  if (typeof signup !== 'object') return null
  const intent = signup as Record<string, unknown>

  const fullName = intent['fullName']
  const role = intent['role']

  if (typeof fullName !== 'string') return null
  const trimmed = fullName.trim()
  if (trimmed === '' || trimmed.length > MAX_FULL_NAME_LENGTH) return null

  // An unknown role fails the whole handoff rather than degrading to a sign-in. Silently
  // dropping it would create the account with no role and no explanation.
  if (!isRegisterableRole(role)) return null

  return { phone, signup: { fullName: trimmed, role } }
}

/** Where somebody lands once they are signed in. */
export function destinationAfterSignIn(roles: readonly string[]): string {
  // A farmer goes straight to the questions that make their account useful. Everybody else goes
  // to the market, which is what they came for.
  return roles.includes('FARMER') ? '/farmer/onboarding' : '/'
}

/**
 * Where somebody lands the FIRST time, having just chosen their role.
 *
 * Separate from `destinationAfterSignIn` because onboarding happens once and signing in happens
 * every day. Sending a returning retailer to a form they filled in months ago would be a small
 * insult repeated daily, which is why the two questions have two functions rather than one with
 * a flag.
 *
 * A retailer is sent to their profile because a shop that has not said what it is called or where
 * it trades cannot usefully appear to anybody. A consumer is not: their profile is dietary
 * preferences and a default address, all of it genuinely optional, and putting a questionnaire
 * between somebody and the market they came for is how the market loses them.
 */
export function destinationAfterRoleSelection(role: string): string {
  if (role === 'FARMER') return '/farmer/onboarding'
  if (role === 'RETAILER') return '/account/profile'
  return '/'
}
