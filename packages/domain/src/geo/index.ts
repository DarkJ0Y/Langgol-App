export {
  estimateRoadDistance,
  haversineMeters,
  isValidPoint,
  kmFromMeters,
  resolveCircuityFactor,
  type DistanceEstimate,
  type DistanceSource,
  type GeoPoint,
} from './distance.js'

import * as distance from './distance.js'

/** Namespace object: `Geo.estimateRoadDistance(from, to, factor)`. */
export const Geo = { ...distance } as const
