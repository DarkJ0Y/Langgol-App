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
