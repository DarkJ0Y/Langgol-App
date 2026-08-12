/**
 * Per-candidate ranking factors.
 *
 * Ranking is **not** by distance, and **not** by price alone. Six factors, each normalised to
 * [0, 1], combined with weights that live in `PlatformConfig` and are stamped onto every quote.
 *
 * ```text
 * score = 0.45·price + 0.18·reliability + 0.14·freshness
 *       + 0.08·speed + 0.08·quantityFit + 0.07·rating
 * ```
 *
 * Every factor here is computed in **integer parts-per-million**, not floating point. Not
 * because a rounding error would move money — it would not — but because a ranking must be
 * exactly reproducible from its stored `pricingVersion` when a farmer asks why they were third.
 *
 * Refs: docs/04_MARKETPLACE.md §5.2, §5.4; docs/P2_DELIVERED_COST.md §5
 */

/** Scores are integers in parts-per-million: 1_000_000 PPM = 1.0. */
export const PPM = 1000000n

export type Ppm = bigint

const BPS = 10000n

function clampPpm(value: bigint): Ppm {
  if (value < 0n) return 0n
  if (value > PPM) return PPM
  return value
}

/**
 * `priceScore = minDeliveredUnitPrice / thisDeliveredUnitPrice`
 *
 * Uses the **delivered** price per kg, not the listing price. Ranking by listing price would
 * recommend the farmer whose produce costs most to move. docs/P2_DELIVERED_COST.md §5.
 */
export function priceScore(thisDeliveredPerKg: bigint, bestDeliveredPerKg: bigint): Ppm {
  if (thisDeliveredPerKg <= 0n) return 0n
  if (bestDeliveredPerKg <= 0n) return 0n
  return clampPpm((bestDeliveredPerKg * PPM) / thisDeliveredPerKg)
}

/**
 * Laplace-smoothed completion rate: `(completed + k·prior) / (accepted + k)`.
 *
 * The prior is what stops a farmer with one completed order outranking a farmer with ninety, and
 * what stops a farmer with zero orders being buried forever. docs/04 §5.4.
 */
export function reliabilityScore(
  completedOrders: number,
  acceptedOrders: number,
  prior: { readonly smoothingK: number; readonly priorBps: number },
): Ppm {
  const completed = BigInt(Math.max(0, Math.trunc(completedOrders)))
  const accepted = BigInt(Math.max(0, Math.trunc(acceptedOrders)))
  const k = BigInt(Math.max(1, Math.trunc(prior.smoothingK)))
  const priorBps = BigInt(prior.priorBps)

  // (completed + k·prior) / (accepted + k), kept exact by scaling both sides by BPS.
  const numerator = (completed * BPS + k * priorBps) * PPM
  const denominator = (accepted + k) * BPS
  if (denominator === 0n) return 0n
  return clampPpm(numerator / denominator)
}

/**
 * Fraction of shelf life remaining at the expected moment of delivery.
 *
 * `max(0, 1 − hoursSinceHarvestAtDelivery / shelfLifeHours)`. A listing with no harvest date
 * scores the neutral midpoint rather than either extreme: absence of evidence is not evidence of
 * staleness, and it is not evidence of freshness either.
 */
export function freshnessScore(
  hoursSinceHarvestAtDelivery: number | null,
  shelfLifeHours: number,
): Ppm {
  if (hoursSinceHarvestAtDelivery === null) return PPM / 2n
  if (!Number.isFinite(shelfLifeHours) || shelfLifeHours <= 0) return 0n

  const elapsed = BigInt(Math.max(0, Math.round(hoursSinceHarvestAtDelivery)))
  const shelfLife = BigInt(Math.round(shelfLifeHours))
  if (elapsed >= shelfLife) return 0n

  return clampPpm(((shelfLife - elapsed) * PPM) / shelfLife)
}

/**
 * `speedScore = 1 / (1 + hoursUntilDelivery / 24)`, rearranged to `24 / (24 + hours)` so it
 * stays exact in integers.
 */
export function speedScore(hoursUntilDelivery: number): Ppm {
  const hours = BigInt(Math.max(0, Math.round(hoursUntilDelivery)))
  const day = 24n
  return clampPpm((day * PPM) / (day + hours))
}

/** `1.0` when the listing fully covers the request, a configured discount when it cannot. */
export function quantityFitScore(
  fullyCovers: boolean,
  config: { readonly full: number; readonly partial: number },
): Ppm {
  const bps = BigInt(fullyCovers ? config.full : config.partial)
  return clampPpm((bps * PPM) / BPS)
}

/**
 * Bayesian-smoothed star rating normalised to [0, 1].
 *
 * `(Σ stars + k·prior) / ((count + k) · maxStars)` — one five-star review from a friend must not
 * outrank forty honest four-star ones.
 */
export function ratingScore(
  ratingSumStarsMilli: number,
  ratingCount: number,
  prior: {
    readonly smoothingK: number
    readonly priorStarsMilli: number
    readonly maxStars: number
  },
): Ppm {
  const sum = BigInt(Math.max(0, Math.round(ratingSumStarsMilli)))
  const count = BigInt(Math.max(0, Math.trunc(ratingCount)))
  const k = BigInt(Math.max(1, Math.trunc(prior.smoothingK)))
  const priorStars = BigInt(prior.priorStarsMilli)
  const maxStars = BigInt(Math.max(1, Math.trunc(prior.maxStars)))

  const numerator = (sum + k * priorStars) * PPM
  const denominator = (count + k) * maxStars * 1000n
  if (denominator === 0n) return 0n
  return clampPpm(numerator / denominator)
}

export interface FactorScores {
  readonly price: Ppm
  readonly reliability: Ppm
  readonly freshness: Ppm
  readonly speed: Ppm
  readonly quantityFit: Ppm
  readonly rating: Ppm
}

export interface RankingWeightsBps {
  readonly price: number
  readonly reliability: number
  readonly freshness: number
  readonly speed: number
  readonly quantityFit: number
  readonly rating: number
}

/**
 * Weighted sum of the factors, in PPM.
 *
 * Weights are basis points summing to 10000, so the result is a weighted average that stays
 * inside [0, 1] by construction rather than by clamping.
 */
export function combineScores(factors: FactorScores, weightsBps: RankingWeightsBps): Ppm {
  const total =
    factors.price * BigInt(weightsBps.price) +
    factors.reliability * BigInt(weightsBps.reliability) +
    factors.freshness * BigInt(weightsBps.freshness) +
    factors.speed * BigInt(weightsBps.speed) +
    factors.quantityFit * BigInt(weightsBps.quantityFit) +
    factors.rating * BigInt(weightsBps.rating)

  return clampPpm(total / BPS)
}

/**
 * Cold-start exposure boost for a newly verified farmer, decaying over their first orders.
 *
 * This is a deliberate, logged market-making intervention to break the
 * no-orders → no-reputation → no-orders loop. It is reported, never secret. docs/04 §5.4.
 */
export function newFarmerBoost(
  completedOrders: number,
  config: { readonly boostBps: number; readonly decayOverOrders: number },
): Ppm {
  const completed = Math.max(0, Math.trunc(completedOrders))
  const decayOver = Math.max(1, Math.trunc(config.decayOverOrders))
  if (completed >= decayOver) return 0n

  const remaining = BigInt(decayOver - completed)
  const full = (BigInt(config.boostBps) * PPM) / BPS
  return (full * remaining) / BigInt(decayOver)
}
