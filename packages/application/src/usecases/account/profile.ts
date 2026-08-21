/**
 * The signed-in user's own account.
 *
 * Both operations are scoped to the actor themselves. There is deliberately no `userId` parameter
 * on either: a use case that can read "any user" by argument is one `req.query.id` away from an
 * IDOR, and the safest way to not have that bug is to not have that parameter.
 *
 * Refs: docs/07_SECURITY.md §4, §7
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import {
  ProfileError,
  nextOnboardingStatus,
  validateProfileUpdate,
  type OnboardingStatus,
} from '@langgol/domain/identity'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { AccountRepository, AuditPort, Clock, UserProfileRecord } from '../../ports/index.js'

export interface AccountDeps {
  readonly clock: Clock
  readonly accounts: AccountRepository
  readonly audit: AuditPort
}

/* ------------------------------------------------------------ get current user */

/**
 * The signed-in user's profile.
 *
 * Returns NOT_FOUND rather than FORBIDDEN when the row is missing, because at this point the
 * session already proved who they are — a missing row is a data problem, not an access decision.
 */
export async function getCurrentUser(
  actor: MaybeActor,
  deps: AccountDeps,
): Promise<Result<UserProfileRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'user:read-self')) return err(Errors.forbidden())

  const profile = await deps.accounts.findProfile(actor.userId)
  if (!profile) return err(Errors.notFound('Account'))

  return ok(profile)
}

/* --------------------------------------------------------- update current user */

export interface UpdateCurrentUserCommand {
  readonly fullName?: string
  readonly email?: string | null
  readonly preferredLanguage?: string
  /** ISO `YYYY-MM-DD`, or null to clear. Parsed here so the caller never handles a Date. */
  readonly dateOfBirth?: string | null
  readonly gender?: string | null
  readonly profilePhotoKey?: string | null
}

/**
 * Update the signed-in user's own profile.
 *
 * Notably absent, and absent on purpose:
 *
 *  - **phone** — it is the authentication identifier, so changing it is an auth flow with its own
 *    OTP challenge (`OtpPurpose.PHONE_CHANGE` already exists for it), not a profile edit;
 *  - **roles** — held through `UserRoleAssignment` and changed only by the role use cases;
 *  - **status** — suspension is an administrative act, and a user who could set their own status
 *    could un-suspend themselves.
 *
 * A field absent from the command is left alone; a field present and null is cleared. That
 * distinction is what makes a partial update safe.
 */
export async function updateCurrentUser(
  actor: MaybeActor,
  command: UpdateCurrentUserCommand,
  deps: AccountDeps,
): Promise<Result<UserProfileRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'user:update-self')) return err(Errors.forbidden())

  const now = deps.clock.now()

  // A date arrives as a string and becomes a Date exactly once, here.
  let dateOfBirth: Date | null | undefined
  if (command.dateOfBirth !== undefined) {
    if (command.dateOfBirth === null || command.dateOfBirth.trim() === '') {
      dateOfBirth = null
    } else {
      const parsed = new Date(`${command.dateOfBirth}T00:00:00.000Z`)
      if (Number.isNaN(parsed.getTime())) {
        return err(Errors.validation('That is not a valid date', { field: 'dateOfBirth' }))
      }
      dateOfBirth = parsed
    }
  }

  let changes
  try {
    changes = validateProfileUpdate(
      {
        ...(command.fullName !== undefined ? { fullName: command.fullName } : {}),
        ...(command.email !== undefined ? { email: command.email } : {}),
        ...(command.preferredLanguage !== undefined
          ? { preferredLanguage: command.preferredLanguage }
          : {}),
        ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
        ...(command.gender !== undefined ? { gender: command.gender } : {}),
        ...(command.profilePhotoKey !== undefined
          ? { profilePhotoKey: command.profilePhotoKey }
          : {}),
      },
      now,
    )
  } catch (cause) {
    if (cause instanceof ProfileError) {
      return err(Errors.validation(cause.message, { field: cause.field, code: cause.code }))
    }
    throw cause
  }

  if (Object.keys(changes).length === 0) {
    // Nothing to do. Returning the current profile is friendlier than an error, and a form
    // submitted unchanged is a normal thing for a person to do.
    const current = await deps.accounts.findProfile(actor.userId)
    return current ? ok(current) : err(Errors.notFound('Account'))
  }

  const existing = await deps.accounts.findProfile(actor.userId)
  if (!existing) return err(Errors.notFound('Account'))

  /*
   * Confirming a name and a language is what moves a user off REGISTERED. Computed rather than
   * set by the client, and monotonic — clearing an optional field later does not un-onboard
   * someone who already finished.
   */
  const onboardingStatus = nextOnboardingStatus({
    current: existing.onboardingStatus as OnboardingStatus,
    roleCount: existing.roles.length,
    hasConfirmedProfile:
      (changes.fullName ?? existing.fullName).trim().length > 0 &&
      (changes.preferredLanguage ?? existing.preferredLanguage) !== undefined,
    hasRoleSetup: false,
  })

  /*
   * SUBMITTED is not the same as CHANGED. The form posts every field on every save, so acting on
   * the submitted set would write columns nobody touched and, worse, record in the audit log that
   * an email was edited when the user only picked a date of birth. An investigator reading that
   * line would be reading a false statement.
   */
  const edited = Object.keys(changes).filter((key) =>
    differs(changes[key as keyof typeof changes], existing[key as keyof UserProfileRecord]),
  )

  if (edited.length === 0 && onboardingStatus === existing.onboardingStatus) {
    // Genuinely nothing to do. Not an error — a form submitted unchanged is a normal thing for a
    // person to do, and it should not leave a trail suggesting otherwise.
    return ok(existing)
  }

  const updated = await deps.accounts.updateProfile(actor.userId, {
    ...Object.fromEntries(edited.map((key) => [key, changes[key as keyof typeof changes]])),
    ...(onboardingStatus !== existing.onboardingStatus ? { onboardingStatus } : {}),
  })
  if (!updated) return err(Errors.notFound('Account'))

  /*
   * Audited with the FIELD NAMES that changed, never the values. Knowing that a date of birth was
   * edited is what an investigation needs; copying the date into an audit row would spread
   * personal data into a table with a different retention policy. docs/07 §7, §11
   */
  if (edited.length > 0) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'PROFILE_UPDATED',
      entityType: 'user',
      entityId: actor.userId,
      reason: [...edited].sort().join(','),
    })
  }

  return ok(updated)
}

/**
 * Whether a submitted value actually differs from the stored one.
 *
 * Dates compare by instant, not by identity — two `Date` objects for the same day are never `===`,
 * and treating them as different would mark every save as an edit.
 */
function differs(next: unknown, current: unknown): boolean {
  if (next instanceof Date && current instanceof Date) {
    return next.getTime() !== current.getTime()
  }
  return next !== current
}
