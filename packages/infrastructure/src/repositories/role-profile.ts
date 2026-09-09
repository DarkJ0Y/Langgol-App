/**
 * Prisma-backed role profiles.
 *
 * Six Prisma models, one repository. The dispatch table below is the only place that knows which
 * model belongs to which role, and every query it builds carries `{ userId }` in the WHERE
 * clause — so the ownership condition exists once rather than six times, and there is no sixth
 * copy for somebody to forget.
 *
 * `updateMany` rather than `update` throughout, for the reason it is used everywhere else in this
 * codebase: it takes a full WHERE clause, so ownership travels with the mutation and a miss
 * affects zero rows instead of throwing a not-found that confirms the record exists.
 *
 * Refs: docs/07_SECURITY.md §4 (layer three)
 */

import { prisma, type Prisma } from '@langgol/db'
import { PROFILE_FIELDS, type ProfileRole } from '@langgol/domain/profiles'
import type { RoleProfileRecord, RoleProfileRepository } from '@langgol/application'

/**
 * Which Prisma delegate serves which role, and which column on `profile_service_areas` points
 * back at it.
 *
 * `serviceAreaKey` is null for consumers and retailers: a shopper has no service area, and a
 * retailer serves whoever walks in. Declaring that here rather than in a conditional keeps the
 * one-place-knows-the-mapping property intact.
 */
const MODELS = {
  CONSUMER: { delegate: () => prisma.consumerProfile, serviceAreaKey: null },
  RETAILER: { delegate: () => prisma.retailerProfile, serviceAreaKey: null },
  WHOLESALER: {
    delegate: () => prisma.wholesalerProfile,
    serviceAreaKey: 'wholesalerProfileId' as const,
  },
  SUPPLIER: {
    delegate: () => prisma.supplierProfile,
    serviceAreaKey: 'supplierProfileId' as const,
  },
  AGRICULTURAL_EXPERT: {
    delegate: () => prisma.agriculturalExpertProfile,
    serviceAreaKey: 'expertProfileId' as const,
  },
  LOGISTICS_PROVIDER: {
    delegate: () => prisma.logisticsProviderProfile,
    serviceAreaKey: 'logisticsProfileId' as const,
  },
} as const

/** The one column every profile needs to be created with, where the role demands a name. */
const REQUIRED_ON_CREATE: Partial<Record<ProfileRole, string>> = {
  RETAILER: 'businessName',
  WHOLESALER: 'businessName',
  SUPPLIER: 'companyName',
  LOGISTICS_PROVIDER: 'companyName',
}

type AnyRow = Record<string, unknown> & {
  id: string
  userId: string
  createdAt: Date
  updatedAt?: Date
  verificationStatus?: string
}

/**
 * Read the latitude/longitude columns back as a single point.
 *
 * `DECIMAL` arrives as a Prisma `Decimal`, and it is converted through its STRING form rather
 * than by coercing the object: a decimal read as a float by the wrong route is how a pin moves a
 * few metres every time it is loaded and saved.
 *
 * Key order matches the domain's own `{ latitude, longitude }`, because the use case compares
 * submitted against stored by serialising both — reversed keys would make every save look like
 * an edit and fill the audit log with changes nobody made.
 */
function readPoint(row: AnyRow): { latitude: number; longitude: number } | null {
  const latitude = row['latitude']
  const longitude = row['longitude']
  if (latitude === null || latitude === undefined) return null
  if (longitude === null || longitude === undefined) return null
  return { latitude: Number(String(latitude)), longitude: Number(String(longitude)) }
}

/**
 * Project a stored row onto the role's declared fields.
 *
 * Only what `PROFILE_FIELDS` names is carried out, so a column added to the table later cannot
 * reach a screen until somebody deliberately declares it. `BigInt` becomes a string on the way,
 * because a poisha amount must never touch a float and JSON has no bigint.
 */
function toRecord(
  role: ProfileRole,
  row: AnyRow,
  serviceAreaIds: readonly string[],
): RoleProfileRecord {
  const fields: Record<string, unknown> = {}
  for (const field of PROFILE_FIELDS[role]) {
    // A pin lives in two columns and reads back as one answer.
    if (field.kind.kind === 'geo') {
      fields[field.name] = readPoint(row)
      continue
    }
    const value = row[field.name]
    fields[field.name] = typeof value === 'bigint' ? value.toString() : (value ?? null)
  }

  return {
    id: row.id,
    userId: row.userId,
    role,
    verificationStatus: row.verificationStatus ?? 'UNVERIFIED',
    fields,
    serviceAreaIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  }
}

