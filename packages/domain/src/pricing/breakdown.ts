/**
 * The delivered-cost breakdown — the single computation that decides what a buyer pays, what a
 * farmer receives, and whether Langgol can afford the transaction.
 *
 * Two economies, never mixed:
 *
 * ```text
 * BUYER SIDE   deliveredCost     = productPrice + buyerDeliveryCharge + handling + applicableFees
 * SELLER SIDE  farmerRealization = productValue − commission − sellerFundedDelivery
 * ```
 *
 * These are separate calculations over the same transaction. Mixing them is how a platform
 * convinces itself that a farmer gained because a buyer paid more. Every quote stores both
 * blocks independently, and neither party is ever shown the other's economics.
 *
 * Refs: docs/P2_DELIVERED_COST.md §1–3; docs/04_MARKETPLACE.md §6; docs/06 §4
 */

import type { ConfigSnapshot } from '../config/snapshot.js'
import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import { PricingError } from './errors.js'
import {
  applyFunding,
  type DeliveryFundingModel,
  type FundingContext,
  type FundingSplit,
} from './funding.js'
import {
  allocateTripCost,
  computeContributionMargin,
  computeLanggolCost,
  computePaymentCost,
  computeSpoilageCost,
  computeTripCost,
  type ContributionMargin,
  type LanggolCost,
  type PerishabilityClass,
} from './internal-cost.js'
import { chargeableWeightMilligrams, computeTariff, type TariffQuote } from './tariff.js'

/**
 * The pricing algorithm version, stamped onto every quote alongside the config versions.
 *
 * Bump this whenever the *shape* of the computation changes — a new cost component, a changed
 * rounding point. Changing a rate does NOT bump it; that is a config version. Together the two
 * make any historical price exactly reproducible.
 */
export const PRICING_VERSION = 'pricing-2026-08-13'

export type FulfilmentMode = 'BUYER_PICKUP' | 'SELLER_DELIVERY' | 'LANGGOL_DELIVERY'

export interface QuoteLineInput {
  readonly listingId: string
  readonly productId: string
  /** Price per sale unit, e.g. per KG or per MON. */
  readonly unitPricePoisha: Poisha
  /** Base units in one sale unit — KG = 1_000_000 (mg). docs/02 §6.1. */
  readonly saleUnitInBaseUnits: bigint
  /** Requested quantity in base units. */
  readonly quantityBase: bigint
  readonly perishability: PerishabilityClass
}

export interface QuoteLine extends QuoteLineInput {
  readonly lineTotalPoisha: Poisha
}

export interface BreakdownInput {
  readonly lines: readonly QuoteLineInput[]
  readonly fulfilmentMode: FulfilmentMode
  readonly fundingModel: DeliveryFundingModel
  readonly fundingContext: Omit<FundingContext, 'enabledModels'>
  readonly paymentMethod: string
  /** Estimated road distance in integer metres. Zero for pickup. */
  readonly roadMeters: number
  /** Vehicle class key into `delivery.internalCost.vehicles`. */
  readonly vehicleClass: string
  /** Expected hours between dispatch and delivery, for the spoilage model. */
  readonly transitHours: number
  readonly hasColdChain: boolean
  /** Drops on the modelled trip. One for a solo dispatch. */
  readonly stops: number
  /**
   * Total chargeable weight expected on the trip, in milligrams. Defaults to this order's own
   * weight — `allocationShare = 1.0` — because pooling is credited only when observed.
   */
  readonly expectedLoadedMilligrams?: bigint
  /** Packed volume in cm³ when known, for volumetric weight. */
  readonly volumeCm3?: number | null
}

export interface BuyerBreakdown {
  readonly subtotalPoisha: Poisha
  readonly deliveryFeePoisha: Poisha
  readonly handlingFeePoisha: Poisha
  readonly platformFeePoisha: Poisha
  readonly buyerTotalPoisha: Poisha
  /** Delivered price per kilogram, for comparison across listings. Null for non-mass products. */
  readonly deliveredPricePerKgPoisha: Poisha | null
}

export interface SellerBreakdown {
  readonly sellerGrossPoisha: Poisha
  readonly commissionPoisha: Poisha
  readonly commissionBps: number
  readonly sellerFundedDeliveryPoisha: Poisha
  readonly sellerNetPoisha: Poisha
}

