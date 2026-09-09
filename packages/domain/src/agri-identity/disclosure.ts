/**
 * What may leave, and the tripwire that checks it did not.
 *
 * The agricultural profile joins together nearly every private thing Langgol holds: an identity
 * document, a phone number, a home address, farm coordinates, land holdings, revenue. Its whole
 * purpose is to be *shown* — to a cooperative, a buyer, an insurer, eventually a lender. That
 * combination is the most likely place in this codebase for a leak, and it will not arrive as a
 * broken check. It will arrive as somebody adding one useful-looking field.
 *
 * ## Two mechanisms, because one is not enough
 *
 * 1. **The type.** `AgriProfile` names only safe fields, so the ordinary path has nothing to
 *    disclose. This is the same discipline as the KYC record in P10 and it is the primary defence.
 *
 * 2. **The tripwire.** `auditDisclosure` walks a finished profile and refuses it if any KEY names
 *    something private or any VALUE looks like a secret. It runs in the use case, in production,
 *    before the response is returned, and its failure mode is to serve nothing.
 *
 * The second exists because the first is only as good as the next person's judgement. A future
 * field called `farmerPhone` compiles; it does not get past the tripwire.
 *
 * ## Why a value check and not only a key check
 *
 * A key check misses `note: '+8801712345678'`. Values are therefore matched by SHAPE — a
 * Bangladeshi mobile number, a run of digits long enough to be an identity number, a coordinate
 * pair inside the country. Each is a shape private data actually takes here, not a generic
 * pattern.
 *
 * Refs: docs/07_SECURITY.md §7, §9, §11
 */

import { isWithinBangladesh } from '../location/address.js'
import {
  BD_PHONE_PATTERN,
  IDENTITY_RUN_PATTERN,
  collapse,
  wordSegments,
} from '../privacy/shapes.js'

export class DisclosureError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Where in the profile the offending value sits, so a developer can find it. */
    readonly path: string,
  ) {
    super(message)
    this.name = 'DisclosureError'
  }
}

/**
 * Who is reading.
 *
 * `SELF` is the owner looking at their own card. `PUBLIC` is everybody else — a buyer scanning a
 * code, a cooperative checking a member, a lender given the identifier by an applicant.
 *
 * Declared now although only `SELF` is reachable in this phase, because the alternative is a
 * projection with no notion of audience that somebody later exposes publicly wholesale. A field
 * added today has to say who may see it.
 */
export const AGRI_AUDIENCES = ['PUBLIC', 'SELF'] as const
export type AgriAudience = (typeof AGRI_AUDIENCES)[number]

/** `PUBLIC` is the narrower of the two; anything public is also visible to the owner. */
export function visibleTo(required: AgriAudience, actual: AgriAudience): boolean {
  return required === 'PUBLIC' || actual === 'SELF'
}

/**
 * Key segments that must never appear in a profile.
 *
 * Matched on word segments rather than substrings, the same way `packages/shared/src/redact.ts`
 * does it — `nidHash` splits to ['nid','hash'] and matches, `candidate` does not match on 'id'.
 *
 * Deliberately broader than the fields that exist. The point is to refuse a field nobody has
 * thought of yet, so the list names categories rather than columns.
 */
const FORBIDDEN_KEY_SEGMENTS: ReadonlySet<string> = new Set([
  // Identity documents
  'nid',
  'identity',
  'passport',
  'licence',
  'license',
  'tin',
  'bin',
  'ciphertext',
  // Contact
  'phone',
  'mobile',
  'msisdn',
  'email',
  'address',
  'postcode',
  'postal',
  // Precise location. A district is safe; a point is not.
  'latitude',
  'longitude',
  'coordinates',
  'coordinate',
  'geo',
  'centroid',
  // Money, in every form this codebase spells it
  'poisha',
  'revenue',
  'price',
  'cost',
  'margin',
  'payout',
  'account',
  'balance',
  'credit',
  'debt',
  'loan',
  // Credentials
  'token',
  'secret',
  'password',
  'hash',
  'key',
  // Other people's business
  'birth',
  'dob',
  'gender',
])

export function isForbiddenKey(name: string): boolean {
  return wordSegments(name).some((segment) => FORBIDDEN_KEY_SEGMENTS.has(segment))
}

function looksSensitive(value: string): string | null {
  if (BD_PHONE_PATTERN.test(collapse(value))) return 'PHONE_SHAPED'
  if (IDENTITY_RUN_PATTERN.test(collapse(value))) return 'IDENTITY_SHAPED'
  return null
}

/**
 * Does this pair of numbers look like a point inside Bangladesh?
 *
 * Catches coordinates that escaped under an innocent key — `[23.81, 90.41]` in an array called
 * `points`, say. Checked as a PAIR because a lone 23.81 is also a perfectly good quantity of
 * anything, and refusing it would make the tripwire useless.
 */
function looksLikeLocalPoint(values: readonly unknown[]): boolean {
  for (let index = 0; index + 1 < values.length; index += 1) {
    const first = values[index]
    const second = values[index + 1]
    if (typeof first !== 'number' || typeof second !== 'number') continue
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue
    if (
      isWithinBangladesh({ latitude: first, longitude: second }) ||
      isWithinBangladesh({ latitude: second, longitude: first })
    ) {
      return true
    }
  }
  return false
}

/**
 * Refuse a profile that discloses something it should not.
 *
 * Throws rather than scrubbing. A scrub would hand back a response missing a field nobody noticed
 * was missing; a throw stops the response, and the caller turns it into a server error. Serving
 * nothing is the correct outcome when the alternative is serving somebody's identity number.
 *
 * `agriId` is exempt from the value check by construction rather than by exception: it is random
 * base32 with no digit run long enough to trip anything.
 */
export function auditDisclosure(
  value: unknown,
  path = 'profile',
  seen = new WeakSet<object>(),
): void {
  if (value === null || value === undefined) return

  if (typeof value === 'string') {
    const shape = looksSensitive(value)
    if (shape !== null) {
      throw new DisclosureError(`A ${shape} value reached the profile`, shape, path)
    }
    return
  }

  if (typeof value === 'bigint') {
    // Money in this codebase is bigint poisha. Nothing in a public profile has any business being
    // one, whatever the field is called.
    throw new DisclosureError('A monetary value reached the profile', 'MONETARY', path)
  }

  if (typeof value !== 'object') return

  if (value instanceof Date) return

  // A cycle cannot disclose anything a first visit did not, and following one never terminates.
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    if (looksLikeLocalPoint(value)) {
      throw new DisclosureError('A coordinate pair reached the profile', 'COORDINATES', path)
    }
    value.forEach((entry, index) => {
      auditDisclosure(entry, `${path}[${String(index)}]`, seen)
    })
    return
  }

  const entries = Object.entries(value as Record<string, unknown>)

  if (looksLikeLocalPoint(entries.map(([, entry]) => entry))) {
    throw new DisclosureError('A coordinate pair reached the profile', 'COORDINATES', path)
  }

  for (const [key, entry] of entries) {
    const here = `${path}.${key}`
    if (isForbiddenKey(key)) {
      throw new DisclosureError(`"${key}" may not appear in a profile`, 'FORBIDDEN_KEY', here)
    }
    auditDisclosure(entry, here, seen)
  }
}

/** Whether a finished profile is safe to serve. The boolean form, for a test or a guard. */
export function isSafeToDisclose(value: unknown): boolean {
  try {
    auditDisclosure(value)
    return true
  } catch {
    return false
  }
}
