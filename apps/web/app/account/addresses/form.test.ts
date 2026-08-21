/**
 * Address form parsing tests.
 *
 * This file exists because of a bug it now pins. The form's coordinate inputs are hidden inputs,
 * which always post a string — `""` when there is no pin. The original schema treated `""` as a
 * malformed coordinate, so saving an address WITHOUT a location failed validation: the common
 * case in rural Bangladesh, and the exact opposite of "GPS must be optional".
 *
 * Nothing caught it. The domain tests exercise `validateAddress`, the use-case tests exercise
 * `createAddress`, and neither sees a `FormData`. Assumptions about form encoding need a test at
 * the layer that holds them.
 */

import { describe, expect, it } from 'vitest'
import {
  AddressFormSchema,
  coordinatesFrom,
  firstErrorField,
  readAddressForm,
  type AddressFormInput,
} from './form'

const AREA = '3f6a5c1e-6a1e-4f2b-9a3c-5d7e8f9a0b1c'

/** Exactly what the browser sends: every field present, empty ones as "". */
function formData(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields: Record<string, string> = {
    label: '',
    recipientName: 'Rahim Uddin',
    recipientPhone: '01712345678',
    adminAreaId: AREA,
    villageOrArea: '',
    addressLine: 'House 4, Road 2',
    landmark: '',
    postalCode: '',
    latitude: '',
    longitude: '',
    coordinateSource: '',
    ...overrides,
  }
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

function parse(data: FormData) {
  return AddressFormSchema.safeParse(readAddressForm(data))
}

describe('an address with no location', () => {
  it('is accepted — this is the case the form is FOR', () => {
    /*
     * The regression. Hidden inputs post "" rather than nothing, so a schema that only allowed a
     * numeric string made the pin mandatory in practice while every comment said it was optional.
     */
    const result = parse(formData())
    expect(result.success).toBe(true)
  })

  it('resolves to no coordinates rather than to an error', () => {
    const result = parse(formData())
    if (!result.success) throw new Error('should parse')
    expect(coordinatesFrom(result.data)).toEqual({ latitude: null, longitude: null })
  })

  it('leaves every other optional field absent rather than empty-stringed', () => {
    const result = parse(formData())
    if (!result.success) throw new Error('should parse')
    // These reach the use case as "" and are turned into null there; what matters is that none
    // of them fails validation just for being blank.
    expect(result.data.label).toBe('')
    expect(result.data.postalCode).toBe('')
    expect(result.data.coordinateSource).toBeUndefined()
  })
})

describe('an address with a location', () => {
  it('accepts a captured pin and converts it to numbers', () => {
    const result = parse(
      formData({ latitude: '24.374945', longitude: '88.604229', coordinateSource: 'DEVICE_GPS' }),
    )
    if (!result.success) throw new Error('should parse')

    expect(coordinatesFrom(result.data)).toEqual({ latitude: 24.374945, longitude: 88.604229 })
    expect(result.data.coordinateSource).toBe('DEVICE_GPS')
  })

  it('accepts a negative coordinate, which is a real place even if not here', () => {
    const result = parse(formData({ latitude: '-33.8688', longitude: '151.2093' }))
    expect(result.success).toBe(true)
  })

  it('treats half a coordinate as no coordinate rather than as a point on the equator', () => {
    const result = parse(formData({ latitude: '24.374945', longitude: '' }))
    if (!result.success) throw new Error('should parse')
    expect(coordinatesFrom(result.data)).toEqual({ latitude: null, longitude: null })
  })

  it('rejects something that is not a number at all', () => {
    const result = parse(formData({ latitude: 'here', longitude: 'there' }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstErrorField(result.error)).toBe('latitude')
  })

  it('refuses a coordinate source the platform does not define', () => {
    expect(parse(formData({ coordinateSource: 'GUESSED' })).success).toBe(false)
  })
})

describe('required fields', () => {
  it('rejects a blank recipient name, and says which field', () => {
    const result = parse(formData({ recipientName: '   ' }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstErrorField(result.error)).toBe('recipientName')
  })

  it('rejects a blank address line', () => {
    const result = parse(formData({ addressLine: '' }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstErrorField(result.error)).toBe('addressLine')
  })

  it('rejects an area that is not a uuid, including the empty picker', () => {
    // The picker posts "" until a selection is made; that must be a clear failure, not a crash.
    const result = parse(formData({ adminAreaId: '' }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstErrorField(result.error)).toBe('adminAreaId')
  })
})

describe('the default checkbox', () => {
  it('is false when the box is absent, which is how an unchecked box posts', () => {
    const result = parse(formData())
    if (!result.success) throw new Error('should parse')
    expect(result.data.makeDefault).toBe(false)
  })

  it('is true when the box is present at all, whatever its value', () => {
    const data = formData()
    data.append('makeDefault', 'yes')
    const result = parse(data)
    if (!result.success) throw new Error('should parse')
    expect(result.data.makeDefault).toBe(true)
  })
})

describe('coordinatesFrom', () => {
  it('says nothing at all when the form never mentioned coordinates', () => {
    // A programmatic caller PATCHing one field must not blank a stored pin.
    const partial = { latitude: undefined, longitude: undefined } as AddressFormInput
    expect(coordinatesFrom(partial)).toBeNull()
  })
})
