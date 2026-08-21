/**
 * Prisma-backed address book and administrative tree.
 *
 * Two things here are load-bearing and easy to get wrong elsewhere:
 *
 *  - **Ownership is in the WHERE clause, never a check afterwards.** `findOwned` takes the user
 *    id and includes it in the query, so another user's address comes back as null. Fetching by
 *    id and then comparing is the version of this that leaks, because the comparison is one
 *    forgotten line away from being skipped.
 *  - **The default flag moves inside a transaction.** A partial unique index allows exactly one
 *    default per user, so clearing the old and setting the new in two statements would either
 *    collide or leave a window with no default at all.
 *
 * Refs: docs/07_SECURITY.md §4.3
 */

import { prisma, type $Enums, type Prisma } from '@langgol/db'
import type { AreaLevel, LocationPrecision } from '@langgol/domain/location'
import type {
  AddressBookRepository,
  AddressRecord,
  AddressWriteInput,
  AdminAreaRecord,
  AdminAreaRepository,
} from '@langgol/application'

/** Decimal(9,6) crosses as a Prisma Decimal; the domain speaks plain numbers. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value)
}

const AREA_SELECT = {
  id: true,
  type: true,
  parentId: true,
  nameBn: true,
  nameEn: true,
  centroidLat: true,
} as const

interface AreaRow {
  id: string
  type: string
  parentId: string | null
  nameBn: string
  nameEn: string
  centroidLat: Prisma.Decimal | null
}

function toArea(row: AreaRow): AdminAreaRecord {
  return {
    id: row.id,
    level: row.type as AreaLevel,
    parentId: row.parentId,
    nameBn: row.nameBn,
    nameEn: row.nameEn,
    // Whether a distance estimate against this area is possible at all. Centroids are seeded
    // separately and are deliberately absent until loaded from an authoritative source.
    hasCentroid: row.centroidLat !== null,
  }
}

export const adminAreaRepository: AdminAreaRepository = {
  async listChildren(parentId) {
    const rows = await prisma.adminArea.findMany({
      where: { parentId, isActive: true },
      select: AREA_SELECT,
      // Bangla first: the reader's default language should decide the order they scan.
      orderBy: { nameBn: 'asc' },
    })
    return rows.map(toArea)
  },

  async findById(areaId) {
    const row = await prisma.adminArea.findFirst({
      where: { id: areaId, isActive: true },
      select: AREA_SELECT,
    })
    return row === null ? null : toArea(row)
  },

  /**
   * Walk to the root, then reverse.
   *
   * At most four iterations — the tree is Division → District → Upazila → Union — so a loop of
   * point lookups costs less than a recursive CTE and stays readable. The depth cap is a guard
   * against a cycle in the data, which `admin_areas_not_self_parent` prevents for the trivial
   * case but not for a longer loop.
   */
  async resolvePath(areaId) {
    const chain: AdminAreaRecord[] = []
    let cursor: string | null = areaId

    for (let depth = 0; depth < 8 && cursor !== null; depth += 1) {
      const row: AreaRow | null = await prisma.adminArea.findUnique({
        where: { id: cursor },
        select: AREA_SELECT,
      })
      if (row === null) break
      chain.push(toArea(row))
      cursor = row.parentId
    }

    return chain.reverse()
  },
}

/* ------------------------------------------------------------------ addresses */

