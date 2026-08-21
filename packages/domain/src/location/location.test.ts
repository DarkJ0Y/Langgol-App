/**
 * Location domain tests.
 *
 * The assertions worth having here are the ones that would silently produce a wrong delivery
 * quote rather than an error: a swapped coordinate pair, half a coordinate, a postcode demanded
 * where none exists, or a precision that claims more than we know.
 */

import { describe, expect, it } from 'vitest'
import {
  AREA_LEVELS,
  AddressError,
  BANGLADESH_BOUNDS,
  BoundaryError,
  DEFAULT_COUNTRY,
  MINIMUM_ADDRESS_LEVEL,
  areaName,
  childLevelOf,
  closeRing,
  contains,
  formatAreaPath,
  isAreaLevel,
  isDeepEnoughForAddress,
  isValidAreaPath,
  isWithinBangladesh,
  looksSwapped,
  parentLevelOf,
  precisionFor,
  ringToWkt,
  validateAddress,
  validateRing,
  type AreaNode,
} from './index.js'

const DHAKA = { latitude: 23.8103, longitude: 90.4125 }
const RAJSHAHI = { latitude: 24.3749, longitude: 88.6042 }

const VALID = {
  recipientName: 'Rahim Uddin',
  recipientPhone: '01712345678',
  adminAreaId: 'area-1',
  addressLine: 'House 4, Road 2',
}

/* ------------------------------------------------------------------ hierarchy */

describe('the administrative hierarchy', () => {
  it('runs coarse to fine, which is the containment relation', () => {
    expect([...AREA_LEVELS]).toEqual(['DIVISION', 'DISTRICT', 'UPAZILA', 'UNION'])
    expect(contains('DIVISION', 'UNION')).toBe(true)
    expect(contains('UNION', 'DIVISION')).toBe(false)
    // Not a strict ancestor of itself.
    expect(contains('DISTRICT', 'DISTRICT')).toBe(false)
  })

  it('walks up and down without hard-coding neighbours', () => {
    expect(childLevelOf('DIVISION')).toBe('DISTRICT')
    expect(childLevelOf('UNION')).toBeNull()
    expect(parentLevelOf('DISTRICT')).toBe('DIVISION')
    expect(parentLevelOf('DIVISION')).toBeNull()
  })

  it('requires at least an upazila, not a union', () => {
    /*
     * Union coverage in the seeded data is incomplete, and a buyer who does not know their union
     * must still be able to finish. Demanding one would strand people at the last step.
     */
    expect(MINIMUM_ADDRESS_LEVEL).toBe('UPAZILA')
    expect(isDeepEnoughForAddress('UPAZILA')).toBe(true)
    expect(isDeepEnoughForAddress('UNION')).toBe(true)
    expect(isDeepEnoughForAddress('DISTRICT')).toBe(false)
    // "Somewhere in Rajshahi" is eight thousand square kilometres, not an address.
    expect(isDeepEnoughForAddress('DIVISION')).toBe(false)
  })

  it('recognises its own levels and nothing else', () => {
    for (const level of AREA_LEVELS) expect(isAreaLevel(level)).toBe(true)
    expect(isAreaLevel('WARD')).toBe(false)
    expect(isAreaLevel('district')).toBe(false)
  })

  it('names areas in the reader’s language, Bangla by default', () => {
    const area = { nameBn: 'রাজশাহী', nameEn: 'Rajshahi' }
    expect(areaName(area, 'bn')).toBe('রাজশাহী')
    expect(areaName(area, 'en')).toBe('Rajshahi')
    expect(formatAreaPath([area, { nameBn: 'বগুড়া', nameEn: 'Bogura' }], 'bn')).toBe(
      'রাজশাহী, বগুড়া',
    )
  })
})

