/**
 * Address and location integration tests.
 *
 * The half of Phase 3 the unit tests cannot reach: the CHECK constraints, the partial unique
 * index that allows exactly one default per user, and the real transactional behaviour of moving
 * that flag. Every assertion here tries to break an invariant with raw Prisma, because a
 * constraint that exists but does not bite buys false confidence.
 *
 * Skipped unless a real database is configured — see database.test.ts for the run instructions.
 *
 * Refs: docs/07_SECURITY.md §4.3; docs/08_BANGLADESH_CONTEXT.md §2
 */

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import { addressBookRepository, adminAreaRepository } from '../repositories/location.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()

const PHONE = '+8801793000001'
const RECIPIENT = '+8801793000002'

afterAll(async () => {
  await prisma.$disconnect()
})

/** A throwaway user plus the deepest seeded area to hang addresses on. */
async function withUserAndArea(body: (userId: string, areaId: string) => Promise<void>) {
  const area =
    (await prisma.adminArea.findFirst({ where: { type: 'UPAZILA' } })) ??
    (await prisma.adminArea.findFirst())
  if (area === null) throw new Error('No admin areas seeded')

  const user = await prisma.user.create({
    data: { phone: PHONE, fullName: 'Address Integration' },
  })

  try {
    await body(user.id, area.id)
  } finally {
    await prisma.address.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
}

const base = (userId: string, areaId: string) => ({
  userId,
  recipientName: 'Rahim Uddin',
  recipientPhone: RECIPIENT,
  adminAreaId: areaId,
  addressLine: 'House 4, Road 2',
  updatedAt: new Date(),
})

const writeInput = (areaId: string) => ({
  label: null,
  recipientName: 'Rahim Uddin',
  recipientPhone: RECIPIENT,
  countryCode: 'BD',
  adminAreaId: areaId,
  villageOrArea: null,
  addressLine: 'House 4, Road 2',
  landmark: null,
  postalCode: null,
  latitude: null,
  longitude: null,
  precision: 'AREA_CENTROID' as const,
})

suite('address column constraints', () => {
  it('defaults the country to Bangladesh', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const row = await prisma.address.create({ data: base(userId, areaId) })
      expect(row.countryCode).toBe('BD')
    })
  })

  it('refuses a country that is not an ISO alpha-2 code', async () => {
    await withUserAndArea(async (userId, areaId) => {
      await expect(
        prisma.address.create({ data: { ...base(userId, areaId), countryCode: 'BGD' } }),
      ).rejects.toThrow()
    })
  })

  it('accepts an address with no postcode, which is the common case', async () => {
    // Most rural locations have no reliable postcode. This must never become required.
    await withUserAndArea(async (userId, areaId) => {
      const row = await prisma.address.create({ data: base(userId, areaId) })
      expect(row.postalCode).toBeNull()
    })
  })

  it('accepts a four-digit postcode and refuses anything else', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const row = await prisma.address.create({
        data: { ...base(userId, areaId), postalCode: '6203' },
      })
      expect(row.postalCode).toBe('6203')

      for (const bad of ['620', '62033', 'ABCD']) {
        await expect(
          prisma.address.create({ data: { ...base(userId, areaId), postalCode: bad } }),
        ).rejects.toThrow()
      }
    })
  })

  it('refuses a Bangladeshi address pinned outside Bangladesh', async () => {
    /*
     * The constraint that catches a swapped coordinate pair. Latitude 88.6 is a real number and
     * passes `addresses_coordinates_valid`; it is simply not a latitude that occurs in this
     * country, and left stored it becomes a delivery quote across the Bay of Bengal.
     */
    await withUserAndArea(async (userId, areaId) => {
      await expect(
        prisma.address.create({
          data: { ...base(userId, areaId), latitude: 88.6042, longitude: 24.3749 },
        }),
      ).rejects.toThrow()
    })
  })

  it('accepts a pin inside the country', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const row = await prisma.address.create({
        data: { ...base(userId, areaId), latitude: 24.3749, longitude: 88.6042 },
      })
      expect(Number(row.latitude)).toBeCloseTo(24.3749, 4)
    })
  })

  it('still populates the geography column from the pin', async () => {
    // The trigger predates this phase; adding columns must not have disturbed it.
    await withUserAndArea(async (userId, areaId) => {
      const row = await prisma.address.create({
        data: { ...base(userId, areaId), latitude: 24.3749, longitude: 88.6042 },
      })
      const geo = await prisma.$queryRaw<{ present: boolean }[]>`
        SELECT geo IS NOT NULL AS present FROM addresses WHERE id = ${row.id}::uuid
      `
      expect(geo[0]?.present).toBe(true)
    })
  })
})