const ADDRESS_SELECT = {
  id: true,
  userId: true,
  label: true,
  recipientName: true,
  recipientPhone: true,
  countryCode: true,
  adminAreaId: true,
  villageOrArea: true,
  addressLine: true,
  landmark: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  precision: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const

interface AddressRow {
  id: string
  userId: string
  label: string | null
  recipientName: string
  recipientPhone: string
  countryCode: string
  adminAreaId: string
  villageOrArea: string | null
  addressLine: string
  landmark: string | null
  postalCode: string | null
  latitude: Prisma.Decimal | null
  longitude: Prisma.Decimal | null
  precision: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

function toAddress(row: AddressRow, areaPath: readonly AdminAreaRecord[]): AddressRecord {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    countryCode: row.countryCode,
    adminAreaId: row.adminAreaId,
    villageOrArea: row.villageOrArea,
    addressLine: row.addressLine,
    landmark: row.landmark,
    postalCode: row.postalCode,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    precision: row.precision as LocationPrecision,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    areaPath,
  }
}

/** Resolve one area chain. Kept separate so a list can resolve each row's path independently. */
async function pathFor(areaId: string): Promise<readonly AdminAreaRecord[]> {
  return adminAreaRepository.resolvePath(areaId)
}

/**
 * Every column, for an insert.
 *
 * Separate from the partial `toWriteData` because Prisma's create input requires the non-nullable
 * columns to be present, and a helper typed for PATCH marks them all optional. Sharing one helper
 * would mean asserting the type back, which is how a genuinely missing field gets written as
 * undefined.
 */
function toCreateData(address: AddressWriteInput) {
  return {
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    countryCode: address.countryCode,
    adminAreaId: address.adminAreaId,
    villageOrArea: address.villageOrArea,
    addressLine: address.addressLine,
    landmark: address.landmark,
    postalCode: address.postalCode,
    latitude: address.latitude,
    longitude: address.longitude,
    precision: address.precision as $Enums.LocationPrecision,
  }
}

function toWriteData(changes: Partial<AddressWriteInput>) {
  return {
    ...(changes.label !== undefined ? { label: changes.label } : {}),
    ...(changes.recipientName !== undefined ? { recipientName: changes.recipientName } : {}),
    ...(changes.recipientPhone !== undefined ? { recipientPhone: changes.recipientPhone } : {}),
    ...(changes.countryCode !== undefined ? { countryCode: changes.countryCode } : {}),
    ...(changes.adminAreaId !== undefined ? { adminAreaId: changes.adminAreaId } : {}),
    ...(changes.villageOrArea !== undefined ? { villageOrArea: changes.villageOrArea } : {}),
    ...(changes.addressLine !== undefined ? { addressLine: changes.addressLine } : {}),
    ...(changes.landmark !== undefined ? { landmark: changes.landmark } : {}),
    ...(changes.postalCode !== undefined ? { postalCode: changes.postalCode } : {}),
    ...(changes.latitude !== undefined ? { latitude: changes.latitude } : {}),
    ...(changes.longitude !== undefined ? { longitude: changes.longitude } : {}),
    ...(changes.precision !== undefined
      ? { precision: changes.precision as $Enums.LocationPrecision }
      : {}),
  }
}

export const addressBookRepository: AddressBookRepository = {
  async listForUser(userId) {
    const rows = await prisma.address.findMany({
      where: { userId, deletedAt: null },
      select: ADDRESS_SELECT,
      // Default first, then most recently touched: the order someone scans for the one they want.
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    })

    return Promise.all(
      rows.map(async (row) => toAddress(row as AddressRow, await pathFor(row.adminAreaId))),
    )
  },

  async findOwned(addressId, userId) {
    // `userId` is part of the query. Someone else's address is not found, not forbidden — a 403
    // would confirm that the id exists.
    const row = await prisma.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
      select: ADDRESS_SELECT,
    })
    return row === null ? null : toAddress(row as AddressRow, await pathFor(row.adminAreaId))
  },

  countForUser(userId) {
    return prisma.address.count({ where: { userId, deletedAt: null } })
  },

  async create({ userId, address, makeDefault }) {
    const row = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        // Clear the previous default in the same transaction. `addresses_one_default_per_user`
        // is a partial unique index, so doing this afterwards would abort the insert.
        await tx.address.updateMany({
          where: { userId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        })
      }

      return tx.address.create({
        data: { userId, ...toCreateData(address), isDefault: makeDefault },
        select: ADDRESS_SELECT,
      })
    })

    return toAddress(row as AddressRow, await pathFor(row.adminAreaId))
  },

  async update({ addressId, userId, changes }) {
    // Conditional on ownership: a mismatched user updates zero rows rather than someone else's.
    const affected = await prisma.address.updateMany({
      where: { id: addressId, userId, deletedAt: null },
      data: toWriteData(changes),
    })
    if (affected.count === 0) return null

    const row = await prisma.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
      select: ADDRESS_SELECT,
    })
    return row === null ? null : toAddress(row as AddressRow, await pathFor(row.adminAreaId))
  },

  /**
   * Soft delete, promoting a replacement default when the deleted address held it.
   *
   * Hard deletion is not an option: orders reference the address they were delivered to, and
   * money moved against that record.
   */
  async softDelete({ addressId, userId, at }) {
    return prisma.$transaction(async (tx) => {
      const target = await tx.address.findFirst({
        where: { id: addressId, userId, deletedAt: null },
        select: { id: true, isDefault: true },
      })
      if (target === null) return { deleted: false, promotedId: null }

      await tx.address.update({
        where: { id: target.id },
        data: { deletedAt: at, isDefault: false },
      })

      if (!target.isDefault) return { deleted: true, promotedId: null }

      // Leaving a user with addresses but no default makes checkout preselect nothing.
      const replacement = await tx.address.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
      if (replacement === null) return { deleted: true, promotedId: null }

      await tx.address.update({ where: { id: replacement.id }, data: { isDefault: true } })
      return { deleted: true, promotedId: replacement.id }
    })
  },

  async setDefault({ addressId, userId }) {
    const row = await prisma.$transaction(async (tx) => {
      const target = await tx.address.findFirst({
        where: { id: addressId, userId, deletedAt: null },
        select: { id: true },
      })
      if (target === null) return null

      await tx.address.updateMany({
        where: { userId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      })

      return tx.address.update({
        where: { id: target.id },
        data: { isDefault: true },
        select: ADDRESS_SELECT,
      })
    })

    return row === null ? null : toAddress(row as AddressRow, await pathFor(row.adminAreaId))
  },
}
