/**
 * Verification policy tests.
 *
 * Small surface, but two of these assertions are load-bearing: that the purpose vocabulary keeps
 * login separate from everything else, and that an address is masked before it can reach a log.
 */

import { describe, expect, it } from 'vitest'
import {
  OTP_PURPOSES,
  VERIFICATION_PURPOSES,
  VERIFICATION_TOKEN_BYTES,
  emailVerificationRequired,
  evaluateVerificationToken,
  isOtpPurpose,
  isVerificationPurpose,
  maskEmail,
} from './verification.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')

describe('purposes', () => {
  it('keeps login separate from every other reason to send a code', () => {
    // The whole point of the vocabulary: budgets, lookups and invalidation are per purpose, so
    // verifying a number cannot spend the allowance needed to sign in.
    expect([...OTP_PURPOSES]).toEqual(['LOGIN', 'PHONE_VERIFY', 'PHONE_CHANGE', 'PAYOUT_CHANGE'])
    expect(new Set(OTP_PURPOSES).size).toBe(OTP_PURPOSES.length)
  })

  it('recognises its own members and nothing else', () => {
    for (const purpose of OTP_PURPOSES) expect(isOtpPurpose(purpose)).toBe(true)
    expect(isOtpPurpose('LOGOUT')).toBe(false)
    expect(isOtpPurpose('login')).toBe(false)

    for (const purpose of VERIFICATION_PURPOSES) expect(isVerificationPurpose(purpose)).toBe(true)
    expect(isVerificationPurpose('PASSWORD_RESET')).toBe(false)
  })

  it('does not let a phone purpose masquerade as a token purpose', () => {
    expect(isVerificationPurpose('LOGIN')).toBe(false)
    expect(isOtpPurpose('EMAIL_VERIFY')).toBe(false)
  })
})

describe('token sizing', () => {
  it('matches a session token, because a live link is a bearer credential', () => {
    expect(VERIFICATION_TOKEN_BYTES).toBe(32)
    // 256 bits. Anything below 128 would be guessable at scale.
    expect(VERIFICATION_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128)
  })
})

describe('email is optional to the platform', () => {
  it('is never required', () => {
    /*
     * Pinned deliberately. The MVP requirements say "email optional", and a farmer with a feature
     * phone and no inbox is the primary user rather than an edge case. Flipping this to true
     * should require editing an assertion that says why.
     */
    expect(emailVerificationRequired()).toBe(false)
  })
})

describe('redeeming a token', () => {
  const live = { expiresAt: new Date(NOW.getTime() + 1000), consumedAt: null, revokedAt: null }

  it('accepts a live, unused token', () => {
    expect(evaluateVerificationToken(live, NOW)).toBe('ACCEPTED')
  })

  it('refuses one already used', () => {
    expect(evaluateVerificationToken({ ...live, consumedAt: NOW }, NOW)).toBe('ALREADY_USED')
  })

  it('refuses one superseded by a newer request', () => {
    expect(evaluateVerificationToken({ ...live, revokedAt: NOW }, NOW)).toBe('REVOKED')
  })

  it('refuses one past its expiry', () => {
    const expired = { ...live, expiresAt: new Date(NOW.getTime() - 1) }
    expect(evaluateVerificationToken(expired, NOW)).toBe('EXPIRED')
  })

  it('treats the exact expiry instant as expired', () => {
    // `<=`, not `<`. A token valid at the moment it expires is a token with a longer life than
    // its own configuration claims.
    expect(evaluateVerificationToken({ ...live, expiresAt: NOW }, NOW)).toBe('EXPIRED')
  })

  it('reports reuse ahead of expiry for a token that is both', () => {
    // Order matters for the audit trail: the first thing that happened to it is the useful fact.
    const both = { expiresAt: new Date(NOW.getTime() - 1), consumedAt: NOW, revokedAt: null }
    expect(evaluateVerificationToken(both, NOW)).toBe('ALREADY_USED')
  })
})

describe('masking an address', () => {
  it('keeps the domain and hides the person', () => {
    // The domain is what makes a bounce or an abusive-signup pattern investigable; the local
    // part is the bit that identifies someone.
    expect(maskEmail('rahim.uddin@example.com')).toBe('r*********n@example.com')
  })

  it('never leaves the full local part visible', () => {
    for (const address of ['a@b.com', 'ab@b.com', 'abc@b.com', 'rahim@example.com']) {
      const masked = maskEmail(address)
      const local = address.slice(0, address.lastIndexOf('@'))
      if (local.length > 2) expect(masked).not.toContain(local)
      expect(masked).toContain('*')
    }
  })

  it('hides a two-character local part entirely rather than revealing half of it', () => {
    expect(maskEmail('ab@example.com')).toBe('**@example.com')
    expect(maskEmail('a@example.com')).toBe('**@example.com')
  })

  it('refuses to guess at something that is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('****')
    expect(maskEmail('')).toBe('****')
    expect(maskEmail('@example.com')).toBe('****')
  })

  it('masks the local part of an address containing an @ in quotes', () => {
    // lastIndexOf, not indexOf — otherwise the "domain" would include part of the local name.
    expect(maskEmail('a@b@example.com')).toBe('a*b@example.com')
  })
})
