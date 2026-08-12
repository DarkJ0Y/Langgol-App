/**
 * The internal cost model — **cost 2** of the three costs in docs/04_MARKETPLACE.md §2.
 *
 * This is what Langgol expects an order to cost it. It is never shown to a buyer or a farmer and
 * never appears on an invoice. It exists for exactly three purposes: ranking feasibility,
 * margin forecasting, and being proved wrong by `DeliveryTrip.actualCostPoisha` after the fact.
 *
 * ```text
 * tripCost              = vehicleBase + perKm × distanceKm × roundTripFactor
 *                         + loadingFee + stopFee × stops
 * allocationShare       = thisOrderChargeableWeight / expectedLoadedWeightOnTrip
 * expectedTransportCost = tripCost × allocationShare
 * expectedSpoilageCost  = productCost × spoilageRate(class, transitHours, coldChain)
 * paymentCost           = rate × buyerTotal + fixedFee
 * fulfilmentCost        = packagingPerOrder + agentTimeCost
 * ```
 *
 * `allocationShare` is 1.0 for a solo dispatch and falls **only** when real pooling is observed
 * in trip history for that corridor — never on optimism.
 *
 * Refs: docs/04_MARKETPLACE.md §4; docs/06_FINANCIAL_ARCHITECTURE.md §6
 */

import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import { PricingError } from './errors.js'

const METERS_PER_KM = 1000n
const BPS = 10000n

export type PerishabilityClass = 'HIGHLY_PERISHABLE' | 'PERISHABLE' | 'SEMI_DURABLE' | 'DURABLE'

export interface VehicleCostProfile {
  readonly capacityKg: number
  readonly baseFeePoisha: number
  readonly perKmPoisha: number
  readonly loadingFeePoisha: number
  readonly stopFeePoisha: number
}

export interface InternalCostConfig {
  readonly provisional: boolean
  readonly roundTripFactorBps: number
  readonly vehicles: Readonly<Record<string, VehicleCostProfile>>
}

export interface SpoilageConfig {
  readonly provisional: boolean
  readonly perHourBpsByClass: Readonly<Record<PerishabilityClass, number>>
  readonly coldChainReductionBps: number
  readonly maxBps: number
}

export interface FulfilmentCostConfig {
  readonly provisional: boolean
  readonly packagingPerOrderPoisha: number
  readonly agentTimePerOrderPoisha: number
}

export interface PaymentCostConfig {
  readonly provisional: boolean
  readonly byMethod: Readonly<
    Record<string, { readonly rateBps: number; readonly fixedPoisha: number }>
  >
}

/* --------------------------------------------------------------------- transport */

export interface TripCostInput {
  readonly vehicleClass: string
  readonly roadMeters: number
  readonly stops: number
  readonly config: InternalCostConfig
}

/**
 * Modelled cost of one whole vehicle movement.
 *
 * The round-trip factor is applied to the **distance component only**: a vehicle returning empty
 * still burns fuel over the return leg, but it is not loaded or unloaded twice.
 */
export function computeTripCost(input: TripCostInput): Poisha {
  const { vehicleClass, roadMeters, stops, config } = input

  const vehicle = config.vehicles[vehicleClass]
  if (!vehicle) {
    throw new PricingError(
      'INVALID_INPUT',
      `No internal cost profile configured for vehicle class "${vehicleClass}"`,
      `configured=${Object.keys(config.vehicles).join(', ')}`,
    )
  }
  if (!Number.isInteger(roadMeters) || roadMeters < 0) {
    throw new PricingError(
      'INVALID_INPUT',
      `Road distance must be a non-negative integer metre count, got ${String(roadMeters)}`,
    )
  }
  if (!Number.isInteger(stops) || stops < 0) {
    throw new PricingError(
      'INVALID_INPUT',
      `Stop count must be a non-negative integer, got ${String(stops)}`,
    )
  }

  // perKm × distance, then × roundTripFactor — one rounding at each documented step.
  const distanceComponent = Money.multiplyByRatio(
    Money.fromPoisha(vehicle.perKmPoisha),
    roadMeters,
    METERS_PER_KM,
  )
  const withReturnLeg = Money.multiplyByRatio(distanceComponent, config.roundTripFactorBps, BPS)

  const stopComponent = Money.multiply(Money.fromPoisha(vehicle.stopFeePoisha), stops)

  return Money.sum([
    Money.fromPoisha(vehicle.baseFeePoisha),
    withReturnLeg,
    Money.fromPoisha(vehicle.loadingFeePoisha),
    stopComponent,
  ])
}