describe('area paths', () => {
  const node = (id: string, level: AreaNode['level'], parentId: string | null): AreaNode => ({
    id,
    level,
    parentId,
    nameBn: id,
    nameEn: id,
  })

  it('accepts a well-formed root-to-leaf chain', () => {
    expect(
      isValidAreaPath([
        node('div', 'DIVISION', null),
        node('dis', 'DISTRICT', 'div'),
        node('upa', 'UPAZILA', 'dis'),
      ]),
    ).toBe(true)
  })

  it('rejects a chain whose parent link does not match', () => {
    /*
     * The case that matters: an area id that is real but sits under a DIFFERENT district from the
     * one also posted. A foreign key would accept it and the delivery quote would be for the
     * wrong half of the country.
     */
    expect(
      isValidAreaPath([
        node('div', 'DIVISION', null),
        node('dis', 'DISTRICT', 'div'),
        node('upa', 'UPAZILA', 'somewhere-else'),
      ]),
    ).toBe(false)
  })

  it('rejects a chain that skips a level or starts below the root', () => {
    expect(isValidAreaPath([node('div', 'DIVISION', null), node('upa', 'UPAZILA', 'div')])).toBe(
      false,
    )
    expect(isValidAreaPath([node('dis', 'DISTRICT', null)])).toBe(false)
    expect(isValidAreaPath([])).toBe(false)
  })
})

/* -------------------------------------------------------------------- address */

describe('required fields', () => {
  it('accepts a complete address with no coordinates at all', () => {
    // The common case in rural Bangladesh, and it must be a complete address.
    const result = validateAddress(VALID)
    expect(result.recipientName).toBe('Rahim Uddin')
    expect(result.recipientPhone).toBe('+8801712345678')
    expect(result).not.toHaveProperty('latitude')
  })

  it('normalises the recipient phone rather than storing what was typed', () => {
    // "01712-345678" and "+8801712345678" must not be two different contacts.
    expect(validateAddress({ ...VALID, recipientPhone: '01712-345678' }).recipientPhone).toBe(
      '+8801712345678',
    )
  })

  it('refuses an empty recipient name or address line', () => {
    expect(() => validateAddress({ ...VALID, recipientName: '   ' })).toThrow(
      expect.objectContaining({ code: 'RECIPIENT_NAME_EMPTY' }),
    )
    expect(() => validateAddress({ ...VALID, addressLine: '  ' })).toThrow(
      expect.objectContaining({ code: 'ADDRESS_LINE_EMPTY' }),
    )
  })

  it('refuses an address with no area — the hierarchy IS the address', () => {
    expect(() => validateAddress({ ...VALID, adminAreaId: '' })).toThrow(
      expect.objectContaining({ code: 'AREA_REQUIRED' }),
    )
  })

  it('refuses a phone that is not a Bangladeshi mobile', () => {
    expect(() => validateAddress({ ...VALID, recipientPhone: '12345' })).toThrow(
      expect.objectContaining({ code: 'PHONE_INVALID' }),
    )
  })

  it('keeps a partial update partial', () => {
    const result = validateAddress({ label: 'Home' })
    expect(Object.keys(result)).toEqual(['label'])
  })
})

describe('optional fields stay optional', () => {
  it('accepts an address with no postcode', () => {
    // Most rural locations have no reliable postcode. Requiring one rejects the majority.
    expect(validateAddress({ ...VALID, postalCode: null }).postalCode).toBeNull()
    expect(validateAddress({ ...VALID, postalCode: '   ' }).postalCode).toBeNull()
  })

  it('accepts a four-digit Bangladeshi postcode', () => {
    expect(validateAddress({ ...VALID, postalCode: '6203' }).postalCode).toBe('6203')
  })

  it('refuses a postcode that is not four digits', () => {
    for (const bad of ['620', '62033', 'ABCD', '62-03']) {
      expect(() => validateAddress({ ...VALID, postalCode: bad })).toThrow(
        expect.objectContaining({ code: 'POSTAL_CODE_INVALID' }),
      )
    }
  })

  it('treats a blank village or landmark as absent rather than as an empty string', () => {
    const result = validateAddress({ ...VALID, villageOrArea: '  ', landmark: '' })
    expect(result.villageOrArea).toBeNull()
    expect(result.landmark).toBeNull()
  })
})

