/**
 * The six role profiles, behind one port.
 *
 * Six near-identical repositories would be six places for the ownership condition to be written,
 * and the fifth one is where somebody eventually forgets it. One interface parameterised by role
 * means the `user_id` in the WHERE clause is written once.
 *
 * ## There is no `findById`
 *
 * Every method takes the OWNER, never a profile id. A retailer reading their own profile passes
 * their user id and gets their own row or nothing; there is no argument they could put somebody
 * else's id into. That is the same discipline as the farmer profile and the farms table, and for
 * the same reason: the reliable way not to have an IDOR is not to have the method that enables it.
 *
 * ## `verificationStatus` is readable, never writable
 *
 * It appears on `RoleProfileRecord` because a profile screen has to show it, and it is absent
 * from every write path. A self-attested verification is not a verification — it is set by the
 * operations process, against evidence, and never by the person being verified.
 *
 * Refs: docs/07_SECURITY.md §4, §8.4
 */

import type { ProfileRole } from '@langgol/domain/profiles'

export interface RoleProfileRecord {
  readonly id: string
  readonly userId: string
  readonly role: ProfileRole
  readonly verificationStatus: string
  /** The role's own declared fields, as stored. Shape follows `PROFILE_FIELDS[role]`. */
  readonly fields: Readonly<Record<string, unknown>>
  /** Admin areas this business serves. Empty for consumers and retailers. */
  readonly serviceAreaIds: readonly string[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface RoleProfileRepository {
  /** The caller's own profile for one role, or null if they have not started one. */
  findForUser(userId: string, role: ProfileRole): Promise<RoleProfileRecord | null>

  /**
   * Create the profile that should have existed since the role was granted.
   *
   * Idempotent by way of the UNIQUE on `user_id` rather than a read-then-write check: two
   * requests arriving together must not produce two profiles, and the database is the only
   * participant that can arbitrate that.
   */
  ensureForUser(userId: string, role: ProfileRole, now: Date): Promise<RoleProfileRecord>

  /** Apply validated changes. Returns null when the caller has no profile for that role. */
  updateForUser(
    userId: string,
    role: ProfileRole,
    changes: Readonly<Record<string, unknown>>,
  ): Promise<RoleProfileRecord | null>

  /**
   * Does this address belong to this user?
   *
   * Narrow on purpose. The profile only needs a yes or a no, and `findOwned` would hand back a
   * recipient name and phone number the caller has no reason to load in order to answer it.
   *
   * A read the profile use case performs BEFORE writing, so a retailer pointing their profile at
   * a stranger's address is refused with a validation error rather than a database exception.
   * The trigger underneath is the guarantee; this is the one that produces a sentence a person
   * can act on.
   */
  ownsAddress(userId: string, addressId: string): Promise<boolean>

  /**
   * Replace the service areas wholesale.
   *
   * A replace rather than add/remove because the form submits the full selection every time, and
   * reconciling a diff on the client is how two tabs end up disagreeing about what was chosen.
   */
  replaceServiceAreas(
    userId: string,
    role: ProfileRole,
    adminAreaIds: readonly string[],
  ): Promise<readonly string[]>
}
