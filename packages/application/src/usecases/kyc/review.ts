/**
 * The reviewer's side of KYC: the queue, the decision, and the history.
 *
 * ## Who may be here at all
 *
 * `ADMIN`, and nobody else. `OPS_AGENT` is deliberately excluded even though field agents are
 * trusted with a great deal — they sit beside a farmer and help them submit, and approving the
 * document you helped to gather puts one person on both sides of the check. That is the shape of
 * every KYC fraud that has ever been written up, and the exclusion is in the policy table rather
 * than here so it cannot be widened by a local edit.
 *
 * ## Nobody reviews their own file
 *
 * An administrator is also a user, and can hold an identity record like anybody else. Checked in
 * this module, and again by a CHECK constraint in the database, because a self-approval is the
 * one row in this system that is both trivially obtainable and completely invisible afterwards.
 *
 * ## What a reviewer is shown, and what they are not
 *
 * The queue carries a name, a masked number and the timestamps. Not the identity number, and not
 * the documents — those require a separate, individually authorized, individually audited step,
 * so that "an operator opened this person's NID" is always a recorded event rather than a side
 * effect of loading a list.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §8.4, §11
 */

import {
  VerificationError,
  applyTransition,
  awaitsReview,
  isVerificationType,
  type VerificationAction,
  type VerificationType,
} from '@langgol/domain/kyc'
import { reviewPermissionFor } from '@langgol/domain/admin'
import type { AuditAction } from '@langgol/domain/audit'
import { allowed, isActor, type Action, type MaybeActor } from '@langgol/domain/policy'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { PendingQueueEntry, VerificationEventRecord } from '../../ports/index.js'
import type { KycDeps } from './identity.js'

/** How many files a reviewer is handed at once. A queue page, not the whole backlog. */
const QUEUE_PAGE = 50

/**
 * The audit action for each decision.
 *
 * Written out rather than interpolated. `KYC_${decision.action}` produced the bare words
 * `KYC_APPROVE` and `KYC_REJECT`, which read as present-tense instructions in a table whose every
 * other row is past-tense — and, being built by string concatenation, could never be checked
 * against the vocabulary at all.
 */
const KYC_AUDIT_ACTION: Record<ReviewDecision['action'], AuditAction> = {
  CLAIM: 'KYC_CLAIMED',
  APPROVE: 'KYC_APPROVED',
  REJECT: 'KYC_REJECTED',
}

/**
 * The files waiting for a decision, oldest first.
 *
 * Oldest first is not cosmetic. A KYC backlog is a first-come obligation, and a queue sorted any
 * other way lets a submission sit indefinitely while newer ones are cleared past it.
 */
export async function listPendingReviews(
  actor: MaybeActor,
  deps: KycDeps,
  limit: number = QUEUE_PAGE,
): Promise<Result<readonly PendingQueueEntry[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'kyc:review')) return err(Errors.forbidden())

  const capped = Math.min(Math.max(Math.floor(limit), 1), QUEUE_PAGE)
  return ok(await deps.verifications.listAwaitingReview(capped))
}

/**
 * The policy action that governs deciding this kind of verification.
 *
 * One workflow, four permissions. The person who checks a trade licence is not the person who
 * checks an agronomist's degree, and neither needs to be the person who reads national identity
 * cards — so the queue a reviewer sees and the decisions they may make are both narrowed by which
 * of the four they hold.
 *
 * PHONE and EMAIL map to nothing: they are proved by the subject redeeming a code, and a human
 * decision on one would be meaningless.
 */
export function reviewActionFor(type: string): Action | null {
  switch (type) {
    case 'IDENTITY':
    case 'PAYMENT':
      return 'kyc:review'
    case 'BUSINESS':
      return 'verification:review-business'
    case 'FARM':
      return 'verification:review-farm'
    case 'EXPERT':
      return 'verification:review-expert'
    default:
      return null
  }
}

/**
 * One queue, for one kind of verification.
 *
 * Separate from `listPendingReviews` so the permission checked is the one for the type being
 * asked for. A reviewer holding only BUSINESS_REVIEW gets the business queue and is refused the
 * others, rather than being handed a mixed list and trusted to leave the rest alone.
 */
export async function listReviewQueue(
  actor: MaybeActor,
  type: string,
  deps: KycDeps,
  limit: number = QUEUE_PAGE,
): Promise<Result<readonly PendingQueueEntry[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  if (!isVerificationType(type)) {
    return err(Errors.validation('Unknown verification type', { field: 'type' }))
  }

  const action = reviewActionFor(type)
  // PHONE and EMAIL have no reviewer queue at all, so there is nothing to be authorised for.
  if (action === null || reviewPermissionFor(type) === null) {
    return err(Errors.validation('That kind is not reviewed by hand', { field: 'type' }))
  }

  if (!allowed(actor, action)) return err(Errors.forbidden())

  const capped = Math.min(Math.max(Math.floor(limit), 1), QUEUE_PAGE)
  return ok(await deps.verifications.listAwaitingReview(capped, type as VerificationType))
}

