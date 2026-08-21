/**
 * Address policy — what makes an address usable, and what we honestly know about where it is.
 *
 * The `AdminArea` tree is the PRIMARY location model and this module does not replace it. A
 * division/district/upazila/union hierarchy already exists, seeded and self-referencing; what
 * lives here is the per-address part the tree cannot express — who receives the parcel, which
 * village, which house, and how much confidence the coordinates deserve.
 *
 * Two constraints from the field shape everything below:
 *
 *  - **Many rural locations have no street address and no reliable postcode.** "Village, union,
 *    upazila, near the school" is a complete address in practice. So `addressLine`, `landmark`
 *    and `villageOrArea` carry the weight, and a postcode is optional — demanding one would
 *    reject the majority of the people this platform exists for.
 *  - **Map literacy varies.** Coordinates are an enhancement, never a requirement, and the
 *    hierarchical picker has to be a complete path on its own.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2; docs/02_DATABASE.md §4
 */

import { normalizePhone, PhoneError, type E164Phone } from '../identity/phone.js'

/**
 * Where an address is, as precisely as we actually know it.
 *
 * Recorded rather than inferred, so distance-based pricing can widen its error bars honestly
 * instead of implying metre accuracy from a union centroid.
 */
export const LOCATION_PRECISIONS = ['EXACT', 'APPROXIMATE', 'AREA_CENTROID'] as const
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number]

export function isLocationPrecision(value: string): value is LocationPrecision {
  return (LOCATION_PRECISIONS as readonly string[]).includes(value)
}

/**
 * ISO 3166-1 alpha-2. Bangladesh is the only country Langgol serves, and the `AdminArea` tree is
 * rooted at divisions rather than at a country node precisely because of that — adding a country
 * level today would re-parent all eight divisions for no benefit.
 *
 * The column exists anyway so that an address carries its own country rather than depending on
 * an assumption held somewhere else in the codebase. When a second country is genuinely served,
 * the tree gains a root level and this becomes the discriminator that was already there.
 */
export const DEFAULT_COUNTRY = 'BD'

/**
 * Bangladesh's bounding box, padded slightly past the land border.
 *
 * A BOX, not the border, and the difference matters. Bangladesh is deeply concave — West Bengal
 * wraps around it to the west and Assam and Tripura to the east — so this rectangle also contains
 * a good deal of India. Kolkata (22.57, 88.36) sits inside it. Anything needing the actual border
 * needs a polygon and `ST_Contains`, which is what the boundary groundwork in `boundary.ts` is
 * for; this is a cheap sanity check, and calling it a country check would oversell it.
 *
 * What it does catch is the class of error that is not merely imprecise but nonsense: a GPS fix
 * of (0, 0), a reading from the wrong hemisphere, and — by far the most common — latitude and
 * longitude the wrong way round. The latitude range (20.3–26.7) and the longitude range
 * (88.0–92.7) do not overlap, which is what makes a swap *detectable* rather than just unlikely.
 */
export const BANGLADESH_BOUNDS = {
  minLatitude: 20.3,
  maxLatitude: 26.7,
  minLongitude: 88.0,
  maxLongitude: 92.7,
} as const

const LABEL_MAX = 40
const NAME_MAX = 120
const LINE_MAX = 250
const LANDMARK_MAX = 160
const VILLAGE_MAX = 120

/** Four digits. Optional everywhere, because most rural addresses simply do not have one. */
const POSTAL_CODE_PATTERN = /^\d{4}$/

export type AddressErrorCode =
  | 'RECIPIENT_NAME_EMPTY'
  | 'RECIPIENT_NAME_TOO_LONG'
  | 'PHONE_INVALID'
  | 'ADDRESS_LINE_EMPTY'
  | 'ADDRESS_LINE_TOO_LONG'
  | 'LABEL_TOO_LONG'
  | 'VILLAGE_TOO_LONG'
  | 'LANDMARK_TOO_LONG'
  | 'AREA_REQUIRED'
  | 'POSTAL_CODE_INVALID'
  | 'COUNTRY_INVALID'
  | 'COORDINATES_INCOMPLETE'
  | 'COORDINATES_OUT_OF_RANGE'
  | 'COORDINATES_LOOK_SWAPPED'
  | 'COORDINATES_OUTSIDE_COUNTRY'
  | 'PRECISION_INVALID'

