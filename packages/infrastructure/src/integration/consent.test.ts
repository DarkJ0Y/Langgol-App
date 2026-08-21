/**
 * Consent integration tests.
 *
 * Consent that can be edited after the fact is not evidence, and no amount of application code
 * proves that — the rules have to be in the database, and the only way to know they are is to try
 * to break them with raw SQL.
 *
 * Skipped unless a real database is configured — see database.test.ts for the run instructions.
 *
 * Refs: docs/07_SECURITY.md §9.2, §10
 */

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import { CONSENT_TYPES } from '@langgol/domain/consent'
import { consentRepository } from '../repositories/consent.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()
const PHONE = '+8801792000001'

afterAll(async () => {
  await prisma.$disconnect()
})

async function withUser(body: (userId: string) => Promise<void>): Promise<void> {
  const user = await prisma.user.create({ data: { phone: PHONE, fullName: 'Consent Integration' } })
  try {
    await body(user.id)
  } finally {
    // `consent_records_no_delete` discards a DELETE, so the rows survive the user; the cascade
    // is what actually removes them.
    await prisma.user.delete({ where: { id: user.id } })
  }
}

const decision = (userId: string, granted = true, version = 1) => ({
  userId,
  consentType: 'MARKETING' as const,
  granted,
  version,
  at: new Date(),
  source: 'ACCOUNT_SETTINGS' as const,
  ipAddress: '203.0.113.7',
  userAgent: 'integration',
})

suite('the enum matches the domain', () => {
  it('offers exactly the consent types the code knows about', async () => {
    // Three places name these — the Prisma enum, the domain catalogue and the UI. A type in one
    // and missing from another can be stored and never labelled, or offered and never saved.
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::"ConsentType"))::text AS value
    `
    expect(rows.map((r) => r.value).sort()).toEqual([...CONSENT_TYPES].sort())
  })

  it('has no ADMIN source, so the database cannot record one', async () => {
    /*
     * The structural half of "admins cannot silently alter user consent". Even a hand-written
     * INSERT has no enum member to attribute an administrator with.
     */
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::"ConsentSource"))::text AS value
    `
    expect(rows.map((r) => r.value).sort()).toEqual(['ACCOUNT_SETTINGS', 'REPROMPT', 'SIGNUP'])
  })
})

