'use server'

/**
 * Back-office actions on one user.
 *
 * Thin: authenticate, read the form, call the use case, translate the result. Every use case
 * authorizes independently, so an operator who reached this module by any route — a forged
 * navigation, a stale session, a direct invocation — is judged the same way as one who clicked a
 * button that was rendered for them.
 *
 * Refs: docs/07_SECURITY.md §4, §5
 */

import { revalidatePath } from 'next/cache'
import {
  grantAdminPermission,
  restoreAccount,
  revokeAdminPermission,
  suspendAccount,
} from '@langgol/application'
import { isErr } from '@langgol/shared'
import type { MessageKey } from '@langgol/i18n'
import { adminDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import type { AdminActionState } from './state'

function toState(code: string): AdminActionState {
  switch (code) {
    case 'VALIDATION_FAILED':
      return { status: 'error', errorKey: 'admin.errorReason' as MessageKey }
    case 'CONFLICT':
      return { status: 'error', errorKey: 'admin.errorNoChange' as MessageKey }
    // One answer for all three: telling a caller which applied would confirm whether a record
    // exists and whether they are merely unauthorised.
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
    case 'NOT_FOUND':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

export async function suspendAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await currentActor()
  const userId = String(formData.get('userId') ?? '')
  const reason = String(formData.get('reason') ?? '')
  const restore = String(formData.get('restore') ?? '') === 'true'

  const deps = await adminDeps()
  const result = restore
    ? await restoreAccount(actor, userId, reason, deps)
    : await suspendAccount(actor, userId, reason, deps)

  if (isErr(result)) return toState(result.error.code)

  revalidatePath(`/admin/users/${userId}`)
  return { status: 'ok' }
}

export async function permissionAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await currentActor()
  const userId = String(formData.get('userId') ?? '')
  const permission = String(formData.get('permission') ?? '')
  const revoke = String(formData.get('revoke') ?? '') === 'true'
  const reason = String(formData.get('reason') ?? '')

  /*
   * Branched rather than ternaried into one value: the two use cases return different success
   * shapes, and collapsing them would need a cast that hides which one actually ran.
   */
  const deps = await adminDeps()

  if (revoke) {
    const revoked = await revokeAdminPermission(actor, userId, permission, reason, deps)
    if (isErr(revoked)) return toState(revoked.error.code)
  } else {
    const granted = await grantAdminPermission(actor, userId, permission, deps)
    if (isErr(granted)) return toState(granted.error.code)
  }

  revalidatePath(`/admin/users/${userId}`)
  return { status: 'ok' }
}
