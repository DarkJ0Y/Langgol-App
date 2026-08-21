/**
 * The consent store.
 *
 * Append-only by contract as well as by database rule: there is no `update` and no `delete` on
 * this port. `supersede` stamps a live row as ended and writes the replacement in one
 * transaction, which is the only mutation the table permits.
 *
 * Every method takes the subject's `userId` and is expected to put it in the WHERE clause. There
 * is deliberately no method that records a decision on someone else's behalf — an administrator
 * needs somewhere to express that, and this port does not give them one.
 *
 * Refs: docs/07_SECURITY.md §9.2, §10
 */

import type { ConsentSource, ConsentType } from '@langgol/domain/consent'

/** A decision as stored. `ipAddress`/`userAgent` are held for defensibility and never returned. */
export interface ConsentRecordRow {
  readonly id: string
  readonly userId: string
  readonly consentType: ConsentType
  readonly granted: boolean
  readonly version: number
  readonly grantedAt: Date
  readonly revokedAt: Date | null
  readonly source: ConsentSource
}

export interface ConsentDecisionInput {
  readonly userId: string
  readonly consentType: ConsentType
  readonly granted: boolean
  readonly version: number
  readonly at: Date
  readonly source: ConsentSource
  /** Recorded, never surfaced. The evidence that a decision was made from a real session. */
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

export interface ConsentRepository {
  /** The live decision for each type this user has answered. At most one per type. */
  listLiveForUser(userId: string): Promise<readonly ConsentRecordRow[]>

  /**
   * Every decision ever recorded for this user, newest first.
   *
   * For the user's own history view and for answering a data-subject request. Superseded rows
   * are included — that is the point of keeping them.
   */
  listHistoryForUser(userId: string): Promise<readonly ConsentRecordRow[]>

  /**
   * Record a decision, superseding the live one for that type.
   *
   * One transaction: stamping the old row and inserting the new one separately would either
   * collide with `consent_one_live_per_type` or leave a window in which the user has no recorded
   * answer at all.
   */
  supersede(input: ConsentDecisionInput): Promise<ConsentRecordRow>

  /**
   * Record several decisions at once, each with its own answer.
   *
   * Takes a LIST of individual answers rather than a set of types to grant, so there is no shape
   * in which one action grants several permissions without each having been answered. Applied in
   * a single transaction so a half-saved consent screen cannot happen.
   */
  supersedeMany(inputs: readonly ConsentDecisionInput[]): Promise<readonly ConsentRecordRow[]>
}
