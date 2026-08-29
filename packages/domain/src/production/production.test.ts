/**
 * Production history tests.
 *
 * Two properties carry most of the weight here, and both are about honesty rather than
 * correctness in the ordinary sense:
 *
 *  - **Revenue is derived.** A farmer states what they sold and what they were paid; the product
 *    is computed. A record whose stored revenue disagrees with its inputs is unfalsifiable a
 *    season later, and the credit scoring this table is meant to feed would be scoring a typo.
 *  - **Nothing is invented.** Absent data stays absent. A farmer with no recorded revenue gets
 *    `null`, not `0` — because "sold nothing" and "sold for nothing" are different facts, and a
 *    forecast built on fabricated zeroes is worse than one built on less data.
 */

import { describe, expect, it } from 'vitest'
import { Money } from '../money/index.js'
import {
  EARLIEST_PRODUCTION_YEAR,
  SEASONS,
  ProductionError,
  computeMarginPoisha,
  computeRevenuePoisha,
  computeYieldPerDecimalMilli,
  isSeason,
  summarise,
  validateProduction,
  type ProductionFields,
} from './production.js'
import type { Poisha } from '../money/index.js'

const record = (over: Partial<ProductionFields & { revenuePoisha: Poisha | null }> = {}) => ({
  season: null,
  year: null,
  cultivatedAreaMilli: null,
  cultivatedAreaUnit: null,
  productionQuantityBase: null,
  productionUnit: null,
  productionCostPoisha: null,
  sellingQuantityBase: null,
  sellingPricePoisha: null,
  harvestDate: null,
  revenuePoisha: null,
  ...over,
})

describe('the seasons a farmer actually names', () => {
  it('carries both vocabularies, because both are in daily use', () => {
    // Rice is Boro/Aus/Aman to everyone who grows it; everything else is Rabi or Kharif. Forcing
    // rice into "Kharif-2" would be tidy and would produce a form nobody recognises.
    for (const season of ['BORO', 'AUS', 'AMAN', 'RABI', 'KHARIF']) {
      expect(SEASONS).toContain(season)
    }
  })

  it('has a home for perennials that fit no season', () => {
    expect(SEASONS).toContain('YEAR_ROUND')
  })

  it('recognises its own members and nothing else', () => {
    expect(isSeason('BORO')).toBe(true)
    expect(isSeason('boro')).toBe(false)
    expect(isSeason('WINTER')).toBe(false)
  })
})

describe('revenue is computed, never taken', () => {
  it('multiplies quantity sold by the price per sale unit', () => {
    // 500 kg at ৳40/kg. Quantity is in base units (mg); price is per kg, which is what a farmer
    // says. 500_000_000 mg × 4000 poisha ÷ 1_000_000 mg-per-kg = 2_000_000 poisha = ৳20,000.
    expect(computeRevenuePoisha(500_000_000n, Money.fromPoisha(4000n), 'KG')).toBe(
      Money.fromPoisha(2_000_000n),
    )
  })

  it('uses the unit table, so a mon and a kilo cannot disagree', () => {
    // One mon is 37.324 kg, so a mon at ৳40 must be worth 37.324× a kilo at ৳40.
    const perKg = computeRevenuePoisha(37_324_000n, Money.fromPoisha(4000n), 'KG')
    const perMon = computeRevenuePoisha(37_324_000n, Money.fromPoisha(148_000n), 'MON')
    expect(perKg).toBe(Money.fromPoisha(149_296n))
    expect(perMon).toBeGreaterThan(0n)
  })

  it('handles counted goods as readily as weighed ones', () => {
    // Two dozen eggs at ৳120 a dozen.
    expect(computeRevenuePoisha(24n, Money.fromPoisha(12_000n), 'DOZEN')).toBe(
      Money.fromPoisha(24_000n),
    )
  })

  it('returns null when nothing was sold, never zero', () => {
    /*
     * The distinction the whole table depends on. Plenty of production is eaten, stored, or given
     * away; a zero would make "sold nothing" and "sold for nothing" the same row, and every
     * average over the column would quietly fall.
     */
    expect(computeRevenuePoisha(null, Money.fromPoisha(4000n), 'KG')).toBeNull()
    expect(computeRevenuePoisha(500n, null, 'KG')).toBeNull()
    expect(computeRevenuePoisha(500n, Money.fromPoisha(4000n), null)).toBeNull()
  })

  it('truncates rather than inventing fractions of a poisha', () => {
    // Poisha is the smallest unit of money there is; rounding up would create money.
    expect(computeRevenuePoisha(1n, Money.fromPoisha(1n), 'KG')).toBe(Money.fromPoisha(0n))
  })

  it('is zero when produce was given away, which is a real answer', () => {
    expect(computeRevenuePoisha(500_000_000n, Money.fromPoisha(0n), 'KG')).toBe(
      Money.fromPoisha(0n),
    )
  })
})

