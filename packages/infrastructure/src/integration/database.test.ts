/**
 * Database integration tests.
 *
 * These run against a REAL PostgreSQL + PostGIS instance and are skipped when one is not
 * configured, so `pnpm test` stays fast and offline while CI and local Docker runs get the real
 * verification.
 *
 *   docker compose up -d && pnpm db:migrate && pnpm db:seed
 *   LANGGOL_INTEGRATION=1 pnpm test
 *
 * Scope is deliberately narrow: the things that can only be wrong against a real database —
 * constraints, triggers, append-only rules, PostGIS behaviour, and the repository queries whose
 * scoping is the actual security control.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import { CONFIG_KEYS } from '@langgol/domain/config'
import { loadConfigSnapshot } from '../config/loader.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()

afterAll(async () => {
  await prisma.$disconnect()
})

suite('platform configuration against a real database', () => {
  it('loads every seeded key into a valid snapshot', async () => {
    // The app cannot boot if this throws. It is the single highest-value integration check.
    const snapshot = await loadConfigSnapshot()
    expect(snapshot.require('commission.bps')).toBe(300)
    expect(snapshot.require('commission.incidence')).toBe('SELLER')
    expect(snapshot.require('payments.prepaidEnabled')).toBe(false)
    expect(snapshot.require('auth.otp.ttlSeconds')).toBe(300)
  })

  it('reports open product decisions as unset rather than guessing', async () => {
    const snapshot = await loadConfigSnapshot()
    expect(snapshot.unsetKeys).toContain('pilot.lossBudget')
    expect(snapshot.unsetKeys).toContain('cancellation.feeSchedule')
    expect(() => snapshot.require('pilot.lossBudget')).toThrow()
  })

  it('has a seeded value for every key the code knows about, or a recorded reason', async () => {
    const snapshot = await loadConfigSnapshot()
    const accounted = new Set([...snapshot.unsetKeys, ...Object.keys(snapshot.versions)])
    const unaccounted = CONFIG_KEYS.filter((key) => !accounted.has(key))
    expect(unaccounted).toEqual([])
  })
})

suite('development fixtures', () => {
  it('seeds exactly the domain allowlist, all inside the reserved phone block', async () => {
    const fixtures = await prisma.user.findMany({
      where: { isDevelopmentFixture: true },
      select: { phone: true, fullName: true },
    })
    expect(fixtures).toHaveLength(DEVELOPMENT_IDENTITIES.length)
    for (const fixture of fixtures) {
      expect(fixture.phone).toMatch(/^\+88017000000(?:0[1-9]|2[0-9])$/)
    }
  })

  it('refuses the fixture flag outside the reserved block', async () => {
    // The constraint, not a convention: a real user's row can never be flagged.
    await expect(
      prisma.user.create({
        data: {
          phone: '+8801799999999',
          fullName: 'Not A Fixture',
          isDevelopmentFixture: true,
        },
      }),
    ).rejects.toThrow()
  })

  it('scopes the fixture lookup in SQL, so a real user is unreachable through it', async () => {
    const real = await prisma.user.create({
      data: { phone: '+8801798765432', fullName: 'Real User' },
    })
    try {
      const found = await prisma.user.findFirst({
        where: { phone: real.phone, isDevelopmentFixture: true },
      })
      expect(found).toBeNull()
    } finally {
      await prisma.user.delete({ where: { id: real.id } })
    }
  })
})

suite('append-only guarantees', () => {
  it('silently discards updates and deletes on the audit log', async () => {
    const marker = `INTEGRATION_${String(Date.now())}`
    await prisma.auditLog.create({
      data: { action: marker, entityType: 'test', entityId: 'test' },
    })

    await prisma.auditLog.updateMany({ where: { action: marker }, data: { action: 'TAMPERED' } })
    expect(await prisma.auditLog.count({ where: { action: 'TAMPERED' } })).toBe(0)

    await prisma.auditLog.deleteMany({ where: { action: marker } })
    expect(await prisma.auditLog.count({ where: { action: marker } })).toBe(1)
  })

  it('keeps published configuration immutable', async () => {
    await prisma.platformConfig.updateMany({
      where: { key: 'commission.bps' },
      data: { note: 'TAMPERED' },
    })
    const row = await prisma.platformConfig.findFirst({ where: { key: 'commission.bps' } })
    expect(row?.note).not.toBe('TAMPERED')
  })
})

suite('phone normalisation is enforced by the database', () => {
  it('rejects an unnormalised number', async () => {
    await expect(
      prisma.user.create({ data: { phone: '01712345678', fullName: 'Unnormalised' } }),
    ).rejects.toThrow()
  })

  it('rejects an impossible operator prefix', async () => {
    await expect(
      prisma.user.create({ data: { phone: '+8801212345678', fullName: 'Bad Operator' } }),
    ).rejects.toThrow()
  })
})

suite('PostGIS location behaviour', () => {
  it('derives the geography point from latitude/longitude and finds it by radius', async () => {
    const area = await prisma.adminArea.findFirst({ where: { type: 'UPAZILA' } })
    expect(area).not.toBeNull()
    if (area === null) return

    const user = await prisma.user.create({
      data: { phone: '+8801797000001', fullName: 'Geo Integration' },
    })

    try {
      // Rajshahi city, roughly. Precision is EXACT because these are real coordinates for a
      // point we chose, not a centroid we invented.
      const address = await prisma.address.create({
        data: {
          userId: user.id,
          recipientName: 'Geo Integration',
          recipientPhone: '+8801797000001',
          adminAreaId: area.id,
          addressLine: 'Integration test',
          latitude: 24.374945,
          longitude: 88.604229,
          precision: 'EXACT',
        },
      })

      const withGeo = await prisma.$queryRaw<{ present: boolean }[]>`
        SELECT geo IS NOT NULL AS present FROM addresses WHERE id = ${address.id}::uuid
      `
      expect(withGeo[0]?.present).toBe(true)

      // A radius query must find it — this is the query discovery will use in P3.
      const near = await prisma.$queryRaw<{ id: string; distance_m: number }[]>`
        SELECT id, ST_Distance(geo, ST_SetSRID(ST_MakePoint(88.604229, 24.374945), 4326)::geography) AS distance_m
        FROM addresses
        WHERE ST_DWithin(geo, ST_SetSRID(ST_MakePoint(88.604229, 24.374945), 4326)::geography, 500)
      `
      expect(near.some((row) => row.id === address.id)).toBe(true)

      // And must NOT find it from 100 km away.
      const far = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM addresses
        WHERE ST_DWithin(geo, ST_SetSRID(ST_MakePoint(90.4, 23.8), 4326)::geography, 1000)
      `
      expect(far.some((row) => row.id === address.id)).toBe(false)

      await prisma.address.delete({ where: { id: address.id } })
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  it('rejects an impossible coordinate', async () => {
    const area = await prisma.adminArea.findFirst()
    const user = await prisma.user.create({
      data: { phone: '+8801797000002', fullName: 'Bad Coords' },
    })
    try {
      await expect(
        prisma.address.create({
          data: {
            userId: user.id,
            recipientName: 'Bad Coords',
            recipientPhone: '+8801797000002',
            adminAreaId: area?.id ?? '',
            addressLine: 'Test',
            latitude: 999,
            longitude: 999,
          },
        }),
      ).rejects.toThrow()
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })
})

suite('ownership scoping', () => {
  it('cannot reach another user’s address through an owner-scoped query', async () => {
    const area = await prisma.adminArea.findFirst()
    const [owner, other] = await Promise.all([
      prisma.user.create({ data: { phone: '+8801797000003', fullName: 'Owner' } }),
      prisma.user.create({ data: { phone: '+8801797000004', fullName: 'Other' } }),
    ])

    try {
      const address = await prisma.address.create({
        data: {
          userId: owner.id,
          recipientName: 'Owner',
          recipientPhone: '+8801797000003',
          adminAreaId: area?.id ?? '',
          addressLine: 'Owned',
        },
      })

      // The ownership condition is IN the query — the pattern that actually stops IDOR.
      const asOther = await prisma.address.findFirst({
        where: { id: address.id, userId: other.id },
      })
      expect(asOther).toBeNull()

      const asOwner = await prisma.address.findFirst({
        where: { id: address.id, userId: owner.id },
      })
      expect(asOwner).not.toBeNull()

      await prisma.address.delete({ where: { id: address.id } })
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
    }
  })
})
