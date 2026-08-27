/**
 * Test-number tests.
 *
 * A predictable OTP code is a deliberate weakening, so the properties that keep it safe are the
 * ones worth asserting: the numbers are unreachable by a real person, they do not collide with
 * the development fixtures, and no number outside the published pair ever gets a fixed code.
 */

import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_IDENTITIES, DEVELOPMENT_PHONE_PREFIX } from './auth-mode.js'
import { OTP_LENGTH } from './otp.js'
import { normalizePhone } from './phone.js'
import {
  TEST_OTP_NUMBERS,
  fixedOtpCodeFor,
  isTestOtpPhone,
  testOtpNumberFor,
} from './test-numbers.js'

describe('the published pair', () => {
  it('offers exactly one farmer and one consumer', () => {
    expect(TEST_OTP_NUMBERS).toHaveLength(2)
    expect(TEST_OTP_NUMBERS.map((n) => n.intendedRole).sort()).toEqual(['CONSUMER', 'FARMER'])
  })

  it('issues codes of the length the verify form accepts', () => {
    // A code of the wrong length could never be typed into the six-digit input.
    for (const entry of TEST_OTP_NUMBERS) {
      expect(entry.code).toMatch(/^\d+$/)
      expect(entry.code).toHaveLength(OTP_LENGTH)
    }
  })

  it('gives each number a different code', () => {
    /*
     * With one shared code, a bug that verified against the WRONG challenge would still appear to
     * work. Distinct codes make a passing test mean the right challenge matched.
     */
    const codes = TEST_OTP_NUMBERS.map((n) => n.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('uses numbers that are structurally valid, so they meet every real constraint', () => {
    // If these failed normalisation they would prove nothing about the real flow.
    for (const entry of TEST_OTP_NUMBERS) {
      expect(() => normalizePhone(entry.phone)).not.toThrow()
      expect(normalizePhone(entry.phone)).toBe(entry.phone)
    }
  })

  it('uses numbers no operator assigns to a person', () => {
    /*
     * The wider `+88017000000…` reserved area, which the development fixtures also sit in — so
     * nobody can receive an SMS on one of these.
     *
     * Note this is a CHARACTER shorter than `DEVELOPMENT_PHONE_PREFIX` (`+880170000000`). The
     * fixtures occupy that 13-character prefix plus one digit; these sit just outside it, which
     * is the separation the next test pins down.
     */
    const RESERVED_AREA = '+88017000000'
    expect(DEVELOPMENT_PHONE_PREFIX.startsWith(RESERVED_AREA)).toBe(true)

    for (const entry of TEST_OTP_NUMBERS) {
      expect(entry.phone.startsWith(RESERVED_AREA)).toBe(true)
    }
  })

  it('does not collide with any development fixture', () => {
    /*
     * The two mechanisms are separate on purpose — fixtures sign in WITHOUT a code, these sign in
     * WITH one. A shared number would mean one account reachable two ways, and the weaker way
     * would decide its security.
     */
    const fixtures = new Set(DEVELOPMENT_IDENTITIES.map((i) => i.phone))
    for (const entry of TEST_OTP_NUMBERS) {
      expect(fixtures.has(entry.phone)).toBe(false)
    }
  })

  it('does not sit in the block the fixture CHECK constraint reserves', () => {
    /*
     * `users_dev_fixture_reserved_block` allows `is_development_fixture` only on
     * +880170000000[1-9]. These numbers are outside it, so a test account can never be marked a
     * fixture and pick up the code-free sign-in path as well.
     */
    for (const entry of TEST_OTP_NUMBERS) {
      expect(entry.phone).not.toMatch(/^\+880170000000[1-9]$/)
    }
  })
})

describe('looking up a fixed code', () => {
  it('returns the published code for a test number', () => {
    for (const entry of TEST_OTP_NUMBERS) {
      expect(fixedOtpCodeFor(entry.phone)).toBe(entry.code)
      expect(isTestOtpPhone(entry.phone)).toBe(true)
      expect(testOtpNumberFor(entry.phone)?.label).toBe(entry.label)
    }
  })

  it('returns null for every other number', () => {
    /*
     * The property that matters most. Anything but an exact match must fall through to
     * `random.numericCode()` — including the development fixtures and numbers adjacent to the
     * published pair.
     */
    for (const phone of [
      '+8801712345678',
      '+8801700000001',
      '+8801700000009',
      '+8801700000010',
      '+8801700000013',
      '+880170000001',
      '',
    ]) {
      expect(fixedOtpCodeFor(phone)).toBeNull()
      expect(isTestOtpPhone(phone)).toBe(false)
    }
  })

  it('does not match on a prefix', () => {
    // A prefix match would hand a fixed code to a whole range of numbers.
    expect(fixedOtpCodeFor('+88017000000110')).toBeNull()
    expect(fixedOtpCodeFor('+880170000001')).toBeNull()
  })
})
