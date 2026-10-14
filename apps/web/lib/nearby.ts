/**
 * Where things are: the farms nearest a buyer, and how many buyers live near a farmer.
 *
 * Distances are the database's (PostGIS geography, metres on the ellipsoid), served from the GIST
 * indexes on `farms.geo`, `listings.geo` and `addresses.geo` — exact, and fast at any size.
 * Every query is a tagged template, so coordinates arrive as bound parameters, never as text.
 *
 * ## Privacy, which is the design rather than a filter on it
 *
 * Farms are public: they are where listings come from, and a buyer choosing produce should see
 * them. Buyers are not. A farmer sees only how MANY buyers live within 5, 10, 25 and 50 km —
 * never a name, a pin or an address — and any count below `MIN_DISCLOSED` is reported as "fewer
 * than 3", so a farmer with one neighbour cannot learn that the one neighbour buys on Langgol.
 * The platform connects the two through listings and orders; nobody needs the other's home.
 */

import 'server-only'
import { prisma } from '@langgol/db'

export interface Point {
  readonly lat: number
  readonly lng: number
}

/** Bangladesh, generously — the same box the database CHECKs addresses and plots against. */
export function inBangladesh(point: Point): boolean {
  return point.lat >= 20.3 && point.lat <= 26.7 && point.lng >= 88.0 && point.lng <= 92.7
}

/** Dhaka, for a visitor who has given no location and has no address on file. */
export const FALLBACK_ORIGIN: Point = { lat: 23.8103, lng: 90.4125 }

export interface NearbyFarm {
  readonly farmId: string
  readonly name: string
  readonly districtEn: string
  readonly districtBn: string
  readonly lat: number
  readonly lng: number
  readonly km: number
  readonly products: readonly {
    readonly listingId: string
    readonly slug: string
    readonly nameEn: string
    readonly nameBn: string
    readonly pricePoisha: bigint
  }[]
}

/** The farms with live listings nearest a point, closest first. */
export async function nearestFarms(origin: Point, limit = 12): Promise<NearbyFarm[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string
      name: string
      district_en: string
      district_bn: string
      lat: number
      lng: number
      km: number
    }[]
  >`
    SELECT f.id,
           f.name,
           a.name_en AS district_en,
           a.name_bn AS district_bn,
           ST_Y(f.geo::geometry) AS lat,
           ST_X(f.geo::geometry) AS lng,
           ST_Distance(f.geo, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography) / 1000 AS km
    FROM farms f
    JOIN admin_areas a ON a.id = f.admin_area_id
    WHERE f.deleted_at IS NULL
      AND f.geo IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM listings l
        WHERE l.farm_id = f.id
          AND l.status = 'PUBLISHED'
          AND l.deleted_at IS NULL
          AND l.available_to >= now()
      )
    ORDER BY f.geo <-> ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography
    LIMIT ${limit}
  `

  const listings = await prisma.listing.findMany({
    where: {
      farmId: { in: rows.map((row) => row.id) },
      status: 'PUBLISHED',
      deletedAt: null,
      availableTo: { gte: new Date() },
    },
    select: {
      id: true,
      farmId: true,
      unitPricePoisha: true,
      product: { select: { slug: true, nameEn: true, nameBn: true } },
    },
    orderBy: { unitPricePoisha: 'asc' },
  })

  return rows.map((row) => ({
    farmId: row.id,
    name: row.name,
    districtEn: row.district_en,
    districtBn: row.district_bn,
    lat: Number(row.lat),
    lng: Number(row.lng),
    km: Number(row.km),
    products: listings
      .filter((listing) => listing.farmId === row.id)
      .map((listing) => ({
        listingId: listing.id,
        slug: listing.product.slug,
        nameEn: listing.product.nameEn,
        nameBn: listing.product.nameBn,
        pricePoisha: listing.unitPricePoisha,
      })),
  }))
}

/** Where a signed-in person lives, as far as their default address says. Their own data. */
export async function homeOf(userId: string): Promise<Point | null> {
  const address = await prisma.address.findFirst({
    where: { userId, deletedAt: null, latitude: { not: null }, longitude: { not: null } },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { latitude: true, longitude: true },
  })
  if (address === null || address.latitude === null || address.longitude === null) return null
  return { lat: Number(address.latitude), lng: Number(address.longitude) }
}

/** Below this, a count is reported as "fewer than this" rather than as itself. */
export const MIN_DISCLOSED = 3

export const DEMAND_RINGS_KM = [5, 10, 25, 50] as const

export interface DemandRing {
  readonly km: (typeof DEMAND_RINGS_KM)[number]
  /** The count, or null when it is below MIN_DISCLOSED and must not be shown exactly. */
  readonly buyers: number | null
}

/**
 * How many buyers have an address within each ring of any of this farmer's farms.
 *
 * Counts of distinct people, never who or where. The farmer themself is left out, and so is
 * anyone whose only role is selling: a "buyer" here is a consumer, retailer or wholesaler.
 */
export async function buyersNear(
  farmerProfileId: string,
  farmerUserId: string,
): Promise<DemandRing[]> {
  const [row] = await prisma.$queryRaw<{ r5: bigint; r10: bigint; r25: bigint; r50: bigint }[]>`
    SELECT
      count(DISTINCT ad.user_id) FILTER (WHERE ST_DWithin(ad.geo, f.geo, 5000))  AS r5,
      count(DISTINCT ad.user_id) FILTER (WHERE ST_DWithin(ad.geo, f.geo, 10000)) AS r10,
      count(DISTINCT ad.user_id) FILTER (WHERE ST_DWithin(ad.geo, f.geo, 25000)) AS r25,
      count(DISTINCT ad.user_id) AS r50
    FROM farms f
    JOIN addresses ad
      ON ad.deleted_at IS NULL
     AND ad.geo IS NOT NULL
     AND ad.user_id <> ${farmerUserId}::uuid
     AND ST_DWithin(ad.geo, f.geo, 50000)
    WHERE f.farmer_profile_id = ${farmerProfileId}::uuid
      AND f.deleted_at IS NULL
      AND f.geo IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM user_role_assignments ura
        WHERE ura.user_id = ad.user_id
          AND ura.revoked_at IS NULL
          AND ura.role IN ('CONSUMER', 'RETAILER', 'WHOLESALER')
      )
  `
  const counts = [row?.r5, row?.r10, row?.r25, row?.r50].map((value) => Number(value ?? 0n))
  return DEMAND_RINGS_KM.map((km, index) => {
    const value = counts[index] ?? 0
    return { km, buyers: value < MIN_DISCLOSED ? null : value }
  })
}