export class AddressError extends Error {
  readonly code: AddressErrorCode
  readonly field: string

  constructor(code: AddressErrorCode, field: string, message: string) {
    super(message)
    this.name = 'AddressError'
    this.code = code
    this.field = field
  }
}

export interface Coordinates {
  readonly latitude: number
  readonly longitude: number
}

export interface AddressInput {
  readonly label?: string | null
  readonly recipientName?: string
  readonly recipientPhone?: string
  readonly adminAreaId?: string
  readonly villageOrArea?: string | null
  readonly addressLine?: string
  readonly landmark?: string | null
  readonly postalCode?: string | null
  readonly countryCode?: string
  readonly latitude?: number | null
  readonly longitude?: number | null
  readonly precision?: string
}

export interface ValidatedAddress {
  label?: string | null
  recipientName?: string
  recipientPhone?: E164Phone
  adminAreaId?: string
  villageOrArea?: string | null
  addressLine?: string
  landmark?: string | null
  postalCode?: string | null
  countryCode?: string
  latitude?: number | null
  longitude?: number | null
  precision?: LocationPrecision
}

function requireText(
  value: string,
  field: string,
  max: number,
  empty: AddressErrorCode,
  tooLong: AddressErrorCode,
): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new AddressError(empty, field, `${field} is required`)
  if (trimmed.length > max) {
    throw new AddressError(tooLong, field, `${field} must be ${String(max)} characters or fewer`)
  }
  return trimmed
}

function optionalText(
  value: string | null,
  field: string,
  max: number,
  tooLong: AddressErrorCode,
): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) {
    throw new AddressError(tooLong, field, `${field} must be ${String(max)} characters or fewer`)
  }
  return trimmed
}

/** True when the point falls inside Bangladesh's bounding box. */
export function isWithinBangladesh(point: Coordinates): boolean {
  return (
    point.latitude >= BANGLADESH_BOUNDS.minLatitude &&
    point.latitude <= BANGLADESH_BOUNDS.maxLatitude &&
    point.longitude >= BANGLADESH_BOUNDS.minLongitude &&
    point.longitude <= BANGLADESH_BOUNDS.maxLongitude
  )
}

/**
 * Would this point be inside Bangladesh if latitude and longitude were exchanged?
 *
 * Worth its own check because the two ranges are disjoint, so the answer is unambiguous — and
 * because a swapped pair produces a delivery quote for a route across the Bay of Bengal rather
 * than an obvious error.
 */
export function looksSwapped(point: Coordinates): boolean {
  return (
    !isWithinBangladesh(point) &&
    isWithinBangladesh({ latitude: point.longitude, longitude: point.latitude })
  )
}

/**
 * Validate a partial address.
 *
 * Only the keys present are returned, so a PATCH that changes one field cannot blank the others.
 * Coordinates are validated as a PAIR: half a coordinate is not a location, and accepting one
 * would store a point on the equator or the prime meridian.
 */
