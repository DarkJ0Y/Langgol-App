/**
 * Prisma-backed consent store.
 *
 * Append-only, and the database enforces it independently: `consent_records_no_delete` discards
 * a DELETE, and `consent_records_supersede_only` discards any UPDATE except stamping `revoked_at`
 * on a row that is still live. So the code below cannot rewrite history even if a future method
 * tries — which is the point, because consent that can be edited afterwards is not evidence.
 *
 * Superseding is one transaction. The partial unique index allows a single live row per
 * (user, type), so ending the old row and inserting the new one as separate statements would
 * either collide or leave the user with no recorded answer in between.
 *
 * Refs: docs/07_SECURITY.md §9.2, §10
 */

import { prisma, type $Enums, type Prisma } from '@langgol/db'
import type { ConsentSource, ConsentType } from '@langgol/domain/consent'
import type {
  ConsentDecisionInput,
  ConsentRecordRow,
  ConsentRepository,
} from '@langgol/application'

const SELECT = {
  id: true,
  userId: true,
  consentType: true,
  granted: true,
  version: true,
  grantedAt: true,
  revokedAt: true,
  source: true,
} as const

interface Row {
  id: string
  userId: string
  consentType: string
  granted: boolean
  version: number
  grantedAt: Date
  revokedAt: Date | null
  source: string
}

function toRecord(row: Row): ConsentRecordRow {
  return {
    id: row.id,
    userId: row.userId,
    consentType: row.consentType as ConsentType,
    granted: row.granted,
    version: row.version,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
    source: row.source as ConsentSource,
  }
}

/**
 * End the live decision for one type and record the replacement.
 *
 * Extracted so `supersede` and `supersedeMany` share exactly one implementation — two copies of
 * a two-statement invariant is how the second copy ends up missing the first statement.
 */
async function supersedeWithin(
  tx: Prisma.TransactionClient,
  input: ConsentDecisionInput,
): Promise<ConsentRecordRow> {
  // Conditional on still being live, so a concurrent second write ends zero rows rather than
  // overwriting the first one's timestamp.
  await tx.consentRecord.updateMany({
    where: {
      userId: input.userId,
      consentType: input.consentType as $Enums.ConsentType,
      revokedAt: null,
    },
    data: { revokedAt: input.at },
  })

  const row = await tx.consentRecord.create({
    data: {
      userId: input.userId,
      consentType: input.consentType as $Enums.ConsentType,
      granted: input.granted,
      version: input.version,
      grantedAt: input.at,
      source: input.source as $Enums.ConsentSource,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
    select: SELECT,
  })

  return toRecord(row as Row)
}

export const consentRepository: ConsentRepository = {
  async listLiveForUser(userId) {
    const rows = await prisma.consentRecord.findMany({
      where: { userId, revokedAt: null },
      select: SELECT,
      orderBy: { grantedAt: 'desc' },
    })
    return rows.map((row) => toRecord(row as Row))
  },

  async listHistoryForUser(userId) {
    // Superseded rows included — keeping them is the entire reason this table is append-only.
    const rows = await prisma.consentRecord.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { grantedAt: 'desc' },
    })
    return rows.map((row) => toRecord(row as Row))
  },

  supersede(input) {
    return prisma.$transaction((tx) => supersedeWithin(tx, input))
  },

  supersedeMany(inputs) {
    /*
     * One transaction for the whole screen. A consent form that saved four answers and failed on
     * the fifth would leave the user believing they had set preferences they had not.
     */
    return prisma.$transaction(async (tx) => {
      const written: ConsentRecordRow[] = []
      for (const input of inputs) written.push(await supersedeWithin(tx, input))
      return written
    })
  },
}