export interface InternalBreakdown {
  readonly tripCostPoisha: Poisha
  readonly allocationShareNumerator: string
  readonly allocationShareDenominator: string
  readonly cost: LanggolCost
  readonly margin: ContributionMargin
}

export interface Breakdown {
  readonly pricingVersion: string
  readonly configVersions: Readonly<Record<string, number>>
  readonly lines: readonly QuoteLine[]
  readonly chargeableMilligrams: bigint
  readonly actualMilligrams: bigint
  readonly roadMeters: number
  readonly fulfilmentMode: FulfilmentMode
  readonly tariff: TariffQuote | null
  readonly funding: FundingSplit
  readonly buyer: BuyerBreakdown
  readonly seller: SellerBreakdown
  readonly internal: InternalBreakdown
}

const MG_PER_KG = 1000000n

/** Mass-based sale units are the only ones with a meaningful price-per-kg. */
function isMassBased(saleUnitInBaseUnits: bigint): boolean {
  return saleUnitInBaseUnits >= 1000n
}

/**
 * Line total: `unitPrice × quantity / saleUnitInBaseUnits`, rounded **half-up exactly once**.
 *
 * The rounding point is normative — docs/02_DATABASE.md §1.1 — because rounding twice, or at a
 * different level, silently changes what a farmer is paid.
 */
export function computeLineTotal(line: QuoteLineInput): Poisha {
  if (line.saleUnitInBaseUnits <= 0n) {
    throw new PricingError(
      'INVALID_INPUT',
      `saleUnitInBaseUnits must be positive for listing ${line.listingId}`,
    )
  }
  if (line.quantityBase <= 0n) {
    throw new PricingError(
      'INVALID_INPUT',
      `Quantity must be positive for listing ${line.listingId}`,
    )
  }
  return Money.multiplyByRatio(line.unitPricePoisha, line.quantityBase, line.saleUnitInBaseUnits)
}

/**
 * Compute the full breakdown for one quote.
 *
 * Every rate, tariff, weight and threshold is read from the supplied `ConfigSnapshot`; nothing
 * economic is decided in this file. The snapshot's versions are copied onto the result so the
 * price can be reproduced exactly, years later, after the rates have changed three times.
 */
