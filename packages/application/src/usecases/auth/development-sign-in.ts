/**
 * Development sign-in.
 *
 * A scaffold so engineering can proceed before SMS infrastructure is contracted. It is written
 * to be **impossible to activate accidentally in production**, and everything it does is
 * auditable.
 *
 * What it is NOT, deliberately:
 *
 *  - Not impersonation. The caller supplies a key from a **closed allowlist**, never a user id,
 *    a phone number or a search term. There is no input by which an arbitrary account could be
 *    reached.
 *  - Not role selection. Each fixture's roles are declared in the domain and are not selectable
 *    by the caller, so there is no path to privilege escalation.
 *  - Not a fallback. It refuses when the environment is production even if configuration says
 *    otherwise, and the repository can only return rows flagged as fixtures — a flag a database
 *    CHECK confines to a reserved phone block.
 *
 * OTP remains the production mechanism and is untouched.
 *
 * Refs: docs/03_ARCHITECTURE.md ADR-22; docs/07_SECURITY.md §3
 */

import {
  assertModePermitted,
  findDevelopmentIdentity,
  maskPhone,
  type AppEnvironment,
  type AuthMode,
} from '@langgol/domain/identity'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  RandomSource,
  SecretHasher,
  SessionRepository,
  UserRepository,
} from '../../ports/index.js'

export interface DevelopmentSignInCommand {
  /** A key from `DEVELOPMENT_IDENTITIES`. Not a user id, not a phone number. */
  readonly identityKey: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

export interface DevelopmentSignInResult {
  readonly userId: string
  readonly sessionToken: string
  readonly expiresAt: Date
  readonly roles: readonly string[]
  readonly identityKey: string
  /** Always true — surfaces the development banner the UI must show. */
  readonly isDevelopmentSession: true
}

export interface DevelopmentSignInDeps {
  readonly environment: AppEnvironment
  readonly authMode: AuthMode
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly random: RandomSource
  readonly hasher: SecretHasher
  readonly users: UserRepository
  readonly sessions: SessionRepository
  readonly audit: AuditPort
}

export async function developmentSignIn(
  command: DevelopmentSignInCommand,
  deps: DevelopmentSignInDeps,
): Promise<Result<DevelopmentSignInResult, AppError>> {
  // Guard 2 of 3. Startup already refused this combination; refusing again here means a
  // mis-wired dependency or a stale cached config cannot open the door.
  assertModePermitted(deps.environment, deps.authMode)

  if (deps.authMode !== 'development') {
    return err(
      Errors.preconditionFailed(
        'Development sign-in is not available: AUTH_MODE is not development.',
      ),
    )
  }

  const identity = findDevelopmentIdentity(command.identityKey)
  if (identity === undefined) {
    await deps.audit.record({
      actorUserId: null,
      action: 'DEV_SIGN_IN_REJECTED',
      entityType: 'development_identity',
      entityId: command.identityKey.slice(0, 64),
      reason: 'UNKNOWN_IDENTITY',
      ipAddress: command.ipAddress,
    })
    return err(Errors.validation('Unknown development identity.', { field: 'identityKey' }))
  }

  // Guard 3 of 3. Scoped at the database to rows carrying the fixture flag, which a CHECK
  // constraint confines to the reserved phone block. A real user's row cannot be returned here.
  const user = await deps.users.findDevelopmentFixture(identity.phone)
  if (user === null) {
    return err(
      Errors.preconditionFailed(
        'Development fixtures are not present in this database. Run `pnpm db:seed` in a development environment.',
      ),
    )
  }

  if (user.status !== 'ACTIVE') {
    return err(Errors.preconditionFailed('That development identity is not active.'))
  }

  const now = deps.clock.now()
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

  // Every development sign-in is audited and marked as such, so a development session is never
  // mistaken for a real one when reading the log later.
  await deps.audit.record({
    actorUserId: user.id,
    action: 'DEV_SIGNED_IN',
    entityType: 'user',
    entityId: user.id,
    reason: `identity=${identity.key}`,
    meta: { authMode: 'development', maskedPhone: maskPhone(user.phone) },
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
  })

  return ok({
    userId: user.id,
    sessionToken,
    expiresAt,
    roles: user.roles,
    identityKey: identity.key,
    isDevelopmentSession: true,
  })
}
