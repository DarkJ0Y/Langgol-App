import { prisma } from '@langgol/db'
import { DIAGNOSIS_CONFIDENCE, type DiagnosisConfidence } from '@langgol/domain/advisory'
import type { DiagnosisRecord, DiagnosisRepository } from '@langgol/application'

/**
 * AI diagnoses served. The table has no image column; see the P16 migration.
 */

function confidenceOf(value: string): DiagnosisConfidence {
  // The database CHECK admits only these three; anything else would be a row written around it.
  return (DIAGNOSIS_CONFIDENCE as readonly string[]).includes(value)
    ? (value as DiagnosisConfidence)
    : 'LOW'
}

function toRecord(row: {
  id: string
  userId: string
  answer: string
  confidence: string
  unusableImage: boolean
  promptVersion: number
  provider: string
  createdAt: Date
}): DiagnosisRecord {
  return { ...row, confidence: confidenceOf(row.confidence) }
}

export const diagnosisRepository: DiagnosisRepository = {
  async record(input) {
    const row = await prisma.diagnosis.create({
      data: {
        userId: input.userId,
        answer: input.answer,
        confidence: input.confidence,
        unusableImage: input.unusableImage,
        promptVersion: input.promptVersion,
        provider: input.provider,
        createdAt: input.at,
      },
    })
    return toRecord(row)
  },

  countSince(since) {
    return prisma.diagnosis.count({ where: { createdAt: { gte: since } } })
  },

  countForUserSince(userId, since) {
    return prisma.diagnosis.count({ where: { userId, createdAt: { gte: since } } })
  },

  async listForUser(userId, limit) {
    const rows = await prisma.diagnosis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows.map(toRecord)
  },
}