describe('margin', () => {
  it('is revenue less cost', () => {
    expect(computeMarginPoisha(Money.fromPoisha(2_000_000n), Money.fromPoisha(500_000n))).toBe(
      Money.fromPoisha(1_500_000n),
    )
  })

  it('may be negative, because a bad season is a real outcome', () => {
    // A credit model that never saw a loss would be a model that had not been shown farming.
    expect(computeMarginPoisha(Money.fromPoisha(100_000n), Money.fromPoisha(400_000n))).toBe(
      Money.fromPoisha(-300_000n),
    )
  })

  it('is null rather than assuming a cost the farmer never recorded', () => {
    expect(computeMarginPoisha(Money.fromPoisha(2_000_000n), null)).toBeNull()
  })
})

describe('yield per decimal', () => {
  it('is computed from quantity and area', () => {
    // 33 decimals (one bigha) producing 660 kg → 20 kg per decimal.
    const perDecimal = computeYieldPerDecimalMilli(660_000_000n, 1000, 'BIGHA')
    expect(perDecimal).toBe(20_000_000_000n)
  })

  it('makes a bigha farmer and an acre farmer comparable', () => {
    /*
     * The reason yield is expressed against the decimal rather than the farmer's own unit: two
     * farmers working the same land at the same rate must produce the same figure regardless of
     * which unit either of them thinks in.
     */
    const bigha = computeYieldPerDecimalMilli(660_000_000n, 1000, 'BIGHA') // 33 decimals
    const decimals = computeYieldPerDecimalMilli(660_000_000n, 33_000, 'DECIMAL') // 33 decimals
    expect(bigha).toBe(decimals)
  })

  it('is null without both a quantity and an area', () => {
    expect(computeYieldPerDecimalMilli(null, 1000, 'BIGHA')).toBeNull()
    expect(computeYieldPerDecimalMilli(660n, null, null)).toBeNull()
  })
})

describe('what a farmer may enter', () => {
  it('accepts a record with almost nothing in it', () => {
    // The start of a history is worth storing. Refusing it teaches farmers to enter nothing.
    expect(validateProduction({ season: 'AMAN', year: 2025 })).toEqual({
      season: 'AMAN',
      year: 2025,
    })
  })

  it('refuses a season outside the list', () => {
    expect(() => validateProduction({ season: 'MONSOON' })).toThrow(ProductionError)
  })

  it('refuses an implausible year', () => {
    expect(() => validateProduction({ year: 1990 })).toThrow(ProductionError)
    expect(() => validateProduction({ year: EARLIEST_PRODUCTION_YEAR - 1 })).toThrow(
      ProductionError,
    )
    expect(() => validateProduction({ year: new Date().getUTCFullYear() + 5 })).toThrow(
      ProductionError,
    )
  })

  it('allows next year, because Boro spans the new year', () => {
    expect(() => validateProduction({ year: new Date().getUTCFullYear() + 1 })).not.toThrow()
  })

  it('refuses negative quantities and money', () => {
    for (const input of [
      { productionQuantityBase: -1n },
      { sellingQuantityBase: -1n },
      { productionCostPoisha: -1n },
      { sellingPricePoisha: -1n },
    ]) {
      expect(() => validateProduction(input)).toThrow(ProductionError)
    }
  })

  it('allows a zero cost and a zero price', () => {
    // Seed saved from last season costs nothing, and produce is given away.
    expect(() =>
      validateProduction({ productionCostPoisha: 0n, sellingPricePoisha: 0n }),
    ).not.toThrow()
  })

  it('has no way to state a revenue at all', () => {
    /*
     * The strongest form of "farmers may not edit derived financials": the input type has no such
     * field, so there is nothing to reject. A caller that sends one finds it ignored here, and
     * overwritten by the database trigger besides.
     */
    const changes = validateProduction({
      sellingQuantityBase: 500n,
      sellingPricePoisha: 4000n,
    } as never)
    expect(Object.keys(changes)).not.toContain('revenuePoisha')
    expect(Object.keys(changes)).not.toContain('revenue')
  })
})

