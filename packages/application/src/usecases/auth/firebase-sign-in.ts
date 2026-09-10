/**
 * Sign in with a Firebase ID token.
 *
 * Firebase Authentication has already sent a code, checked it, and issued a signed token asserting
 * a phone number. This use case turns that assertion into a Langgol session.
 *
 * ## What Firebase decides, and what it does not
 *
 * Firebase decides ONE thing: that the caller controls this phone number. Everything after that is
 * unchanged from the OTP path and stays in PostgreSQL — the account, its roles, its suspension
 * status, the session, the audit line, and every authorization decision that follows. A verified
 * token for a suspended account still cannot sign in.
 *
 * That boundary is the reason this was worth building as a mode rather than a rewrite. Nothing
 * above this file knows which mode issued a session, because a session is a session.
 *
 * ## Signup and login are still one flow
 *
 * As with OTP, a first successful verification creates the account. Asking a farmer on a 3G
 * connection to know in advance whether they are registering or returning is friction for no
 * benefit, so the distinction is inferred rather than asked.
 *
 * Refs: docs/03_ARCHITECTURE.md ADR-22; docs/07_SECURITY.md §3
 */

import {
  assertModePermitted,
  maskPhone,
  normalizePhone,
  PhoneError,
  type AppEnvironment,
  type AuthMode,
  type E164Phone,
} from '@langgol/domain/identity'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import { SELF_SELECTABLE_ROLES, type SelfSelectableRole } from '@langgol/domain/identity'
import type {
  AuditPort,
  Clock,
  FirebaseIdentityVerifier,
  RandomSource,
  SecretHasher,
  SessionRepository,
  UserRepository,
} from '../../ports/index.js'

export interface FirebaseSignInCommand {
  /**
   * The ID token from the browser's Firebase sign-in.
   *
   * A bearer credential. Never logged, never audited, never returned in an error.
   */
  readonly idToken: string
  /** Used only when the account does not yet exist. */
  readonly signup?: {
    readonly fullName: string
    readonly role: SelfSelectableRole
    readonly preferredLanguage: 'BN' | 'EN'
  }
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

export interface FirebaseSignInResult {
  readonly userId: string
  /** Returned once. Never stored, never logged. */
  readonly sessionToken: string
  readonly expiresAt: Date
  readonly isNewAccount: boolean
  readonly roles: readonly string[]
}

export interface FirebaseSignInDeps {
  readonly environment: AppEnvironment
  readonly authMode: AuthMode
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly random: RandomSource
  readonly hasher: SecretHasher
  readonly firebase: FirebaseIdentityVerifier
  readonly users: UserRepository
  readonly sessions: SessionRepository
  readonly audit: AuditPort
}

export async function firebaseSignIn(
  command: FirebaseSignInCommand,
  deps: FirebaseSignInDeps,
): Promise<Result<FirebaseSignInResult, AppError>> {
  // Re-asserted here as well as at startup, so a mis-wired dependency or a stale cached config
  // cannot reach the sign-in path with a mode the environment forbids.
  assertModePermitted(deps.environment, deps.authMode)

  if (deps.authMode !== 'firebase') {
    return err(
      Errors.preconditionFailed('Firebase sign-in is not available: AUTH_MODE is not firebase.'),
    )
  }

  const identity = await deps.firebase.verifyIdToken(command.idToken)

  if (identity === null) {
    /*
     * One error for every way a token can fail, and no detail about which.
     *
     * The audit line carries no identifier at all, because there is nothing trustworthy in an
     * unverified token to record — anything taken from its claims would be attacker-controlled
     * text written into an operator's table.
     */
    await deps.audit.record({
      actorUserId: null,
      action: 'FIREBASE_SIGN_IN_REJECTED',
      entityType: 'firebase_token',
      entityId: 'unverified',
      reason: 'TOKEN_NOT_VERIFIED',
      ipAddress: command.ipAddress,
    })
    return err(Errors.validation('That sign-in could not be verified. Try again.'))
  }

  /*
   * Normalised through the same domain function as every other entry point.
   *
   * Firebase issues E.164 and this would almost certainly pass through unchanged. It is done
   * anyway because "almost certainly" is how a second, subtly different notion of the same phone
   * number gets into a database that has a unique constraint on it.
   */
  let phone: E164Phone
  try {
    phone = normalizePhone(identity.phone)
  } catch (error) {
    if (error instanceof PhoneError) {
      /*
       * A verified token carrying a number this system cannot represent. Not the user's fault and
       * not something they can fix, so it is recorded for an operator rather than explained to
       * them. Reached if Firebase is configured for a country Langgol does not serve.
       */
      await deps.audit.record({
        actorUserId: null,
        action: 'FIREBASE_SIGN_IN_REJECTED',
        entityType: 'firebase_token',
        entityId: identity.uid.slice(0, 64),
        reason: `UNSUPPORTED_PHONE:${error.code}`,
        ipAddress: command.ipAddress,
      })
      return err(Errors.validation('That number cannot be used on Langgol.', { field: 'phone' }))
    }
    throw error
  }

  const now = deps.clock.now()

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

    /*
     * The role is re-checked against the allowlist even though the type says it is safe.
     *
     * The type is erased at the boundary: this command arrives from a form post, and TypeScript
     * cannot enforce anything about what actually came over the wire. The P14 audit found this
     * allowlist duplicated in three places; there is one now, and this is a use of it rather than
     * a fourth copy.
     */
    if (!(SELF_SELECTABLE_ROLES as readonly string[]).includes(command.signup.role)) {
      return err(Errors.validation('That role cannot be chosen at signup.', { field: 'role' }))
    }

    user = await deps.users.createWithRole({
      phone,
      fullName: command.signup.fullName.trim(),
      role: command.signup.role,
      preferredLanguage: command.signup.preferredLanguage,
      verifiedAt: identity.verifiedAt,
    })
    isNewAccount = true
  } else {
    await deps.users.markPhoneVerified(user.id, identity.verifiedAt)
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

  /*
   * The mode is recorded on the audit line.
   *
   * An investigator looking at a session months from now needs to know which party verified the
   * number, because the controls behind the two are different: under `otp` the attempt cap and
   * the spend limit are ours, under `firebase` they are Google's.
   */
  await deps.audit.record({
    actorUserId: user.id,
    action: 'FIREBASE_SIGNED_IN',
    entityType: 'user',
    entityId: user.id,
    reason: isNewAccount ? 'NEW_ACCOUNT' : 'RETURNING',
    meta: { authMode: 'firebase', maskedPhone: maskPhone(phone) },
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