suite('one default address per user', () => {
  it('refuses a second default row outright', async () => {
    await withUserAndArea(async (userId, areaId) => {
      await prisma.address.create({ data: { ...base(userId, areaId), isDefault: true } })
      await expect(
        prisma.address.create({ data: { ...base(userId, areaId), isDefault: true } }),
      ).rejects.toThrow()
    })
  })

  it('moves the flag atomically through the repository', async () => {
    /*
     * The partial unique index is why this has to be one transaction: clearing the old default
     * and setting the new one as two statements would either collide or leave a window with none.
     */
    await withUserAndArea(async (userId, areaId) => {
      const first = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })
      const second = await addressBookRepository.create({
        userId,
        address: { ...writeInput(areaId), label: 'Shop' },
        makeDefault: true,
      })

      const rows = await addressBookRepository.listForUser(userId)
      expect(rows.filter((r) => r.isDefault)).toHaveLength(1)
      expect(rows.find((r) => r.id === second.id)?.isDefault).toBe(true)
      expect(rows.find((r) => r.id === first.id)?.isDefault).toBe(false)
    })
  })

  it('promotes a replacement when the default is soft-deleted', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const first = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })
      await addressBookRepository.create({
        userId,
        address: { ...writeInput(areaId), label: 'Shop' },
        makeDefault: false,
      })

      const result = await addressBookRepository.softDelete({
        addressId: first.id,
        userId,
        at: new Date(),
      })

      expect(result.deleted).toBe(true)
      expect(result.promotedId).not.toBeNull()

      const rows = await addressBookRepository.listForUser(userId)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.isDefault).toBe(true)
    })
  })

  it('keeps the row after a soft delete, because orders reference it', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const created = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })
      await addressBookRepository.softDelete({ addressId: created.id, userId, at: new Date() })

      expect(await addressBookRepository.findOwned(created.id, userId)).toBeNull()
      // Gone from the address book, still present as a row.
      expect(await prisma.address.count({ where: { id: created.id } })).toBe(1)
    })
  })

  it('allows a new default once the old one is soft-deleted', async () => {
    // The partial index excludes soft-deleted rows; if it did not, deleting a default would
    // permanently block setting another.
    await withUserAndArea(async (userId, areaId) => {
      const first = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })
      await addressBookRepository.softDelete({ addressId: first.id, userId, at: new Date() })

      const second = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })
      expect(second.isDefault).toBe(true)
    })
  })
})

suite('ownership is enforced by the query', () => {
  it('does not return another user’s address', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const mine = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })

      const stranger = await prisma.user.create({
        data: { phone: '+8801793000003', fullName: 'Stranger' },
      })
      try {
        // Ownership is in the WHERE clause, so this is not-found rather than found-and-refused.
        expect(await addressBookRepository.findOwned(mine.id, stranger.id)).toBeNull()
        expect(await addressBookRepository.listForUser(stranger.id)).toHaveLength(0)
      } finally {
        await prisma.user.delete({ where: { id: stranger.id } })
      }
    })
  })

  it('refuses to update or delete on behalf of a stranger', async () => {
    await withUserAndArea(async (userId, areaId) => {
      const mine = await addressBookRepository.create({
        userId,
        address: writeInput(areaId),
        makeDefault: true,
      })

      const stranger = await prisma.user.create({
        data: { phone: '+8801793000004', fullName: 'Stranger Two' },
      })
      try {
        expect(
          await addressBookRepository.update({
            addressId: mine.id,
            userId: stranger.id,
            changes: { addressLine: 'Taken over' },
          }),
        ).toBeNull()

        const removal = await addressBookRepository.softDelete({
          addressId: mine.id,
          userId: stranger.id,
          at: new Date(),
        })
        expect(removal.deleted).toBe(false)

        // Untouched.
        const still = await addressBookRepository.findOwned(mine.id, userId)
        expect(still?.addressLine).toBe('House 4, Road 2')
      } finally {
        await prisma.user.delete({ where: { id: stranger.id } })
      }
    })
  })
})

suite('the administrative tree', () => {
  it('lists the eight divisions as roots', async () => {
    const roots = await adminAreaRepository.listChildren(null)
    expect(roots).toHaveLength(8)
    expect(roots.every((area) => area.level === 'DIVISION')).toBe(true)
  })

  it('resolves an upazila to its full root-to-leaf path', async () => {
    const upazila = await prisma.adminArea.findFirst({ where: { type: 'UPAZILA' } })
    if (upazila === null) return

    const path = await adminAreaRepository.resolvePath(upazila.id)
    expect(path.map((area) => area.level)).toEqual(['DIVISION', 'DISTRICT', 'UPAZILA'])
    expect(path.at(-1)?.id).toBe(upazila.id)
  })

  it('returns an empty path for an id that does not exist', async () => {
    expect(
      await adminAreaRepository.resolvePath('00000000-0000-4000-8000-000000000000'),
    ).toHaveLength(0)
  })

  it('reports honestly whether an area has a centroid', async () => {
    // Centroids are deliberately unseeded until loaded from an authoritative source; code that
    // needs a distance must be able to tell rather than assume.
    const areas = await adminAreaRepository.listChildren(null)
    for (const area of areas) expect(typeof area.hasCentroid).toBe('boolean')
  })
})

suite('farm boundary groundwork', () => {
  it('has a nullable boundary column with a GIST index', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'farms' AND column_name = 'boundary'
    `
    expect(columns[0]?.is_nullable).toBe('YES')

    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname = 'farms_boundary_gix'
    `
    expect(indexes).toHaveLength(1)
  })

  it('refuses a self-intersecting polygon', async () => {
    /*
     * `ST_IsValid` is why boundary.ts deliberately does NOT hand-roll a self-intersection test:
     * the database already answers this, and two implementations could disagree.
     */
    const bowtie = await prisma.$queryRaw<{ valid: boolean }[]>`
      SELECT ST_IsValid(
        ST_GeomFromText('POLYGON((88.60 24.37, 88.61 24.38, 88.60 24.38, 88.61 24.37, 88.60 24.37))', 4326)
      ) AS valid
    `
    expect(bowtie[0]?.valid).toBe(false)
  })
})