export function validateAddress(input: AddressInput): ValidatedAddress {
  const result: ValidatedAddress = {}

  if (input.label !== undefined) {
    result.label = optionalText(input.label, 'label', LABEL_MAX, 'LABEL_TOO_LONG')
  }

  if (input.recipientName !== undefined) {
    result.recipientName = requireText(
      input.recipientName,
      'recipientName',
      NAME_MAX,
      'RECIPIENT_NAME_EMPTY',
      'RECIPIENT_NAME_TOO_LONG',
    )
  }

  if (input.recipientPhone !== undefined) {
    try {
      result.recipientPhone = normalizePhone(input.recipientPhone)
    } catch (error) {
      if (error instanceof PhoneError) {
        throw new AddressError('PHONE_INVALID', 'recipientPhone', error.message)
      }
      throw error
    }
  }

  if (input.adminAreaId !== undefined) {
    const area = input.adminAreaId.trim()
    if (area.length === 0) {
      // The hierarchy IS the address here; without it there is nothing to deliver against.
      throw new AddressError('AREA_REQUIRED', 'adminAreaId', 'Select an area')
    }
    result.adminAreaId = area
  }

  if (input.villageOrArea !== undefined) {
    result.villageOrArea = optionalText(
      input.villageOrArea,
      'villageOrArea',
      VILLAGE_MAX,
      'VILLAGE_TOO_LONG',
    )
  }

  if (input.addressLine !== undefined) {
    result.addressLine = requireText(
      input.addressLine,
      'addressLine',
      LINE_MAX,
      'ADDRESS_LINE_EMPTY',
      'ADDRESS_LINE_TOO_LONG',
    )
  }

  if (input.landmark !== undefined) {
    result.landmark = optionalText(input.landmark, 'landmark', LANDMARK_MAX, 'LANDMARK_TOO_LONG')
  }

  if (input.postalCode !== undefined) {
    const postal = input.postalCode === null ? null : input.postalCode.trim()
    if (postal === null || postal.length === 0) {
      result.postalCode = null
    } else if (!POSTAL_CODE_PATTERN.test(postal)) {
      throw new AddressError(
        'POSTAL_CODE_INVALID',
        'postalCode',
        'A Bangladeshi postcode is four digits',
      )
    } else {
      result.postalCode = postal
    }
  }

  if (input.countryCode !== undefined) {
    const country = input.countryCode.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new AddressError('COUNTRY_INVALID', 'countryCode', 'Country must be a two-letter code')
    }
    result.countryCode = country
  }

  const hasLatitude = input.latitude !== undefined
  const hasLongitude = input.longitude !== undefined

  if (hasLatitude || hasLongitude) {
    const latitude = input.latitude ?? null
    const longitude = input.longitude ?? null

    if (latitude === null && longitude === null) {
      // Clearing the pin is always allowed. An address without coordinates is normal here.
      result.latitude = null
      result.longitude = null
    } else if (latitude === null || longitude === null) {
      throw new AddressError(
        'COORDINATES_INCOMPLETE',
        'latitude',
        'Give both latitude and longitude, or neither',
      )
    } else {
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        throw new AddressError(
          'COORDINATES_OUT_OF_RANGE',
          'latitude',
          'Those coordinates are not a point on Earth',
        )
      }

      const point = { latitude, longitude }
      const country = result.countryCode ?? input.countryCode ?? DEFAULT_COUNTRY

      if (country === DEFAULT_COUNTRY && !isWithinBangladesh(point)) {
        if (looksSwapped(point)) {
          throw new AddressError(
            'COORDINATES_LOOK_SWAPPED',
            'latitude',
            'Latitude and longitude look the wrong way round',
          )
        }
        throw new AddressError(
          'COORDINATES_OUTSIDE_COUNTRY',
          'latitude',
          'That point is outside Bangladesh',
        )
      }

      result.latitude = latitude
      result.longitude = longitude
    }
  }

  if (input.precision !== undefined) {
    if (!isLocationPrecision(input.precision)) {
      throw new AddressError('PRECISION_INVALID', 'precision', 'Unknown location precision')
    }
    result.precision = input.precision
  }

  return result
}

/**
 * How much confidence the stored coordinates deserve.
 *
 * Never upgraded on the client's say-so. A pin the user placed themselves is APPROXIMATE, not
 * EXACT: they are pointing at a rooftop on a map they may be reading for the first time. EXACT is
 * reserved for a device GPS fix the user deliberately captured, and no coordinates at all means
 * we fall back to the area centroid and must say so.
 */
export function precisionFor(input: {
  readonly hasCoordinates: boolean
  readonly source: 'DEVICE_GPS' | 'MAP_PIN' | 'NONE'
}): LocationPrecision {
  if (!input.hasCoordinates || input.source === 'NONE') return 'AREA_CENTROID'
  return input.source === 'DEVICE_GPS' ? 'EXACT' : 'APPROXIMATE'
}
