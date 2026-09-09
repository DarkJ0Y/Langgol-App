/**
 * The verification state machine, shared by every kind of verification Langgol performs.
 *
 * Seven things get verified — a phone, an email, an identity document, a farm, a business, an
 * expert's credentials, a payment destination — and before this module they had nothing in
 * common but the word. Phone and email each grew their own flow, which was right for them: a
 * six-digit code and an emailed token are automatic, and neither needs a human.
 *
 * The other five do need a human, and that is the whole reason this exists. "Somebody submitted
 * evidence, somebody qualified looked at it, and here is what they decided and when" is one
 * problem, not five, and solving it five times is how the fifth one ends up without an audit
 * trail.
 *
 * ## The rule the whole module exists to enforce
 *
 * **A subject can never verify itself.** There is no transition from any state to `VERIFIED`
 * that a submitter can drive. `submit` reaches `PENDING`; everything after that is a reviewer's
 * to decide. This is enforced here as a shape — the transition table simply has no such edge —
 * rather than as a check somewhere that could be forgotten.
 *
 * Refs: docs/07_SECURITY.md §4, §8.4
 */

/**
 * What is being verified.
 *
 * `PHONE` and `EMAIL` are included even though they are proven automatically. They belong in the
 * vocabulary because a user's verification screen has to list them beside the rest, and because
 * an operator asking "what is proven about this account?" should get one answer rather than
 * having to know which two live somewhere else.
 */
export const VERIFICATION_TYPES = [
  'PHONE',
  'EMAIL',
  'IDENTITY',
  'FARM',
  'BUSINESS',
  'EXPERT',
  'PAYMENT',
] as const
export type VerificationType = (typeof VERIFICATION_TYPES)[number]

export const isVerificationType = (value: unknown): value is VerificationType =>
  typeof value === 'string' && (VERIFICATION_TYPES as readonly string[]).includes(value)

/**
 * The types a person proves by doing something, with no reviewer involved.
 *
 * Kept as a list rather than a flag on each type because the distinction decides which queue a
 * record joins: an automatic type must never appear in a reviewer's inbox, where it would sit
 * forever waiting for a decision nobody is expected to make.
 */
export const AUTOMATIC_VERIFICATION_TYPES: readonly VerificationType[] = ['PHONE', 'EMAIL']

/** The types that reach a human reviewer. The complement of the automatic ones. */
export const REVIEWED_VERIFICATION_TYPES: readonly VerificationType[] = VERIFICATION_TYPES.filter(
  (type) => !AUTOMATIC_VERIFICATION_TYPES.includes(type),
)

export const isReviewedType = (type: VerificationType): boolean =>
  REVIEWED_VERIFICATION_TYPES.includes(type)

/**
 * Where a verification stands.
 *
 * `PENDING` and `UNDER_REVIEW` are deliberately distinct. Pending means nobody has picked it up;
 * under review means somebody has. Collapsing them would make an ageing queue indistinguishable
 * from a busy one, and the operational question "is anybody actually looking at these?" would
 * have no answer.
 *
 * `EXPIRED` is not a rejection. A document that has lapsed was never judged false — it simply
 * stopped being current, and the difference matters to somebody re-submitting.
 */
export const VERIFICATION_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const isVerificationStatus = (value: unknown): value is VerificationStatus =>
  typeof value === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(value)

/** How the evidence was checked. Recorded so a decision can be understood later. */
export const VERIFICATION_METHODS = [
  /** A reviewer looked at the documents. The only method available today. */
  'MANUAL_REVIEW',
  /** A code or link the subject redeemed. Phone and email.  */
  'AUTOMATED_CHALLENGE',
  /** Checked against an issuing authority's register. Not yet built. */
  'GOVERNMENT_REGISTRY',
  /** A field agent confirmed it in person. */
  'FIELD_AGENT',
] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

export const isVerificationMethod = (value: unknown): value is VerificationMethod =>
  typeof value === 'string' && (VERIFICATION_METHODS as readonly string[]).includes(value)

export class VerificationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'VerificationError'
  }
}

/**
 * What may happen to a verification, and who may cause it.
 *
 * `SUBMIT` is the only transition a subject can perform. Everything else is a reviewer's, and
 * `EXPIRE` is the system's. The actor kind is part of the transition rather than checked
 * separately, so a use case cannot accidentally apply a reviewer's transition on a subject's
 * behalf.
 */
export const VERIFICATION_ACTIONS = ['SUBMIT', 'CLAIM', 'APPROVE', 'REJECT', 'EXPIRE'] as const
export type VerificationAction = (typeof VERIFICATION_ACTIONS)[number]

export type ActorKind = 'SUBJECT' | 'REVIEWER' | 'SYSTEM'

interface TransitionRule {
  readonly from: readonly VerificationStatus[]
  readonly to: VerificationStatus
  readonly by: readonly ActorKind[]
  /** A reason is mandatory for this transition. */
  readonly needsReason?: boolean
}

/**
 * The transition table.
 *
 * Note what has no entry: nothing takes a record to `VERIFIED` with `SUBJECT` among its actors.
 * That absence is the security property — a submitter holds no transition that approves their
 * own document, so there is no check to forget and no flag to get wrong.
 */
