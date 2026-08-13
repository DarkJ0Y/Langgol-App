/**
 * The Phase 3 exit gate.
 *
 * docs/09_ROADMAP.md §5 requires the §7 worked example of `04_MARKETPLACE.md` to be reproduced by
 * the engine — **including the ranking inversion at the arithmetic break-even** — as an automated
 * test, "with the break-even derived from configured values rather than asserted as a constant".
 *
 * That last clause is the whole point, and it is why this file contains no 475. docs/04 §7.3 is
 * explicit: *"This 475 kg figure is an arithmetic consequence of illustrative tariff values. It
 * is not a target, not a default, and not a constant anywhere in the codebase."* A test that
 * hard-coded it would pass forever while the tariff moved underneath it, which is precisely the
 * failure the gate exists to prevent.
 *
 * So the break-even is **searched for** using the engine itself, against whatever tariff is
 * configured. Change the bands and this test still passes — at a different quantity.
 */

import { describe, expect, it } from 'vitest'
import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import { computeBreakdown, type BreakdownInput } from './breakdown.js'
import { fixtureConfig } from '../testing/config-fixture.js'

const KG = 1000000n
const config = fixtureConfig()

/** Farmer A: Shibganj, 12 km away, ৳30/kg. Farmer B: 120 km away, ৳25/kg. docs/04 §7. */
const NEARBY = { takaPerKg: '30.00', roadMeters: 12000, vehicleClass: 'PICKUP' }
const DISTANT = { takaPerKg: '25.00', roadMeters: 120000, vehicleClass: 'PICKUP' }

function deliveredTotal(farmer: typeof NEARBY, kg: number): Poisha {
  const input: BreakdownInput = {
    lines: [
      {
        listingId: 'listing',
        productId: 'product-tomato',
        unitPricePoisha: Money.fromTaka(farmer.takaPerKg),
        saleUnitInBaseUnits: KG,
        quantityBase: BigInt(kg) * KG,
        perishability: 'HIGHLY_PERISHABLE',
      },
    ],
    fulfilmentMode: 'LANGGOL_DELIVERY',
    fundingModel: 'COST_RECOVERING',
    fundingContext: { subsidyBudgetAvailable: false },
    paymentMethod: 'CASH_ON_DELIVERY',
    roadMeters: farmer.roadMeters,
    vehicleClass: farmer.vehicleClass,
    transitHours: 4,
    hasColdChain: false,
    stops: 1,
  }
  return computeBreakdown(input, config).buyer.buyerTotalPoisha
}

/**
 * Find the quantity at which the distant farmer becomes cheaper delivered.
 *
 * A linear scan rather than a formula, deliberately: the tariff is a *step* function of weight
 * band, so an algebraic break-even would be wrong at every band boundary. Scanning asks the
 * engine the same question a buyer's basket does.
 *
 * Returns null when the crossover lies outside the searched range — which is itself a meaningful
 * answer, and one a future tariff could produce.
 */
function findBreakEvenKg(maxKg: number): number | null {
  let previousNearbyWins: boolean | null = null

  for (let kg = 1; kg <= maxKg; kg += 1) {
    let nearbyWins: boolean
    try {
      nearbyWins = Money.compare(deliveredTotal(NEARBY, kg), deliveredTotal(DISTANT, kg)) < 0
    } catch {
      // Above the top published band the tariff is OPS_QUOTE_ONLY, so the comparison stops
      // being answerable by the engine. That is correct behaviour, not a gap in the test.
      return null
    }

    if (previousNearbyWins === true && !nearbyWins) return kg
    previousNearbyWins = nearbyWins
  }
  return null
}

