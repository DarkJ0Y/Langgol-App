/**
 * The farmer profile store.
 *
 * Every method takes the farmer's own `userId` and is expected to put it in the WHERE clause.
 * There is deliberately NO method that reads or writes a profile by `farmerProfileId` alone: an
 * id-only lookup is one `req.params.id` away from an IDOR, and the reliable way not to have that
 * bug is not to have that method. The marketplace reads farmer profiles by id for listings, and
 * does so through its own port, where the resource is public by design.
 *
 * Refs: docs/03_ARCHITECTURE.md §2.1, docs/07_SECURITY.md §4
 */

import type { FarmingFields } from '@langgol/domain/farming'

/**
 * A farmer profile as the farmer's own screens see it.
 *
 * Note what is NOT here: `nidHash`, `payoutAccountRef`, `payoutAccountName`, `riskTier` and the
 * settlement-hold override. The hash is a duplicate-detection artefact that no interface should
 * echo; payout details belong to the payout flow, which re-authenticates before showing them;
 * and the risk tier is an internal assessment that would invite argument and gaming if surfaced.
 * The profile screen has no use for any of them, so they never leave the repository.
 */
export interface FarmerProfileRecord extends FarmingFields {
  readonly id: string
  readonly userId: string
  readonly displayName: string
  readonly bio: string | null
  readonly verificationStatus: string
  readonly verifiedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface FarmerProfileRepository {
  /** The signed-in farmer's own profile, or null if they have not got one yet. */
  findByUserId(userId: string): Promise<FarmerProfileRecord | null>

  /**
   * Create the profile that should have existed since the FARMER role was granted.
   *
   * Idempotent: a concurrent first request must not produce two profiles, and `user_id` is
   * UNIQUE so the database is the arbiter rather than a read-then-write race in the use case.
   *
   * The display name is taken from the user's own row by the adapter rather than passed in. The
   * `Actor` a use case holds carries an id, roles and status — not a name — and inventing a
   * parameter for it would mean the caller supplying a name for somebody else's profile.
   */
  ensureForUser(input: {
    readonly userId: string
    readonly now: Date
  }): Promise<FarmerProfileRecord>

  /** Apply a validated partial update. Only the keys present are written. */
  updateForUser(
    userId: string,
    changes: Partial<FarmingFields>,
  ): Promise<FarmerProfileRecord | null>
}
