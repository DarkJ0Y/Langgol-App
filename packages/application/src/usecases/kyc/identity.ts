/**
 * Submitting an identity document, and reading back what came of it.
 *
 * ## The one-way property
 *
 * A subject can reach `PENDING` and nothing else. There is no argument to any function here that
 * influences the outcome of a review, and no code path from this module to `VERIFIED`. That is
 * enforced three times over, deliberately: the policy vocabulary has no self-approving action,
 * the domain transition table has no edge from a SUBJECT actor to VERIFIED, and the database
 * refuses a decided row with no reviewer attached. Any one of them would do; all three are there
 * because this is the check whose absence is worth the most to an attacker.
 *
 * ## What happens to the number
 *
 * It exists in plaintext for the length of this function and nowhere else. It is normalised,
 * encrypted, and handed to the repository already enciphered — the repository has no method that
 * accepts a raw number. What is kept beside it is a mask and four digits, which is what every
 * subsequent read renders, so no ordinary read path ever needs a decryption.
 *
 * Nothing here writes the number to an audit row, an error message or a log line. The audit entry
 * records the masked form, which is enough to tell two submissions apart and not enough to be a
 * disclosure.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §11
 */

import {
  DocumentError,
  IdentityError,
  IDENTITY_DESCRIPTORS,
  canResubmit,
  isIdentityType,
  normalizeIdentity,
  userFacingStatus,
  validateSubmissionDocuments,
  type DocumentCandidate,
  type IdentityType,
  type UserFacingStatus,
  type VerificationType,
} from '@langgol/domain/kyc'
import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  IdentityCipher,
  StoragePort,
  VerificationRecord,
  VerificationRepository,
} from '../../ports/index.js'

export interface KycDeps {
  readonly clock: Clock
  readonly verifications: VerificationRepository
  readonly cipher: IdentityCipher
  readonly storage: StoragePort
  readonly audit: AuditPort
}

export interface SubmitIdentityCommand {
  readonly identityType: string
  /** The raw number as typed. Never stored, never logged, never returned. */
  readonly identityNumber: string
  readonly documentFront: DocumentCandidate | null
  readonly documentBack: DocumentCandidate | null
}

/** What a person sees about one of their own verifications. */
export interface VerificationView {
  readonly id: string
  readonly type: VerificationType
  /** Four words, not five. A subject does not need to know a reviewer has claimed their file. */
  readonly status: UserFacingStatus
  readonly identityType: IdentityType | null
  /** Already masked. There is no unmasked form reachable from this shape. */
  readonly identityNumberMasked: string | null
  readonly rejectionReason: string | null
  readonly submittedAt: Date | null
  readonly reviewedAt: Date | null
  /** Whether the form should be offered again. */
  readonly canResubmit: boolean
}

export function toView(record: VerificationRecord): VerificationView {
  return {
    id: record.id,
    type: record.type,
    status: userFacingStatus(record.status),
    identityType: record.identityType,
    identityNumberMasked: record.identityNumberMasked,
    /*
     * Shown only on a rejection. Carrying it on a later PENDING row would leave the previous
     * refusal on screen beside a submission that has not been judged, which reads as though the
     * new one has already failed.
     */
    rejectionReason: record.status === 'REJECTED' ? record.rejectionReason : null,
    submittedAt: record.submittedAt,
    reviewedAt: record.reviewedAt,
    canResubmit: canResubmit(record.status),
  }
}

/* ------------------------------------------------------------------- read */

/**
 * Every verification belonging to the caller.
 *
 * Takes no user id. The subject is the signed-in actor, so there is no argument here that could
 * be pointed at somebody else's KYC file.
 */
export async function myVerifications(
  actor: MaybeActor,
  deps: KycDeps,
): Promise<Result<readonly VerificationView[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'kyc:read-own', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }

  const records = await deps.verifications.listForUser(actor.userId)
  return ok(records.map(toView))
}

/* ----------------------------------------------------------------- submit */

/**
 * Submit an identity document for review.
 *
 * Ordering is deliberate and is a security property in itself. Everything that can be judged
 * without touching the network is judged first — permission, cipher availability, the number, the
 * files — so that a caller who is not allowed to submit, or whose document is not a document,
 * never causes an upload. An endpoint that stores bytes before it authorizes is a file host.
 */
