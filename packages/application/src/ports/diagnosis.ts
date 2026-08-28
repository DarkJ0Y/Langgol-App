/**
 * The diagnosis record.
 *
 * Stores the ANSWER a farmer was given and nothing about the photograph that produced it. The
 * image is discarded once the provider replies (see `domain/advisory/diagnosis.ts`), so there is
 * no key, no URL and no bytes on this record — a farmer can look back at what they were told,
 * and nobody can reconstruct what they photographed.
 *
 * `countSince` and `countForUserSince` exist to serve the spend breaker, which needs both a
 * platform-wide and a per-farmer figure before every call.
 */

import type { DiagnosisConfidence } from '@langgol/domain/advisory'

export interface DiagnosisRecord {
  readonly id: string
  readonly userId: string
  readonly answer: string
  readonly confidence: DiagnosisConfidence
  readonly unusableImage: boolean
  readonly promptVersion: number
  readonly provider: string
  readonly createdAt: Date
}

export interface DiagnosisRepository {
  record(input: {
    readonly userId: string
    readonly answer: string
    readonly confidence: DiagnosisConfidence
    readonly unusableImage: boolean
    readonly promptVersion: number
    readonly provider: string
    readonly at: Date
  }): Promise<DiagnosisRecord>

  /** Everything served since `since`, across all farmers. For the platform budget. */
  countSince(since: Date): Promise<number>

  /** Everything served to one farmer since `since`. For the per-farmer cap. */
  countForUserSince(userId: string, since: Date): Promise<number>

  /** The farmer's own history, newest first. Scoped by user id in the query. */
  listForUser(userId: string, limit: number): Promise<readonly DiagnosisRecord[]>
}
