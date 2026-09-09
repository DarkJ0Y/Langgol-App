/**
 * The back-office port.
 *
 * ## What an administrator is handed, and what they are not
 *
 * `AdminUserSummary` carries a masked phone and no email, no date of birth, no address and nothing
 * from an identity document. That is not because an administrator can never see those — support
 * work sometimes needs them — but because a LIST does not. A search that returns fifty rows should
 * not put fifty phone numbers on a screen, in a browser cache and in whatever the operator's
 * machine syncs, to answer "which of these is Rahim".
 *
 * Reaching further is a separate, individually authorized, individually audited step. The rule is
 * the same one P10 applied to identity numbers: the ordinary path has nothing to leak.
 *
 * ## Pagination is not optional
 *
 * Every list here takes a page. An admin search with no bound is one `SELECT *` away from pulling
 * the entire user table into a server component, and the first person to notice is a farmer whose
 * request timed out behind it.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §11
 */

import type { AdminPermission } from '@langgol/domain/admin'

/** One page of anything. */
export interface Page<T> {
  readonly items: readonly T[]
  /** Total matching rows, so a screen can say "1–20 of 340". */
  readonly total: number
  readonly limit: number
  readonly offset: number
}

/**
 * A user as a search result.
 *
 * Deliberately thin. Enough to recognise somebody and decide whether to open them, and nothing
 * that would be a disclosure fifty times over.
 */
export interface AdminUserSummary {
  readonly userId: string
  readonly fullName: string
  /** Masked before it leaves the repository, so no caller has to remember to do it. */
  readonly phoneMasked: string
  readonly status: string
  readonly onboardingStatus: string
  readonly roles: readonly string[]
  readonly createdAt: Date
}

/** The filters a back-office search offers. Every one of them is optional. */
export interface AdminUserFilter {
  /** Matched against the name, and against the phone only when it looks like a number. */
  readonly search?: string | undefined
  readonly role?: string | undefined
  readonly status?: string | undefined
  readonly onboardingStatus?: string | undefined
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}

/**
 * One user, opened.
 *
 * Still no email, no date of birth and no address. A support conversation that genuinely needs a
 * contact detail is a different action from browsing a profile, and conflating the two is how a
 * back office becomes a directory of everybody's personal data.
 */
export interface AdminUserDetail extends AdminUserSummary {
  readonly phoneVerified: boolean
  readonly emailVerified: boolean
  /** What is proven, never how. Types and statuses only. */
  readonly verifications: readonly { readonly type: string; readonly status: string }[]
  readonly permissions: readonly AdminPermission[]
  readonly suspendedReason: string | null
}

export interface AuditEntry {
  readonly id: string
  readonly actorUserId: string | null
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  readonly reason: string | null
  readonly createdAt: Date
}

export interface AuditFilter {
  readonly actorUserId?: string | undefined
  readonly action?: string | undefined
  readonly entityType?: string | undefined
  readonly entityId?: string | undefined
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}

export interface AdminRepository {
  /** A page of users matching the filter. Newest first. */
  searchUsers(filter: AdminUserFilter): Promise<Page<AdminUserSummary>>

  /** One user, or null. */
  userDetail(userId: string): Promise<AdminUserDetail | null>

  /**
   * Suspend or restore an account.
   *
   * Returns false when the row did not change — already suspended, already active, or gone. The
   * caller reports that as a conflict rather than pretending it worked.
   */
  setUserStatus(input: {
    readonly userId: string
    readonly status: 'ACTIVE' | 'SUSPENDED'
    readonly reason: string
    readonly now: Date
  }): Promise<boolean>

  /** The live permissions an administrator holds. */
  permissionsFor(userId: string): Promise<readonly AdminPermission[]>

  /** Grant one. Returns false when it is already held. */
  grantPermission(input: {
    readonly userId: string
    readonly permission: AdminPermission
    readonly grantedById: string
    readonly now: Date
  }): Promise<boolean>

  /** Revoke one. Returns false when it was not held. */
  revokePermission(input: {
    readonly userId: string
    readonly permission: AdminPermission
    readonly revokedById: string
    readonly reason: string
    readonly now: Date
  }): Promise<boolean>

  /** A page of the audit log, newest first. */
  auditLog(filter: AuditFilter): Promise<Page<AuditEntry>>
}
