/**
 * User profile values and their validation.
 *
 * Pure, so the same rules apply to a form post, an admin edit and a seed without three
 * implementations drifting apart. Every rule here is one a Bangladeshi user could plausibly hit,
 * not a generic form-library default.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §1–2; docs/07_SECURITY.md §7
 */

export type ProfileErrorCode =
  | 'NAME_EMPTY'
  | 'NAME_TOO_LONG'
  | 'EMAIL_INVALID'
  | 'DOB_IN_FUTURE'
  | 'DOB_TOO_OLD'
  | 'DOB_UNDERAGE'
  | 'GENDER_INVALID'
  | 'LANGUAGE_INVALID'

export class ProfileError extends Error {
  readonly code: ProfileErrorCode
  readonly field: string

  constructor(code: ProfileErrorCode, field: string, message: string) {
    super(message)
    this.name = 'ProfileError'
    this.code = code
    this.field = field
  }
}

/**
 * Recorded because agricultural programmes and cooperative membership frequently report on it,
 * and because women's participation in Bangladeshi agriculture is a thing the pilot is expected
 * to measure. `PREFER_NOT_TO_SAY` is a first-class answer, not a null — a user declining to
 * answer is different from a record that was never filled in, and conflating them would
 * overstate how much is unknown.
 */
export const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const
export type Gender = (typeof GENDERS)[number]

export function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value)
}

/**
 * How far through setup an account is.
 *
 * A separate axis from `UserStatus`: an ACTIVE account can still be half-onboarded, and a
 * SUSPENDED one can be fully set up. Collapsing them into one column is how "why can this user
 * not list anything?" becomes unanswerable.
 *
 * The vocabulary itself moved to `domain/onboarding/states.ts` in P12, which widened it from four
 * milestones to eight and made it derivable from facts rather than accumulated by whichever screen
 * remembered to advance it. Re-exported here so the existing imports keep working and so identity
 * remains the one place a caller has to look for what a user *is*.
 */
import {
  NO_PROGRESS,
  advanceOnboardingState,
  deriveOnboardingState,
  type OnboardingState,
} from '../onboarding/index.js'

export {
  ONBOARDING_STATES as ONBOARDING_STATUSES,
  isOnboardingState as isOnboardingStatus,
  type OnboardingState as OnboardingStatus,
} from '../onboarding/states.js'

/** Local alias for the re-exported type, so signatures below read naturally. */
type OnboardingStatus = OnboardingState

export const LANGUAGES = ['BN', 'EN'] as const
export type LanguageCode = (typeof LANGUAGES)[number]

export function isLanguageCode(value: string): value is LanguageCode {
  return (LANGUAGES as readonly string[]).includes(value)
}

/** Long enough for a full Bangladeshi name with honorifics; short enough to bound the column. */
const NAME_MAX = 120

/**
 * Minimum age to hold an account.
 *
 * Not a rounded 18: a great many Bangladeshi smallholders begin farming earlier, and locking them
 * out would exclude exactly the users the platform exists for. 13 is the floor at which holding a
 * personal account is defensible; anything below it should be a guardian's account.
 */
const MIN_AGE_YEARS = 13

/** Beyond this a date of birth is a typo, not a person. */
const MAX_AGE_YEARS = 120

export interface ProfileUpdate {
  readonly fullName?: string
  readonly email?: string | null
  readonly preferredLanguage?: string
  readonly dateOfBirth?: Date | null
  readonly gender?: string | null
  readonly profilePhotoKey?: string | null
}

export interface ValidatedProfileUpdate {
  readonly fullName?: string
  readonly email?: string | null
  readonly preferredLanguage?: LanguageCode
  readonly dateOfBirth?: Date | null
  readonly gender?: Gender | null
  readonly profilePhotoKey?: string | null
}

/**
 * Deliberately permissive.
 *
 * Email is optional on this platform — phone is the identifier — so the only job here is to
 * reject something that clearly is not an address. An RFC-complete pattern rejects valid
 * addresses and would turn an optional field into a support ticket.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * Validate a partial profile update.
 *
 * Only the keys PRESENT in the input are validated and returned, so a caller updating one field
 * cannot accidentally blank the rest — a partial update must stay partial all the way down to
 * the query.
 */
