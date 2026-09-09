/**
 * Sign out.
 *
 * Sessions are database-backed precisely so this is meaningful: revocation takes effect on the
 * next request everywhere, which a stateless token cannot offer.
 *
 * `everywhere` exists because "sign out of all devices" is the action a user takes when they
 * believe something is wrong, and it must not be harder to reach than the ordinary one.
 */

import { ok, type AppError, type Result } from '@langgol/shared'
import type { AuditPort, Clock, SecretHasher, SessionRepository } from '../../ports/index.js'

export interface SignOutCommand {
  readonly sessionToken: string
  readonly userId: string
  /** Revoke every session for this user, not only the one presenting the token. */
  readonly everywhere?: boolean
  readonly reason?: string
}

export interface SignOutResult {
  readonly revoked: number
}

export interface SignOutDeps {
  readonly clock: Clock
  readonly hasher: SecretHasher
  readonly sessions: SessionRepository
  readonly audit: AuditPort
}

export async function signOut(
  command: SignOutCommand,
  deps: SignOutDeps,
): Promise<Result<SignOutResult, AppError>> {
  const now = deps.clock.now()
  const reason = command.reason ?? 'USER_SIGNED_OUT'

  let revoked = 1
  if (command.everywhere === true) {
    revoked = await deps.sessions.revokeAllForUser({ userId: command.userId, at: now, reason })
  } else {
    // The token is looked up by hash; the plaintext never leaves this call.
    await deps.sessions.revoke({
      tokenHash: deps.hasher.hashToken(command.sessionToken),
      at: now,
      reason,
    })
  }

  await deps.audit.record({
    actorUserId: command.userId,
    action: command.everywhere === true ? 'SIGNED_OUT_ALL' : 'SIGNED_OUT',
    entityType: 'user',
    entityId: command.userId,
    reason,
  })

  return ok({ revoked })
}
