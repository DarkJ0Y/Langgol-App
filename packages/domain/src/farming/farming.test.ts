/**
 * Farming vocabulary, land conversion and profile-consistency tests.
 *
 * The cases worth having here are the ones where "obviously correct" code is wrong:
 *
 *  - a farmer typing Bangla numerals into a Bangla-first form,
 *  - "no irrigation" combined with an irrigation method, which is not missing data but
 *    contradictory data, and must be refused rather than stored,
 *  - a two-step edit reaching a state neither step could reach on its own,
 *  - and "no irrigation" counting as an ANSWER on the completion meter rather than a gap.
 */

import { describe, expect, it } from 'vitest'
import {
  FARMER_TYPES,
  FARMING_METHODS,
  IRRIGATION_METHODS,
  LAND_OWNERSHIP_TYPES,
  LAND_UNITS,
  WATER_SOURCES,
  isFarmerType,
  isLandUnit,
} from './catalogue.js'
import {
  LAND_AMOUNT_SCALE,
  LandError,
  formatLandAmount,
  parseLandAmount,
  toDecimals,
  toMilliDecimals,
} from './land.js'
import {
  EMPTY_FARMING_FIELDS,
  MAX_EXPERIENCE_YEARS,
  ONBOARDING_STEPS,
  FarmingProfileError,
  farmingCompletion,
  validateFarmingUpdate,
  type FarmingFields,
} from './profile.js'

const base = (over: Partial<FarmingFields> = {}): FarmingFields => ({
  ...EMPTY_FARMING_FIELDS,
  ...over,
})

