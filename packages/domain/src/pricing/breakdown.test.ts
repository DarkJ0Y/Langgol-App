/**
 * Delivered-cost breakdown tests.
 *
 * These reproduce the buyer-facing table in docs/04_MARKETPLACE.md §6 and the worked examples in
 * §7, end to end — product, delivery, handling, buyer total, commission, farmer net and delivered
 * price per kg. If any of those published figures moves, this suite fails.
 */

import { describe, expect, it } from 'vitest'
import { ConfigError } from '../config/snapshot.js'
import * as Money from '../money/money.js'
import { computeBreakdown, computeLineTotal, PRICING_VERSION } from './breakdown.js'
import type { BreakdownInput, QuoteLineInput } from './breakdown.js'
import { fixtureConfig } from '../testing/config-fixture.js'

const KG = 1000000n

/** Tomato at ৳30.00/kg — the produce in every docs/04 §7 example. */
function tomatoLine(kg: number, takaPerKg = '30.00'): QuoteLineInput {
  return {
    listingId: `listing-${String(kg)}`,
    productId: 'product-tomato',
    unitPricePoisha: Money.fromTaka(takaPerKg),
    saleUnitInBaseUnits: KG,
    quantityBase: BigInt(kg) * KG,
    perishability: 'HIGHLY_PERISHABLE',
  }
}

function input(overrides: Partial<BreakdownInput> = {}): BreakdownInput {
  return {
    lines: [tomatoLine(5)],
    fulfilmentMode: 'LANGGOL_DELIVERY',
    fundingModel: 'COST_RECOVERING',
    fundingContext: { subsidyBudgetAvailable: false },
    paymentMethod: 'CASH_ON_DELIVERY',
    roadMeters: 12000,
    vehicleClass: 'VAN',
    transitHours: 4,
    hasColdChain: false,
    stops: 1,
    ...overrides,
  }
}

describe('computeLineTotal', () => {
  it('rounds half-up exactly once, at the line', () => {
    // ৳30.005/kg is not expressible; use a price that forces a half-poisha at the line instead.
    const line: QuoteLineInput = {
      ...tomatoLine(1),
      unitPricePoisha: Money.fromPoisha(3333n),
      quantityBase: 1500000n, // 1.5 kg
    }
    // 3333 × 1.5 = 4999.5 → 5000 (half-up, away from zero)
    expect(computeLineTotal(line)).toBe(5000n)
  })

  it('rejects a zero or negative quantity', () => {
    expect(() => computeLineTotal({ ...tomatoLine(1), quantityBase: 0n })).toThrow()
  })
})

describe('docs/04 §7.1 — consumer buying 5 kg at 12 km', () => {
  const result = computeBreakdown(input(), fixtureConfig())

  it('produces the published buyer-facing table', () => {
    expect(Money.toTakaString(result.buyer.subtotalPoisha)).toBe('150.00')
    expect(Money.toTakaString(result.buyer.deliveryFeePoisha)).toBe('96.00')
    expect(Money.toTakaString(result.buyer.handlingFeePoisha)).toBe('10.00')
    expect(Money.toTakaString(result.buyer.platformFeePoisha)).toBe('0.00')
    expect(Money.toTakaString(result.buyer.buyerTotalPoisha)).toBe('256.00')
  })

  it('reports the delivered price per kg the buyer compares on: ৳51.20', () => {
    expect(Money.toTakaString(result.buyer.deliveredPricePerKgPoisha!)).toBe('51.20')
  })

  it('produces the farmer side: 3% commission, ৳145.50 net — docs/06 §5', () => {
    expect(Money.toTakaString(result.seller.sellerGrossPoisha)).toBe('150.00')
    expect(Money.toTakaString(result.seller.commissionPoisha)).toBe('4.50')
    expect(result.seller.commissionBps).toBe(300)
    expect(Money.toTakaString(result.seller.sellerNetPoisha)).toBe('145.50')
  })

  it('books order revenue of ৳110.50 — docs/06 §6', () => {
    expect(Money.toTakaString(result.internal.margin.revenuePoisha)).toBe('110.50')
  })

  it('flags the negative contribution margin rather than hiding it', () => {
    // "That number is the MVP's central finding, and the system is built so it cannot be hidden."
    expect(result.internal.margin.isNegative).toBe(true)
    expect(Money.isNegative(result.internal.margin.marginPoisha)).toBe(true)
  })

  it('stamps the pricing version and every config version it priced under', () => {
    expect(result.pricingVersion).toBe(PRICING_VERSION)
    expect(result.configVersions['commission.bps']).toBe(1)
    expect(result.configVersions['delivery.tariff']).toBe(1)
  })
})

describe('docs/04 §7.2 — retailer buying 100 kg', () => {
  it('local farmer at 12 km delivers at ৳32.96/kg', () => {
    const result = computeBreakdown(input({ lines: [tomatoLine(100)] }), fixtureConfig())
    expect(Money.toTakaString(result.buyer.subtotalPoisha)).toBe('3000.00')
    expect(Money.toTakaString(result.buyer.deliveryFeePoisha)).toBe('248.00')
    expect(Money.toTakaString(result.buyer.handlingFeePoisha)).toBe('48.00')
    // Delivered economics get close to farm-gate price as the basket grows — the §7.2 finding.
    // The document prints ৳32.98 using an illustrative ৳50 handling fee; the seeded provisional
    // handling schedule gives ৳48.00, hence ৳32.96. The finding is unchanged.
    expect(Money.toTakaString(result.buyer.deliveredPricePerKgPoisha!)).toBe('32.96')
  })

  it('distant farmer at 120 km is beaten decisively', () => {
    const local = computeBreakdown(input({ lines: [tomatoLine(100)] }), fixtureConfig())
    const distant = computeBreakdown(
      input({ lines: [tomatoLine(100, '25.00')], roadMeters: 120000 }),
      fixtureConfig(),
    )
    expect(Money.compare(distant.buyer.buyerTotalPoisha, local.buyer.buyerTotalPoisha)).toBe(1)
  })
})

