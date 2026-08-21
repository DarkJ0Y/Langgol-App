/**
 * Area boundaries — groundwork for farm polygons.
 *
 * Nothing in the platform draws a farm boundary yet. This module exists so that when it does,
 * the shape has a validated domain representation rather than a bare array of numbers passed
 * between layers, and so the decisions that are easy to get wrong are made once, here, rather
 * than in whichever screen happens to ship first.
 *
 * Three of those decisions, made now:
 *
 *  - **Ring order is [longitude, latitude].** GeoJSON and PostGIS both use x-then-y, while every
 *    human-facing surface in this codebase says "latitude, longitude". Mixing the two silently
 *    produces a polygon in the Indian Ocean, so the conversion happens at exactly one boundary
 *    and is named.
 *  - **A ring is closed explicitly.** PostGIS requires the first and last position to be
 *    identical; a caller who forgets gets a rejected insert deep in a repository. `closeRing`
 *    makes it a domain operation with a test.
 *  - **Area is not computed here.** A correct geodesic area needs the same care as distance and
 *    belongs with PostGIS `ST_Area(geography)`, which already knows the datum. A plane-geometry
 *    approximation would look right and be wrong by percent at Bangladeshi latitudes — and land
 *    area is what a farmer's subsidy eligibility could one day be computed from.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2; packages/domain/src/geo/distance.ts
 */

import { isWithinBangladesh, type Coordinates } from './address.js'

/** A single vertex, in the order humans state it. Converted at the PostGIS boundary, not before. */
export type BoundaryVertex = Coordinates

/** Minimum vertices for an area: three corners plus the repeated closing position. */
const MIN_CLOSED_RING = 4

/**
 * A conservative cap. A smallholding needs a handful of vertices; thousands means a device
 * streamed a GPS track into the field, which is a different feature with different storage.
 */
const MAX_VERTICES = 1000

export type BoundaryErrorCode =
  | 'TOO_FEW_VERTICES'
  | 'TOO_MANY_VERTICES'
  | 'VERTEX_OUT_OF_RANGE'
  | 'VERTEX_OUTSIDE_COUNTRY'
  | 'RING_NOT_CLOSED'

export class BoundaryError extends Error {
  readonly code: BoundaryErrorCode

  constructor(code: BoundaryErrorCode, message: string) {
    super(message)
    this.name = 'BoundaryError'
    this.code = code
  }
}

function samePosition(a: BoundaryVertex, b: BoundaryVertex): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude
}

/** Append the first vertex if the ring does not already end where it started. */
export function closeRing(ring: readonly BoundaryVertex[]): readonly BoundaryVertex[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first === undefined || last === undefined) return ring
  return samePosition(first, last) ? ring : [...ring, first]
}

/**
 * Validate a closed ring.
 *
 * Deliberately does NOT test for self-intersection. Deciding whether a ring is simple is
 * `ST_IsValid`'s job, it is exactly the kind of geometry predicate that is subtly wrong when
 * hand-rolled, and the database is going to run it anyway — duplicating it here would create two
 * answers that can disagree.
 */
export function validateRing(ring: readonly BoundaryVertex[]): readonly BoundaryVertex[] {
  const closed = closeRing(ring)

  if (closed.length < MIN_CLOSED_RING) {
    throw new BoundaryError('TOO_FEW_VERTICES', 'A boundary needs at least three corners')
  }
  if (closed.length > MAX_VERTICES) {
    throw new BoundaryError('TOO_MANY_VERTICES', 'That boundary has too many points')
  }

  for (const vertex of closed) {
    if (
      !Number.isFinite(vertex.latitude) ||
      !Number.isFinite(vertex.longitude) ||
      Math.abs(vertex.latitude) > 90 ||
      Math.abs(vertex.longitude) > 180
    ) {
      throw new BoundaryError('VERTEX_OUT_OF_RANGE', 'A corner is not a point on Earth')
    }
    if (!isWithinBangladesh(vertex)) {
      throw new BoundaryError('VERTEX_OUTSIDE_COUNTRY', 'A corner falls outside Bangladesh')
    }
  }

  const first = closed[0]
  const last = closed[closed.length - 1]
  if (first === undefined || last === undefined || !samePosition(first, last)) {
    throw new BoundaryError('RING_NOT_CLOSED', 'The boundary does not close')
  }

  return closed
}

/**
 * Render a validated ring as WKT for PostGIS, converting to longitude-first order.
 *
 * The single place that reordering happens. Everything above this line says latitude first,
 * because that is what people say; everything the database sees says longitude first, because
 * that is what OGC specifies.
 */
export function ringToWkt(ring: readonly BoundaryVertex[]): string {
  const closed = validateRing(ring)
  const positions = closed
    .map((vertex) => `${String(vertex.longitude)} ${String(vertex.latitude)}`)
    .join(', ')
  return `POLYGON((${positions}))`
}
