/**
 * Prisma-backed farms and plots.
 *
 * The ownership condition is part of every statement, never a check performed afterwards. A farm
 * is reached through `farmer: { userId }` and a plot through `farm: { farmer: { userId } }`, so
 * an id belonging to somebody else matches no row at all — the query cannot return data the
 * caller then has to remember to reject.
 *
 * `updateMany` and `deleteMany` rather than `update` and `delete` throughout, for the same
 * reason: they take a full WHERE clause, so ownership travels with the mutation, and a miss
 * affects zero rows instead of throwing a not-found that says the record exists.
 *
 * Refs: docs/07_SECURITY.md §4 (layer three)
 */

import { prisma, type Prisma } from '@langgol/db'
import type { FarmRecord, FarmRepository, PlotRecord, PlotRepository } from '@langgol/application'
import type {
  FarmingMethod,
  IrrigationMethod,
  LandOwnershipType,
  LandUnit,
  SoilType,
  WaterSource,
} from '@langgol/domain/farming'

/** Exactly what a farmer's own screens may see. */
const FARM_SELECT = {
  id: true,
  name: true,
  adminAreaId: true,
  addressId: true,
  villageOrArea: true,
  addressLine: true,
  latitude: true,
  longitude: true,
  areaAmountMilli: true,
  areaUnit: true,
  ownershipType: true,
  soilType: true,
  irrigationAvailable: true,
  irrigationMethod: true,
  waterSource: true,
  farmingMethod: true,
  verificationStatus: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { plots: { where: { deletedAt: null } } } },
} as const

const PLOT_SELECT = {
  id: true,
  farmId: true,
  name: true,
  areaAmountMilli: true,
  areaUnit: true,
  soilType: true,
  irrigationMethod: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  updatedAt: true,
} as const

type FarmRow = Prisma.FarmGetPayload<{ select: typeof FARM_SELECT }>
type PlotRow = Prisma.PlotGetPayload<{ select: typeof PLOT_SELECT }>

/** Decimals reach the client as strings; a float would silently lose the sixth decimal place. */
const coord = (value: Prisma.Decimal | null): string | null =>
  value === null ? null : value.toString()

