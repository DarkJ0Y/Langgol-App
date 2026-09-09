/**
 * Prisma-backed verifications.
 *
 * ## The projection is the security boundary
 *
 * `toRecord` is the only way a verification leaves this module, and it does not carry the
 * ciphertext, the blind index, or the number. Reaching those takes `revealCiphertext`, which is
 * named after what it does and is called from exactly one authorized use case.
 *
 * This matters more than it looks. The usual way an identity number leaks is not a broken check —
 * it is a `select *` somewhere, feeding a serialiser that renders whatever it is given. There is
 * nothing here for such a serialiser to find.
 *
 * ## Ownership travels in the WHERE clause
 *
 * `findOwned` takes both ids and puts both in the query, so a stranger's record is not found
 * rather than found-then-refused. That is layer three of the three the policy module describes,
 * and it is the one that cannot be forgotten the way an `if` can.
 *
 * Refs: docs/07_SECURITY.md §4, §7
 */

import { prisma } from '@langgol/db'
import { maskPhone } from '@langgol/domain/identity'
import type {
  PendingQueueEntry,
  ReviewInput,
  SubmitIdentityInput,
  VerificationEventRecord,
  VerificationRecord,
  VerificationRepository,
} from '@langgol/application'
import type {
  IdentityType,
  VerificationMethod,
  VerificationStatus,
  VerificationType,
} from '@langgol/domain/kyc'

/**
 * The columns a verification is read through.
 *
 * Written out rather than defaulted, because the default is everything — and on a table joined to
 * one holding a ciphertext, "everything" is precisely what must not be selected. The identity
 * join below names four columns and none of them is the encrypted one.
 */
const RECORD_SELECT = {
  id: true,
  userId: true,
  type: true,
  status: true,
  method: true,
  submittedAt: true,
  reviewedAt: true,
  reviewerUserId: true,
  rejectionReason: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  identity: {
    select: {
      identityType: true,
      identityNumberMasked: true,
      documentFrontKey: true,
      documentBackKey: true,
    },
  },
} as const

type SelectedRow = {
  id: string
  userId: string
  type: string
  status: string
  method: string | null
  submittedAt: Date | null
  reviewedAt: Date | null
  reviewerUserId: string | null
  rejectionReason: string | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  identity: {
    identityType: string
    identityNumberMasked: string
    documentFrontKey: string
    documentBackKey: string | null
  } | null
}

function toRecord(row: SelectedRow): VerificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as VerificationType,
    status: row.status as VerificationStatus,
    method: row.method as VerificationMethod | null,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewerUserId: row.reviewerUserId,
    rejectionReason: row.rejectionReason,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    identityType: (row.identity?.identityType as IdentityType | undefined) ?? null,
    // Already masked in the column. Rendering never needs a decryption, and a read path that
    // never decrypts is a read path that cannot leak.
    identityNumberMasked: row.identity?.identityNumberMasked ?? null,
    // Booleans, not keys. A screen needs to know whether there is a back to look at; it does not
    // need a pointer at the object, which would then travel through every response that carried it.
    hasDocumentFront: row.identity?.documentFrontKey !== undefined,
    hasDocumentBack:
      row.identity?.documentBackKey !== undefined && row.identity?.documentBackKey !== null,
  }
}

