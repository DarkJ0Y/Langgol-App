/**
 * Trip cost reconciliation — replacing the model with the truth.
 *
 * At quote time the engine *predicts* what an order will cost to move. After the trip runs, ops
 * record what it **actually** cost, and that real figure is allocated back across the orders the
 * trip carried. The gap between prediction and reality is not a rounding detail to be tidied
 * away: it is the single most important number the pilot produces, because it is what says
 * whether the delivered-cost model is worth anything.
 *
 * ```text
 * allocationShare = thisOrderChargeableWeight / totalChargeableWeightOnTrip
 * actualCost      = tripActualCost × allocationShare
 * calibrationGap  = actualCost − expectedCost
 * ```
 *
 * Allocation uses `Money.allocate`, so the parts sum to the trip cost **exactly** — no poisha is
 * invented or lost across the orders, however the weights divide.
 *
 * Refs: docs/04_MARKETPLACE.md §4; docs/10_ECONOMIC_MEASUREMENT.md §6.3; docs/02_DATABASE.md §8.1
 */

import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import { PricingError } from './errors.js'

/** How a trip's cost is divided between the orders it carried. docs/02 §8.1. */
export type AllocationMethod =
  /** Default: proportional to chargeable weight. */
  | 'WEIGHT_SHARE'
  /** Every order pays the same share, regardless of size. */
  | 'EQUAL_SHARE'
  /** A single-order trip: that order carries all of it. */
  | 'STANDALONE'

export interface TripOrderInput {
  readonly orderId: string
  /** Chargeable weight in milligrams — the same figure the tariff was computed on. */
  readonly chargeableMilligrams: bigint
  /** What the engine predicted at quote time, for the calibration gap. */
  readonly expectedCostPoisha: Poisha
}

export interface AllocatedOrderCost {
  readonly orderId: string
  readonly actualCostPoisha: Poisha
  readonly expectedCostPoisha: Poisha
  /**
   * `actual − expected`. Positive means the model **under**-predicted: the order really cost more
   * than the quote assumed. This is the number that recalibrates the tariff.
   */
  readonly calibrationGapPoisha: Poisha
  readonly allocationNumerator: bigint
  readonly allocationDenominator: bigint
}

export interface TripReconciliation {
  readonly tripActualCostPoisha: Poisha
  readonly method: AllocationMethod
  readonly orders: readonly AllocatedOrderCost[]
  /** Sum of the allocated costs. Always exactly equal to the trip cost. */
  readonly allocatedTotalPoisha: Poisha
  /** Sum of what the engine had predicted across these orders. */
  readonly expectedTotalPoisha: Poisha
  /** Trip-level model error. The headline calibration figure. */
  readonly calibrationGapPoisha: Poisha
}

/**
 * Allocate a trip's actual cost across the orders it carried.
 *
 * **The remainder goes to the first order by id**, deterministically, rather than to whichever
 * order happens to sort first in memory. Langgol's money convention sends a rounding remainder to
 * the platform rather than to a farmer or buyer — but this is an internal cost figure that never
 * touches what anyone is paid, so the only requirement is that it is stable and reproducible.
 * A reconciliation that produced different numbers on a re-run would be useless as evidence.
 */
