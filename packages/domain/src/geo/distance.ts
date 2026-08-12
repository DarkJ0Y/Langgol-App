/**
 * Distance estimation for the delivered-cost engine.
 *
 * Road distance APIs cost money per call and rural Bangladeshi road networks are poorly mapped,
 * so the MVP estimates road distance as **haversine × a road-circuity factor** (default 1.30,
 * configurable per district). Every quote records which source was used, so the factor's error
 * can be measured against real trip distance and tightened per corridor.
 *
 * This is treated as a **hypothesis to be calibrated, never a fact**. Rivers, ferries and
 * embankment roads make it materially wrong in places.
 *
 * Floating point appears here and nowhere downstream: haversine needs transcendental functions,
 * which have no exact integer form. The result is rounded **once**, to an integer metre, and
 * every money calculation downstream consumes that integer. Money never touches a float.
 *
 * Refs: docs/04_MARKETPLACE.md §3; docs/P2_DELIVERED_COST.md §6
 */

/** Where a distance figure came from. Stored on every quote so the estimate can be audited. */
export type DistanceSource = 'HAVERSINE' | 'HAVERSINE_CIRCUITY' | 'ROAD_API' | 'ACTUAL_TRIP'

export interface GeoPoint {
  readonly latitude: number
  readonly longitude: number
}

export interface DistanceEstimate {
  /** Great-circle distance, integer metres. */
  readonly straightLineMeters: number
  /** Estimated road distance, integer metres. This is what pricing consumes. */
  readonly roadMeters: number
  readonly source: DistanceSource
  /** The circuity factor actually applied, recorded so the estimate is reproducible. */
  readonly circuityFactor: number
}

/**
 * IUGG mean Earth radius in metres. A physical constant, not a business parameter — there is no
 * version of Langgol in which this belongs in PlatformConfig.
 */
const EARTH_MEAN_RADIUS_METERS = 6371008.8

const DEGREES_TO_RADIANS = Math.PI / 180

function isFiniteCoordinate(value: number, limit: number): boolean {
  return Number.isFinite(value) && value >= -limit && value <= limit
}

/** True when a point carries usable coordinates. Many rural addresses carry none. */
export function isValidPoint(point: GeoPoint | null | undefined): point is GeoPoint {
  if (!point) return false
  return isFiniteCoordinate(point.latitude, 90) && isFiniteCoordinate(point.longitude, 180)
}

/**
 * Great-circle distance between two points, in integer metres.
 *
 * Uses the haversine formula, which is numerically stable for the short distances Langgol
 * operates over — unlike the spherical law of cosines, which loses precision under a kilometre.
 */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const fromLatRad = from.latitude * DEGREES_TO_RADIANS
  const toLatRad = to.latitude * DEGREES_TO_RADIANS
  const deltaLat = (to.latitude - from.latitude) * DEGREES_TO_RADIANS
  const deltaLng = (to.longitude - from.longitude) * DEGREES_TO_RADIANS

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2)

  const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(EARTH_MEAN_RADIUS_METERS * centralAngle)
}

/**
 * Estimate road distance from two points and a district circuity factor.
 *
 * @param circuityFactor Road-to-straight-line multiplier for the corridor, from
 *   `PlatformConfig['delivery.circuityFactor']`. Never hard-coded at a call site.
 */
export function estimateRoadDistance(
  from: GeoPoint,
  to: GeoPoint,
  circuityFactor: number,
): DistanceEstimate {
  if (!Number.isFinite(circuityFactor) || circuityFactor < 1) {
    throw new RangeError(
      `Circuity factor must be a finite number >= 1, received ${String(circuityFactor)}. ` +
        'A road can never be shorter than the great-circle path between its endpoints.',
    )
  }

  const straightLineMeters = haversineMeters(from, to)
  return {
    straightLineMeters,
    // Rounded once, here. Everything downstream is integer arithmetic.
    roadMeters: Math.round(straightLineMeters * circuityFactor),
    source: 'HAVERSINE_CIRCUITY',
    circuityFactor,
  }
}

/**
 * Resolve the circuity factor for a district from the configured map.
 *
 * The config shape is `{ default: number, [districtKey: string]: number }`, so a corridor with a
 * measured factor overrides the default without a deploy.
 */
export function resolveCircuityFactor(
  configured: { readonly default: number } & Record<string, number>,
  districtKey?: string | null,
): number {
  if (districtKey) {
    const specific = configured[districtKey]
    if (typeof specific === 'number' && Number.isFinite(specific)) return specific
  }
  return configured.default
}

/**
 * Metres → kilometres for **display and rationale labels only**, rounded to one decimal.
 *
 * The tariff never consumes this: it charges on exact metres pro-rata (see `tariff.ts`), so no
 * rounding policy for a partial kilometre is invented anywhere in the pricing path.
 */
export function kmFromMeters(meters: number): number {
  return Math.round(meters / 100) / 10
}
