/**
 * Consent form parsing tests.
 *
 * An unchecked checkbox posts nothing. If the parser only read what arrived, withdrawing a
 * permission would look identical to not having submitted it, and pressing "save" after
 * unticking marketing would silently leave it granted. That is the "never silently enable"
 * requirement failing in the direction nobody thinks to test.
 */

import { describe, expect, it } from 'vitest'
import { CONSENT_FIELD_PREFIX, readConsentForm } from './form'

/** What the browser actually sends: the declared list, plus only the ticked boxes. */
function formData(declared: readonly string[], ticked: readonly string[]): FormData {
  const data = new FormData()
  data.append('types', declared.join(','))
  for (const type of ticked) data.append(`${CONSENT_FIELD_PREFIX}${type}`, 'on')
  return data
}

describe('every declared permission gets an answer', () => {
  it('reads a ticked box as granted', () => {
    const { answers } = readConsentForm(formData(['MARKETING'], ['MARKETING']))
    expect(answers).toEqual([{ type: 'MARKETING', granted: true }])
  })

  it('reads an unticked box as an explicit refusal, not as silence', () => {
    /*
     * The regression this file exists for. An unchecked checkbox posts nothing at all, so a
     * parser that trusted the payload would return no answer and the permission would keep its
     * previous value — the user unticks marketing, presses save, and stays subscribed.
     */
    const { answers } = readConsentForm(formData(['MARKETING'], []))
    expect(answers).toEqual([{ type: 'MARKETING', granted: false }])
  })

  it('answers every declared permission, not only the ticked ones', () => {
    const declared = ['MARKETING', 'LOCATION', 'FARM_DATA']
    const { answers } = readConsentForm(formData(declared, ['LOCATION']))

    expect(answers).toHaveLength(3)
    expect(answers).toEqual([
      { type: 'MARKETING', granted: false },
      { type: 'LOCATION', granted: true },
      { type: 'FARM_DATA', granted: false },
    ])
  })

  it('keeps a mixed submission mixed', () => {
    const declared = ['MARKETING', 'LOCATION', 'FARM_DATA', 'PERSONALIZATION']
    const { answers } = readConsentForm(formData(declared, ['MARKETING', 'FARM_DATA']))

    expect(answers.filter((a) => a.granted).map((a) => a.type)).toEqual(['MARKETING', 'FARM_DATA'])
    expect(answers.filter((a) => !a.granted).map((a) => a.type)).toEqual([
      'LOCATION',
      'PERSONALIZATION',
    ])
  })
})

describe('malformed submissions', () => {
  it('answers nothing when nothing was declared', () => {
    // Not an error, and not an excuse to invent answers for every permission that exists.
    expect(readConsentForm(new FormData()).answers).toEqual([])
    expect(readConsentForm(formData([], [])).answers).toEqual([])
  })

  it('ignores blank entries and stray whitespace in the declaration', () => {
    const data = new FormData()
    data.append('types', ' MARKETING , , LOCATION ')
    const { answers } = readConsentForm(data)
    expect(answers.map((a) => a.type)).toEqual(['MARKETING', 'LOCATION'])
  })

  it('does not produce two contradictory answers for a repeated declaration', () => {
    const data = new FormData()
    data.append('types', 'MARKETING,MARKETING')
    data.append(`${CONSENT_FIELD_PREFIX}MARKETING`, 'on')
    const { answers } = readConsentForm(data)
    expect(answers).toEqual([{ type: 'MARKETING', granted: true }])
  })

  it('passes an unknown type through for the use case to reject', () => {
    /*
     * Deliberately not filtered here. The use case owns the vocabulary and refuses the whole
     * submission; silently dropping it in the parser would hide a client that is out of step.
     */
    const { answers } = readConsentForm(formData(['SELL_MY_DATA'], ['SELL_MY_DATA']))
    expect(answers).toEqual([{ type: 'SELL_MY_DATA', granted: true }])
  })

  it('cannot be tricked into granting by a checkbox for an undeclared permission', () => {
    // Only what the form declared is answered, so an injected field grants nothing.
    const data = formData(['MARKETING'], ['MARKETING'])
    data.append(`${CONSENT_FIELD_PREFIX}FINANCIAL_DATA`, 'on')

    const { answers } = readConsentForm(data)
    expect(answers.map((a) => a.type)).toEqual(['MARKETING'])
  })
})