describe('country', () => {
  it('defaults to Bangladesh', () => {
    expect(DEFAULT_COUNTRY).toBe('BD')
  })

  it('upper-cases a two-letter code', () => {
    expect(validateAddress({ ...VALID, countryCode: 'bd' }).countryCode).toBe('BD')
  })

  it('refuses anything that is not an ISO alpha-2 code', () => {
    for (const bad of ['BGD', 'B', '12']) {
      expect(() => validateAddress({ ...VALID, countryCode: bad })).toThrow(
        expect.objectContaining({ code: 'COUNTRY_INVALID' }),
      )
    }
  })
})

/* ---------------------------------------------------------------- coordinates */

describe('coordinates', () => {
  it('accepts a point inside Bangladesh', () => {
    const result = validateAddress({ ...VALID, ...DHAKA })
    expect(result.latitude).toBe(DHAKA.latitude)
    expect(result.longitude).toBe(DHAKA.longitude)
  })

  it('allows clearing the pin', () => {
    const result = validateAddress({ ...VALID, latitude: null, longitude: null })
    expect(result.latitude).toBeNull()
    expect(result.longitude).toBeNull()
  })

  it('refuses half a coordinate', () => {
    // One number is not a location; storing it puts the address on the equator.
    expect(() => validateAddress({ ...VALID, latitude: 23.8, longitude: null })).toThrow(
      expect.objectContaining({ code: 'COORDINATES_INCOMPLETE' }),
    )
    expect(() => validateAddress({ ...VALID, latitude: null, longitude: 90.4 })).toThrow(
      expect.objectContaining({ code: 'COORDINATES_INCOMPLETE' }),
    )
  })

  it('refuses a point that is not on Earth', () => {
    expect(() => validateAddress({ ...VALID, latitude: 200, longitude: 90 })).toThrow(
      expect.objectContaining({ code: 'COORDINATES_OUT_OF_RANGE' }),
    )
    expect(() => validateAddress({ ...VALID, latitude: Number.NaN, longitude: 90 })).toThrow(
      expect.objectContaining({ code: 'COORDINATES_OUT_OF_RANGE' }),
    )
  })

  it('catches latitude and longitude the wrong way round', () => {
    /*
     * The single most valuable assertion in this file. Bangladesh's latitude range (20.3–26.7)
     * and longitude range (88.0–92.7) do not overlap, so a swap is not merely implausible — it is
     * detectable. Left uncaught it becomes a delivery quote for a route across the Bay of Bengal.
     */
    expect(() =>
      validateAddress({ ...VALID, latitude: RAJSHAHI.longitude, longitude: RAJSHAHI.latitude }),
    ).toThrow(expect.objectContaining({ code: 'COORDINATES_LOOK_SWAPPED' }))
  })

  it('catches a swap whose latitude also leaves the planet', () => {
    // Dhaka swapped puts 90.4125 in the latitude slot, which is past the pole. Still caught, by
    // the range rule rather than the swap rule — the message differs, the rejection does not.
    expect(() =>
      validateAddress({ ...VALID, latitude: DHAKA.longitude, longitude: DHAKA.latitude }),
    ).toThrow(expect.objectContaining({ code: 'COORDINATES_OUT_OF_RANGE' }))
  })

  it('reports a distant point as outside the box, not as a swap', () => {
    // Delhi: real, valid, and nowhere near Bangladesh in either orientation.
    expect(() => validateAddress({ ...VALID, latitude: 28.6139, longitude: 77.209 })).toThrow(
      expect.objectContaining({ code: 'COORDINATES_OUTSIDE_COUNTRY' }),
    )
  })

  it('is a bounding box, not the border — and does not pretend otherwise', () => {
    /*
     * Bangladesh is deeply concave, so its bounding box contains a good deal of West Bengal.
     * Kolkata passes. That is a known and accepted limit of a cheap check: it exists to catch
     * nonsense coordinates, not to adjudicate the border. Anything needing the real boundary
     * needs a polygon and ST_Contains.
     */
    expect(isWithinBangladesh({ latitude: 22.5726, longitude: 88.3639 })).toBe(true)
    expect(() => validateAddress({ ...VALID, latitude: 22.5726, longitude: 88.3639 })).not.toThrow()
  })

  it('refuses a null-island fix, which is what a failed GPS read looks like', () => {
    expect(() => validateAddress({ ...VALID, latitude: 0, longitude: 0 })).toThrow(AddressError)
  })

  it('does not apply the Bangladesh box to another country', () => {
    // The bounds are scoped to BD so serving a second country is a data change, not a rewrite.
    const result = validateAddress({
      ...VALID,
      countryCode: 'IN',
      latitude: 22.5726,
      longitude: 88.3639,
    })
    expect(result.latitude).toBe(22.5726)
  })

  it('agrees with its own bounding box', () => {
    expect(isWithinBangladesh(DHAKA)).toBe(true)
    expect(isWithinBangladesh(RAJSHAHI)).toBe(true)
    expect(isWithinBangladesh({ latitude: BANGLADESH_BOUNDS.minLatitude, longitude: 90 })).toBe(
      true,
    )
    expect(isWithinBangladesh({ latitude: 0, longitude: 0 })).toBe(false)
    expect(looksSwapped({ latitude: 90.4125, longitude: 23.8103 })).toBe(true)
    expect(looksSwapped({ latitude: 0, longitude: 0 })).toBe(false)
  })
})

