/**
 * The digital agricultural identity port.
 *
 * ## Why the repository returns summaries and not records
 *
 * The obvious design wires eight repositories into the use case — user, roles, farms, farmer
 * profile, production, verifications, areas, role profiles — and lets it pick out the safe bits.
 * That is the arrangement where a leak eventually happens, because the use case would be holding
 * a phone number, a coordinate and a revenue figure while assembling something meant to be public.
 *
 * So the narrowing happens HERE, at the boundary where each table is read. What crosses into the
 * application layer is already a summary: counts, bands, district names, statuses. The assembly
 * function cannot disclose a farm's coordinates because it is never given a farm.
 *
 * Refs: docs/07_SECURITY.md §7; docs/03_ARCHITECTURE.md §2.1
 */

import type {
  AgriBusinessSummary,
  AgriFarmSummary,
  AgriLocationSummary,
  AgriProductionSummary,
  AgriRoleSummary,
  AgriVerificationSummary,
} from '@langgol/domain/agri-identity'

/** Everything the profile is assembled from, except the identifier itself. */
export interface AgriProfileSourceData {
  readonly displayName: string
  readonly memberSince: Date
  readonly roles: readonly AgriRoleSummary[]
  readonly verifications: readonly AgriVerificationSummary[]
  readonly location: AgriLocationSummary | null
  readonly farm: AgriFarmSummary | null
  readonly production: AgriProductionSummary | null
  readonly business: AgriBusinessSummary | null
}

export interface AgriIdentityRepository {
  /** The user's AGRI-ID, or null if one has never been issued. */
  findAgriId(userId: string): Promise<string | null>

  /**
   * Claim a candidate identifier for a user.
   *
   * Returns null when the candidate is already taken, so the caller retries with fresh randomness.
   * The uniqueness is the database's to arbitrate: a read-then-write check loses the race with
   * itself, and two people sharing an AGRI-ID is not a condition this system could recover from
   * once either of them has printed it.
   *
   * Idempotent per user — a second call for somebody who already has one returns what they have,
   * because issuing a second identifier would orphan every document carrying the first.
   */
  issueAgriId(userId: string, candidate: string, now: Date): Promise<string | null>

  /**
   * The safe summaries, assembled by the adapter from every table involved.
   *
   * Null when the user does not exist. Every field is already narrowed — see the note above.
   */
  profileSources(userId: string): Promise<AgriProfileSourceData | null>
}

/**
 * Random bytes for a new identifier.
 *
 * Separate from `RandomSource` so the contract is explicit about what it is for: an AGRI-ID must
 * come from a CSPRNG and never from a hash of anything the user owns. A caller passing anything
 * else has to go out of its way.
 */
export interface AgriIdRandom {
  bytes(count: number): Uint8Array
}
