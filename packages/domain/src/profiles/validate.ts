/**
 * One validator for all six role profiles.
 *
 * It reads `PROFILE_FIELDS` and applies the rule the descriptor declares, so there is exactly one
 * implementation of "a TIN is twelve digits" and exactly one implementation of "an unanswered
 * question is null, not invalid" — rather than six copies drifting apart in six modules.
 *
 * ## The rule that governs everything below
 *
 * **Absent is not invalid.** Every field except a role's name is optional, and a blank one is
 * recorded as `null` rather than refused. A shopkeeper filling this in on a phone at closing time
 * should be able to save four answers and leave the fifth; a form that refuses the lot because of
 * one empty box is a form nobody finishes.
 *
 * The one exception is a business or company name, because a supplier profile with no company
 * name is not an incomplete profile — it is an unidentifiable one.
 */

import {
  BusinessIdentityError,
  normalizeBin,
  normalizeBusinessName,
  normalizeDigits,
  normalizeTin,
  normalizeTradeLicence,
} from './business.js'
import { isWithinBangladesh, looksSwapped } from '../location/address.js'
import { PROFILE_FIELDS, type FieldDescriptor, type ProfileRole } from './schema.js'

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'ProfileError'
  }
}

function fail(message: string, code: string, field: string): never {
  throw new ProfileError(message, code, field)
}

/** What a form or an API sends. Values are unknown until a descriptor has judged them. */
export type ProfileInput = Readonly<Record<string, unknown>>

/** What may be written. Narrowed by the descriptors, never wider than them. */
export type ProfileChanges = Record<string, unknown>

/** A UUID, in the one canonical form Postgres hands back. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * A latitude/longitude pair, or null.
 *
 * Validated as a PAIR, exactly as `validateAddress` does it, because half a coordinate is not a
 * location. The bounds and the swap check are IMPORTED from the address module rather than
 * restated: a pin that would be refused on the address screen must be refused here too, and two
 * copies of a bounding box is two chances for one of them to be widened alone.
 */
function validateGeo(
  value: unknown,
  field: string,
): { latitude: number; longitude: number } | null {
  const pair = value as { latitude?: unknown; longitude?: unknown }
  if (typeof pair !== 'object' || pair === null) fail('Give both, or neither', 'GEO_PAIR', field)

  const read = (raw: unknown): number | null => {
    if (raw === null || raw === undefined) return null
    // Trimmed BEFORE the emptiness test: a box holding only spaces is an unanswered box, and
    // `Number(' ')` is 0 — which would silently drop a shop into the Gulf of Guinea.
    const text = normalizeDigits(String(raw)).trim()
    if (text === '') return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  const latitude = read(pair.latitude)
  const longitude = read(pair.longitude)

  // Clearing the pin is always allowed. A shop with no pin is the normal case, not a failure.
  if (latitude === null && longitude === null) return null
  if (latitude === null || longitude === null) {
    fail('Give both latitude and longitude, or neither', 'GEO_PAIR', field)
  }
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    fail('Those coordinates are not a point on Earth', 'GEO_INVALID', field)
  }

  const point = { latitude, longitude }
  // Reported separately from a plain out-of-bounds reading, because it is the one mistake the
  // person can fix by swapping two boxes rather than going back outside to take the fix again.
  if (looksSwapped(point)) {
    fail('Latitude and longitude look the wrong way round', 'GEO_SWAPPED', field)
  }
  if (!isWithinBangladesh(point)) {
    fail('That point is not in Bangladesh', 'GEO_OUT_OF_BOUNDS', field)
  }

  return point
}