export const verificationRepository: VerificationRepository = {
  async listForUser(userId) {
    const rows = await prisma.verification.findMany({
      where: { userId },
      select: RECORD_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((row) => toRecord(row as SelectedRow))
  },

  async findOwned(verificationId, userId) {
    // Both ids in the WHERE clause. Somebody else's record is NOT FOUND, which is a different
    // thing from found-and-refused and discloses less.
    const row = await prisma.verification.findFirst({
      where: { id: verificationId, userId },
      select: RECORD_SELECT,
    })
    return row === null ? null : toRecord(row as SelectedRow)
  },

  async findById(verificationId) {
    const row = await prisma.verification.findUnique({
      where: { id: verificationId },
      select: RECORD_SELECT,
    })
    return row === null ? null : toRecord(row as SelectedRow)
  },

  async blindIndexBelongsToOther(blindIndex, userId) {
    const row = await prisma.identityRecord.findFirst({
      where: { identityNumberBlindIndex: blindIndex, NOT: { userId } },
      select: { id: true },
    })
    return row !== null
  },

  /**
   * Create or replace this user's identity submission.
   *
   * One transaction. A verification row with no identity record beside it is a file a reviewer
   * cannot decide, and an identity record with no verification is a document nobody will ever
   * look at — either half alone is worse than neither.
   *
   * The previous documents are deliberately NOT deleted here. A rejected submission's evidence is
   * what makes the rejection reviewable afterwards, and deleting it on re-submission would erase
   * the reason a complaint could be settled. Their lifecycle belongs to a retention job.
   */
  async submitIdentity(input: SubmitIdentityInput) {
    const written = await prisma.$transaction(async (tx) => {
      const verification = await tx.verification.upsert({
        where: { userId_type: { userId: input.userId, type: 'IDENTITY' } },
        create: {
          userId: input.userId,
          type: 'IDENTITY',
          status: 'PENDING',
          method: input.method,
          submittedAt: input.now,
          updatedAt: input.now,
        },
        update: {
          status: 'PENDING',
          method: input.method,
          submittedAt: input.now,
          // A fresh submission carries none of the last decision. Leaving the old reason attached
          // would show a person the previous refusal beside a file nobody has looked at yet.
          reviewedAt: null,
          reviewerUserId: null,
          rejectionReason: null,
          updatedAt: input.now,
        },
        select: { id: true },
      })

      await tx.identityRecord.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          verificationId: verification.id,
          identityType: input.identityType,
          identityNumberCiphertext: input.identityNumberCiphertext,
          identityNumberBlindIndex: input.identityNumberBlindIndex,
          identityNumberMasked: input.identityNumberMasked,
          identityNumberLast4: input.identityNumberLast4,
          documentFrontKey: input.documentFrontKey,
          documentBackKey: input.documentBackKey,
          updatedAt: input.now,
        },
        update: {
          verificationId: verification.id,
          identityType: input.identityType,
          identityNumberCiphertext: input.identityNumberCiphertext,
          identityNumberBlindIndex: input.identityNumberBlindIndex,
          identityNumberMasked: input.identityNumberMasked,
          identityNumberLast4: input.identityNumberLast4,
          documentFrontKey: input.documentFrontKey,
          documentBackKey: input.documentBackKey,
          updatedAt: input.now,
        },
      })

      await tx.verificationEvent.create({
        data: {
          verificationId: verification.id,
          actorUserId: input.userId,
          action: 'SUBMIT',
          toStatus: 'PENDING',
        },
      })

      return verification.id
    })

    const row = await prisma.verification.findUniqueOrThrow({
      where: { id: written },
      select: RECORD_SELECT,
    })
    return toRecord(row as SelectedRow)
  },

  /**
   * Apply a decision and append its history line together.
   *
   * `updateMany` with the expected status in the WHERE clause, so two reviewers pressing approve
   * at the same moment produce one decision and one loser who is told to reload — rather than two
   * writes where the second silently overwrites the first's attribution.
   */
  async review(input: ReviewInput) {
    const current = await prisma.verification.findUnique({
      where: { id: input.verificationId },
      select: { status: true },
    })
    if (current === null) return null

    const applied = await prisma.$transaction(async (tx) => {
      const affected = await tx.verification.updateMany({
        // The status guard is the optimistic lock. Without it the later write wins and the
        // earlier reviewer's name is quietly replaced.
        where: { id: input.verificationId, status: current.status },
        data: {
          status: input.toStatus,
          reviewerUserId: input.reviewerUserId,
          reviewedAt: input.now,
          rejectionReason: input.toStatus === 'REJECTED' ? input.reason : null,
          updatedAt: input.now,
        },
      })

      if (affected.count === 0) return false

      await tx.verificationEvent.create({
        data: {
          verificationId: input.verificationId,
          actorUserId: input.reviewerUserId,
          action: input.action,
          fromStatus: current.status,
          toStatus: input.toStatus,
          reason: input.reason,
        },
      })

      return true
    })

    if (!applied) return null

    const row = await prisma.verification.findUniqueOrThrow({
      where: { id: input.verificationId },
      select: RECORD_SELECT,
    })
    return toRecord(row as SelectedRow)
  },

  async listAwaitingReview(limit, type) {
    const rows = await prisma.verification.findMany({
      where: {
        status: { in: ['PENDING', 'UNDER_REVIEW'] },
        // Narrowed in the WHERE clause rather than filtered afterwards, so a reviewer's page never
        // holds a file from a queue they may not decide.
        ...(type === undefined ? {} : { type }),
      },
      select: {
        ...RECORD_SELECT,
        // Enough to tell two files apart in a queue, and nothing more. A reviewer does not need
        // the subject's address book to decide whether a photograph matches a number.
        user: { select: { fullName: true, phone: true } },
      },
      // Oldest first: a KYC backlog is a first-come obligation, and any other ordering lets a
      // submission sit indefinitely while newer ones are cleared past it.
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    })

    return rows.map((row): PendingQueueEntry => {
      const withUser = row as SelectedRow & { user: { fullName: string; phone: string } }
      return {
        verification: toRecord(withUser),
        subjectName: withUser.user.fullName,
        // Masked before it leaves the repository, so no caller has to remember to do it.
        subjectPhoneMasked: maskPhone(withUser.user.phone),
      }
    })
  },

  async history(verificationId) {
    const rows = await prisma.verificationEvent.findMany({
      where: { verificationId },
      orderBy: { createdAt: 'asc' },
    })

    return rows.map((row): VerificationEventRecord => ({
      id: row.id,
      verificationId: row.verificationId,
      actorUserId: row.actorUserId,
      action: row.action,
      fromStatus: row.fromStatus as VerificationStatus | null,
      toStatus: row.toStatus as VerificationStatus,
      reason: row.reason,
      createdAt: row.createdAt,
    }))
  },

  async documentKeys(verificationId) {
    const row = await prisma.identityRecord.findUnique({
      where: { verificationId },
      select: { documentFrontKey: true, documentBackKey: true },
    })
    return row === null ? null : { front: row.documentFrontKey, back: row.documentBackKey }
  },

  /**
   * The encrypted number.
   *
   * The owner travels back with it because the ciphertext is bound to them — a caller cannot
   * decrypt it against their own id, which is what stops a reviewer's session from being used to
   * unwrap a ciphertext copied out of another row.
   */
  async revealCiphertext(verificationId) {
    const row = await prisma.identityRecord.findUnique({
      where: { verificationId },
      select: { identityNumberCiphertext: true, userId: true },
    })
    return row === null
      ? null
      : { ciphertext: row.identityNumberCiphertext, ownerUserId: row.userId }
  },
}
