/**
 * Role administration.
 *
 * Three operations — list, assign, revoke — each gated by the authorization policy rather than by
 * an `if` at the call site. The audit finding that prompted this phase was that the policy engine
 * existed and was never called; these use cases are where that stops being true.
 *
 * Every path here fails closed. An unknown role, a missing reason, an actor without the right
 * permission and an attempt to grant a privileged role under the ordinary permission are all
 * refused, and the refusals are audited — a rejected attempt to grant oneself ADMIN is worth
 * knowing about precisely because it failed.
 *
 * Refs: docs/07_SECURITY.md §4.1, §10; packages/domain/src/policy/policy.ts
 */

import {
  ANONYMOUS,
  allowed,
  assignmentActionFor,
  isActor,
  type MaybeActor,
} from '@langgol/domain/policy'
import { isPrivilegedRole, isRole, roleLabel, type Role } from '@langgol/domain/identity'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AccountRepository,
  AuditPort,
  Clock,
  RoleAssignmentRecord,
  RoleDefinitionRecord,
} from '../../ports/index.js'

export interface RoleDeps {
  readonly clock: Clock
  readonly accounts: AccountRepository
  readonly audit: AuditPort
}

/* ------------------------------------------------------------------ list roles */

export interface ListRolesResult {
  readonly definitions: readonly RoleDefinitionRecord[]
  /** Only the subset a user may pick for themselves. The UI should offer nothing else. */
  readonly selfSelectable: readonly RoleDefinitionRecord[]
}

/**
 * The role catalogue.
 *
 * Readable by any signed-in actor: the signup screen has to render the choices. Which roles a
 * person may actually take is a separate question, answered by `selfSelectable`.
 */
export async function listRoles(
  actor: MaybeActor,
  deps: RoleDeps,
): Promise<Result<ListRolesResult, AppError>> {
  if (!allowed(actor, 'role:list')) {
    return err(actor === ANONYMOUS ? Errors.unauthenticated() : Errors.forbidden())
  }

  const definitions = await deps.accounts.listRoleDefinitions()
  return ok({
    definitions,
    selfSelectable: definitions.filter((definition) => definition.selfSelectable),
  })
}

/* ------------------------------------------------------------- roles of a user */

export interface UserRolesResult {
  readonly userId: string
  readonly roles: readonly RoleAssignmentRecord[]
}

/**
 * The roles a user holds.
 *
 * A user may read their own; an administrator may read anyone's. The ownership check runs through
 * the policy engine rather than a comparison here, so the rule stays in one place.
 */
export async function getUserRoles(
  actor: MaybeActor,
  targetUserId: string,
  deps: RoleDeps,
): Promise<Result<UserRolesResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const isSelf = actor.userId === targetUserId
  const permitted = isSelf
    ? allowed(actor, 'role:read-own', { ownerUserId: targetUserId })
    : allowed(actor, 'admin:user-read')

  if (!permitted) return err(Errors.forbidden())

  return ok({ userId: targetUserId, roles: await deps.accounts.listRolesFor(targetUserId) })
}

/* ---------------------------------------------------------------- assign role */

export interface AssignRoleCommand {
  readonly targetUserId: string
  readonly role: string
}

export interface AssignRoleResult {
  readonly roles: readonly string[]
  /** False when the user already held it. Not an error — an administrator may double-click. */
  readonly added: boolean
}

export async function assignRole(
  actor: MaybeActor,
  command: AssignRoleCommand,
  deps: RoleDeps,
): Promise<Result<AssignRoleResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  /*
   * Validate the role BEFORE the permission check, so an unknown value is a clear validation
   * error rather than a confusing "forbidden". The reverse order would tell an attacker probing
   * role names apart from an admin making a typo.
   */
  if (!isRole(command.role)) {
    return err(
      Errors.validation('That is not a role this platform recognises', {
        role: command.role.slice(0, 32),
      }),
    )
  }

  // Granting ADMIN or OPS_AGENT asks a different question from granting WHOLESALER.
  const action = assignmentActionFor(command.role as Role)

  if (!allowed(actor, action)) {
    // A refused privilege grant is exactly the event worth having in the audit log.
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'ROLE_ASSIGN_REJECTED',
      entityType: 'user',
      entityId: command.targetUserId,
      reason: `role=${command.role}`,
      meta: { privileged: isPrivilegedRole(command.role) },
    })
    return err(Errors.forbidden())
  }

  const result = await deps.accounts.assignRole({
    userId: command.targetUserId,
    role: command.role,
    grantedById: actor.userId,
    at: deps.clock.now(),
  })

  if (result.added) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'ROLE_ASSIGNED',
      entityType: 'user',
      entityId: command.targetUserId,
      reason: command.role,
      meta: { privileged: isPrivilegedRole(command.role) },
    })
  }

  return ok(result)
}

/* ---------------------------------------------------------------- revoke role */

export interface RemoveRoleCommand {
  readonly targetUserId: string
  readonly role: string
  readonly reason: string
}

export interface RemoveRoleResult {
  readonly roles: readonly string[]
  readonly removed: boolean
}

/**
 * Take a role away.
 *
 * A reason is mandatory. Revocation can lock a farmer out of listings they depend on, so an
 * unexplained one is not acceptable — the same principle that makes fault attribution mandatory
 * on a failed order. The database enforces it too.
 */
export async function removeRole(
  actor: MaybeActor,
  command: RemoveRoleCommand,
  deps: RoleDeps,
): Promise<Result<RemoveRoleResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  if (!isRole(command.role)) {
    return err(Errors.validation('That is not a role this platform recognises'))
  }

  if (!allowed(actor, 'role:revoke')) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'ROLE_REVOKE_REJECTED',
      entityType: 'user',
      entityId: command.targetUserId,
      reason: `role=${command.role}`,
    })
    return err(Errors.forbidden())
  }

  const reason = command.reason.trim()
  if (reason.length === 0) {
    return err(Errors.validation('A reason is required to remove a role'))
  }

  /*
   * An administrator removing their own ADMIN role can lock every administrator out of the
   * platform if they are the last one. Refused here rather than discovered at 2am.
   */
  if (actor.userId === command.targetUserId && isPrivilegedRole(command.role)) {
    return err(
      Errors.validation(
        'You cannot remove your own privileged role. Ask another administrator to do it.',
      ),
    )
  }

  const result = await deps.accounts.revokeRole({
    userId: command.targetUserId,
    role: command.role,
    revokedById: actor.userId,
    reason,
    at: deps.clock.now(),
  })

  if (result.removed) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'ROLE_REVOKED',
      entityType: 'user',
      entityId: command.targetUserId,
      reason: `${command.role}: ${reason.slice(0, 120)}`,
      meta: { privileged: isPrivilegedRole(command.role) },
    })
  }

  return ok(result)
}

/** Localised label for a role, for a caller that already has the enum value. */
export function labelForRole(
  role: string,
  locale: 'bn' | 'en',
): { name: string; description: string } {
  return isRole(role) ? roleLabel(role, locale) : { name: role, description: '' }
}
