/**
 * Verify a one-time code and establish a session.
 *
 * On first successful verification the account is created — signup and login are the same flow,
 * because asking a farmer to distinguish them on a 3G connection is friction for no benefit.
 * The role chosen at signup is recorded; a returning user's roles are untouched.
 *
 * The session token is generated here, returned **once**, and stored only as a SHA-256 hash. A
 * stolen database yields no usable session.
 */

import {
  evaluateOtpAttempt,
  maskPhone,
  normalizePhone,
  PhoneError,
  type E164Phone,
} from '@langgol/domain/identity'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  OtpChallengeRepository,
  RandomSource,
  SecretHasher,
  SessionRepository,
  UserRepository,
} from '../../ports/index.js'

/**
 * Roles a user may self-select at signup. Privileged roles are granted by an admin, never chosen.
 *
 * Re-exported from the domain rather than restated. This list was defined here in full until the
 * P14 audit, alongside identical copies in `domain/identity/roles.ts` and the web app's OTP
 * handoff policy — three allowlists deciding which roles somebody may give themselves.
 *
 * They agreed, so nothing was exploitable. What made it worth fixing is the failure mode: widening
 * one for a new signup flow leaves the others unchanged, and which list actually guards then
 * depends on which check happens to run first. There is now one, and a test asserts the web app's
 * own list still matches it.
 */
import { SELF_SELECTABLE_ROLES, type SelfSelectableRole } from '@langgol/domain/identity'

export { SELF_SELECTABLE_ROLES, type SelfSelectableRole }

export interface VerifyOtpCommand {
  readonly phone: string
  readonly code: string
  /** Used only when the account does not yet exist. */
  readonly signup?: {
    readonly fullName: string
    readonly role: SelfSelectableRole
    readonly preferredLanguage: 'BN' | 'EN'
  }
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

export interface VerifyOtpResult {
  readonly userId: string
  /** Returned once. Never stored, never logged. */
  readonly sessionToken: string
  readonly expiresAt: Date
  readonly isNewAccount: boolean
  readonly roles: readonly string[]
}

export interface VerifyOtpDeps {
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly random: RandomSource
  readonly hasher: SecretHasher
  readonly challenges: OtpChallengeRepository
  readonly users: UserRepository
  readonly sessions: SessionRepository
  readonly audit: AuditPort
}

export async function verifyOtp(
  command: VerifyOtpCommand,
  deps: VerifyOtpDeps,
): Promise<Result<VerifyOtpResult, AppError>> {
  let phone: E164Phone
  try {
    phone = normalizePhone(command.phone)
  } catch (error) {
    if (error instanceof PhoneError) {
      return err(Errors.validation(error.message, { field: 'phone', code: error.code }))
    }
    throw error
  }

  const now = deps.clock.now()
  const challenge = await deps.challenges.findLatestActive(phone, 'LOGIN', now)

  if (challenge === null) {
    // Same error whether the challenge never existed, expired or was already used — the
    // distinction would tell an attacker which numbers have recently requested a code.
    return err(Errors.validation('That code is not valid. Request a new one.', { field: 'code' }))
  }

  const codeMatches = await deps.hasher.verify(command.code, challenge.codeHash)
  const evaluation = evaluateOtpAttempt(
    {
      expiresAt: challenge.expiresAt,
      attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts,
      consumedAt: challenge.consumedAt,
    },
    codeMatches,
    now,
  )

  if (evaluation.verdict !== 'ACCEPTED') {
    // Record the attempt BEFORE returning, so a failed guess always counts even if the caller
    // retries aggressively. This is what makes the attempt cap real.
    await deps.challenges.recordAttempt(challenge.id)
    if (evaluation.burn) await deps.challenges.burn(challenge.id, now)

    await deps.audit.record({
      actorUserId: null,
      action: 'OTP_VERIFY_FAILED',
      entityType: 'phone',
      entityId: maskPhone(phone),
      reason: evaluation.verdict,
      ipAddress: command.ipAddress,
    })

    if (evaluation.verdict === 'TOO_MANY_ATTEMPTS') {
      return err(Errors.rateLimited(0))
    }
    return err(
      Errors.validation('That code is not valid. Request a new one.', {
        field: 'code',
        attemptsRemaining: evaluation.attemptsRemaining,
      }),
    )
  }

  await deps.challenges.consume(challenge.id, now)

  // --- Resolve or create the account ---------------------------------------
  let user = await deps.users.findByPhone(phone)
  let isNewAccount = false

  if (user === null) {
    if (command.signup === undefined) {
      return err(
        Errors.validation('This number is not registered yet. Choose a role to continue.', {
          field: 'signup',
        }),
      )
    }
    user = await deps.users.createWithRole({
      phone,
      fullName: command.signup.fullName.trim(),
      role: command.signup.role,
      preferredLanguage: command.signup.preferredLanguage,
      verifiedAt: now,
    })
    isNewAccount = true
  } else {
    await deps.users.markPhoneVerified(user.id, now)
  }

  if (user.status !== 'ACTIVE') {
    await deps.audit.record({
      actorUserId: user.id,
      action: 'LOGIN_BLOCKED',
      entityType: 'user',
      entityId: user.id,
      reason: user.status,
      ipAddress: command.ipAddress,
    })
    // A suspended user is told plainly rather than left guessing why login fails.
    return err(
      Errors.preconditionFailed(
        user.status === 'SUSPENDED'
          ? 'This account is suspended. Contact Langgol support.'
          : 'This account is no longer active.',
      ),
    )
  }

  // --- Establish the session ------------------------------------------------
  const idleTimeouts = deps.config.require('auth.session.idleTimeoutDays')
  const isPrivileged = user.roles.includes('ADMIN') || user.roles.includes('OPS_AGENT')
  const days = isPrivileged ? idleTimeouts.ADMIN : idleTimeouts.DEFAULT

  const sessionToken = deps.random.sessionToken()
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  await deps.sessions.create({
    userId: user.id,
    tokenHash: deps.hasher.hashToken(sessionToken),
    expiresAt,
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
  })

  await deps.users.recordLogin(user.id, now)
  await deps.audit.record({
    actorUserId: user.id,
    action: isNewAccount ? 'ACCOUNT_CREATED' : 'LOGIN_SUCCEEDED',
    entityType: 'user',
    entityId: user.id,
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
  })

  return ok({
    userId: user.id,
    sessionToken,
    expiresAt,
    isNewAccount,
    roles: user.roles,
  })
}
