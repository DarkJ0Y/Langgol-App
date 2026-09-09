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
  REGISTERABLE_ROLES,
  decodeHandoff,
  destinationAfterRoleSelection,
  destinationAfterSignIn,
  encodeHandoff,
  handoffExpiry,
} from './otp-handoff-policy'
import { SELF_SELECTABLE_ROLES, isPrivilegedRole } from '@langgol/domain/identity'

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

describe('which roles somebody may give themselves', () => {
  /*
   * The P14 audit found this list defined three times — here, in the verify-OTP use case, and in
   * the domain — all agreeing, which is exactly why nobody had noticed that widening one would
   * leave the others behind. There is now one definition, and this pins that the web app is still
   * reading it rather than having quietly grown a copy again.
   */
  it('is the domain list, not a copy of it', () => {
    expect([...REGISTERABLE_ROLES]).toEqual([...SELF_SELECTABLE_ROLES])
  })

  it('never includes a privileged role', () => {
    // The escalation this allowlist exists to prevent: choosing ADMIN at signup.
    for (const role of REGISTERABLE_ROLES) {
      expect(isPrivilegedRole(role), role).toBe(false)
    }
  })

  it('refuses a privileged role in a handoff cookie', () => {
    // The cookie is the outer of two gates. A handoff naming ADMIN fails to decode at all rather
    // than reaching the use case that would refuse it.
    const forged = JSON.stringify({
      phone: '+8801712345678',
      signup: { fullName: 'Someone', role: 'ADMIN' },
    })
    expect(decodeHandoff(forged)).toBeNull()
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

describe('where somebody lands having just chosen their role', () => {
  /*
   * A different question from signing in, and it has a different answer. Onboarding happens once;
   * signing in happens every day, and sending a returning retailer to a form they filled in
   * months ago would be a small insult repeated daily.
   */

  it('sends a farmer to their own questionnaire', () => {
    expect(destinationAfterRoleSelection('FARMER')).toBe('/farmer/onboarding')
  })

  it('sends a retailer to their business details', () => {
    // A shop that has not said what it is called or where it trades cannot usefully appear to
    // anybody, so this is the one screen worth interrupting for.
    expect(destinationAfterRoleSelection('RETAILER')).toBe('/account/profile')
  })

  it('sends a consumer to the market rather than to a questionnaire', () => {
    /*
     * Every consumer question is genuinely optional — dietary preferences and a default address.
     * Putting a form between somebody and the market they came for is how the market loses them;
     * the same form is a link away on their account page whenever they want it.
     */
    expect(destinationAfterRoleSelection('CONSUMER')).toBe('/')
  })

  it('sends an unrecognised role somewhere that exists', () => {
    // The role is checked against an allowlist before it reaches here. If that ever changes, the
    // failure should be a harmless redirect rather than a route that 404s.
    expect(destinationAfterRoleSelection('SOMETHING_ELSE')).toBe('/')
  })

  it('does not change where a returning user lands', () => {
    // The two functions answer two questions. This pins that they stayed separate.
    expect(destinationAfterSignIn(['RETAILER'])).toBe('/')
  })
})
