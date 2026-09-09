/**
 * Identity, KYC and verification ports.
 *
 * Three capabilities the use cases need and cannot implement themselves: somewhere to keep an
 * identity number that is not the database in clear, somewhere to keep documents that is not the
 * public internet, and a store for the records themselves.
 *
 * ## The shape that keeps raw NIDs off normal read paths
 *
 * `VerificationRecord` — what every read returns — carries `identityNumberMasked` and no
 * ciphertext at all. There is no field on it a caller could accidentally render. Reading the real
 * number requires `revealIdentityNumber`, a separate method that exists on the repository, takes
 * an explicit reason, and is called from exactly one authorized use case.
 *
 * That is the "never expose raw NID through normal APIs" requirement expressed as a TYPE rather
 * than as a convention: the ordinary path has nothing to leak, so leaking requires deliberately
 * calling the method named after what it does.
 *
 * Refs: docs/07_SECURITY.md §4, §7
 */

import type {
  IdentityType,
  VerificationMethod,
  VerificationStatus,
  VerificationType,
} from '@langgol/domain/kyc'

/* ------------------------------------------------------------------- cipher */

/**
 * Reversible encryption for an identity number.
 *
 * Every method takes the owning user, which is bound into the ciphertext so that a value lifted
 * from one row cannot be decrypted in another.
 */
export interface IdentityCipher {
  /** False when no key is configured. Callers must REFUSE rather than store in clear. */
  readonly isConfigured: boolean
  encrypt(plaintext: string, context: { readonly userId: string }): string
  decrypt(stored: string, context: { readonly userId: string }): string
  /**
   * A deterministic keyed index, for asking whether a number is already registered without
   * decrypting the table. Not bound to a user: finding the same number across different accounts
   * is the entire purpose.
   */
  blindIndex(plaintext: string): string
}

/* -------------------------------------------------------------------- grant */

/**
 * What a caller asks to be granted.
 *
 * No expiry: the signer decides that, and a caller able to name its own would be able to mint a
 * grant that outlived the review it was issued for.
 */
export interface DocumentGrantRequest {
  readonly storageKey: string
  readonly viewerUserId: string
  readonly verificationId: string
}

/** Permission to fetch one stored object, for one viewer, for a few minutes. */
export interface DocumentGrant extends DocumentGrantRequest {
  readonly expiresAt: Date
}

export interface DocumentGrantSigner {
  /** `lifetimeSeconds` is a request, not an instruction: the signer caps it. */
  issue(grant: DocumentGrantRequest, now: Date, lifetimeSeconds?: number): string
  /** Null for every failure — forged, altered, expired — with no hint which. */
  verify(token: string, now: Date): DocumentGrant | null
}

/* --------------------------------------------------------------- repository */

/**
 * A verification as every ordinary read path sees it.
 *
 * Note what is absent: the ciphertext, the blind index, and the number itself. A screen, an API
 * response and a log line can all be built from this without any of them being able to disclose
 * an identity number, because the disclosure is not reachable from here.
 */
export interface VerificationRecord {
  readonly id: string
  readonly userId: string
  readonly type: VerificationType
  readonly status: VerificationStatus
  readonly method: VerificationMethod | null
  readonly submittedAt: Date | null
  readonly reviewedAt: Date | null
  readonly reviewerUserId: string | null
  readonly rejectionReason: string | null
  readonly expiresAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date

  /* Identity-specific, present only when `type` is IDENTITY. */
  readonly identityType: IdentityType | null
  /** Already masked. The only form of the number that ever leaves the repository by default. */
  readonly identityNumberMasked: string | null
  readonly hasDocumentFront: boolean
  readonly hasDocumentBack: boolean
}

/** One line of the history a reviewer and an auditor read. */
export interface VerificationEventRecord {
  readonly id: string
  readonly verificationId: string
  readonly actorUserId: string | null
  readonly action: string
  readonly fromStatus: VerificationStatus | null
  readonly toStatus: VerificationStatus
  readonly reason: string | null
  readonly createdAt: Date
}

export interface SubmitIdentityInput {
  readonly userId: string
  readonly identityType: IdentityType
  /** Already encrypted by the caller. The repository never sees plaintext. */
  readonly identityNumberCiphertext: string
  readonly identityNumberBlindIndex: string
  readonly identityNumberMasked: string
  readonly identityNumberLast4: string
  readonly documentFrontKey: string
  readonly documentBackKey: string | null
  readonly method: VerificationMethod
  readonly now: Date
}

export interface ReviewInput {
  readonly verificationId: string
  readonly reviewerUserId: string
  readonly toStatus: VerificationStatus
  readonly action: string
  readonly reason: string | null
  readonly now: Date
}

export interface PendingQueueEntry {
  readonly verification: VerificationRecord
  /** Enough to tell two submissions apart in a queue. Never more than that. */
  readonly subjectName: string
  readonly subjectPhoneMasked: string
}

export interface VerificationRepository {
  /** Every verification belonging to one user. The account screen's read. */
  listForUser(userId: string): Promise<readonly VerificationRecord[]>

  /** One record, scoped to its owner. A stranger's id is not found rather than forbidden. */
  findOwned(verificationId: string, userId: string): Promise<VerificationRecord | null>

  /** One record by id, for a reviewer. Authorization is the use case's to establish first. */
  findById(verificationId: string): Promise<VerificationRecord | null>

  /**
   * Create or replace this user's identity submission.
   *
   * Idempotent on `(user_id, type)` so two taps on a slow connection produce one record in the
   * queue rather than two.
   */
  submitIdentity(input: SubmitIdentityInput): Promise<VerificationRecord>

  /**
   * Is this identity number already registered to a DIFFERENT user?
   *
   * Asked by blind index, so the question is answerable without decrypting anything.
   */
  blindIndexBelongsToOther(blindIndex: string, userId: string): Promise<boolean>

  /** Apply a reviewer's decision and append the history line, in one transaction. */
  review(input: ReviewInput): Promise<VerificationRecord | null>

  /**
   * The queue. Oldest first, because a backlog is a first-come obligation.
   *
   * `type` narrows it to one kind of verification. The three human-reviewed types beyond identity
   * — business, farm and expert — are separate queues worked by separate people under separate
   * permissions, so a reviewer must never be handed a file they are not authorised to decide.
   * Omitted, it returns every type, which only somebody holding all the permissions should ask for.
   */
  listAwaitingReview(limit: number, type?: VerificationType): Promise<readonly PendingQueueEntry[]>

  /** Every state change on one record, oldest first. */
  history(verificationId: string): Promise<readonly VerificationEventRecord[]>

  /** The storage keys for one record. Separate, so an ordinary read cannot reach them. */
  documentKeys(
    verificationId: string,
  ): Promise<{ readonly front: string; readonly back: string | null } | null>

  /**
   * The encrypted identity number, for the one authorized use case that may reveal it.
   *
   * Named for what it does. A method called `findById` that happened to include a ciphertext
   * would eventually be called by somebody who did not read its fields.
   */
  revealCiphertext(
    verificationId: string,
  ): Promise<{ readonly ciphertext: string; readonly ownerUserId: string } | null>
}
