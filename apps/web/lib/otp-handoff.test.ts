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
import {
  HANDOFF_GRACE_SECONDS,
  MAX_FULL_NAME_LENGTH,
  decodeHandoff,
  destinationAfterSignIn,
  encodeHandoff,
  handoffExpiry,
} from './otp-handoff-policy'

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

describe('carrying the signup intent', () => {
  it('round-trips a registration', () => {
    const handoff = {
      phone: '+8801712345678',
      signup: { fullName: 'করিম মিয়া', role: 'FARMER' as const },
    }
    expect(decodeHandoff(encodeHandoff(handoff))).toEqual(handoff)
  })

  it('round-trips a plain sign-in with no intent attached', () => {
    expect(decodeHandoff(encodeHandoff({ phone: '+8801712345678' }))).toEqual({
      phone: '+8801712345678',
    })
  })

  it('reads the pre-registration format as a sign-in', () => {
    /*
     * The cookie held a bare phone string before registration existed. Somebody mid-flow across
     * a deploy should sign in, not meet an error they have no way to act on.
     */
    expect(decodeHandoff('+8801712345678')).toEqual({ phone: '+8801712345678' })
  })

  it('refuses a role outside the self-selectable list', () => {
    /*
     * The gate that matters. Without it a crafted cookie could hand somebody ADMIN at the moment
     * their account is created — before any of the checks that guard role GRANTS ever run.
     * `verifyOtp` re-checks too; this is the outer of two gates, not a replacement for it.
     */
    const forged = JSON.stringify({
      phone: '+8801712345678',
      signup: { fullName: 'ক', role: 'ADMIN' },
    })
    expect(decodeHandoff(forged)).toBeNull()
  })

  it('fails the whole handoff on a bad role rather than degrading to a sign-in', () => {
    // Dropping the intent silently would create the account with no role and no explanation.
    const forged = JSON.stringify({ phone: '+880', signup: { fullName: 'ক', role: 'WHOLESALER' } })
    expect(decodeHandoff(forged)).toBeNull()
  })

  it('refuses a blank or absurdly long name', () => {
    for (const fullName of ['', '   ', 'ক'.repeat(MAX_FULL_NAME_LENGTH + 1)]) {
      const raw = JSON.stringify({ phone: '+8801712345678', signup: { fullName, role: 'FARMER' } })
      expect(decodeHandoff(raw)).toBeNull()
    }
  })

  it('trims the name it hands on', () => {
    const raw = JSON.stringify({
      phone: '+8801712345678',
      signup: { fullName: '  করিম  ', role: 'CONSUMER' },
    })
    expect(decodeHandoff(raw)?.signup?.fullName).toBe('করিম')
  })

  it('returns null for corrupt, empty or missing cookies', () => {
    for (const raw of [null, undefined, '', '   ', '{', '{"signup":{}}', '{"phone":""}']) {
      expect(decodeHandoff(raw)).toBeNull()
    }
  })

  it('ignores fields nobody put there', () => {
    // A cookie is attacker-shaped input even when it is HttpOnly; only the known keys are read.
    const raw = JSON.stringify({
      phone: '+8801712345678',
      signup: { fullName: 'করিম', role: 'FARMER' },
      isAdmin: true,
    })
    expect(decodeHandoff(raw)).toEqual({
      phone: '+8801712345678',
      signup: { fullName: 'করিম', role: 'FARMER' },
    })
  })
})

describe('where somebody lands after signing in', () => {
  it('sends a farmer to the questions that make their account useful', () => {
    expect(destinationAfterSignIn(['FARMER'])).toBe('/farmer/onboarding')
  })

  it('sends everybody else to the market they came for', () => {
    expect(destinationAfterSignIn(['CONSUMER'])).toBe('/')
    expect(destinationAfterSignIn(['RETAILER'])).toBe('/')
    expect(destinationAfterSignIn([])).toBe('/')
  })

  it('treats somebody who farms and buys as a farmer', () => {
    // One account, several roles. The farmer half is the one with setup left to do.
    expect(destinationAfterSignIn(['CONSUMER', 'FARMER'])).toBe('/farmer/onboarding')
  })
})