export function reconcileTripCost(
  tripActualCostPoisha: Poisha,
  orders: readonly TripOrderInput[],
  method: AllocationMethod = 'WEIGHT_SHARE',
): TripReconciliation {
  Money.requireNonNegative(tripActualCostPoisha, 'Trip actual cost')

  if (orders.length === 0) {
    throw new PricingError(
      'INVALID_INPUT',
      'A trip with no orders has no cost to allocate. Record the cost against the trip and ' +
        'investigate why it carried nothing.',
    )
  }

  // Sorted by id so the allocation is reproducible regardless of query order.
  const ordered = [...orders].sort((a, b) => a.orderId.localeCompare(b.orderId))

  for (const order of ordered) {
    if (order.chargeableMilligrams < 0n) {
      throw new PricingError(
        'INVALID_INPUT',
        `Order ${order.orderId} has a negative chargeable weight`,
      )
    }
  }

  const weights = buildWeights(ordered, method)
  const denominator = weights.reduce((total, weight) => total + weight, 0n)

  if (denominator === 0n) {
    throw new PricingError(
      'INVALID_INPUT',
      'Total allocation weight on this trip is zero, so cost cannot be apportioned. ' +
        'A trip carrying no chargeable weight needs an EQUAL_SHARE allocation instead.',
    )
  }

  // Money.allocate guarantees the parts sum exactly to the whole.
  const shares = Money.allocate(tripActualCostPoisha, weights, 0)

  const allocated: AllocatedOrderCost[] = ordered.map((order, index) => {
    const actualCostPoisha = shares[index]!
    return {
      orderId: order.orderId,
      actualCostPoisha,
      expectedCostPoisha: order.expectedCostPoisha,
      calibrationGapPoisha: Money.subtract(actualCostPoisha, order.expectedCostPoisha),
      allocationNumerator: weights[index]!,
      allocationDenominator: denominator,
    }
  })

  const allocatedTotalPoisha = Money.sum(allocated.map((entry) => entry.actualCostPoisha))
  const expectedTotalPoisha = Money.sum(allocated.map((entry) => entry.expectedCostPoisha))

  return {
    tripActualCostPoisha,
    method,
    orders: allocated,
    allocatedTotalPoisha,
    expectedTotalPoisha,
    calibrationGapPoisha: Money.subtract(allocatedTotalPoisha, expectedTotalPoisha),
  }
}

function buildWeights(
  orders: readonly TripOrderInput[],
  method: AllocationMethod,
): readonly bigint[] {
  switch (method) {
    case 'WEIGHT_SHARE':
      return orders.map((order) => order.chargeableMilligrams)
    case 'EQUAL_SHARE':
      return orders.map(() => 1n)
    case 'STANDALONE': {
      if (orders.length !== 1) {
        throw new PricingError(
          'INVALID_INPUT',
          `STANDALONE allocation expects exactly one order, got ${String(orders.length)}. ` +
            'A trip carrying several orders is pooled by definition.',
        )
      }
      return [1n]
    }
  }
}

/**
 * Trip-level economics, for the delivery-model comparison in docs/10 §6.2.
 *
 * These are the figures that answer "did aggregating four orders actually reduce cost per
 * order?" — the question the whole trip/order separation exists to make answerable.
 */
export interface TripMetrics {
  readonly costPerOrderPoisha: Poisha
  readonly costPerKgPoisha: Poisha | null
  /** Load utilisation in basis points of capacity: 5000 = half full. */
  readonly utilisationBps: number
  readonly averageDistancePerOrderMeters: number
}

export function computeTripMetrics(input: {
  readonly actualCostPoisha: Poisha
  readonly orderCount: number
  readonly totalWeightMilligrams: bigint
  readonly vehicleCapacityMilligrams: bigint
  readonly routeDistanceMeters: number
}): TripMetrics {
  if (input.orderCount <= 0) {
    throw new PricingError('INVALID_INPUT', 'Trip metrics require at least one order')
  }
  if (input.vehicleCapacityMilligrams <= 0n) {
    throw new PricingError('INVALID_INPUT', 'Vehicle capacity must be positive')
  }

  const MG_PER_KG = 1000000n

  return {
    costPerOrderPoisha: Money.divide(input.actualCostPoisha, input.orderCount),
    costPerKgPoisha:
      input.totalWeightMilligrams > 0n
        ? Money.multiplyByRatio(input.actualCostPoisha, MG_PER_KG, input.totalWeightMilligrams)
        : null,
    utilisationBps: Number(
      (input.totalWeightMilligrams * 10000n) / input.vehicleCapacityMilligrams,
    ),
    averageDistancePerOrderMeters: Math.round(input.routeDistanceMeters / input.orderCount),
  }
}