describe('docs/04 §7.3 — the ranking inverts at institutional volume', () => {
  it('the distant farmer becomes cheaper delivered at 500 kg', () => {
    const local = computeBreakdown(
      input({ lines: [tomatoLine(500)], vehicleClass: 'PICKUP' }),
      fixtureConfig(),
    )
    const distant = computeBreakdown(
      input({ lines: [tomatoLine(500, '25.00')], roadMeters: 120000, vehicleClass: 'PICKUP' }),
      fixtureConfig(),
    )

    // ৳5/kg farm-gate advantage × 500 kg = ৳2,500 against ৳2,376 of extra transport.
    // Local:   ৳15,000 product + ৳494 delivery + ৳208 handling
    // Distant: ৳12,500 product + ৳2,870 delivery + ৳208 handling
    expect(Money.toTakaString(local.buyer.buyerTotalPoisha)).toBe('15702.00')
    expect(Money.toTakaString(distant.buyer.buyerTotalPoisha)).toBe('15578.00')
    expect(Money.compare(distant.buyer.buyerTotalPoisha, local.buyer.buyerTotalPoisha)).toBe(-1)
  })
})

describe('money invariants that the database also enforces', () => {
  const result = computeBreakdown(input(), fixtureConfig())

  it('buyerTotal = subtotal + delivery + handling + platformFee', () => {
    expect(
      Money.sum([
        result.buyer.subtotalPoisha,
        result.buyer.deliveryFeePoisha,
        result.buyer.handlingFeePoisha,
        result.buyer.platformFeePoisha,
      ]),
    ).toBe(result.buyer.buyerTotalPoisha)
  })

  it('sellerNet = sellerGross − commission − sellerFundedDelivery', () => {
    expect(
      Money.subtract(
        Money.subtract(result.seller.sellerGrossPoisha, result.seller.commissionPoisha),
        result.seller.sellerFundedDeliveryPoisha,
      ),
    ).toBe(result.seller.sellerNetPoisha)
  })

  it('every buyer-facing amount is a non-negative integer bigint', () => {
    for (const amount of [
      result.buyer.subtotalPoisha,
      result.buyer.deliveryFeePoisha,
      result.buyer.handlingFeePoisha,
      result.buyer.platformFeePoisha,
      result.buyer.buyerTotalPoisha,
    ]) {
      expect(typeof amount).toBe('bigint')
      expect(amount >= 0n).toBe(true)
    }
  })
})

describe('PlatformConfig is the single source of business rates', () => {
  it('refuses to price when the commission rate is an open decision', () => {
    const config = fixtureConfig([{ key: 'commission.bps', version: 2, value: null }])
    expect(() => computeBreakdown(input(), config)).toThrow(ConfigError)
  })

  it('refuses to price when the tariff is unset rather than assuming one', () => {
    const config = fixtureConfig([{ key: 'delivery.tariff', version: 2, value: null }])
    expect(() => computeBreakdown(input(), config)).toThrow(
      expect.objectContaining({ code: 'NOT_SET' }),
    )
  })

  it('re-prices from config alone: doubling the commission doubles what is deducted', () => {
    const dearer = computeBreakdown(
      input(),
      fixtureConfig([{ key: 'commission.bps', version: 7, value: 600 }]),
    )
    expect(Money.toTakaString(dearer.seller.commissionPoisha)).toBe('9.00')
    expect(dearer.seller.commissionBps).toBe(600)
    expect(dearer.configVersions['commission.bps']).toBe(7)
  })
})

describe('fulfilment modes', () => {
  it('BUYER_PICKUP charges no delivery and costs Langgol no transport', () => {
    const result = computeBreakdown(
      input({ fulfilmentMode: 'BUYER_PICKUP', roadMeters: 0 }),
      fixtureConfig(),
    )
    expect(Money.isZero(result.buyer.deliveryFeePoisha)).toBe(true)
    expect(result.tariff).toBeNull()
    expect(Money.isZero(result.internal.cost.transportPoisha)).toBe(true)
  })

  it('SELLER_DELIVERY charges the tariff but costs Langgol no transport', () => {
    const result = computeBreakdown(
      input({
        fulfilmentMode: 'SELLER_DELIVERY',
        fundingModel: 'SELLER_FUNDED',
        fundingContext: { subsidyBudgetAvailable: false, sellerOffersFundedDelivery: true },
      }),
      fixtureConfig(),
    )
    expect(Money.isZero(result.internal.cost.transportPoisha)).toBe(true)
    expect(Money.toTakaString(result.seller.sellerFundedDeliveryPoisha)).toBe('96.00')
    // The farmer funding delivery must show up as a real deduction, never a spurious gain.
    expect(Money.toTakaString(result.seller.sellerNetPoisha)).toBe('49.50')
  })
})

describe('pooling is credited only when observed', () => {
  it('a solo dispatch carries the whole trip cost', () => {
    const solo = computeBreakdown(input(), fixtureConfig())
    expect(solo.internal.cost.transportPoisha).toBe(solo.internal.tripCostPoisha)
  })

  it('an observed pooled trip reduces this order-s allocated share', () => {
    const pooled = computeBreakdown(
      input({ expectedLoadedMilligrams: 50n * KG, stops: 6 }),
      fixtureConfig(),
    )
    const solo = computeBreakdown(input(), fixtureConfig())
    expect(
      Money.compare(pooled.internal.cost.transportPoisha, solo.internal.cost.transportPoisha),
    ).toBe(-1)
  })
})
