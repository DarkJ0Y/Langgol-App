/**
 * Granular administrative permissions.
 *
 * ## Why the ADMIN role is no longer enough
 *
 * Until this phase, holding `ADMIN` meant holding everything: reading any user, granting any role,
 * decrypting any national identity number, suspending any account. That is one compromised
 * session away from total loss, and it is also wrong in the ordinary case — the person who reviews
 * trade licences has no business decrypting NIDs, and the person who reads the audit log has no
 * business suspending anybody.
 *
 * So `ADMIN` is now a door, not a key. It says somebody may enter the back office; a permission
 * says what they may do once inside. Both are required, and neither implies the other.
 *
 * ## The rule that makes this worth having
 *
 * **No permission is implied.** There is no super-permission, no wildcard, and no branch anywhere
 * that reads "if the actor is an ADMIN, allow". An administrator with an empty permission set can
 * open the admin area and do precisely nothing in it, which is the correct default for an account
 * that has just been created.
 *
 * The temptation to add `if (hasRole(actor, 'ADMIN')) return ALLOW` as a convenience is the single
 * change that would undo this entire module, so it is worth naming as the thing not to do.
 *
 * ## Least privilege has a cost, and it is paid deliberately
 *
 * A reviewer who cannot find the permission they need is a reviewer who asks somebody with more
 * access to do it for them, which is worse than granting it. The set below is therefore small,
 * and each permission is drawn around a job somebody actually has rather than around a table.
 *
 * Refs: docs/07_SECURITY.md §4, §5, §8.4
 */

/**
 * The permissions an administrator may hold.
 *
 * Named for the job, not the endpoint. `KYC_VIEW` and `KYC_REVIEW` are separate because looking at
 * a queue and deciding somebody's identity are different responsibilities held by different people
 * — and the second is the one that can be abused invisibly.
 */
export const ADMIN_PERMISSIONS = [
  /** See that a user exists, and read their profile. */
  'USER_VIEW',
  /** Change a user's own details on their behalf. */
  'USER_EDIT',
  /** Grant and revoke roles, and manage other administrators' permissions. */
  'ROLE_MANAGE',
  /** See the KYC queue and a submission's status. Not the number, and not the documents. */
  'KYC_VIEW',
  /** Approve or reject an identity document, and decrypt the number in order to do so. */
  'KYC_REVIEW',
  /** Approve or reject a trading business — a retailer, wholesaler or supplier. */
  'BUSINESS_REVIEW',
  /** Approve or reject a farm. */
  'FARM_REVIEW',
  /** Approve or reject an agricultural expert's credentials. */
  'EXPERT_REVIEW',
  /** Read the audit log. */
  'AUDIT_VIEW',
  /** Suspend an account, and restore one. */
  'ACCOUNT_SUSPEND',
] as const

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

export const isAdminPermission = (value: unknown): value is AdminPermission =>
  typeof value === 'string' && (ADMIN_PERMISSIONS as readonly string[]).includes(value)

/**
 * Which permission each verification type is reviewed under.
 *
 * The P10 verification hub already models FARM, BUSINESS and EXPERT as types of one thing, so the
 * review workflow is shared and only the permission differs. A type absent from this map cannot be
 * reviewed by anybody, which is the correct answer for PHONE and EMAIL — those are proved
 * automatically and have no human queue.
 */
export const REVIEW_PERMISSION_BY_TYPE: Readonly<Record<string, AdminPermission>> = {
  IDENTITY: 'KYC_REVIEW',
  BUSINESS: 'BUSINESS_REVIEW',
  FARM: 'FARM_REVIEW',
  EXPERT: 'EXPERT_REVIEW',
  PAYMENT: 'KYC_REVIEW',
}

/**
 * The permission needed to review a verification of this type, or null when none can.
 *
 * Null for PHONE and EMAIL. A reviewer's queue that offered them would be offering work nobody is
 * expected to do, and a decision on them would be meaningless — they are proved by the subject
 * redeeming a code, not by anybody's judgement.
 */
export function reviewPermissionFor(type: string): AdminPermission | null {
  return REVIEW_PERMISSION_BY_TYPE[type] ?? null
}

/** Whether a permission set contains one. Fails closed on an absent set. */
export function holdsPermission(
  held: readonly string[] | undefined,
  permission: AdminPermission,
): boolean {
  return held !== undefined && held.includes(permission)
}