function toFarm(row: FarmRow): FarmRecord {
  return {
    id: row.id,
    name: row.name,
    adminAreaId: row.adminAreaId,
    addressId: row.addressId,
    villageOrArea: row.villageOrArea,
    addressLine: row.addressLine,
    latitude: coord(row.latitude),
    longitude: coord(row.longitude),
    areaAmountMilli: row.areaAmountMilli,
    areaUnit: row.areaUnit as LandUnit | null,
    ownershipType: row.ownershipType as LandOwnershipType | null,
    soilType: row.soilType as SoilType | null,
    irrigationAvailable: row.irrigationAvailable,
    irrigationMethod: row.irrigationMethod as IrrigationMethod | null,
    waterSource: row.waterSource as WaterSource | null,
    farmingMethod: row.farmingMethod as FarmingMethod | null,
    verificationStatus: row.verificationStatus,
    plotCount: row._count.plots,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toPlot(row: PlotRow): PlotRecord {
  return {
    id: row.id,
    farmId: row.farmId,
    name: row.name,
    areaAmountMilli: row.areaAmountMilli,
    areaUnit: row.areaUnit as LandUnit | null,
    soilType: row.soilType as SoilType | null,
    irrigationMethod: row.irrigationMethod as IrrigationMethod | null,
    latitude: coord(row.latitude),
    longitude: coord(row.longitude),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** The ownership condition, written once so no query can forget it. */
const ownedFarm = (userId: string) => ({ deletedAt: null, farmer: { userId } })
const ownedPlot = (userId: string) => ({
  deletedAt: null,
  farm: { deletedAt: null, farmer: { userId } },
})

async function findFarm(userId: string, farmId: string): Promise<FarmRecord | null> {
  const row = await prisma.farm.findFirst({
    where: { id: farmId, ...ownedFarm(userId) },
    select: FARM_SELECT,
  })
  return row === null ? null : toFarm(row)
}

async function findPlot(userId: string, plotId: string): Promise<PlotRecord | null> {
  const row = await prisma.plot.findFirst({
    where: { id: plotId, ...ownedPlot(userId) },
    select: PLOT_SELECT,
  })
  return row === null ? null : toPlot(row)
}

export const farmRepository: FarmRepository = {
  async listForUser(userId) {
    const rows = await prisma.farm.findMany({
      where: ownedFarm(userId),
      select: FARM_SELECT,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toFarm)
  },

  findForUser: findFarm,

  countForUser(userId) {
    return prisma.farm.count({ where: ownedFarm(userId) })
  },

  async createForUser(userId, input) {
    /*
     * The farmer profile is resolved from the session's user id, never supplied by the caller —
     * a `farmerProfileId` parameter would let one farmer create a farm under another's name.
     */
    const profile = await prisma.farmerProfile.findUniqueOrThrow({
      where: { userId },
      select: { id: true },
    })

    const created = await prisma.farm.create({
      data: {
        farmerProfileId: profile.id,
        name: input.name,
        adminAreaId: input.adminAreaId,
        villageOrArea: input.villageOrArea ?? null,
        addressLine: input.addressLine ?? null,
        addressId: input.addressId ?? null,
        ...(input.coordinates
          ? {
              latitude: input.coordinates.latitude,
              longitude: input.coordinates.longitude,
              // A pin the farmer dropped or captured is EXACT; without one the row keeps the
              // AREA_CENTROID default, which is what the admin-area tree gives us.
              precision: 'EXACT' as const,
            }
          : {}),
      },
      select: { id: true },
    })

    /*
     * Re-read through the owner-scoped path rather than returning the create's own row. Prisma
     * cannot select `_count` on a create, and going back through `findFarm` means there is one
     * definition of what a farm record looks like instead of two that can drift.
     */
    const row = await findFarm(userId, created.id)
    if (row === null) throw new Error('farm vanished immediately after creation')
    return row
  },

  async updateForUser(userId, farmId, changes) {
    if (Object.keys(changes).length === 0) return findFarm(userId, farmId)

    const affected = await prisma.farm.updateMany({
      where: { id: farmId, ...ownedFarm(userId) },
      data: changes as Prisma.FarmUpdateManyMutationInput,
    })
    if (affected.count === 0) return null

    return findFarm(userId, farmId)
  },

  async softDeleteForUser(userId, farmId) {
    // Soft, because listings and orders reference a farm and must not lose what they point at.
    const affected = await prisma.farm.updateMany({
      where: { id: farmId, ...ownedFarm(userId) },
      data: { deletedAt: new Date() },
    })
    return affected.count > 0
  },
}

export const plotRepository: PlotRepository = {
  async listForFarm(userId, farmId) {
    const rows = await prisma.plot.findMany({
      // Scoped through the farm, so a stranger's farm id yields an empty list rather than plots.
      where: { farmId, ...ownedPlot(userId) },
      select: PLOT_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toPlot)
  },

  findForUser: findPlot,

  countForFarm(userId, farmId) {
    return prisma.plot.count({ where: { farmId, ...ownedPlot(userId) } })
  },

  async createForUser(userId, farmId, input) {
    /*
     * The farm is confirmed to be theirs BEFORE the plot is created. Without this an unknown or
     * stolen farm id would create a plot hanging off somebody else's farm — the foreign key would
     * happily accept it.
     */
    const farm = await prisma.farm.findFirst({
      where: { id: farmId, ...ownedFarm(userId) },
      select: { id: true },
    })
    if (farm === null) return null

    const row = await prisma.plot.create({
      data: {
        farmId,
        name: input.name,
        ...(input.coordinates
          ? { latitude: input.coordinates.latitude, longitude: input.coordinates.longitude }
          : {}),
      },
      select: PLOT_SELECT,
    })
    return toPlot(row)
  },

  async updateForUser(userId, plotId, changes) {
    if (Object.keys(changes).length === 0) return findPlot(userId, plotId)

    const affected = await prisma.plot.updateMany({
      where: { id: plotId, ...ownedPlot(userId) },
      data: changes as Prisma.PlotUpdateManyMutationInput,
    })
    if (affected.count === 0) return null

    return findPlot(userId, plotId)
  },

  async softDeleteForUser(userId, plotId) {
    const affected = await prisma.plot.updateMany({
      where: { id: plotId, ...ownedPlot(userId) },
      data: { deletedAt: new Date() },
    })
    return affected.count > 0
  },
}
