/**
 * The onboarding facts port.
 *
 * One method, returning the flat set of booleans the domain step table judges. The adapter does
 * the joins; the domain does the reasoning; the use case does neither.
 *
 * ## Why facts and not records
 *
 * The same reason the agricultural profile takes summaries: a repository that handed back a user
 * row, a farm and a production history would be handing the use case a phone number and a set of
 * coordinates in order to answer "has this person added a farm?". Every fact below is a boolean a
 * `SELECT EXISTS` can settle, and none of them can leak anything.
 */

import type { OnboardingFacts } from '@langgol/domain/onboarding'

export interface OnboardingRepository {
  /** What is true about this account right now. Null when the user does not exist. */
  factsForUser(userId: string): Promise<OnboardingFacts | null>

  /**
   * Cache the derived state on the user row.
   *
   * The stored column exists so "how many users stalled after verifying their phone?" can be
   * answered in SQL. It is never read to decide what somebody may do — the derivation is the
   * truth, and this is a copy kept for querying.
   */
  recordState(userId: string, state: string): Promise<void>
}