/** A poisha column arrives from a form as a number and must be stored as BigInt. */
function toStorable(role: ProfileRole, changes: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = {}
  for (const field of PROFILE_FIELDS[role]) {
    if (!(field.name in changes)) continue
    const value = changes[field.name]

    // One answer, two columns — and cleared as a pair, so half a pin can never be stored.
    if (field.kind.kind === 'geo') {
      const point = value as { latitude: number; longitude: number } | null
      out['latitude'] = point === null ? null : point.latitude
      out['longitude'] = point === null ? null : point.longitude
      continue
    }

    out[field.name] =
      field.kind.kind === 'money' && typeof value === 'number' ? BigInt(value) : value
  }
  return out
}

async function readServiceAreas(role: ProfileRole, profileId: string): Promise<readonly string[]> {
  const key = MODELS[role].serviceAreaKey
  if (key === null) return []

  const rows = await prisma.profileServiceArea.findMany({
    where: { [key]: profileId } as Prisma.ProfileServiceAreaWhereInput,
    select: { adminAreaId: true },
  })
  return rows.map((r) => r.adminAreaId)
}

async function find(userId: string, role: ProfileRole): Promise<RoleProfileRecord | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- six delegates, one shape
  const row = (await (MODELS[role].delegate() as any).findUnique({
    where: { userId },
  })) as AnyRow | null
  if (row === null) return null

  return toRecord(role, row, await readServiceAreas(role, row.id))
}

export const roleProfileRepository: RoleProfileRepository = {
  findForUser: find,

  async ensureForUser(userId, role, now) {
    const existing = await find(userId, role)
    if (existing !== null) return existing

    /*
     * A profile whose role demands a name cannot be created empty, so the account's own name is
     * used as a starting value. It is a placeholder the owner immediately edits, not a claim
     * about their business — and the alternative, refusing to create the row, would mean the
     * profile screen 404s for somebody who genuinely holds the role.
     */
    const nameField = REQUIRED_ON_CREATE[role]
    const data: Record<string, unknown> = { userId }

    if (nameField !== undefined) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { fullName: true },
      })
      data[nameField] = user.fullName
    }
    // Every profile table carries `updated_at`, so the role makes no difference here.
    data['updatedAt'] = now

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- six delegates, one shape
    await (MODELS[role].delegate() as any).create({ data })

    const created = await find(userId, role)
    if (created === null) throw new Error('profile vanished immediately after creation')
    return created
  },

  async updateForUser(userId, role, changes) {
    const data = toStorable(role, changes)
    if (Object.keys(data).length === 0) return find(userId, role)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- six delegates, one shape
    const affected = (await (MODELS[role].delegate() as any).updateMany({
      where: { userId },
      data,
    })) as { count: number }

    if (affected.count === 0) return null
    return find(userId, role)
  },

  /**
   * Whether an address is the caller's.
   *
   * `deletedAt: null` is part of the question, not an optimisation. A soft-deleted address is one
   * the owner removed, and letting a profile newly point at it would resurrect it on a screen
   * they thought they had cleared.
   */
  async ownsAddress(userId, addressId) {
    const found = await prisma.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
      select: { id: true },
    })
    return found !== null
  },

  async replaceServiceAreas(userId, role, adminAreaIds) {
    const key = MODELS[role].serviceAreaKey
    if (key === null) return []

    const profile = await find(userId, role)
    if (profile === null) return []

    const unique = [...new Set(adminAreaIds)]

    /*
     * Delete and reinsert in one transaction. A partial replacement — old rows gone, new rows not
     * yet written — is a business that briefly serves nowhere, and a search running in that
     * window would silently omit them.
     */
    await prisma.$transaction([
      prisma.profileServiceArea.deleteMany({
        where: { [key]: profile.id } as Prisma.ProfileServiceAreaWhereInput,
      }),
      ...(unique.length === 0
        ? []
        : [
            prisma.profileServiceArea.createMany({
              data: unique.map((adminAreaId) => ({ adminAreaId, [key]: profile.id })),
            }),
          ]),
    ])

    return unique
  },
}