export function validateProfileUpdate(input: ProfileUpdate, now: Date): ValidatedProfileUpdate {
  const output: {
    fullName?: string
    email?: string | null
    preferredLanguage?: LanguageCode
    dateOfBirth?: Date | null
    gender?: Gender | null
    profilePhotoKey?: string | null
  } = {}

  if (input.fullName !== undefined) {
    const trimmed = input.fullName.trim()
    if (trimmed.length === 0) {
      throw new ProfileError('NAME_EMPTY', 'fullName', 'A name is required')
    }
    if (trimmed.length > NAME_MAX) {
      throw new ProfileError(
        'NAME_TOO_LONG',
        'fullName',
        `A name may be at most ${String(NAME_MAX)} characters`,
      )
    }
    output.fullName = trimmed
  }

  if (input.email !== undefined) {
    if (input.email === null || input.email.trim() === '') {
      // Clearing an optional field is a legitimate edit, not a validation failure.
      output.email = null
    } else {
      const trimmed = input.email.trim().toLowerCase()
      if (!looksLikeEmail(trimmed)) {
        throw new ProfileError('EMAIL_INVALID', 'email', 'That does not look like an email address')
      }
      output.email = trimmed
    }
  }

  if (input.preferredLanguage !== undefined) {
    if (!isLanguageCode(input.preferredLanguage)) {
      throw new ProfileError('LANGUAGE_INVALID', 'preferredLanguage', 'Unsupported language')
    }
    output.preferredLanguage = input.preferredLanguage
  }

  if (input.dateOfBirth !== undefined) {
    if (input.dateOfBirth === null) {
      output.dateOfBirth = null
    } else {
      const dob = input.dateOfBirth
      if (Number.isNaN(dob.getTime())) {
        throw new ProfileError('DOB_IN_FUTURE', 'dateOfBirth', 'That is not a valid date')
      }
      if (dob.getTime() > now.getTime()) {
        throw new ProfileError(
          'DOB_IN_FUTURE',
          'dateOfBirth',
          'A date of birth cannot be in the future',
        )
      }

      const years = yearsBetween(dob, now)
      if (years > MAX_AGE_YEARS) {
        throw new ProfileError('DOB_TOO_OLD', 'dateOfBirth', 'Please check the date of birth')
      }
      if (years < MIN_AGE_YEARS) {
        throw new ProfileError(
          'DOB_UNDERAGE',
          'dateOfBirth',
          `An account holder must be at least ${String(MIN_AGE_YEARS)} years old`,
        )
      }
      output.dateOfBirth = dob
    }
  }

  if (input.gender !== undefined) {
    if (input.gender === null || input.gender === '') {
      output.gender = null
    } else {
      if (!isGender(input.gender)) {
        throw new ProfileError('GENDER_INVALID', 'gender', 'Unsupported value')
      }
      output.gender = input.gender
    }
  }

  if (input.profilePhotoKey !== undefined) {
    const key = input.profilePhotoKey
    output.profilePhotoKey = key === null || key.trim() === '' ? null : key.trim()
  }

  return output
}

/** Whole years elapsed, counting the birthday rather than dividing milliseconds. */
export function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear()
  const monthDelta = to.getUTCMonth() - from.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1
  }
  return years
}

/**
 * The next onboarding status for a user, given what they have.
 *
 * Monotonic: it never moves a user backwards. Someone who completed onboarding and later cleared
 * an optional field has not become un-onboarded, and demoting them would re-trigger a setup flow
 * they already finished.
 */
export function nextOnboardingStatus(input: {
  readonly current: OnboardingStatus
  readonly roleCount: number
  readonly hasConfirmedProfile: boolean
  readonly hasRoleSetup: boolean
  /** Absent for a caller that does not know. See the note about partial knowledge below. */
  readonly phoneVerified?: boolean
  readonly kycStatus?: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED'
}): OnboardingStatus {
  /*
   * A caller that knows only part of the picture advances a user only as far as that part
   * justifies, and never past it.
   *
   * The account use case, for instance, knows about names and roles and nothing about identity
   * documents. Defaulting the unknown facts to "not done" means it can raise somebody to
   * PROFILE_COMPLETED and stop, which is correct — and because the result is combined with the
   * stored value monotonically, it can never pull back a user whom the KYC flow had already
   * carried further.
   */
  const earned = deriveOnboardingState({
    ...NO_PROGRESS,
    hasConfirmedName: input.hasConfirmedProfile,
    phoneVerified: input.phoneVerified ?? true,
    roles: Array.from({ length: input.roleCount }, () => 'ROLE'),
    roleProfileStarted: input.hasRoleSetup,
    roleProfileComplete: input.hasRoleSetup,
    kycStatus: input.kycStatus ?? 'NONE',
  })

  return advanceOnboardingState(input.current, earned)
}