export interface AllocationInput {
  /** This order's chargeable weight, in milligrams. */
  readonly orderChargeableMilligrams: bigint
  /**
   * Total chargeable weight expected on the trip, in milligrams. Equals the order's own weight
   * for a solo dispatch, giving `allocationShare = 1.0`.
   */
  readonly expectedLoadedMilligrams: bigint
}

/**
 * This order's share of a trip cost.
 *
 * Expressed as an exact rational and applied with a single rounding, so allocating a trip across
 * its orders can never invent or lose a poisha at the margins.
 */
export function allocateTripCost(tripCostPoisha: Poisha, input: AllocationInput): Poisha {
  const { orderChargeableMilligrams, expectedLoadedMilligrams } = input

  if (orderChargeableMilligrams < 0n) {
    throw new PricingError('INVALID_INPUT', 'Order chargeable weight must not be negative')
  }
  if (expectedLoadedMilligrams <= 0n) {
    throw new PricingError(
      'INVALID_INPUT',
      'Expected loaded weight on the trip must be positive; a trip carrying nothing has no cost to allocate',
    )
  }
  if (orderChargeableMilligrams > expectedLoadedMilligrams) {
    throw new PricingError(
      'INVALID_INPUT',
      'An order cannot weigh more than the trip carrying it',
      `order=${orderChargeableMilligrams.toString()}mg loaded=${expectedLoadedMilligrams.toString()}mg`,
    )
  }

  return Money.multiplyByRatio(tripCostPoisha, orderChargeableMilligrams, expectedLoadedMilligrams)
}

/* --------------------------------------------------------------------- spoilage */

export interface SpoilageInput {
  readonly productCostPoisha: Poisha
  readonly perishability: PerishabilityClass
  readonly transitHours: number
  readonly hasColdChain: boolean
  readonly config: SpoilageConfig
}

/**
 * Expected spoilage loss, as a fraction of product value.
 *
 * A flat per-hour rate per perishability class is deliberately crude; docs/04 §12 defers real
 * cold-chain modelling to a later phase. The cap stops a long transit producing an absurd
 * expected loss greater than a sane fraction of the consignment.
 */
export function computeSpoilageCost(input: SpoilageInput): Poisha {
  const { productCostPoisha, perishability, transitHours, hasColdChain, config } = input

  if (!Number.isFinite(transitHours) || transitHours < 0) {
    throw new PricingError(
      'INVALID_INPUT',
      `Transit hours must be non-negative, got ${String(transitHours)}`,
    )
  }

  const perHourBps = config.perHourBpsByClass[perishability]
  if (perHourBps === undefined) {
    throw new PricingError(
      'INVALID_INPUT',
      `No spoilage rate configured for class "${perishability}"`,
    )
  }

  // Hours are rounded up: a partly-elapsed hour still exposes produce to the heat.
  const hours = Math.ceil(transitHours)
  let effectiveBps = perHourBps * hours

  if (hasColdChain) {
    effectiveBps = Math.round((effectiveBps * (10000 - config.coldChainReductionBps)) / 10000)
  }
  if (effectiveBps > config.maxBps) effectiveBps = config.maxBps

  return Money.percentBps(productCostPoisha, effectiveBps)
}

/* --------------------------------------------------------------------- payment */

/**
 * What accepting this payment method costs Langgol.
 *
 * `COD: rate × buyerTotal` · `MFS: rate × buyerTotal + fixedFee` — a single shape covers both,
 * which is what lets a new method be a configuration entry rather than a code change.
 */