export function computeBreakdown(input: BreakdownInput, config: ConfigSnapshot): Breakdown {
  if (input.lines.length === 0) {
    throw new PricingError('INVALID_INPUT', 'A quote must contain at least one line')
  }

  /* ---------------------------------------------------------------- product side */

  const lines: QuoteLine[] = input.lines.map((line) => ({
    ...line,
    lineTotalPoisha: computeLineTotal(line),
  }))

  const subtotalPoisha = Money.sum(lines.map((line) => line.lineTotalPoisha))
  const sellerGrossPoisha = subtotalPoisha

  const actualMilligrams = lines.reduce(
    (total, line) => (isMassBased(line.saleUnitInBaseUnits) ? total + line.quantityBase : total),
    0n,
  )

  /* ------------------------------------------------------------------- weight */

  const chargeableMilligrams = chargeableWeightMilligrams({
    actualMilligrams,
    volumeCm3: input.volumeCm3 ?? null,
    volumetricDivisorCm3PerKg: config.require('delivery.volumetricDivisorCm3PerKg'),
  })

  /* ------------------------------------------------------------------ handling */

  const handlingConfig = config.require('delivery.handling')
  // The most perishable line sets the handling class: a crate of tomatoes in the load determines
  // how the whole consignment must be packed and handled.
  const handlingClass = mostPerishable(lines.map((line) => line.perishability))
  const handlingFeePoisha = Money.add(
    Money.fromPoisha(handlingConfig.perOrderPoisha),
    Money.multiplyByRatio(
      Money.fromPoisha(handlingConfig.perKgPoishaByClass[handlingClass]),
      actualMilligrams,
      MG_PER_KG,
    ),
  )

  /* ------------------------------------------------------- tariff and funding */

  const requiresDelivery = input.fulfilmentMode !== 'BUYER_PICKUP'

  const tariff = requiresDelivery
    ? computeTariff(chargeableMilligrams, input.roadMeters, config.require('delivery.tariff'))
    : null

  const funding = applyFunding(tariff?.tariffPoisha ?? Money.zero, input.fundingModel, {
    ...input.fundingContext,
    enabledModels: config.require('delivery.fundingModel.enabled'),
  })

  /* ---------------------------------------------------------------- buyer side */

  const platformFeeBps = config.require('platformFee.bps')
  const platformFeePoisha = Money.percentBps(subtotalPoisha, platformFeeBps)

  const buyerTotalPoisha = Money.sum([
    subtotalPoisha,
    funding.chargedToBuyerPoisha,
    handlingFeePoisha,
    platformFeePoisha,
  ])

  const deliveredPricePerKgPoisha =
    actualMilligrams > 0n
      ? Money.multiplyByRatio(buyerTotalPoisha, MG_PER_KG, actualMilligrams)
      : null

  /* --------------------------------------------------------------- seller side */

  const commissionBps = config.require('commission.bps')
  const commissionPoisha = Money.percentBps(sellerGrossPoisha, commissionBps)
  const sellerNetPoisha = Money.subtract(
    Money.subtract(sellerGrossPoisha, commissionPoisha),
    funding.fundedBySellerPoisha,
  )

  /* ------------------------------------------------------------ internal model */

  // A farmer delivering their own produce costs Langgol nothing in transport; the farmer's own
  // cost is theirs, and is reflected in sellerNet under SELLER_FUNDED rather than here.
  const langgolMovesTheGoods = input.fulfilmentMode === 'LANGGOL_DELIVERY'

  const tripCostPoisha = langgolMovesTheGoods
    ? computeTripCost({
        vehicleClass: input.vehicleClass,
        roadMeters: input.roadMeters,
        stops: input.stops,
        config: config.require('delivery.internalCost'),
      })
    : Money.zero

  const expectedLoadedMilligrams =
    input.expectedLoadedMilligrams ?? (chargeableMilligrams > 0n ? chargeableMilligrams : 1n)

  const expectedTransportPoisha = langgolMovesTheGoods
    ? allocateTripCost(tripCostPoisha, {
        orderChargeableMilligrams: chargeableMilligrams,
        expectedLoadedMilligrams,
      })
    : Money.zero

  const expectedSpoilagePoisha = computeSpoilageCost({
    productCostPoisha: subtotalPoisha,
    perishability: handlingClass,
    transitHours: input.transitHours,
    hasColdChain: input.hasColdChain,
    config: config.require('delivery.spoilage'),
  })

  const paymentPoisha = computePaymentCost(
    buyerTotalPoisha,
    input.paymentMethod,
    config.require('payments.cost'),
  )

  const cost = computeLanggolCost({
    expectedTransportPoisha,
    expectedSpoilagePoisha,
    paymentPoisha,
    fulfilmentConfig: config.require('fulfilment.cost'),
  })

  const margin = computeContributionMargin({
    commissionPoisha,
    platformFeePoisha,
    handlingFeePoisha,
    deliveryChargedToBuyerPoisha: funding.chargedToBuyerPoisha,
    deliveryFundedBySellerPoisha: funding.fundedBySellerPoisha,
    deliveryFundedByRetailerPoisha: funding.fundedByRetailerPoisha,
    promotionalSubsidyPoisha: funding.promotionalSubsidyPoisha,
    cost,
  })

  return {
    pricingVersion: PRICING_VERSION,
    configVersions: config.versions,
    lines,
    chargeableMilligrams,
    actualMilligrams,
    roadMeters: requiresDelivery ? input.roadMeters : 0,
    fulfilmentMode: input.fulfilmentMode,
    tariff,
    funding,
    buyer: {
      subtotalPoisha,
      deliveryFeePoisha: funding.chargedToBuyerPoisha,
      handlingFeePoisha,
      platformFeePoisha,
      buyerTotalPoisha,
      deliveredPricePerKgPoisha,
    },
    seller: {
      sellerGrossPoisha,
      commissionPoisha,
      commissionBps,
      sellerFundedDeliveryPoisha: funding.fundedBySellerPoisha,
      sellerNetPoisha,
    },
    internal: {
      tripCostPoisha,
      allocationShareNumerator: chargeableMilligrams.toString(),
      allocationShareDenominator: expectedLoadedMilligrams.toString(),
      cost,
      margin,
    },
  }
}

const PERISHABILITY_ORDER: readonly PerishabilityClass[] = [
  'HIGHLY_PERISHABLE',
  'PERISHABLE',
  'SEMI_DURABLE',
  'DURABLE',
]

function mostPerishable(classes: readonly PerishabilityClass[]): PerishabilityClass {
  for (const candidate of PERISHABILITY_ORDER) {
    if (classes.includes(candidate)) return candidate
  }
  return 'DURABLE'
}