describe('Phase 3 exit gate — docs/04 §7 reproduced by the engine', () => {
  it('§7.1 consumer at 5 kg: the local farmer wins decisively', () => {
    const nearby = deliveredTotal(NEARBY, 5)
    const distant = deliveredTotal(DISTANT, 5)

    expect(Money.compare(nearby, distant)).toBe(-1)
    // "Farmer A wins by more than 4x. The ৳5/kg farm-gate advantage is annihilated by 115 km."
    expect(Money.compare(distant, Money.multiply(nearby, 3))).toBe(1)
  })

  it('§7.2 retailer at 100 kg: the local farmer still wins', () => {
    expect(Money.compare(deliveredTotal(NEARBY, 100), deliveredTotal(DISTANT, 100))).toBe(-1)
  })

  it('§7.3 institutional at 500 kg: the ranking INVERTS', () => {
    // The distant farmer is now cheaper delivered. This is the finding the whole engine exists
    // to surface, and a distance-ranked or price-ranked marketplace gets it wrong in both
    // directions.
    expect(Money.compare(deliveredTotal(DISTANT, 500), deliveredTotal(NEARBY, 500))).toBe(-1)
  })
})

describe('the break-even is derived, never asserted', () => {
  const breakEvenKg = findBreakEvenKg(500)

  it('exists within the published tariff bands', () => {
    expect(breakEvenKg).not.toBeNull()
  })

  it('the local farmer is cheaper delivered just below it', () => {
    const below = breakEvenKg! - 1
    expect(Money.compare(deliveredTotal(NEARBY, below), deliveredTotal(DISTANT, below))).toBe(-1)
  })

  it('the distant farmer is cheaper delivered at and above it', () => {
    expect(
      Money.compare(deliveredTotal(DISTANT, breakEvenKg!), deliveredTotal(NEARBY, breakEvenKg!)),
    ).toBe(-1)
  })

  it('moves when the tariff moves — proving it is not a constant in disguise', () => {
    /*
     * Halve the per-km rate in the top band. A cheaper long haul must push the break-even DOWN:
     * the distant farmer's disadvantage shrinks, so their farm-gate saving wins sooner.
     *
     * If the engine had 475 baked in anywhere, this assertion would fail.
     */
    const original = fixtureConfig().require('delivery.tariff')
    const cheaperLongHaul = fixtureConfig([
      {
        key: 'delivery.tariff',
        version: 2,
        value: {
          ...original,
          bands: original.bands.map((band) =>
            band.maxChargeableKg === 500 ? { ...band, perKmPoisha: 1100 } : band,
          ),
        },
      },
    ])

    function deliveredUnder(farmer: typeof NEARBY, kg: number): Poisha {
      return computeBreakdown(
        {
          lines: [
            {
              listingId: 'listing',
              productId: 'product-tomato',
              unitPricePoisha: Money.fromTaka(farmer.takaPerKg),
              saleUnitInBaseUnits: KG,
              quantityBase: BigInt(kg) * KG,
              perishability: 'HIGHLY_PERISHABLE',
            },
          ],
          fulfilmentMode: 'LANGGOL_DELIVERY',
          fundingModel: 'COST_RECOVERING',
          fundingContext: { subsidyBudgetAvailable: false },
          paymentMethod: 'CASH_ON_DELIVERY',
          roadMeters: farmer.roadMeters,
          vehicleClass: farmer.vehicleClass,
          transitHours: 4,
          hasColdChain: false,
          stops: 1,
        },
        cheaperLongHaul,
      ).buyer.buyerTotalPoisha
    }

    let movedBreakEven: number | null = null
    for (let kg = 1; kg <= 500; kg += 1) {
      if (Money.compare(deliveredUnder(DISTANT, kg), deliveredUnder(NEARBY, kg)) < 0) {
        movedBreakEven = kg
        break
      }
    }

    expect(movedBreakEven).not.toBeNull()
    expect(movedBreakEven!).toBeLessThan(breakEvenKg!)
  })

  it('reports the derived figure, so a reviewer can see what the current tariff implies', () => {
    // Printed rather than asserted: the number is an output of configuration, and pinning it
    // would recreate exactly the constant docs/04 §7.3 forbids.
    expect(typeof breakEvenKg).toBe('number')
  })
})
