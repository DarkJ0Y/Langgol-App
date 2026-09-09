/**
 * Back-office use cases.
 *
 * ## Every one of these authorizes independently
 *
 * The admin pages render only for somebody the policy engine admits, and that is a courtesy to the
 * interface rather than a control. A hidden button is not a permission check. Each function below
 * asks the policy engine itself, so a caller who reached this module by any route — a forged
 * navigation, a stale session, a direct action invocation — is judged the same way.
 *
 * ## Least privilege is checked here, not assumed upstream
 *
 * Holding the ADMIN role admits somebody to the dashboard and grants nothing. Every capability
 * below names its own permission, and an administrator holding none can call every function here
 * and be refused by all of them.
 *
 * ## What gets written down
 *
 * Suspending an account, granting a permission and revoking one are the three actions in this
 * module that change somebody else's standing, and all three demand a reason and record it. An
 * unattributed suspension is indistinguishable from a bug a month later, and a farmer locked out
 * of their own livelihood is owed better than that.
 *
 * Refs: docs/07_SECURITY.md §4, §5, §11
 */

import { isAdminPermission, type AdminPermission } from '@langgol/domain/admin'
import { allowed, isActor, type Action, type MaybeActor } from '@langgol/domain/policy'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AdminRepository,
  AdminUserDetail,
  AdminUserFilter,
  AdminUserSummary,
  AuditEntry,
  AuditFilter,
  AuditPort,
  Clock,
  Page,
} from '../../ports/index.js'

export interface AdminDeps {
  readonly clock: Clock
  readonly admin: AdminRepository
  readonly audit: AuditPort
}

/**
 * The largest page anybody may ask for.
 *
 * A cap rather than a suggestion: a caller passing `limit=100000` gets fifty rows. The bound
 * exists so that one back-office query cannot pull the user table into a server component while a
 * farmer's request waits behind it.
 */
const MAX_PAGE = 50
const DEFAULT_PAGE = 20

function paging(limit: number | undefined, offset: number | undefined) {
  return {
    limit: Math.min(Math.max(Math.floor(limit ?? DEFAULT_PAGE), 1), MAX_PAGE),
    offset: Math.max(Math.floor(offset ?? 0), 0),
  }
}

/** Authenticated, and holding the permission this action needs. */
function gate(actor: MaybeActor, action: Action): Result<{ readonly userId: string }, AppError> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, action)) return err(Errors.forbidden())
  return ok({ userId: actor.userId })
}

/* ------------------------------------------------------------------- users */

export async function searchUsers(
  actor: MaybeActor,
  filter: AdminUserFilter,
  deps: AdminDeps,
): Promise<Result<Page<AdminUserSummary>, AppError>> {
  const gated = gate(actor, 'admin:user-read')
  if (!('value' in gated)) return gated

  return ok(await deps.admin.searchUsers({ ...filter, ...paging(filter.limit, filter.offset) }))
}

export async function viewUser(
  actor: MaybeActor,
  userId: string,
  deps: AdminDeps,
): Promise<Result<AdminUserDetail, AppError>> {
  const gated = gate(actor, 'admin:user-read')
  if (!('value' in gated)) return gated

  const detail = await deps.admin.userDetail(userId)
  if (detail === null) return err(Errors.notFound('User'))

  /*
   * Opening a user's record is recorded.
   *
   * Not because it is dangerous, but because it is the ordinary path to somebody's personal data
   * and "who looked at this account?" is a question a data-subject request can ask. A read nobody
   * logged is a read nobody can answer for.
   */
  await deps.audit.record({
    actorUserId: gated.value.userId,
    action: 'ADMIN_USER_VIEWED',
    entityType: 'user',
    entityId: userId,
  })

  return ok(detail)
}

/* -------------------------------------------------------------- suspension */

/** A reason short enough to read and long enough to mean something. */
const MIN_REASON = 8
const MAX_REASON = 500

function checkReason(reason: string): Result<string, AppError> {
  const trimmed = reason.trim()
  if (trimmed.length < MIN_REASON) {
    return err(Errors.validation('Say why, in a sentence', { field: 'reason' }))
  }
  return ok(trimmed.slice(0, MAX_REASON))
}

/**
 * Suspend an account.
 *
 * A suspension can stop a farmer selling, which is their income. It therefore requires its own
 * permission, demands a reason, refuses to act on the operator's own account, and is written to
 * the audit log with the words the operator gave.
 */
export async function suspendAccount(
  actor: MaybeActor,
  userId: string,
  reason: string,
  deps: AdminDeps,
): Promise<Result<{ readonly status: string }, AppError>> {
  const gated = gate(actor, 'admin:user-suspend')
  if (!('value' in gated)) return gated

  /*
   * Nobody suspends themselves.
   *
   * Not a safety rail for the operator's benefit — a self-suspension would lock the account
   * holding ACCOUNT_SUSPEND out of the tool needed to undo it, and on a small team that can be the
   * only such account.
   */
  if (userId === gated.value.userId) {
    return err(Errors.validation('You cannot suspend your own account', { field: 'userId' }))
  }

  const checked = checkReason(reason)
  if (!('value' in checked)) return checked

  const changed = await deps.admin.setUserStatus({
    userId,
    status: 'SUSPENDED',
    reason: checked.value,
    now: deps.clock.now(),
  })
  if (!changed) return err(Errors.conflict('That account was not active'))

  await deps.audit.record({
    actorUserId: gated.value.userId,
    action: 'ACCOUNT_SUSPENDED',
    entityType: 'user',
    entityId: userId,
    reason: checked.value,
  })

  return ok({ status: 'SUSPENDED' })
}

