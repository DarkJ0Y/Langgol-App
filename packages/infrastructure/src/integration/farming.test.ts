/**
 * Farmer profile integration tests.
 *
 * The domain refuses a self-contradictory profile, but application validation is not a
 * guarantee — a migration, a support script or a future endpoint writes SQL directly and never
 * passes through it. These tests try to write the contradictions with raw Prisma to prove the
 * CHECK constraints are actually in the database.
 *
 * Skipped unless a real database is configured — see database.test.ts for the run instructions.
 *
 * Refs: docs/02_DATABASE.md §5, docs/08_BANGLADESH_CONTEXT.md §2
 */

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import {
  FARMER_TYPES,
  FARMING_METHODS,
  IRRIGATION_METHODS,
  LAND_OWNERSHIP_TYPES,
  LAND_UNITS,
  WATER_SOURCES,
} from '@langgol/domain/farming'
import { farmerProfileRepository } from '../repositories/farming.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()

/**
 * This file's own phone block, and it must stay its own.
 *
 * Vitest runs test FILES in parallel against one database, and `users.phone` is UNIQUE — so two
 * files sharing a number race to create the same row and one of them fails with a unique-constraint
 * error that looks nothing like the real cause. This file originally reused `+8801793…`, which
 * `location.test.ts` already owned; it passed in CI on timing luck and failed the first time it met
 * a slower connection.
 *
 * Blocks currently spoken for: 792 consent, 793 location, 795 verification, 796 account.
 */
const PHONE = '+8801794000001'

afterAll(async () => {
  await prisma.$disconnect()
})

/** A farmer with a profile, torn down afterwards by cascade from the user. */
async function withFarmer(body: (ids: { userId: string; profileId: string }) => Promise<void>) {
  const user = await prisma.user.create({
    data: {
      phone: PHONE,
      fullName: 'চাষি পরীক্ষা',
      roles: { create: { role: 'FARMER' } },
    },
  })
  try {
    const profile = await prisma.farmerProfile.create({
      data: { userId: user.id, displayName: 'চাষি পরীক্ষা' },
    })
    await body({ userId: user.id, profileId: profile.id })
  } finally {
    await prisma.user.delete({ where: { id: user.id } })
  }
}

