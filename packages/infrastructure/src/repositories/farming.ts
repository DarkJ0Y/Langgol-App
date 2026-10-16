/**
 * Prisma-backed farmer profile store.
 *
 * Every query is scoped by `user_id` in the WHERE clause — layer three of the three-layer
 * defence in docs/07_SECURITY.md §4. The policy check in the use case can be forgotten by a
 * future caller; an ownership condition compiled into the query cannot.
 *
 * The SELECT is an allowlist rather than a `findUnique` returning the whole row. `nid_hash`,
 * the payout columns and `risk_tier` live on this table and none of them belongs on a profile
 * screen; a bare model read would carry all three to the client the first time somebody added a
 * field to the page. What is not selected cannot leak.
 */

import { prisma, type Prisma } from '@langgol/db'
import type {
  FarmerType,
  FarmingMethod,
  IrrigationMethod,
  LandOwnershipType,
  LandUnit,
  WaterSource,
} from '@langgol/domain/farming'
import type { FarmerProfileRecord, FarmerProfileRepository } from '@langgol/application'

/**
 * Exactly the columns the farmer's own screens may see.
 *
 * Deliberately absent: `nidHash`, `payoutAccountRef`, `payoutAccountName`, `payoutVerifiedAt`,
 * `payoutChangedAt`, `riskTier`, `settlementHoldHoursOverride`, and the reputation counters.
 */
const SELECT = {
  id: true,
  userId: true,
  displayName: true,
  bio: true,
  verificationStatus: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  farmingExperienceYears: true,
  farmerType: true,
  totalLandAmountMilli: true,
  landUnit: true,
  ownershipType: true,
  irrigationAvailable: true,
  irrigationMethod: true,
  waterSource: true,
  farmingMethod: true,
} as const

type Row = Prisma.FarmerProfileGetPayload<{ select: typeof SELECT }>

function toRecord(row: Row): FarmerProfileRecord {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    bio: row.bio,
    verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    farmingExperienceYears: row.farmingExperienceYears,
    farmerType: row.farmerType as FarmerType | null,
    totalLandAmountMilli: row.totalLandAmountMilli,
    landUnit: row.landUnit as LandUnit | null,
    ownershipType: row.ownershipType as LandOwnershipType | null,
    irrigationAvailable: row.irrigationAvailable,
    irrigationMethod: row.irrigationMethod as IrrigationMethod | null,
    waterSource: row.waterSource as WaterSource | null,
    farmingMethod: row.farmingMethod as FarmingMethod | null,
  }
}

/**
 * The owner-scoped read, as a plain function.
 *
 * Not a method reached through `this`: the repository is handed around as a value (`deps.farmers`)
 * and one day somebody will destructure it, at which point a `this.findByUserId(…)` would become
 * a runtime error a long way from the change that caused it.
 */
async function findByUserId(userId: string): Promise<FarmerProfileRecord | null> {
  const row = await prisma.farmerProfile.findUnique({ where: { userId }, select: SELECT })
  return row === null ? null : toRecord(row)
}

export const farmerProfileRepository: FarmerProfileRepository = {
  findByUserId,

  async ensureForUser({ userId }) {
    /*
     * Idempotent by way of the UNIQUE on `user_id` rather than by a read-then-write check.
     *
     * Two requests arriving together — a farmer double-tapping the dashboard on a slow
     * connection is the ordinary case, not a contrived one — would both see "no profile" and
     * both insert. `upsert` makes the database the arbiter, and it is the only participant that
     * can be.
     *
     * The display name is copied from the user's own row. It is a starting value, not a claim:
     * the farmer can change it, and nothing reads it as a business name.
     */
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    })

    try {
      const row = await prisma.farmerProfile.upsert({
        where: { userId },
        // Everything agronomic stays NULL. An auto-created profile must assert nothing about the
        // farmer that they did not tell us.
        create: { userId, displayName: user.fullName },
        update: {},
        select: SELECT,
      })
      return toRecord(row)
    } catch (cause) {
      /*
       * Prisma does not always compile `upsert` to one INSERT ... ON CONFLICT; it can fall back
       * to read-then-insert, and then the slower of two concurrent calls hits the UNIQUE. The
       * constraint has done its job — the other request created the profile — so return it.
       */
      if ((cause as { code?: unknown }).code === 'P2002') {
        const winner = await prisma.farmerProfile.findUnique({ where: { userId }, select: SELECT })
        if (winner) return toRecord(winner)
      }
      throw cause
    }
  },

  async updateForUser(userId, changes) {
    if (Object.keys(changes).length === 0) {
      return findByUserId(userId)
    }

    /*
     * `updateMany` rather than `update`, so the ownership condition is part of the statement and
     * a miss affects zero rows instead of throwing. The row is then re-read through the same
     * allowlist, which keeps one definition of what a farmer profile looks like from here out.
     */
    const affected = await prisma.farmerProfile.updateMany({
      where: { userId },
      data: changes as Prisma.FarmerProfileUpdateManyMutationInput,
    })
    if (affected.count === 0) return null

    return findByUserId(userId)
  },
}