/** Restore a suspended account. Same permission, same reason requirement, same audit line. */
export async function restoreAccount(
  actor: MaybeActor,
  userId: string,
  reason: string,
  deps: AdminDeps,
): Promise<Result<{ readonly status: string }, AppError>> {
  const gated = gate(actor, 'admin:user-restore')
  if (!('value' in gated)) return gated

  const checked = checkReason(reason)
  if (!('value' in checked)) return checked

  const changed = await deps.admin.setUserStatus({
    userId,
    status: 'ACTIVE',
    reason: checked.value,
    now: deps.clock.now(),
  })
  if (!changed) return err(Errors.conflict('That account was not suspended'))

  await deps.audit.record({
    actorUserId: gated.value.userId,
    action: 'ACCOUNT_RESTORED',
    entityType: 'user',
    entityId: userId,
    reason: checked.value,
  })

  return ok({ status: 'ACTIVE' })
}

/* ------------------------------------------------------------- permissions */

/**
 * Grant an administrative permission.
 *
 * The most dangerous action in the module: `ROLE_MANAGE` is self-amplifying, so a holder can grant
 * themselves the other nine. Two things constrain it. Nobody may grant to themselves — enforced
 * here and again by a CHECK constraint, because it is the one rule whose absence turns a single
 * compromised session into total control. And every grant is audited with the permission named.
 */
export async function grantAdminPermission(
  actor: MaybeActor,
  userId: string,
  permission: string,
  deps: AdminDeps,
): Promise<Result<{ readonly granted: AdminPermission }, AppError>> {
  const gated = gate(actor, 'admin:permission-manage')
  if (!('value' in gated)) return gated

  if (!isAdminPermission(permission)) {
    return err(Errors.validation('Unknown permission', { field: 'permission' }))
  }

  if (userId === gated.value.userId) {
    return err(Errors.validation('Somebody else must grant this to you', { field: 'userId' }))
  }

  const granted = await deps.admin.grantPermission({
    userId,
    permission,
    grantedById: gated.value.userId,
    now: deps.clock.now(),
  })
  if (!granted) return err(Errors.conflict('That permission is already held'))

  await deps.audit.record({
    actorUserId: gated.value.userId,
    action: 'ADMIN_PERMISSION_GRANTED',
    entityType: 'user',
    entityId: userId,
    meta: { permission },
  })

  return ok({ granted: permission })
}

export async function revokeAdminPermission(
  actor: MaybeActor,
  userId: string,
  permission: string,
  reason: string,
  deps: AdminDeps,
): Promise<Result<{ readonly revoked: AdminPermission }, AppError>> {
  const gated = gate(actor, 'admin:permission-manage')
  if (!('value' in gated)) return gated

  if (!isAdminPermission(permission)) {
    return err(Errors.validation('Unknown permission', { field: 'permission' }))
  }

  const checked = checkReason(reason)
  if (!('value' in checked)) return checked

  /*
   * Revoking your own is permitted, unlike granting.
   *
   * Standing down from a permission you no longer need is good practice and needs no second
   * person. The asymmetry is deliberate: the dangerous direction is acquiring privilege, not
   * shedding it.
   */
  const revoked = await deps.admin.revokePermission({
    userId,
    permission,
    revokedById: gated.value.userId,
    reason: checked.value,
    now: deps.clock.now(),
  })
  if (!revoked) return err(Errors.conflict('That permission was not held'))

  await deps.audit.record({
    actorUserId: gated.value.userId,
    action: 'ADMIN_PERMISSION_REVOKED',
    entityType: 'user',
    entityId: userId,
    reason: checked.value,
    meta: { permission },
  })

  return ok({ revoked: permission })
}

/* ------------------------------------------------------------- audit log */

/**
 * Read the audit log.
 *
 * Its own permission, held by fewer people than you might expect. The log records who looked at
 * whose account, so unrestricted access to it is itself a way of watching colleagues.
 *
 * Reading it is NOT audited. That is a deliberate omission rather than an oversight: an audit
 * table that records reads of itself grows without bound, and each read produces an entry that
 * produces an entry the next time somebody looks.
 */
export async function listAuditLog(
  actor: MaybeActor,
  filter: AuditFilter,
  deps: AdminDeps,
): Promise<Result<Page<AuditEntry>, AppError>> {
  const gated = gate(actor, 'admin:audit-read')
  if (!('value' in gated)) return gated

  return ok(await deps.admin.auditLog({ ...filter, ...paging(filter.limit, filter.offset) }))
}