suite('the enums match the domain', () => {
  /*
   * The vocabulary is named in three places — the Prisma enum, the domain catalogue and the i18n
   * keys. A value in one and missing from another can be stored and never labelled, or offered
   * and never saved. These assertions are what make the two authoritative lists one list.
   */
  const CASES = [
    ['FarmerType', FARMER_TYPES],
    ['LandUnit', LAND_UNITS],
    ['LandOwnershipType', LAND_OWNERSHIP_TYPES],
    ['IrrigationMethod', IRRIGATION_METHODS],
    ['WaterSource', WATER_SOURCES],
    ['FarmingMethod', FARMING_METHODS],
  ] as const

  it.each(CASES)('%s offers exactly what the domain knows about', async (name, expected) => {
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT unnest(enum_range(NULL::"${name}"))::text AS value`,
    )
    expect(rows.map((r) => r.value).sort()).toEqual([...expected].sort())
  })
})

suite('a profile may be incomplete', () => {
  it('accepts a profile with every farming question unanswered', async () => {
    /*
     * The most important test in this file. A farmer signing up on a borrowed phone at the edge
     * of coverage must reach a working account; a NOT NULL on any of these columns would turn
     * "has not answered yet" into "cannot exist".
     */
    await withFarmer(async ({ profileId }) => {
      const row = await prisma.farmerProfile.findUniqueOrThrow({ where: { id: profileId } })

      expect(row.farmingExperienceYears).toBeNull()
      expect(row.farmerType).toBeNull()
      expect(row.totalLandAmountMilli).toBeNull()
      expect(row.irrigationAvailable).toBeNull()
    })
  })

  it('accepts nought years, because a farmer in their first season is a farmer', async () => {
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: { farmingExperienceYears: 0 },
        }),
      ).resolves.toBeDefined()
    })
  })
})

suite('but a profile may not contradict itself', () => {
  it('refuses negative or implausible experience', async () => {
    await withFarmer(async ({ profileId }) => {
      for (const years of [-1, 200]) {
        await expect(
          prisma.farmerProfile.update({
            where: { id: profileId },
            data: { farmingExperienceYears: years },
          }),
        ).rejects.toThrow()
      }
    })
  })

  it('refuses an area without a unit', async () => {
    // A number nobody can read. The pair travels together or not at all.
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: { totalLandAmountMilli: 2000 },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a unit without an area', async () => {
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({ where: { id: profileId }, data: { landUnit: 'BIGHA' } }),
      ).rejects.toThrow()
    })
  })

  it('accepts the pair together', async () => {
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: { totalLandAmountMilli: 2500, landUnit: 'BIGHA' },
        }),
      ).resolves.toBeDefined()
    })
  })

  it('refuses a zero or negative area', async () => {
    await withFarmer(async ({ profileId }) => {
      for (const amount of [0, -1]) {
        await expect(
          prisma.farmerProfile.update({
            where: { id: profileId },
            data: { totalLandAmountMilli: amount, landUnit: 'BIGHA' },
          }),
        ).rejects.toThrow()
      }
    })
  })

  it('refuses an irrigation method when there is no irrigation', async () => {
    /*
     * The constraint this file exists for. Application validation cannot stop a migration or a
     * support script writing this pair, and once written no downstream code can recover the
     * farmer's actual answer.
     */
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: { irrigationAvailable: false, irrigationMethod: 'DRIP' },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a tubewell as the water source when there is no irrigation', async () => {
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: { irrigationAvailable: false, waterSource: 'DEEP_TUBEWELL' },
        }),
      ).rejects.toThrow()
    })
  })

  it('allows rain as the water source when there is no irrigation', async () => {
    // A rain-fed farmer genuinely has a water source. Refusing this would force an accurate
    // answer to be stored as a blank.
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: { irrigationAvailable: false, waterSource: 'RAIN' },
        }),
      ).resolves.toBeDefined()
    })
  })

  it('allows any method once irrigation is available', async () => {
    await withFarmer(async ({ profileId }) => {
      await expect(
        prisma.farmerProfile.update({
          where: { id: profileId },
          data: {
            irrigationAvailable: true,
            irrigationMethod: 'DRIP',
            waterSource: 'DEEP_TUBEWELL',
          },
        }),
      ).resolves.toBeDefined()
    })
  })
})

suite('the repository against real SQL', () => {
  it('creates a profile on demand and does not duplicate it', async () => {
    /*
     * `ensureForUser` is called on every dashboard read. A farmer double-tapping on a slow
     * connection would, with a read-then-write check, produce two profiles — the UNIQUE on
     * user_id and the upsert are what make the database the arbiter instead.
     */
    const user = await prisma.user.create({
      data: {
        phone: '+8801794000002',
        fullName: 'নতুন চাষি',
        roles: { create: { role: 'FARMER' } },
      },
    })

    try {
      const now = new Date()
      const [first, second] = await Promise.all([
        farmerProfileRepository.ensureForUser({ userId: user.id, now }),
        farmerProfileRepository.ensureForUser({ userId: user.id, now }),
      ])

      expect(first.id).toBe(second.id)
      expect(await prisma.farmerProfile.count({ where: { userId: user.id } })).toBe(1)
      // The account's own name, copied as a starting value.
      expect(first.displayName).toBe('নতুন চাষি')
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  it('never returns the columns a profile screen has no use for', async () => {
    /*
     * `nid_hash`, the payout destination and the risk tier all live on this table. The SELECT is
     * an allowlist precisely so that adding a field to the page cannot carry them to the client.
     */
    await withFarmer(async ({ userId, profileId }) => {
      await prisma.farmerProfile.update({
        where: { id: profileId },
        data: { nidHash: 'sha256:test', payoutAccountRef: '01700000000', riskTier: 'TRUSTED' },
      })

      const record = await farmerProfileRepository.findByUserId(userId)
      const serialised = JSON.stringify(record)

      expect(serialised).not.toContain('sha256:test')
      expect(serialised).not.toContain('01700000000')
      expect(serialised).not.toContain('TRUSTED')
    })
  })

  it('writes only the keys it was given', async () => {
    await withFarmer(async ({ userId, profileId }) => {
      await prisma.farmerProfile.update({
        where: { id: profileId },
        data: { farmingExperienceYears: 12, farmerType: 'VEGETABLE' },
      })

      const updated = await farmerProfileRepository.updateForUser(userId, {
        farmerType: 'FRUIT',
      })

      expect(updated?.farmerType).toBe('FRUIT')
      // Untouched, because it was not in the change set.
      expect(updated?.farmingExperienceYears).toBe(12)
    })
  })

  it('reports null rather than throwing for a user with no profile', async () => {
    const user = await prisma.user.create({
      data: { phone: '+8801794000003', fullName: 'প্রোফাইলহীন' },
    })
    try {
      expect(await farmerProfileRepository.findByUserId(user.id)).toBeNull()
      expect(
        await farmerProfileRepository.updateForUser(user.id, { farmerType: 'CROP' }),
      ).toBeNull()
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  it('removes the profile with the user, since it is their record', async () => {
    const user = await prisma.user.create({
      data: {
        phone: '+8801794000004',
        fullName: 'মুছে যাবে',
        roles: { create: { role: 'FARMER' } },
      },
    })
    await prisma.farmerProfile.create({ data: { userId: user.id, displayName: 'মুছে যাবে' } })

    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.farmerProfile.count({ where: { userId: user.id } })).toBe(0)
  })
})