function validateField(field: FieldDescriptor, value: unknown): unknown {
  // Absent stays absent. `''` arrives from every unfilled input and means the same thing.
  if (value === null || value === '' || value === undefined) {
    if (field.required === true) fail('This is needed', 'REQUIRED', field.name)
    return null
  }

  switch (field.kind.kind) {
    case 'text':
    case 'longText': {
      if (typeof value !== 'string') fail('Enter text', 'NOT_TEXT', field.name)
      const trimmed = value.trim()
      if (trimmed === '') {
        if (field.required === true) fail('This is needed', 'REQUIRED', field.name)
        return null
      }
      if (trimmed.length > field.kind.maxLength) fail('That is too long', 'TOO_LONG', field.name)
      // A name gets the shared normaliser so it is judged identically wherever it appears.
      return field.name.endsWith('Name') ? normalizeBusinessName(trimmed, field.name) : trimmed
    }

    case 'integer': {
      const raw = typeof value === 'number' ? String(value) : normalizeDigits(String(value)).trim()
      if (!/^\d{1,7}$/.test(raw)) fail('Enter a whole number', 'NOT_INTEGER', field.name)
      const parsed = Number(raw)
      if (parsed < field.kind.min || parsed > field.kind.max) {
        fail('That number looks wrong', 'OUT_OF_RANGE', field.name)
      }
      return parsed
    }

    case 'money': {
      /*
       * Taka in, poisha stored. A consultation fee is typed as "৫০০", and every amount in this
       * schema is an integer in the smallest unit — so the conversion happens once, here, rather
       * than in whichever screen happens to render it.
       */
      const raw = normalizeDigits(String(value)).trim().replace(/,/g, '')
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) fail('Enter an amount', 'NOT_MONEY', field.name)
      return Math.round(Number(raw) * 100)
    }

    case 'boolean':
      return value === true || value === 'true' || value === 'YES' || value === 'on'

    case 'choice': {
      if (!field.kind.guard(value))
        fail('That is not one of the choices', 'UNKNOWN_VALUE', field.name)
      return value
    }

    case 'multi': {
      const list = Array.isArray(value) ? value : [value]
      const cleaned = list
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        .map((entry) => entry.trim())

      if (cleaned.length === 0) return []
      if (cleaned.length > 30) fail('Too many selected', 'TOO_MANY', field.name)

      /*
       * An empty option list means free text — `preferredProducts` and `certifications` cannot be
       * a closed vocabulary, because a farmer's certification is whatever the issuing body called
       * it. Everything else is checked against its list.
       */
      if (field.kind.options.length > 0) {
        for (const entry of cleaned) {
          if (!field.kind.guard(entry)) {
            fail('That is not one of the choices', 'UNKNOWN_VALUE', field.name)
          }
        }
      } else {
        for (const entry of cleaned) {
          if (entry.length > 80) fail('That entry is too long', 'TOO_LONG', field.name)
        }
      }

      // Deduplicated: the same certification listed twice is one certification.
      return [...new Set(cleaned)]
    }

    case 'tin':
      return normalizeTin(String(value))
    case 'bin':
      return normalizeBin(String(value))
    case 'licence':
      return normalizeTradeLicence(String(value))

    case 'address': {
      /*
       * Shape only. WHOSE address this is cannot be known here — the domain has no database — so
       * the use case checks ownership before writing and a trigger checks it again underneath.
       * Rejecting a malformed id early still matters: it keeps a typo out of a query.
       */
      const id = String(value).trim()
      if (!UUID.test(id)) fail('Choose an address from your list', 'NOT_ADDRESS', field.name)
      return id
    }

    case 'geo':
      return validateGeo(value, field.name)
  }
}

/**
 * Validate a partial update for one role.
 *
 * Only fields the role actually declares are considered. A `consultationFeePoisha` posted to the
 * retailer endpoint is ignored rather than stored — the descriptor table is the allowlist, so a
 * caller cannot write a column the role has no business having.
 */
export function validateProfile(role: ProfileRole, input: ProfileInput): ProfileChanges {
  const changes: ProfileChanges = {}

  for (const field of PROFILE_FIELDS[role]) {
    if (!(field.name in input)) continue
    try {
      changes[field.name] = validateField(field, input[field.name])
    } catch (cause) {
      // The shared business module throws its own error type; re-raise it as this layer's, so a
      // caller has one error shape to handle rather than two.
      if (cause instanceof BusinessIdentityError) {
        fail(cause.message, cause.code, cause.field)
      }
      throw cause
    }
  }

  return changes
}

/**
 * How complete a profile is, for the same progress indicator the farmer profile carries.
 *
 * Counted against the role's own declared fields, so a consumer is not measured against a
 * wholesaler's warehouse capacity.
 */
export function profileCompletion(
  role: ProfileRole,
  stored: Readonly<Record<string, unknown>>,
): { readonly answered: number; readonly total: number; readonly percent: number } {
  const fields = PROFILE_FIELDS[role]
  const answered = fields.filter((field) => {
    const value = stored[field.name]
    if (value === null || value === undefined || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    /*
     * A coordinate pair counts only when it holds a real point. A row whose latitude and
     * longitude columns are both null reads back as an object rather than a null, and counting
     * that as answered would show a shop at 100% while its pin was never dropped.
     */
    if (field.kind.kind === 'geo') {
      const point = value as { latitude?: unknown; longitude?: unknown }
      return typeof point === 'object' && point !== null && typeof point.latitude === 'number'
    }
    // `false` is an answer. A logistics operator without cold chain has answered the question.
    return true
  }).length

  return {
    answered,
    total: fields.length,
    percent: fields.length === 0 ? 0 : Math.round((answered / fields.length) * 100),
  }
}
