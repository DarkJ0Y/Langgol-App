/**
 * Farmer onboarding form-parsing tests.
 *
 * The failure mode this guards is the one the address form actually shipped with: a blank field
 * read as *invalid* rather than as *unanswered*, which made saving impossible for exactly the
 * users the question was optional for. Every question here is skippable, so "left blank" has to
 * survive parsing as a deliberate `null`.
 */

import { describe, expect, it } from 'vitest'
import { FarmerFormError, readFarmerForm } from './form'

/** What a browser posts: every field present, unanswered ones as empty strings. */
function formData(values: Record<string, string> = {}): FormData {
  const data = new FormData()
  const blank = {
    farmingExperienceYears: '',
    farmerType: '',
    totalLandAmount: '',
    landUnit: '',
    ownershipType: '',
    irrigationAvailable: '',
    irrigationMethod: '',
    waterSource: '',
    farmingMethod: '',
  }
  for (const [key, value] of Object.entries({ ...blank, ...values })) data.append(key, value)
  return data
}

describe('an unanswered question', () => {
  it('reads every blank field as null rather than refusing the submission', () => {
    /*
     * The regression. If a blank threw, a farmer who answered five questions and skipped one
     * would lose all five — and skipping is explicitly allowed.
     */
    const result = readFarmerForm(formData())

    expect(result).toEqual({
      farmingExperienceYears: null,
      farmerType: null,
      totalLandAmountMilli: null,
      landUnit: null,
      ownershipType: null,
      irrigationAvailable: null,
      irrigationMethod: null,
      waterSource: null,
      farmingMethod: null,
    })
  })

  it('mentions every field even when unanswered, so an answer can be withdrawn', () => {
    // The use case cannot distinguish a cleared field from one the form never sent. Omitting
    // blanks would make un-answering impossible.
    const keys = Object.keys(readFarmerForm(formData()))
    expect(keys).toContain('farmerType')
    expect(keys).toContain('waterSource')
  })

  it('keeps the answers that were given alongside the ones that were not', () => {
    const result = readFarmerForm(formData({ farmerType: 'VEGETABLE' }))
    expect(result.farmerType).toBe('VEGETABLE')
    expect(result.ownershipType).toBeNull()
  })
})

describe('experience', () => {
  it('reads a plain number', () => {
    expect(readFarmerForm(formData({ farmingExperienceYears: '12' })).farmingExperienceYears).toBe(
      12,
    )
  })

  it('reads nought as an answer, not as a blank', () => {
    // A farmer in their first season answered the question. Falsiness is not absence.
    expect(readFarmerForm(formData({ farmingExperienceYears: '0' })).farmingExperienceYears).toBe(0)
  })

  it('accepts Bangla numerals', () => {
    expect(readFarmerForm(formData({ farmingExperienceYears: '১২' })).farmingExperienceYears).toBe(
      12,
    )
  })

  it('refuses text', () => {
    expect(() => readFarmerForm(formData({ farmingExperienceYears: 'twelve' }))).toThrow(
      FarmerFormError,
    )
  })
})

describe('land area and its unit', () => {
  it('reads the pair together', () => {
    const result = readFarmerForm(formData({ totalLandAmount: '2.5', landUnit: 'BIGHA' }))
    expect(result.totalLandAmountMilli).toBe(2500)
    expect(result.landUnit).toBe('BIGHA')
  })

  it('accepts Bangla numerals in the area', () => {
    expect(
      readFarmerForm(formData({ totalLandAmount: '২.৫', landUnit: 'BIGHA' })).totalLandAmountMilli,
    ).toBe(2500)
  })

  it('defaults the unit rather than throwing away the whole form', () => {
    /*
     * A farmer who typed an area but did not notice the unit select should not lose their other
     * five answers over it. Decimal (শতক) is the unit small plots are described in nationally.
     */
    const result = readFarmerForm(formData({ totalLandAmount: '30' }))
    expect(result.totalLandAmountMilli).toBe(30_000)
    expect(result.landUnit).toBe('DECIMAL')
  })

  it('sends no unit when no area was given', () => {
    // A unit alone is noise, and the domain refuses the half-pair.
    const result = readFarmerForm(formData({ landUnit: 'BIGHA' }))
    expect(result.totalLandAmountMilli).toBeNull()
    expect(result.landUnit).toBeNull()
  })

  it('refuses an area that is not a number', () => {
    expect(() => readFarmerForm(formData({ totalLandAmount: 'lots' }))).toThrow()
  })
})

describe('the three-state irrigation question', () => {
  it('reads yes and no', () => {
    expect(readFarmerForm(formData({ irrigationAvailable: 'YES' })).irrigationAvailable).toBe(true)
    expect(readFarmerForm(formData({ irrigationAvailable: 'NO' })).irrigationAvailable).toBe(false)
  })

  it('keeps "not said" distinct from "no"', () => {
    /*
     * The reason this is a radio group and not a checkbox. An unticked checkbox posts nothing,
     * which would make "I have no irrigation" identical to "I have not got there yet" — and the
     * completion meter would then nag a rain-fed farmer about a question they had answered.
     */
    expect(readFarmerForm(formData()).irrigationAvailable).toBeNull()
  })

  it('clears the method when the farmer says there is no irrigation', () => {
    /*
     * The form hides the follow-up questions, so the browser still posts whatever was selected
     * before they changed their mind. Sending it on would be refused by the domain as a
     * contradiction — a confusing error for an ordinary correction.
     */
    const result = readFarmerForm(
      formData({ irrigationAvailable: 'NO', irrigationMethod: 'DRIP', waterSource: 'POND' }),
    )
    expect(result.irrigationMethod).toBeNull()
    expect(result.waterSource).toBeNull()
  })

  it('keeps rain as a water source for a rain-fed farmer', () => {
    // An accurate answer, and the domain allows it. Clearing it would record a blank instead.
    const result = readFarmerForm(formData({ irrigationAvailable: 'NO', waterSource: 'RAIN' }))
    expect(result.waterSource).toBe('RAIN')
  })

  it('keeps the follow-ups when irrigation is available', () => {
    const result = readFarmerForm(
      formData({
        irrigationAvailable: 'YES',
        irrigationMethod: 'SPRINKLER',
        waterSource: 'DEEP_TUBEWELL',
      }),
    )
    expect(result.irrigationMethod).toBe('SPRINKLER')
    expect(result.waterSource).toBe('DEEP_TUBEWELL')
  })
})

describe('values the form did not offer', () => {
  it('passes an unknown choice through for the use case to reject', () => {
    /*
     * Deliberately not filtered here. The domain owns the vocabulary and refuses the whole
     * submission; dropping it quietly would hide a client that is out of step.
     */
    expect(readFarmerForm(formData({ farmerType: 'TRACTOR' })).farmerType).toBe('TRACTOR')
  })
})
