/**
 * Self-select a role.
 *
 * Only `FARMER`, `CONSUMER` and `RETAILER` may ever be chosen this way. `ADMIN` and `OPS_AGENT`
 * are **controlled roles**: granted by an administrator, recorded with a grantor, never picked
 * from a menu.
 *
 * The allowlist is enforced HERE, on the server, against a domain constant. The UI showing only
 * three options is a courtesy to the user, not a security boundary — a request naming `ADMIN` is
 * rejected with the same code whether it came from our form or from curl.
 *
 * Refs: docs/07_SECURITY.md §4.1, §5.1
 */

import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { AuditPort, Clock, UserRepository } from '../../ports/index.js'
import { SELF_SELECTABLE_ROLES, type SelfSelectableRole } from './verify-otp.js'

export interface SelectRoleCommand {
  readonly userId: string
  readonly role: string
}

export interface SelectRoleResult {
  readonly roles: readonly string[]
  readonly added: boolean
}

export interface SelectRoleDeps {
  readonly clock: Clock
  readonly users: UserRepository
  readonly audit: AuditPort
}

function isSelfSelectable(role: string): role is SelfSelectableRole {
  return (SELF_SELECTABLE_ROLES as readonly string[]).includes(role)
}

export async function selectRole(
  command: SelectRoleCommand,
  deps: SelectRoleDeps,
): Promise<Result<SelectRoleResult, AppError>> {
  if (!isSelfSelectable(command.role)) {
    // Privilege escalation attempt, or a broken client. Either way it is audited: a request
    // naming ADMIN is worth knowing about even when it fails.
    await deps.audit.record({
      actorUserId: command.userId,
      action: 'ROLE_SELF_SELECT_REJECTED',
      entityType: 'user',
      entityId: command.userId,
      reason: `requested=${command.role.slice(0, 32)}`,
    })
    return err(Errors.forbidden('That role cannot be self-selected.'))
  }

  const result = await deps.users.grantSelfRole(command.userId, command.role)

  if (result.added) {
    await deps.audit.record({
      actorUserId: command.userId,
      action: 'ROLE_SELF_SELECTED',
      entityType: 'user',
      entityId: command.userId,
      reason: command.role,
    })
  }

  return ok(result)
}