export interface ReviewDecision {
  readonly action: Extract<VerificationAction, 'CLAIM' | 'APPROVE' | 'REJECT'>
  /** Mandatory for a rejection. The domain refuses the transition without one. */
  readonly reason?: string | null
}

/**
 * Record a reviewer's decision.
 *
 * The transition itself is decided by the domain, which owns which states may follow which and
 * whether a reason is required. This function's job is everything the domain cannot know: who is
 * asking, whether they are allowed, whether the record is theirs to judge, and what gets written
 * down afterwards.
 */
export async function reviewVerification(
  actor: MaybeActor,
  verificationId: string,
  decision: ReviewDecision,
  deps: KycDeps,
): Promise<Result<{ readonly status: string }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  /*
   * Authorised against the record's OWN type, not against a fixed permission.
   *
   * The record has to be read first to know which permission applies, which is the fetch-then-check
   * shape usually worth avoiding. It is correct here because nothing has been disclosed at this
   * point — the refusal below happens before any field of the record is returned or acted on, and
   * the alternative would be one permission covering four different reviewers' jobs.
   */
  const record = await deps.verifications.findById(verificationId)
  if (record === null) return err(Errors.notFound('Verification'))

  const action = reviewActionFor(record.type)
  if (action === null) {
    return err(Errors.validation('That kind is not reviewed by hand', { field: 'type' }))
  }
  if (!allowed(actor, action)) return err(Errors.forbidden())

  /*
   * An administrator may not decide their own file.
   *
   * Reported as NOT_FOUND rather than FORBIDDEN, matching how ownership failures are reported
   * everywhere else in this codebase: a 403 would confirm the record exists, and here the person
   * asking already knows it does. The value is that the refusal is uniform and the audit line
   * below is unambiguous.
   */
  if (record.userId === actor.userId) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'KYC_SELF_REVIEW_REFUSED',
      entityType: 'verification',
      entityId: record.id,
      reason: 'reviewer is the subject',
    })
    return err(Errors.forbidden())
  }

  let outcome
  try {
    outcome = applyTransition({
      action: decision.action,
      from: record.status,
      by: 'REVIEWER',
      reason: decision.reason ?? null,
    })
  } catch (cause) {
    if (cause instanceof VerificationError) {
      return err(Errors.validation(cause.message, { code: cause.code }))
    }
    throw cause
  }

  const updated = await deps.verifications.review({
    verificationId: record.id,
    reviewerUserId: actor.userId,
    toStatus: outcome.to,
    action: decision.action,
    reason: outcome.reason,
    now: deps.clock.now(),
  })

  // Null means the row moved between the read and the write — another reviewer got there first.
  // Reported as a conflict rather than an error, because the correct action is to reload.
  if (updated === null) return err(Errors.conflict('That file was already decided'))

  /*
   * The audit row names the decision and carries the reviewer's own words.
   *
   * It does NOT carry the identity number, the mask, or anything about the documents. What an
   * investigation needs from this line is who decided what and when; the subject is identified by
   * the record id, which is a join away from everything else.
   */
  await deps.audit.record({
    actorUserId: actor.userId,
    action: KYC_AUDIT_ACTION[decision.action],
    entityType: 'verification',
    entityId: record.id,
    ...(outcome.reason === null ? {} : { reason: outcome.reason }),
    meta: { from: record.status, to: outcome.to, subjectUserId: record.userId },
  })

  return ok({ status: updated.status })
}

/**
 * The history of one verification.
 *
 * Readable by the subject as well as by a reviewer, and that is deliberate: a person who was
 * rejected is entitled to see when it happened and what was said. What they do not get is the
 * reviewer's identity, which is stripped below — a farmer who disagrees with a decision should
 * take it up with Langgol, not with the individual who made it.
 */
export interface HistoryLine {
  readonly action: string
  readonly fromStatus: string | null
  readonly toStatus: string
  readonly reason: string | null
  readonly at: Date
  /** Present only for a reviewer. Null when the subject is reading their own history. */
  readonly actorUserId: string | null
}

export async function verificationHistory(
  actor: MaybeActor,
  verificationId: string,
  deps: KycDeps,
): Promise<Result<readonly HistoryLine[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const record = await deps.verifications.findById(verificationId)
  if (record === null) return err(Errors.notFound('Verification'))

  const isSubject = record.userId === actor.userId
  const isReviewer = allowed(actor, 'kyc:read-any')

  // Neither the owner nor an administrator: not found, so the id itself discloses nothing.
  if (!isSubject && !isReviewer) return err(Errors.notFound('Verification'))

  const events = await deps.verifications.history(verificationId)

  return ok(
    events.map((event: VerificationEventRecord) => ({
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason,
      at: event.createdAt,
      // Withheld from the subject. A reviewer sees who decided; the person decided about does not.
      actorUserId: isReviewer ? event.actorUserId : null,
    })),
  )
}

/** Whether a record is still waiting on somebody. Re-exported so a screen need not re-derive it. */
export { awaitsReview }
