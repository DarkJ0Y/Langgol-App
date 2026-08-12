/**
 * Breakdown serialisation.
 *
 * Money is a `bigint` and `bigint` has no JSON representation, so every amount crosses a process
 * boundary — the API response, the `order_quotes.breakdown` column — as a **decimal string**.
 * `Number()` would silently lose precision above 2^53 and is never used on money.
 *
 * The serialised shape is the buyer-facing contract and the stored audit record at once: it is
 * what the web app renders and what an auditor reads three years later to reproduce a price.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §2; docs/04_MARKETPLACE.md §6
 */

import * as Money from '../money/money.js'
import type { Breakdown } from './breakdown.js'

export interface SerializedLine {
  readonly listingId: string
  readonly productId: string
  readonly unitPricePoisha: string
  readonly saleUnitInBaseUnits: string
  readonly quantityBase: string
  readonly lineTotalPoisha: string
}

/** What the buyer is entitled to see: real amounts, no fictional "was ৳X, now free". */
export interface SerializedBuyerBreakdown {
  readonly subtotalPoisha: string
  readonly deliveryFeePoisha: string
  readonly handlingFeePoisha: string
  readonly platformFeePoisha: string
  readonly buyerTotalPoisha: string
  readonly deliveredPricePerKgPoisha: string | null
}

/** What the farmer sees — their own side only. They never see the buyer's delivery charge. */
export interface SerializedSellerBreakdown {
  readonly sellerGrossPoisha: string
  readonly commissionPoisha: string
  readonly commissionBps: number
  readonly sellerFundedDeliveryPoisha: string
  readonly sellerNetPoisha: string
}

/** Never rendered to either party. Persisted for calibration and margin reporting. */
export interface SerializedInternalBreakdown {
  readonly tripCostPoisha: string
  readonly allocationShareNumerator: string
  readonly allocationShareDenominator: string
  readonly transportPoisha: string
  readonly spoilagePoisha: string
  readonly paymentPoisha: string
  readonly packagingPoisha: string
  readonly agentTimePoisha: string
  readonly totalCostPoisha: string
  readonly revenuePoisha: string
  readonly contributionMarginPoisha: string
  readonly marginIsNegative: boolean
}

export interface SerializedBreakdown {
  readonly pricingVersion: string
  readonly configVersions: Readonly<Record<string, number>>
  readonly fulfilmentMode: string
  readonly distanceMeters: number
  readonly chargeableMilligrams: string
  readonly actualMilligrams: string
  readonly lines: readonly SerializedLine[]
  readonly tariff: {
    readonly tariffPoisha: string
    readonly baseFeePoisha: string
    readonly distanceFeePoisha: string
    readonly chargeableDistanceMeters: number
    readonly bandIndex: number
  } | null
  readonly funding: {
    readonly model: string
    readonly tariffPoisha: string
    readonly chargedToBuyerPoisha: string
    readonly fundedBySellerPoisha: string
    readonly fundedByRetailerPoisha: string
    readonly promotionalSubsidyPoisha: string
    readonly subsidyReason: string | null
  }
  readonly buyer: SerializedBuyerBreakdown
  readonly seller: SerializedSellerBreakdown
  readonly internal: SerializedInternalBreakdown
}

export function serializeBreakdown(breakdown: Breakdown): SerializedBreakdown {
  const { buyer, seller, internal, funding, tariff } = breakdown

  return {
    pricingVersion: breakdown.pricingVersion,
    configVersions: breakdown.configVersions,
    fulfilmentMode: breakdown.fulfilmentMode,
    distanceMeters: breakdown.roadMeters,
    chargeableMilligrams: breakdown.chargeableMilligrams.toString(),
    actualMilligrams: breakdown.actualMilligrams.toString(),

    lines: breakdown.lines.map((line) => ({
      listingId: line.listingId,
      productId: line.productId,
      unitPricePoisha: Money.serialize(line.unitPricePoisha),
      saleUnitInBaseUnits: line.saleUnitInBaseUnits.toString(),
      quantityBase: line.quantityBase.toString(),
      lineTotalPoisha: Money.serialize(line.lineTotalPoisha),
    })),

    tariff: tariff
      ? {
          tariffPoisha: Money.serialize(tariff.tariffPoisha),
          baseFeePoisha: Money.serialize(tariff.baseFeePoisha),
          distanceFeePoisha: Money.serialize(tariff.distanceFeePoisha),
          chargeableDistanceMeters: tariff.chargeableDistanceMeters,
          bandIndex: tariff.bandIndex,
        }
      : null,

    funding: {
      model: funding.model,
      tariffPoisha: Money.serialize(funding.tariffPoisha),
      chargedToBuyerPoisha: Money.serialize(funding.chargedToBuyerPoisha),
      fundedBySellerPoisha: Money.serialize(funding.fundedBySellerPoisha),
      fundedByRetailerPoisha: Money.serialize(funding.fundedByRetailerPoisha),
      promotionalSubsidyPoisha: Money.serialize(funding.promotionalSubsidyPoisha),
      subsidyReason: funding.subsidyReason,
    },

    buyer: {
      subtotalPoisha: Money.serialize(buyer.subtotalPoisha),
      deliveryFeePoisha: Money.serialize(buyer.deliveryFeePoisha),
      handlingFeePoisha: Money.serialize(buyer.handlingFeePoisha),
      platformFeePoisha: Money.serialize(buyer.platformFeePoisha),
      buyerTotalPoisha: Money.serialize(buyer.buyerTotalPoisha),
      deliveredPricePerKgPoisha:
        buyer.deliveredPricePerKgPoisha === null
          ? null
          : Money.serialize(buyer.deliveredPricePerKgPoisha),
    },

    seller: {
      sellerGrossPoisha: Money.serialize(seller.sellerGrossPoisha),
      commissionPoisha: Money.serialize(seller.commissionPoisha),
      commissionBps: seller.commissionBps,
      sellerFundedDeliveryPoisha: Money.serialize(seller.sellerFundedDeliveryPoisha),
      sellerNetPoisha: Money.serialize(seller.sellerNetPoisha),
    },

    internal: {
      tripCostPoisha: Money.serialize(internal.tripCostPoisha),
      allocationShareNumerator: internal.allocationShareNumerator,
      allocationShareDenominator: internal.allocationShareDenominator,
      transportPoisha: Money.serialize(internal.cost.transportPoisha),
      spoilagePoisha: Money.serialize(internal.cost.spoilagePoisha),
      paymentPoisha: Money.serialize(internal.cost.paymentPoisha),
      packagingPoisha: Money.serialize(internal.cost.packagingPoisha),
      agentTimePoisha: Money.serialize(internal.cost.agentTimePoisha),
      totalCostPoisha: Money.serialize(internal.cost.totalPoisha),
      revenuePoisha: Money.serialize(internal.margin.revenuePoisha),
      contributionMarginPoisha: Money.serialize(internal.margin.marginPoisha),
      marginIsNegative: internal.margin.isNegative,
    },
  }
}

/**
 * Strip the internal block for anything the buyer's browser can see.
 *
 * Contribution margin, trip cost and spoilage assumptions are Langgol's own numbers. Shipping
 * them to a client would leak the platform's cost base to every competitor with dev tools.
 */
export function toBuyerFacing(
  serialized: SerializedBreakdown,
): Omit<SerializedBreakdown, 'internal' | 'seller'> {
  const { internal: _internal, seller: _seller, ...buyerFacing } = serialized
  return buyerFacing
}