const TRANSITIONS: Record<VerificationAction, TransitionRule> = {
  /*
   * Re-submission is allowed from a settled state and not from a live one. Somebody who was
   * rejected may correct their documents and try again; somebody already in the queue may not
   * push themselves to the back of it by submitting twice.
   */
  SUBMIT: {
    from: ['REJECTED', 'EXPIRED'],
    to: 'PENDING',
    by: ['SUBJECT'],
  },

  /** A reviewer picks the record up. Makes an ageing queue distinguishable from a busy one. */
  CLAIM: {
    from: ['PENDING'],
    to: 'UNDER_REVIEW',
    by: ['REVIEWER'],
  },

  /*
   * Approval is reachable from `PENDING` as well as `UNDER_REVIEW`. Requiring a claim first
   * would be process theatre: a reviewer who has read the documents has read them whether or not
   * they pressed a button beforehand.
   */
  APPROVE: {
    from: ['PENDING', 'UNDER_REVIEW'],
    to: 'VERIFIED',
    by: ['REVIEWER'],
  },

  /*
   * A rejection without a reason is the failure this flag exists to prevent. The person is going
   * to re-submit, and "rejected" alone tells them nothing about what to change — so they guess,
   * submit the same thing, and occupy the queue twice.
   */
  REJECT: {
    from: ['PENDING', 'UNDER_REVIEW'],
    to: 'REJECTED',
    by: ['REVIEWER'],
    needsReason: true,
  },

  /*
   * Only a verified record expires. A pending one that has gone stale is a queue problem, not a
   * lapsed document, and marking it `EXPIRED` would tell the submitter their papers were out of
   * date when nobody had looked at them.
   */
  EXPIRE: {
    from: ['VERIFIED'],
    to: 'EXPIRED',
    by: ['SYSTEM'],
  },
}

export interface TransitionInput {
  readonly action: VerificationAction
  readonly from: VerificationStatus
  readonly by: ActorKind
  readonly reason?: string | null
}

export interface TransitionOutcome {
  readonly to: VerificationStatus
  /** Trimmed, length-checked, and null when the transition does not carry one. */
  readonly reason: string | null
}

/** A rejection reason long enough to act on and short enough to read. */
export const MAX_REASON_LENGTH = 500
const MIN_REASON_LENGTH = 4

/**
 * Decide a transition, or refuse it.
 *
 * Pure, so the whole table is exhaustively testable without a database, a clock or a request.
 * Every refusal names a code rather than a sentence, because the words belong to the interface
 * and the reason belongs to the audit log.
 */
export function applyTransition(input: TransitionInput): TransitionOutcome {
  const rule = TRANSITIONS[input.action]
  if (rule === undefined) {
    throw new VerificationError('Unknown action', 'UNKNOWN_ACTION')
  }

  if (!rule.by.includes(input.by)) {
    // The message is deliberately about the actor, not about the record: telling a subject which
    // states an approval is reachable from would be describing a door they do not have.
    throw new VerificationError('Not permitted to do that', 'ACTOR_NOT_PERMITTED')
  }

  if (!rule.from.includes(input.from)) {
    throw new VerificationError(
      `Cannot ${input.action.toLowerCase()} from ${input.from}`,
      'ILLEGAL_TRANSITION',
    )
  }

  const trimmed = typeof input.reason === 'string' ? input.reason.trim() : ''

  if (rule.needsReason === true) {
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw new VerificationError('Say why, so it can be corrected', 'REASON_REQUIRED')
    }
    if (trimmed.length > MAX_REASON_LENGTH) {
      throw new VerificationError('That reason is too long', 'REASON_TOO_LONG')
    }
  }

  return { to: rule.to, reason: trimmed === '' ? null : trimmed.slice(0, MAX_REASON_LENGTH) }
}

/** Whether a record in this state is waiting for a reviewer. Drives the queue. */
export function awaitsReview(status: VerificationStatus): boolean {
  return status === 'PENDING' || status === 'UNDER_REVIEW'
}

/**
 * What the SUBJECT is told.
 *
 * Four words, not five: a person looking at their own account does not need to know whether a
 * reviewer has claimed their file, and showing them would raise a question they cannot act on
 * ("why has nobody picked it up?"). `UNDER_REVIEW` therefore reads as pending, which is what it
 * means to the person waiting.
 *
 * `EXPIRED` reads as not verified rather than as its own word for the same reason it exists in
 * the first place: the action a person must take is identical to never having submitted, and a
 * distinct label would imply a distinct remedy.
 */
export type UserFacingStatus = 'NOT_VERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED'

export function userFacingStatus(status: VerificationStatus | null): UserFacingStatus {
  switch (status) {
    case 'PENDING':
    case 'UNDER_REVIEW':
      return 'PENDING'
    case 'VERIFIED':
      return 'VERIFIED'
    case 'REJECTED':
      return 'REJECTED'
    case 'EXPIRED':
    case null:
    default:
      return 'NOT_VERIFIED'
  }
}

/** Whether a person may submit again. Drives whether the form is offered at all. */
export function canResubmit(status: VerificationStatus | null): boolean {
  return status === null || status === 'REJECTED' || status === 'EXPIRED'
}