describe('precision records what we actually know', () => {
  it('falls back to the area centroid when there is no pin', () => {
    expect(precisionFor({ hasCoordinates: false, source: 'NONE' })).toBe('AREA_CENTROID')
    expect(precisionFor({ hasCoordinates: false, source: 'DEVICE_GPS' })).toBe('AREA_CENTROID')
  })

  it('calls a dragged pin APPROXIMATE, not EXACT', () => {
    /*
     * Someone placing a pin is pointing at a rooftop on a map they may be reading for the first
     * time. Recording that as EXACT would let distance pricing imply metre accuracy it does not
     * have. docs/08 §2
     */
    expect(precisionFor({ hasCoordinates: true, source: 'MAP_PIN' })).toBe('APPROXIMATE')
  })

  it('reserves EXACT for a device fix the user deliberately captured', () => {
    expect(precisionFor({ hasCoordinates: true, source: 'DEVICE_GPS' })).toBe('EXACT')
  })
})

/* ------------------------------------------------------------------ boundaries */

describe('farm boundary groundwork', () => {
  const square = [
    { latitude: 24.37, longitude: 88.6 },
    { latitude: 24.37, longitude: 88.61 },
    { latitude: 24.38, longitude: 88.61 },
    { latitude: 24.38, longitude: 88.6 },
  ]

  it('closes a ring that does not already close', () => {
    const closed = closeRing(square)
    expect(closed).toHaveLength(5)
    expect(closed[4]).toEqual(square[0])
  })

  it('leaves an already-closed ring alone', () => {
    const already = [...square, square[0]!]
    expect(closeRing(already)).toHaveLength(5)
  })

  it('accepts a valid smallholding boundary', () => {
    expect(validateRing(square)).toHaveLength(5)
  })

  it('refuses fewer than three corners', () => {
    expect(() => validateRing(square.slice(0, 2))).toThrow(
      expect.objectContaining({ code: 'TOO_FEW_VERTICES' }),
    )
  })

  it('refuses a corner outside Bangladesh', () => {
    expect(() => validateRing([...square, { latitude: 48.85, longitude: 2.35 }])).toThrow(
      expect.objectContaining({ code: 'VERTEX_OUTSIDE_COUNTRY' }),
    )
  })

  it('refuses a corner that is not a point on Earth', () => {
    expect(() => validateRing([...square, { latitude: 500, longitude: 88.6 }])).toThrow(
      BoundaryError,
    )
  })

  it('emits WKT longitude-first, which is the one place the order flips', () => {
    /*
     * Everything above this line says latitude first because that is what people say; PostGIS
     * says longitude first because that is what OGC specifies. Getting it wrong puts the farm in
     * the Indian Ocean, and it is invisible until someone looks at a map.
     */
    const wkt = ringToWkt(square)
    expect(wkt.startsWith('POLYGON((88.6 24.37,')).toBe(true)
    expect(wkt.endsWith('88.6 24.37))')).toBe(true)
  })
})
