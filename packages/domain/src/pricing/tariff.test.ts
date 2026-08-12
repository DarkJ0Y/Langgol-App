/**
 * Tariff tests.
 *
 * The worked examples in docs/04_MARKETPLACE.md §7 are the specification for this module. Every
 * figure asserted here is traced to a table in that document, so a change to the engine that
 * silently moves a published number fails the build.
 */

import { describe, expect, it } from 'vitest'
import * as Money from '../money/money.js'
import { PricingError } from './errors.js'
import { chargeableWeightMilligrams, computeTariff, selectBand } from './tariff.js'
import type { TariffConfig } from './tariff.js'

const KG = 1000000n

const TARIFF: TariffConfig = {
  currency: 'BDT',
  provisional: true,
  bands: [
    { maxChargeableKg: 5, baseFeePoisha: 4000, includedKm: 5, perKmPoisha: 800 },
    { maxChargeableKg: 20, baseFeePoisha: 7000, includedKm: 5, perKmPoisha: 1000 },
    { maxChargeableKg: 100, baseFeePoisha: 15000, includedKm: 5, perKmPoisha: 1400 },
    { maxChargeableKg: 500, baseFeePoisha: 45000, includedKm: 10, perKmPoisha: 2200 },
  ],
  aboveTopBand: 'OPS_QUOTE_ONLY',
}

describe('chargeableWeightMilligrams', () => {
  it('uses actual weight when no volume is known', () => {
    expect(
      chargeableWeightMilligrams({
        actualMilligrams: 5n * KG,
        volumetricDivisorCm3PerKg: 5000,
      }),
    ).toBe(5n * KG)
  })

  it('uses volumetric weight when the load is bulky — pumpkins are light and huge', () => {
    // 50,000 cm³ / 5000 = 10 kg volumetric, against 4 kg actual.
    expect(
      chargeableWeightMilligrams({
        actualMilligrams: 4n * KG,
        volumeCm3: 50000,
        volumetricDivisorCm3PerKg: 5000,
      }),
    ).toBe(10n * KG)
  })

  it('keeps actual weight when it exceeds volumetric', () => {
    expect(
      chargeableWeightMilligrams({
        actualMilligrams: 40n * KG,
        volumeCm3: 50000,
        volumetricDivisorCm3PerKg: 5000,
      }),
    ).toBe(40n * KG)
  })

  it('rejects a negative weight', () => {
    expect(() =>
      chargeableWeightMilligrams({ actualMilligrams: -1n, volumetricDivisorCm3PerKg: 5000 }),
    ).toThrow(PricingError)
  })
})

describe('selectBand', () => {
  it('selects the first band whose ceiling the weight does not exceed', () => {
    expect(selectBand(1n * KG, TARIFF).band.maxChargeableKg).toBe(5)
    expect(selectBand(5n * KG, TARIFF).band.maxChargeableKg).toBe(5)
    expect(selectBand(6n * KG, TARIFF).band.maxChargeableKg).toBe(20)
    expect(selectBand(100n * KG, TARIFF).band.maxChargeableKg).toBe(100)
    expect(selectBand(500n * KG, TARIFF).band.maxChargeableKg).toBe(500)
  })

  it('refuses to price above the top band — ops must quote it by hand', () => {
    expect(() => selectBand(501n * KG, TARIFF)).toThrow(
      expect.objectContaining({ code: 'OPS_QUOTE_ONLY' }),
    )
  })

  it('reports a misconfigured tariff rather than guessing', () => {
    expect(() => selectBand(1n * KG, { ...TARIFF, bands: [] })).toThrow(
      expect.objectContaining({ code: 'NO_TARIFF_BAND' }),
    )
  })
})

describe('computeTariff — docs/04_MARKETPLACE.md §7 worked examples', () => {
  it('§7.1 consumer, 5 kg at 12 km: 40 + 7×8 = ৳96.00', () => {
    const quote = computeTariff(5n * KG, 12000, TARIFF)
    expect(Money.toTakaString(quote.tariffPoisha)).toBe('96.00')
    expect(quote.chargeableDistanceMeters).toBe(7000)
  })

  it('§7.1 distant farmer, 5 kg at 120 km: 40 + 115×8 = ৳960.00', () => {
    expect(Money.toTakaString(computeTariff(5n * KG, 120000, TARIFF).tariffPoisha)).toBe('960.00')
  })

  it('§7.2 retailer, 100 kg at 12 km: 150 + 7×14 = ৳248.00', () => {
    expect(Money.toTakaString(computeTariff(100n * KG, 12000, TARIFF).tariffPoisha)).toBe('248.00')
  })

  it('§7.3 institutional, 500 kg at 12 km: 450 + 2×22 = ৳494.00', () => {
    expect(Money.toTakaString(computeTariff(500n * KG, 12000, TARIFF).tariffPoisha)).toBe('494.00')
  })

  it('§7.3 institutional, 500 kg at 120 km: 450 + 110×22 = ৳2,870.00', () => {
    expect(Money.toTakaString(computeTariff(500n * KG, 120000, TARIFF).tariffPoisha)).toBe(
      '2870.00',
    )
  })

  /*
   * docs/04 §7.2 prints ৳2,870.00 for Farmer B at 100 kg, which is the §7.3 figure for 500 kg
   * repeated. At 100 kg the load sits in the 20–100 kg band, not the 100–500 kg band, so the
   * correct figure is 150 + 115×14 = ৳1,760.00. The engine is self-consistent with §7.1,
   * §7.2 Farmer A and §7.3; the document has a copy-paste error. Recorded in CHANGELOG.md.
   */
  it('§7.2 distant farmer, 100 kg at 120 km: 150 + 115×14 = ৳1,760.00 (doc erratum)', () => {
    expect(Money.toTakaString(computeTariff(100n * KG, 120000, TARIFF).tariffPoisha)).toBe(
      '1760.00',
    )
  })

  it('charges nothing for distance inside the included radius', () => {
    const quote = computeTariff(5n * KG, 3000, TARIFF)
    expect(Money.toTakaString(quote.tariffPoisha)).toBe('40.00')
    expect(quote.chargeableDistanceMeters).toBe(0)
  })

  it('charges a partial kilometre pro-rata rather than rounding up to a whole km', () => {
    // 5 km included + 500 m chargeable at ৳8/km = ৳4.00 on top of the ৳40 base.
    expect(Money.toTakaString(computeTariff(5n * KG, 5500, TARIFF).tariffPoisha)).toBe('44.00')
  })

  it('rejects a non-integer metre distance rather than silently rounding money', () => {
    expect(() => computeTariff(5n * KG, 12000.5, TARIFF)).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })
})