export function computePaymentCost(
  buyerTotalPoisha: Poisha,
  method: string,
  config: PaymentCostConfig,
): Poisha {
  const profile = config.byMethod[method]
  if (!profile) {
    throw new PricingError(
      'INVALID_INPUT',
      `No payment cost profile configured for method "${method}"`,
      `configured=${Object.keys(config.byMethod).join(', ')}`,
    )
  }
  return Money.add(
    Money.percentBps(buyerTotalPoisha, profile.rateBps),
    Money.fromPoisha(profile.fixedPoisha),
  )
}

/* ------------------------------------------------------------ cost and margin */

export interface LanggolCostInput {
  readonly expectedTransportPoisha: Poisha
  readonly expectedSpoilagePoisha: Poisha
  readonly paymentPoisha: Poisha
  readonly fulfilmentConfig: FulfilmentCostConfig
}

export interface LanggolCost {
  readonly transportPoisha: Poisha
  readonly spoilagePoisha: Poisha
  readonly paymentPoisha: Poisha
  readonly packagingPoisha: Poisha
  readonly agentTimePoisha: Poisha
  readonly totalPoisha: Poisha
}

export function computeLanggolCost(input: LanggolCostInput): LanggolCost {
  const packagingPoisha = Money.fromPoisha(input.fulfilmentConfig.packagingPerOrderPoisha)
  const agentTimePoisha = Money.fromPoisha(input.fulfilmentConfig.agentTimePerOrderPoisha)

  return {
    transportPoisha: input.expectedTransportPoisha,
    spoilagePoisha: input.expectedSpoilagePoisha,
    paymentPoisha: input.paymentPoisha,
    packagingPoisha,
    agentTimePoisha,
    totalPoisha: Money.sum([
      input.expectedTransportPoisha,
      input.expectedSpoilagePoisha,
      input.paymentPoisha,
      packagingPoisha,
      agentTimePoisha,
    ]),
  }
}

export interface ContributionMarginInput {
  readonly commissionPoisha: Poisha
  readonly platformFeePoisha: Poisha
  readonly handlingFeePoisha: Poisha
  readonly deliveryChargedToBuyerPoisha: Poisha
  readonly deliveryFundedBySellerPoisha: Poisha
  readonly deliveryFundedByRetailerPoisha: Poisha
  readonly promotionalSubsidyPoisha: Poisha
  readonly cost: LanggolCost
}

export interface ContributionMargin {
  readonly revenuePoisha: Poisha
  readonly variableCostPoisha: Poisha
  readonly marginPoisha: Poisha
  /** True when the platform loses money on this order. Allowed, but always flagged. */
  readonly isNegative: boolean
}

/**
 * Contribution margin for one order.
 *
 * ```text
 * revenue      = commission + platformFee + handling
 *                + deliveryChargedToBuyer + deliveryFundedBySeller + deliveryFundedByRetailer
 * variableCost = transport + spoilage + payment + packaging + agentTime + promotionalSubsidy
 * margin       = revenue − variableCost
 * ```
 *
 * The subsidy appears as an explicit **cost** rather than as reduced revenue, exactly as it is
 * posted to ledger `5020`. That is what makes "how much are we paying for this order?"
 * answerable in one query instead of inferable from a gap.
 *
 * A negative margin does not block the quote — subsidy may be a deliberate growth choice — but
 * it is flagged, counted and reported daily. A marketplace that cannot see its per-order margin
 * cannot know whether it is working.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §6; docs/04_MARKETPLACE.md §4
 */
export function computeContributionMargin(input: ContributionMarginInput): ContributionMargin {
  const revenuePoisha = Money.sum([
    input.commissionPoisha,
    input.platformFeePoisha,
    input.handlingFeePoisha,
    input.deliveryChargedToBuyerPoisha,
    input.deliveryFundedBySellerPoisha,
    input.deliveryFundedByRetailerPoisha,
  ])

  const variableCostPoisha = Money.add(input.cost.totalPoisha, input.promotionalSubsidyPoisha)
  const marginPoisha = Money.subtract(revenuePoisha, variableCostPoisha)

  return {
    revenuePoisha,
    variableCostPoisha,
    marginPoisha,
    isNegative: Money.isNegative(marginPoisha),
  }
}