export async function submitIdentity(
  actor: MaybeActor,
  command: SubmitIdentityCommand,
  deps: KycDeps,
): Promise<Result<VerificationView, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'kyc:submit-own')) return err(Errors.forbidden())

  /*
   * Fail closed when there is no key.
   *
   * The alternative — storing the number in clear and encrypting it later — is how plaintext
   * identity numbers end up in a database permanently. Refusing is visible and recoverable;
   * silently degrading is neither.
   */
  if (!deps.cipher.isConfigured) {
    return err(Errors.providerUnavailable('identity encryption'))
  }

  if (!isIdentityType(command.identityType)) {
    return err(Errors.validation('Unknown document type', { field: 'identityType' }))
  }
  const descriptor = IDENTITY_DESCRIPTORS[command.identityType]

  // Only a document type we actually accept. Checked before the number, so an unsupported type
  // is not also told its number is the wrong length.
  if (!descriptor.submittable) {
    return err(
      Errors.validation('That document type is not accepted yet', {
        field: 'identityType',
        code: 'IDENTITY_TYPE_UNSUPPORTED',
      }),
    )
  }

  /*
   * A live submission is not replaced.
   *
   * Somebody already in the queue may not push themselves to the back of it by submitting again,
   * and a reviewer part-way through a file must not have it change underneath them. Looked up
   * through the user's own list rather than by id, because a first-time submitter has no id to
   * pass and should not have to invent one.
   */
  const current = (await deps.verifications.listForUser(actor.userId)).find(
    (record) => record.type === 'IDENTITY',
  )
  if (current !== undefined && !canResubmit(current.status)) {
    return err(Errors.conflict('A document is already being reviewed'))
  }

  let identity
  try {
    identity = normalizeIdentity(command.identityType, command.identityNumber)
  } catch (cause) {
    if (cause instanceof IdentityError) {
      return err(Errors.validation(cause.message, { field: cause.field, code: cause.code }))
    }
    throw cause
  }

  let documents
  try {
    documents = validateSubmissionDocuments({
      front: command.documentFront,
      back: command.documentBack,
      backRequired: descriptor.hasBackSide,
    })
  } catch (cause) {
    if (cause instanceof DocumentError) {
      return err(Errors.validation(cause.message, { field: cause.field, code: cause.code }))
    }
    throw cause
  }

  /*
   * One document verifies one person.
   *
   * Asked by blind index, so the question is answered without decrypting anybody's row. The
   * database carries the same rule as a UNIQUE; this check exists to turn it into a sentence the
   * submitter can act on rather than a constraint violation.
   */
  const blindIndex = deps.cipher.blindIndex(identity.number)
  if (await deps.verifications.blindIndexBelongsToOther(blindIndex, actor.userId)) {
    /*
     * Deliberately vague, and deliberately the same shape as any other refusal. Confirming that a
     * particular NID is already registered would turn this endpoint into an oracle for testing
     * whether a given person holds a Langgol account.
     */
    /*
     * Recorded, because this refusal is the one place the API behaves differently depending on
     * data about somebody else. A caller can learn whether a given number is registered by
     * submitting it, which is inherent to duplicate detection and cannot be removed without
     * removing the check. What it must not be is INVISIBLE: somebody walking a list of numbers
     * produces a run of these rows against one account, and that is a pattern worth being able
     * to see.
     *
     * The masked form only. Writing the probed number here would put an identity number nobody
     * on this platform owns into the audit table.
     */
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'KYC_DUPLICATE_DOCUMENT_REFUSED',
      entityType: 'user',
      entityId: actor.userId,
      meta: { identityType: command.identityType, identityNumberMasked: identity.masked },
    })

    return err(
      Errors.validation('That document cannot be used', {
        field: 'identityNumber',
        code: 'IDENTITY_ALREADY_REGISTERED',
      }),
    )
  }

  if (!deps.storage.isAvailable) {
    return err(Errors.providerUnavailable('document storage'))
  }

  const front = await deps.storage.upload({
    folder: 'kyc-documents',
    filename: `front.${documents.front.extension}`,
    contentType: documents.front.contentType,
    data: command.documentFront?.bytes ?? new Uint8Array(),
  })
  if (!front.ok) return err(Errors.providerUnavailable('document storage'))

  let backKey: string | null = null
  if (documents.back !== null && command.documentBack !== null) {
    const back = await deps.storage.upload({
      folder: 'kyc-documents',
      filename: `back.${documents.back.extension}`,
      contentType: documents.back.contentType,
      data: command.documentBack.bytes,
    })
    if (!back.ok) return err(Errors.providerUnavailable('document storage'))
    backKey = back.object.storageKey
  }

  const now = deps.clock.now()
  const record = await deps.verifications.submitIdentity({
    userId: actor.userId,
    identityType: command.identityType,
    // Bound to the owner: this ciphertext cannot be decrypted in anybody else's row.
    identityNumberCiphertext: deps.cipher.encrypt(identity.number, { userId: actor.userId }),
    identityNumberBlindIndex: blindIndex,
    identityNumberMasked: identity.masked,
    identityNumberLast4: identity.last4,
    documentFrontKey: front.object.storageKey,
    documentBackKey: backKey,
    method: 'MANUAL_REVIEW',
    now,
  })

  /*
   * The audit row carries the MASK.
   *
   * Enough to tell two submissions apart when investigating, and not a disclosure. The raw number
   * would be a copy of the most sensitive value in the system sitting in a table with a different
   * retention policy and a wider audience than the encrypted column it belongs in.
   */
  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'KYC_SUBMITTED',
    entityType: 'verification',
    entityId: record.id,
    meta: {
      identityType: command.identityType,
      identityNumberMasked: identity.masked,
      hasBack: backKey !== null,
    },
  })

  return ok(toView(record))
}
