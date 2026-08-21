/**
 * Profile validation tests.
 *
 * The rules here decide what a farmer is allowed to type about themselves, so the ones worth
 * asserting are the ones that would exclude a real user if they were wrong — an age floor set
 * carelessly at 18 locks out smallholders who genuinely farm at 15.
 */

import { describe, expect, it } from 'vitest'
import {
  GENDERS,
  ProfileError,
  isGender,
  isLanguageCode,
  isOnboardingStatus,
  nextOnboardingStatus,
  validateProfileUpdate,
  yearsBetween,
} from './profile.js'

const NOW = new Date('2026-08-20T00:00:00.000Z')

describe('partial updates stay partial', () => {
  it('returns only the keys that were supplied', () => {
    const result = validateProfileUpdate({ fullName: 'Rahim Uddin' }, NOW)
    expect(Object.keys(result)).toEqual(['fullName'])
  })

  it('does not invent a value for an absent field', () => {
    // The bug this guards: a form that posts one field blanking every other column.
    const result = validateProfileUpdate({ gender: 'FEMALE' }, NOW)
    expect(result).not.toHaveProperty('fullName')
    expect(result).not.toHaveProperty('email')
  })

  it('distinguishes "absent" from "explicitly cleared"', () => {
    expect(validateProfileUpdate({ email: null }, NOW)).toEqual({ email: null })
    expect(validateProfileUpdate({}, NOW)).toEqual({})
  })
})

describe('name', () => {
  it('trims and accepts a normal name', () => {
    expect(validateProfileUpdate({ fullName: '  Rahim Uddin  ' }, NOW).fullName).toBe('Rahim Uddin')
  })

  it('accepts a Bangla name', () => {
    expect(validateProfileUpdate({ fullName: 'রহিম উদ্দিন' }, NOW).fullName).toBe('রহিম উদ্দিন')
  })

  it('refuses a name of only whitespace', () => {
    expect(() => validateProfileUpdate({ fullName: '   ' }, NOW)).toThrow(
      expect.objectContaining({ code: 'NAME_EMPTY' }),
    )
  })

  it('refuses an absurdly long name', () => {
    expect(() => validateProfileUpdate({ fullName: 'র'.repeat(200) }, NOW)).toThrow(
      expect.objectContaining({ code: 'NAME_TOO_LONG' }),
    )
  })
})

describe('email', () => {
  it('lower-cases so the unique index actually prevents duplicates', () => {
    // Rahim@Example.COM and rahim@example.com must not become two accounts.
    expect(validateProfileUpdate({ email: '  Rahim@Example.COM ' }, NOW).email).toBe(
      'rahim@example.com',
    )
  })

  it('treats an empty string as clearing the field', () => {
    expect(validateProfileUpdate({ email: '' }, NOW).email).toBeNull()
  })

  it('refuses something that is plainly not an address', () => {
    expect(() => validateProfileUpdate({ email: 'rahim at example' }, NOW)).toThrow(
      expect.objectContaining({ code: 'EMAIL_INVALID' }),
    )
  })
})

describe('date of birth', () => {
  it('accepts an adult', () => {
    const dob = new Date('1990-05-14T00:00:00.000Z')
    expect(validateProfileUpdate({ dateOfBirth: dob }, NOW).dateOfBirth).toEqual(dob)
  })

  it('accepts a 15-year-old — smallholders really do farm at that age', () => {
    // A carelessly-set floor of 18 would exclude exactly the users this platform exists for.
    const dob = new Date('2011-01-01T00:00:00.000Z')
    expect(() => validateProfileUpdate({ dateOfBirth: dob }, NOW)).not.toThrow()
  })

  it('refuses someone under 13', () => {
    const dob = new Date('2020-01-01T00:00:00.000Z')
    expect(() => validateProfileUpdate({ dateOfBirth: dob }, NOW)).toThrow(
      expect.objectContaining({ code: 'DOB_UNDERAGE' }),
    )
  })

  it('refuses a future date', () => {
    expect(() =>
      validateProfileUpdate({ dateOfBirth: new Date('2030-01-01T00:00:00.000Z') }, NOW),
    ).toThrow(expect.objectContaining({ code: 'DOB_IN_FUTURE' }))
  })

  it('refuses an implausible age, which is always a typo', () => {
    expect(() =>
      validateProfileUpdate({ dateOfBirth: new Date('1850-01-01T00:00:00.000Z') }, NOW),
    ).toThrow(expect.objectContaining({ code: 'DOB_TOO_OLD' }))
  })

  it('counts whole years by birthday, not by dividing milliseconds', () => {
    // The day before a birthday the person is still the younger age.
    expect(yearsBetween(new Date('2000-08-21T00:00:00Z'), new Date('2026-08-20T00:00:00Z'))).toBe(
      25,
    )
    expect(yearsBetween(new Date('2000-08-20T00:00:00Z'), new Date('2026-08-20T00:00:00Z'))).toBe(
      26,
    )
  })
})

describe('gender', () => {
  it('offers declining to answer as a real option', () => {
    // Distinct from a field never filled in — conflating them overstates how much is unknown.
    expect([...GENDERS]).toContain('PREFER_NOT_TO_SAY')
    expect(validateProfileUpdate({ gender: 'PREFER_NOT_TO_SAY' }, NOW).gender).toBe(
      'PREFER_NOT_TO_SAY',
    )
  })

  it('refuses a value outside the set', () => {
    expect(() => validateProfileUpdate({ gender: 'YES' }, NOW)).toThrow(
      expect.objectContaining({ code: 'GENDER_INVALID' }),
    )
  })

  it('has working guards', () => {
    expect(isGender('FEMALE')).toBe(true)
    expect(isGender('female')).toBe(false)
    expect(isLanguageCode('BN')).toBe(true)
    expect(isLanguageCode('FR')).toBe(false)
    expect(isOnboardingStatus('READY')).toBe(true)
    expect(isOnboardingStatus('DONE')).toBe(false)
  })
})

describe('language', () => {
  it('refuses an unsupported language rather than falling back silently', () => {
    expect(() => validateProfileUpdate({ preferredLanguage: 'FR' }, NOW)).toThrow(ProfileError)
  })
})

describe('onboarding status only moves forward', () => {
  it('advances as the user completes steps', () => {
    expect(
      nextOnboardingStatus({
        current: 'REGISTERED',
        roleCount: 1,
        hasConfirmedProfile: false,
        hasRoleSetup: false,
      }),
    ).toBe('ROLE_SELECTED')

    expect(
      nextOnboardingStatus({
        current: 'ROLE_SELECTED',
        roleCount: 1,
        hasConfirmedProfile: true,
        hasRoleSetup: false,
      }),
    ).toBe('PROFILE_COMPLETE')

    expect(
      nextOnboardingStatus({
        current: 'PROFILE_COMPLETE',
        roleCount: 1,
        hasConfirmedProfile: true,
        hasRoleSetup: true,
      }),
    ).toBe('READY')
  })

  it('never demotes someone who already finished', () => {
    // Clearing an optional field later must not re-trigger a setup flow they completed.
    expect(
      nextOnboardingStatus({
        current: 'READY',
        roleCount: 0,
        hasConfirmedProfile: false,
        hasRoleSetup: false,
      }),
    ).toBe('READY')
  })
})