describe('dashboard figures come from stored rows', () => {
  it('reports nothing for a farmer with no records', () => {
    const summary = summarise([])
    expect(summary.records).toBe(0)
    expect(summary.totalRevenuePoisha).toBeNull()
    expect(summary.totalAreaMilliDecimals).toBeNull()
  })

  it('returns null rather than a fabricated zero', () => {
    /*
     * "Do not create fake analytics." A farmer who recorded a harvest but no sale has no revenue
     * — not a revenue of nought. The screen renders null as "not recorded", which is the truth.
     */
    const summary = summarise([record({ productionQuantityBase: 100n, productionUnit: 'KG' })])
    expect(summary.records).toBe(1)
    expect(summary.totalRevenuePoisha).toBeNull()
    expect(summary.totalCostPoisha).toBeNull()
  })

  it('adds areas across records, converting each from its own unit', () => {
    const summary = summarise([
      record({ cultivatedAreaMilli: 1000, cultivatedAreaUnit: 'BIGHA' }), // 33 decimals
      record({ cultivatedAreaMilli: 33_000, cultivatedAreaUnit: 'DECIMAL' }), // 33 decimals
    ])
    // 33 decimals each, expressed in MILLI-decimals: 33_000 + 33_000.
    expect(summary.totalAreaMilliDecimals).toBe(66_000n)
  })

  it('never adds incompatible units into one misleading total', () => {
    /*
     * Ten mon of rice and twelve pumpkins have no meaningful sum. Grouping by unit is the honest
     * answer; a single "total production" number would be arithmetic on nonsense.
     */
    const summary = summarise([
      record({ productionQuantityBase: 100n, productionUnit: 'KG' }),
      record({ productionQuantityBase: 12n, productionUnit: 'PIECE' }),
      record({ productionQuantityBase: 50n, productionUnit: 'KG' }),
    ])
    expect(summary.totalsByUnit.get('KG')).toBe(150n)
    expect(summary.totalsByUnit.get('PIECE')).toBe(12n)
    expect(summary.totalsByUnit.size).toBe(2)
  })

  it('sums revenue only across records that have one', () => {
    const summary = summarise([
      record({ revenuePoisha: Money.fromPoisha(2_000_000n) }),
      record({ revenuePoisha: null }),
      record({ revenuePoisha: Money.fromPoisha(500_000n) }),
    ])
    // Compared as Poisha, never through Number() — bigint precision must not touch a float.
    expect(summary.totalRevenuePoisha).toBe(Money.fromPoisha(2_500_000n))
  })

  it('counts distinct seasons rather than records', () => {
    // Two plots harvested in the same Boro season is one season of history, not two.
    const summary = summarise([
      record({ season: 'BORO', year: 2025 }),
      record({ season: 'BORO', year: 2025 }),
      record({ season: 'AMAN', year: 2025 }),
    ])
    expect(summary.records).toBe(3)
    expect(summary.seasonsRecorded).toBe(2)
  })
})
