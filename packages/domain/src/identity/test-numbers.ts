/**
 * Test phone numbers with a predictable one-time code.
 *
 * Manual testing of the OTP flow otherwise means reading a code out of a server log for every
 * sign-in. These two numbers always receive the same code, so registration and login can be
 * exercised from a browser without touching the log.
 *
 * ## What this does NOT do
 *
 * It does not bypass verification. The fixed code is hashed, stored and checked exactly like a
 * random one, and everything around it still applies — the five-minute expiry, the attempt cap,
 * the resend cooldown, the per-phone and per-IP rate limits, and the invalidation of any earlier
 * outstanding code. The only thing that changes is that `numericCode()` is not consulted.
 *
 * That distinction matters. A verification bypass would skip the attempt cap and the hashing and
 * would be a genuine back door; making the code *predictable* leaves every control in place and
 * weakens exactly one thing — the secrecy of two numbers nobody can receive SMS on.
 *
 * ## Why it cannot reach production
 *
 * Three independent locks, in the order an attacker would meet them:
 *
 *  1. **Composition.** `otpDeps()` only supplies the lookup outside production and staging. In
 *     production the use case has no way to obtain a fixed code, so the branch is unreachable
 *     rather than merely unused.
 *  2. **The numbers.** They sit in the same reserved `+88017000000…` range as the development
 *     fixtures — structurally valid Bangladeshi numbers that no operator assigns, so no real
 *     person can hold one.
 *  3. **The env schema.** Production already refuses `SMS_PROVIDER=console`, so a production
 *     deployment cannot silently fall back to log-only delivery either.
 *
 * Deliberately separate from the development fixtures in `auth-mode.ts`. Those nine accounts
 * exist to be signed into WITHOUT a code, through `/auth/development`; these two exist to be
 * signed into WITH one, through the real OTP flow. Different mechanisms, different guarantees,
 * and the reserved block for fixtures is full at nine besides.
 *
 * Refs: docs/07_SECURITY.md §3.1; docs/03_ARCHITECTURE.md ADR-22
 */

import type { E164Phone } from './phone.js'

export interface TestOtpNumber {
  readonly phone: string
  /** Always issued for this number. Must be `OTP_LENGTH` digits. */
  readonly code: string
  /** What the number is for, so a tester knows which one to reach for. */
  readonly intendedRole: 'FARMER' | 'CONSUMER'
  readonly label: string
}

/**
 * The two numbers.
 *
 * Distinct codes rather than one shared code, so a passing test proves the challenge for *that*
 * number was matched — with a single code, a bug that verified against the wrong challenge would
 * still appear to work.
 */
export const TEST_OTP_NUMBERS: readonly TestOtpNumber[] = [
  {
    phone: '+8801700000011',
    code: '111111',
    intendedRole: 'FARMER',
    label: 'Test farmer',
  },
  {
    phone: '+8801700000012',
    code: '222222',
    intendedRole: 'CONSUMER',
    label: 'Test consumer',
  },
]

const BY_PHONE: ReadonlyMap<string, TestOtpNumber> = new Map(
  TEST_OTP_NUMBERS.map((entry) => [entry.phone, entry]),
)

/** The fixed code for a test number, or `null` for every other number. */
export function fixedOtpCodeFor(phone: E164Phone | string): string | null {
  return BY_PHONE.get(phone)?.code ?? null
}

export function isTestOtpPhone(phone: E164Phone | string): boolean {
  return BY_PHONE.has(phone)
}

export function testOtpNumberFor(phone: E164Phone | string): TestOtpNumber | undefined {
  return BY_PHONE.get(phone)
}
