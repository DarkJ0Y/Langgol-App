/**
 * OTP handoff tests.
 *
 * The cookie plumbing needs `next/headers` and is exercised by the flow itself; what is testable
 * here — and what actually went wrong — is the arithmetic and the naming.
 *
 * The bug this replaces: the verify step took the phone number from a hidden form input that the
 * page had no way to populate, because the page is only ever given the MASKED number. It posted
 * `""` on every submission, the schema rejected it, and every correct code was reported invalid.
 * OTP login could not complete at all — in production, where `AUTH_MODE=otp` is mandatory, that
 * is the only way in.
 */

import { describe, expect, it } from 'vitest'
import { HANDOFF_GRACE_SECONDS, handoffExpiry } from './otp-handoff-policy'

const NOW = new Date('2026-08-22T09:00:00.000Z')

describe('the handoff outlives the code it accompanies', () => {
  it('expires after the OTP, not before it', () => {
    /*
     * The failure this prevents is the most confusing one this flow can produce: the user types a
     * code that is genuinely still valid and is told it is not, because the number it belongs to
     * was forgotten first.
     */
    const otpTtl = 300
    const expiry = handoffExpiry(NOW, otpTtl)
    const codeExpiry = new Date(NOW.getTime() + otpTtl * 1000)

    expect(expiry.getTime()).toBeGreaterThan(codeExpiry.getTime())
  })

  it('adds exactly the stated grace, so the margin is not accidental', () => {
    expect(handoffExpiry(NOW, 300).getTime() - NOW.getTime()).toBe(
      (300 + HANDOFF_GRACE_SECONDS) * 1000,
    )
  })

  it('still outlives a very short TTL', () => {
    // A tightened OTP lifetime must not invert the relationship.
    for (const ttl of [30, 60, 120, 900]) {
      expect(handoffExpiry(NOW, ttl).getTime()).toBeGreaterThan(NOW.getTime() + ttl * 1000)
    }
  })

  it('does not linger for hours after the code dies', () => {
    // The number is PII; the window should be minutes, not a session.
    expect(HANDOFF_GRACE_SECONDS).toBeLessThanOrEqual(300)
  })
})