describe('the vocabularies are closed lists', () => {
  it('has no duplicate members', () => {
    for (const list of [
      FARMER_TYPES,
      LAND_UNITS,
      LAND_OWNERSHIP_TYPES,
      IRRIGATION_METHODS,
      WATER_SOURCES,
      FARMING_METHODS,
    ]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('recognises its own members and nothing else', () => {
    expect(isFarmerType('VEGETABLE')).toBe(true)
    expect(isFarmerType('vegetable')).toBe(false)
    expect(isFarmerType('TRACTOR')).toBe(false)
    expect(isLandUnit('BIGHA')).toBe(true)
    expect(isLandUnit(null)).toBe(false)
  })

  it('offers MIXED wherever a smallholder would need it', () => {
    // The Bangladeshi norm is rice plus a vegetable plot plus a few birds. A vocabulary without
    // MIXED forces most farmers to describe themselves wrongly.
    expect(FARMER_TYPES).toContain('MIXED')
    expect(LAND_OWNERSHIP_TYPES).toContain('MIXED')
    expect(FARMING_METHODS).toContain('MIXED')
  })

  it('keeps sharecropping distinct from leasing', () => {
    // বর্গা is not a lease: the sharecropper does not control the crop and usually cannot pledge
    // it. Advisory and credit features must be able to tell them apart.
    expect(LAND_OWNERSHIP_TYPES).toContain('SHARECROPPED')
    expect(LAND_OWNERSHIP_TYPES).toContain('LEASED')
  })
})

describe('land conversion', () => {
  it('treats a decimal as the canonical unit', () => {
    expect(toDecimals(1 * LAND_AMOUNT_SCALE, 'DECIMAL')).toBe(1)
  })

  it('converts the units a farmer actually speaks', () => {
    // Dhaka convention: 1 bigha = 20 katha = 33 decimals; 1 acre = 100 decimals.
    expect(toDecimals(1 * LAND_AMOUNT_SCALE, 'BIGHA')).toBe(33)
    expect(toDecimals(1 * LAND_AMOUNT_SCALE, 'ACRE')).toBe(100)
    expect(toDecimals(20 * LAND_AMOUNT_SCALE, 'KATHA')).toBe(33)
    expect(toDecimals(1 * LAND_AMOUNT_SCALE, 'HECTARE')).toBe(247)
  })

  it('handles a fractional answer without floating point drift', () => {
    // "আড়াই বিঘা" — two and a half bigha — is an ordinary answer, not an edge case.
    expect(toMilliDecimals(2500, 'BIGHA')).toBe(82_500)
    expect(toDecimals(2500, 'BIGHA')).toBe(83)
  })

  it('is exact when summed, which a float would not be', () => {
    // Ten farmers with 0.1 acre each. In floats this is the canonical 0.9999999 case.
    const total = Array.from({ length: 10 }, () => toMilliDecimals(100, 'ACRE')).reduce(
      (a, b) => a + b,
      0,
    )
    expect(total).toBe(toMilliDecimals(1 * LAND_AMOUNT_SCALE, 'ACRE'))
  })
})

describe('reading what the farmer typed', () => {
  it('accepts whole and fractional numbers', () => {
    expect(parseLandAmount('2')).toBe(2000)
    expect(parseLandAmount('2.5')).toBe(2500)
    expect(parseLandAmount('0.25')).toBe(250)
  })

  it('accepts Bangla numerals', () => {
    /*
     * The case a Bangla-first product must not get wrong. A farmer using the Bangla keyboard the
     * interface encouraged them to use would otherwise be told their own numerals are invalid.
     */
    expect(parseLandAmount('২')).toBe(2000)
    expect(parseLandAmount('২.৫')).toBe(2500)
    expect(parseLandAmount('১০')).toBe(10_000)
  })

  it('reads blank as "did not say", not as an error', () => {
    // Leaving the land question empty is allowed. It must not block the rest of the form.
    expect(parseLandAmount('')).toBeNull()
    expect(parseLandAmount('   ')).toBeNull()
  })

  it('refuses text, negatives and zero', () => {
    expect(() => parseLandAmount('two bigha')).toThrow(LandError)
    expect(() => parseLandAmount('-5')).toThrow(LandError)
    expect(() => parseLandAmount('0')).toThrow(LandError)
  })

  it('round-trips through the display format', () => {
    for (const typed of ['2', '2.5', '0.25', '10']) {
      expect(formatLandAmount(parseLandAmount(typed) ?? 0)).toBe(typed)
    }
  })
})

describe('validating an update', () => {
  it('accepts a complete, coherent answer', () => {
    const changes = validateFarmingUpdate(
      {
        farmingExperienceYears: 12,
        farmerType: 'VEGETABLE',
        totalLandAmountMilli: 2500,
        landUnit: 'BIGHA',
        ownershipType: 'OWNED',
        irrigationAvailable: true,
        irrigationMethod: 'FURROW',
        waterSource: 'SHALLOW_TUBEWELL',
        farmingMethod: 'CONVENTIONAL',
      },
      base(),
    )
    expect(changes.farmerType).toBe('VEGETABLE')
    expect(changes.totalLandAmountMilli).toBe(2500)
  })

  it('leaves absent fields alone and clears explicit nulls', () => {
    // The distinction PATCH depends on. Absent means "not mentioned", null means "erase this".
    const changes = validateFarmingUpdate(
      { farmerType: null },
      base({ farmerType: 'CROP', farmingExperienceYears: 5 }),
    )
    expect(changes).toEqual({ farmerType: null })
    expect('farmingExperienceYears' in changes).toBe(false)
  })

  it('refuses a value outside the vocabulary', () => {
    expect(() => validateFarmingUpdate({ farmerType: 'TRACTOR' }, base())).toThrow(
      FarmingProfileError,
    )
    expect(() => validateFarmingUpdate({ landUnit: 'SQUARE_MILE' }, base())).toThrow(
      FarmingProfileError,
    )
  })

  it('allows nought years, because a new farmer is a farmer', () => {
    expect(validateFarmingUpdate({ farmingExperienceYears: 0 }, base())).toEqual({
      farmingExperienceYears: 0,
    })
  })

  it('refuses negative, fractional and implausible experience', () => {
    for (const years of [-1, 1.5, MAX_EXPERIENCE_YEARS + 1, 1975]) {
      expect(() => validateFarmingUpdate({ farmingExperienceYears: years }, base())).toThrow(
        FarmingProfileError,
      )
    }
  })

  it('refuses an area without a unit, or a unit without an area', () => {
    expect(() => validateFarmingUpdate({ totalLandAmountMilli: 2000 }, base())).toThrow(
      FarmingProfileError,
    )
    expect(() => validateFarmingUpdate({ landUnit: 'BIGHA' }, base())).toThrow(FarmingProfileError)
  })

  it('refuses an area that has to be a slipped decimal point', () => {
    // 5000 acres is not a Bangladeshi smallholding; it is a typo that would poison every average
    // computed over this column.
    expect(() =>
      validateFarmingUpdate(
        { totalLandAmountMilli: 5000 * LAND_AMOUNT_SCALE, landUnit: 'ACRE' },
        base(),
      ),
    ).toThrow(FarmingProfileError)
  })

  it('refuses an irrigation method when there is no irrigation', () => {
    /*
     * Not missing data — contradictory data. Storing it would corrupt every rule that reads the
     * pair, and no amount of downstream defensiveness recovers the farmer's actual answer.
     */
    expect(() =>
      validateFarmingUpdate({ irrigationAvailable: false, irrigationMethod: 'DRIP' }, base()),
    ).toThrow(FarmingProfileError)
  })

  it('catches the contradiction across two separate edits', () => {
    /*
     * The reason validation takes `current` rather than only the submission. Saving the method
     * first and switching irrigation off afterwards reaches, in two legal-looking steps, a state
     * neither step could reach directly.
     */
    const stored = base({ irrigationAvailable: true, irrigationMethod: 'DRIP' })
    expect(() => validateFarmingUpdate({ irrigationAvailable: false }, stored)).toThrow(
      FarmingProfileError,
    )
  })

  it('lets a farmer switch irrigation off if they clear the method too', () => {
    expect(
      validateFarmingUpdate(
        { irrigationAvailable: false, irrigationMethod: null, waterSource: null },
        base({ irrigationAvailable: true, irrigationMethod: 'DRIP' }),
      ),
    ).toEqual({ irrigationAvailable: false, irrigationMethod: null, waterSource: null })
  })

  it('allows rain as the water source with no irrigation', () => {
    // A rain-fed farmer genuinely has a water source, and it is rain. Refusing this would force
    // an accurate answer to be recorded as a blank.
    expect(() =>
      validateFarmingUpdate({ irrigationAvailable: false, waterSource: 'RAIN' }, base()),
    ).not.toThrow()
  })

  it('refuses a tubewell as the water source with no irrigation', () => {
    expect(() =>
      validateFarmingUpdate({ irrigationAvailable: false, waterSource: 'DEEP_TUBEWELL' }, base()),
    ).toThrow(FarmingProfileError)
  })
})

describe('profile completion', () => {
  it('reports nothing answered for a new farmer', () => {
    const completion = farmingCompletion(base())
    expect(completion.percent).toBe(0)
    expect(completion.isComplete).toBe(false)
    expect(completion.missing).toEqual([...ONBOARDING_STEPS])
  })

  it('counts "no irrigation" as an answer, not as a gap', () => {
    /*
     * The regression this test exists for. Treating `false` as unanswered would nag a rain-fed
     * farmer forever about a question they have already answered correctly — and would make a
     * complete profile unreachable for them.
     */
    const completion = farmingCompletion(base({ irrigationAvailable: false }))
    expect(completion.answered).toContain('irrigationAvailable')
    expect(completion.missing).not.toContain('irrigationAvailable')
  })

  it('does not ask a rain-fed farmer for a water source', () => {
    // With no irrigation the water-source question is not applicable, so it cannot count against
    // them. Otherwise 100% would be unreachable for a whole class of farmer.
    const completion = farmingCompletion(base({ irrigationAvailable: false }))
    expect(completion.missing).not.toContain('waterSource')
  })

  it('reaches complete for a rain-fed farmer who answered everything asked of them', () => {
    const completion = farmingCompletion(
      base({
        farmingExperienceYears: 10,
        totalLandAmountMilli: 2000,
        landUnit: 'BIGHA',
        ownershipType: 'SHARECROPPED',
        irrigationAvailable: false,
        farmingMethod: 'CONVENTIONAL',
      }),
    )
    expect(completion.isComplete).toBe(true)
    expect(completion.percent).toBe(100)
  })

  it('needs both halves of the land pair before counting it', () => {
    expect(farmingCompletion(base({ totalLandAmountMilli: 2000 })).missing).toContain(
      'totalLandArea',
    )
    expect(
      farmingCompletion(base({ totalLandAmountMilli: 2000, landUnit: 'BIGHA' })).missing,
    ).not.toContain('totalLandArea')
  })

  it('counts nought years as answered', () => {
    // A brand-new farmer answering "0" has answered. Falsiness is not absence.
    expect(farmingCompletion(base({ farmingExperienceYears: 0 })).answered).toContain(
      'farmingExperienceYears',
    )
  })
})