suite('consent record constraints', () => {
  it('refuses a version below one', async () => {
    await withUser(async (userId) => {
      await expect(
        prisma.consentRecord.create({
          data: {
            userId,
            consentType: 'MARKETING',
            granted: true,
            version: 0,
            grantedAt: new Date(),
            source: 'SIGNUP',
          },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a decision superseded before it was made', async () => {
    await withUser(async (userId) => {
      const now = new Date()
      await expect(
        prisma.consentRecord.create({
          data: {
            userId,
            consentType: 'MARKETING',
            granted: true,
            version: 1,
            grantedAt: now,
            revokedAt: new Date(now.getTime() - 1000),
            source: 'SIGNUP',
          },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a second live decision for the same permission', async () => {
    // Two live rows would make "do they allow this?" a question with two answers.
    await withUser(async (userId) => {
      await consentRepository.supersede(decision(userId))
      await expect(
        prisma.consentRecord.create({
          data: {
            userId,
            consentType: 'MARKETING',
            granted: false,
            version: 1,
            grantedAt: new Date(),
            source: 'SIGNUP',
          },
        }),
      ).rejects.toThrow()
    })
  })

  it('allows a new decision once the previous one is superseded', async () => {
    await withUser(async (userId) => {
      await consentRepository.supersede(decision(userId, true))
      await expect(consentRepository.supersede(decision(userId, false))).resolves.toBeDefined()
    })
  })
})

suite('consent is append-only', () => {
  it('silently discards a DELETE', async () => {
    /*
     * The same `DO INSTEAD NOTHING` treatment as audit_logs and platform_configs. A support tool
     * or a migration that tried to tidy consent away would appear to succeed and change nothing.
     */
    await withUser(async (userId) => {
      const row = await consentRepository.supersede(decision(userId))

      await prisma.consentRecord.deleteMany({ where: { id: row.id } })

      expect(await prisma.consentRecord.count({ where: { id: row.id } })).toBe(1)
    })
  })

  it('refuses to change what was agreed', async () => {
    await withUser(async (userId) => {
      const row = await consentRepository.supersede(decision(userId, true, 1))

      // Every one of these is an attempt to rewrite history, and every one is discarded.
      await prisma.consentRecord.updateMany({ where: { id: row.id }, data: { granted: false } })
      await prisma.consentRecord.updateMany({ where: { id: row.id }, data: { version: 99 } })
      await prisma.consentRecord.updateMany({
        where: { id: row.id },
        data: { grantedAt: new Date('2000-01-01') },
      })

      const after = await prisma.consentRecord.findUnique({ where: { id: row.id } })
      expect(after?.granted).toBe(true)
      expect(after?.version).toBe(1)
      expect(after?.grantedAt.getFullYear()).toBeGreaterThan(2000)
    })
  })

  it('allows exactly one edit: stamping a live row as superseded', async () => {
    await withUser(async (userId) => {
      await consentRepository.supersede(decision(userId, true))
      await consentRepository.supersede(decision(userId, false))

      const rows = await prisma.consentRecord.findMany({
        where: { userId },
        orderBy: { grantedAt: 'asc' },
      })
      expect(rows).toHaveLength(2)
      expect(rows[0]?.revokedAt).not.toBeNull()
      expect(rows[1]?.revokedAt).toBeNull()
    })
  })

  it('refuses to un-supersede a row that has already ended', async () => {
    // Reviving a superseded decision would resurrect an agreement the user withdrew.
    await withUser(async (userId) => {
      await consentRepository.supersede(decision(userId, true))
      await consentRepository.supersede(decision(userId, false))

      const ended = await prisma.consentRecord.findFirst({
        where: { userId, revokedAt: { not: null } },
      })
      if (ended === null) throw new Error('expected a superseded row')

      await prisma.consentRecord.updateMany({ where: { id: ended.id }, data: { revokedAt: null } })

      const after = await prisma.consentRecord.findUnique({ where: { id: ended.id } })
      expect(after?.revokedAt).not.toBeNull()
    })
  })
})

suite('the consent repository against real SQL', () => {
  it('keeps every decision and reports the live one', async () => {
    await withUser(async (userId) => {
      await consentRepository.supersede(decision(userId, true))
      await consentRepository.supersede(decision(userId, false))
      await consentRepository.supersede(decision(userId, true))

      const live = await consentRepository.listLiveForUser(userId)
      const history = await consentRepository.listHistoryForUser(userId)

      expect(live).toHaveLength(1)
      expect(live[0]?.granted).toBe(true)
      expect(history).toHaveLength(3)
    })
  })

  it('writes a whole screen of answers in one transaction', async () => {
    await withUser(async (userId) => {
      const at = new Date()
      const written = await consentRepository.supersedeMany([
        { ...decision(userId), consentType: 'MARKETING', granted: true, at },
        { ...decision(userId), consentType: 'LOCATION', granted: false, at },
        { ...decision(userId), consentType: 'FARM_DATA', granted: true, at },
      ])

      expect(written).toHaveLength(3)
      const live = await consentRepository.listLiveForUser(userId)
      expect(
        live
          .filter((r) => r.granted)
          .map((r) => r.consentType)
          .sort(),
      ).toEqual(['FARM_DATA', 'MARKETING'])
    })
  })

  it('stores the IP and user agent that the API never returns', async () => {
    // Held so an agreement can be evidenced if challenged; simply not part of any response.
    await withUser(async (userId) => {
      const row = await consentRepository.supersede(decision(userId))
      const stored = await prisma.consentRecord.findUnique({ where: { id: row.id } })

      expect(stored?.ipAddress).toBe('203.0.113.7')
      expect(JSON.stringify(row)).not.toContain('203.0.113.7')
    })
  })

  it('removes consent with the user, since it is their record', async () => {
    const user = await prisma.user.create({
      data: { phone: '+8801792000002', fullName: 'Cascade Consent' },
    })
    await consentRepository.supersede(decision(user.id))

    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.consentRecord.count({ where: { userId: user.id } })).toBe(0)
  })
})
