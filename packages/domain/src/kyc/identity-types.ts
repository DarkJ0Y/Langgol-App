/**
 * The identity documents Langgol accepts, and the rules each one is judged by.
 *
 * NID is the only type supported today. It is nevertheless declared as one entry in a table
 * rather than hardcoded, because "design the system so additional identity types can be added
 * later" is a requirement about SHAPE: adding a passport should be a row here plus a translation,
 * not a search for every place that assumed ten digits.
 *
 * ## What a descriptor owns, and what it does not
 *
 * A descriptor owns the SYNTAX of a number: how it is normalised, what lengths are plausible,
 * and how much of it may be shown. It does not own whether the number is real. No regular
 * expression proves that an NID belongs to the person holding it — only a check against the
 * Election Commission's register does, and that is an operational process with evidence behind
 * it. That is what the review workflow is for, and why a submission starts at `PENDING` and is
 * never self-approved.
 *
 * ## Why masking lives here
 *
 * `mask` is part of the descriptor rather than a helper somewhere in the interface, because the
 * number of digits it is safe to reveal is a property of the DOCUMENT. A four-digit tail of a
 * ten-digit NID is a different disclosure from a four-digit tail of a seventeen-digit one, and a
 * single global mask would eventually be wrong for one of them.
 *
 * Refs: docs/07_SECURITY.md §7, §11; docs/08_BANGLADESH_CONTEXT.md §2
 */

import { toAsciiDigits } from '../intl/numerals.js'

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string = 'identityNumber',
  ) {
    super(message)
    this.name = 'IdentityError'
  }
}

function fail(message: string, code: string, field = 'identityNumber'): never {
  throw new IdentityError(message, code, field)
}

/**
 * The document types the platform knows about.
 *
 * Only `NID` may be submitted today — see `SUBMITTABLE_IDENTITY_TYPES`. The others are named so
 * that the column's vocabulary is settled in advance: widening what is accepted should be a
 * change to one list, not a migration that rewrites stored values.
 */
export const IDENTITY_TYPES = ['NID', 'BIRTH_CERTIFICATE', 'PASSPORT', 'DRIVING_LICENCE'] as const
export type IdentityType = (typeof IDENTITY_TYPES)[number]

export const isIdentityType = (value: unknown): value is IdentityType =>
  typeof value === 'string' && (IDENTITY_TYPES as readonly string[]).includes(value)

/**
 * Bangla-Indic digits to ASCII.
 *
 * Delegates to `intl/numerals.ts`, which is where this transliteration lives for the whole domain.
 * It was reimplemented here with the same character arithmetic until the P15 audit found four
 * copies of it — three hand-rolled and one already delegating correctly. Identical copies of a
 * pure function are harmless until one of them is fixed.
 */
export function normalizeDigits(input: string): string {
  return toAsciiDigits(input)
}

export interface IdentityTypeDescriptor {
  readonly type: IdentityType
  /** May a user submit this today? Declared, so widening support is a one-line change. */
  readonly submittable: boolean
  /** Does this document have two sides worth photographing? */
  readonly hasBackSide: boolean
  /** Strip formatting and fold alternative numerals. Never validates. */
  readonly normalize: (raw: string) => string
  /** Throws `IdentityError` when the normalised value cannot be this document. */
  readonly validate: (normalized: string) => void
  /** What may be shown on a screen or written to a row that is not the encrypted column. */
  readonly mask: (normalized: string) => string
  /** How many trailing characters `mask` reveals. Stored, so a mask can be rebuilt. */
  readonly revealedTail: number
}

/**
 * How many digits a Bangladeshi NID has.
 *
 * Three lengths are all current, and refusing any of them would turn real people away:
 *
 *  - **10** — the smart card (Jatiya Parichay Patra) issued since 2016.
 *  - **13** — the older paper card.
 *  - **17** — the same older number prefixed with a four-digit birth year, which is how it is
 *    printed on some documents and how several government systems export it.
 *
 * A 13-digit number and its 17-digit form are the same identity. They are NOT normalised into
 * one another here, because deriving the birth year would be inventing data, and dropping it
 * would silently discard something the submitter was asked for.
 */
const NID_LENGTHS: ReadonlySet<number> = new Set([10, 13, 17])

/**
 * Reveal the last four digits and nothing else.
 *
 * Four is the tail a person can recognise as their own without it identifying them to a reader —
 * the same quantity a bank statement shows for a card. The bullet is U+2022, which renders in
 * both Bangla and Latin typefaces; asterisks in a Bangla line look like a footnote.
 */
function maskTail(normalized: string, reveal: number): string {
  if (normalized.length <= reveal) return '•'.repeat(normalized.length)
  return `${'•'.repeat(normalized.length - reveal)}${normalized.slice(-reveal)}`
}

const nidDescriptor: IdentityTypeDescriptor = {
  type: 'NID',
  submittable: true,
  hasBackSide: true,
  revealedTail: 4,

  // Spaces and dashes go, because the number is printed in groups and people copy what they see.
  // Rejecting a correct number over its formatting is a refusal the submitter cannot act on.
  normalize: (raw) => normalizeDigits(raw).replace(/[\s-]/g, ''),

  validate: (value) => {
    if (!/^\d+$/.test(value)) fail('An NID is digits only', 'NID_NOT_NUMERIC')
    if (!NID_LENGTHS.has(value.length)) {
      fail('An NID is 10, 13 or 17 digits', 'NID_LENGTH')
    }
    /*
     * A number of one repeated digit is a placeholder somebody typed to get past the form, not a
     * card. Caught here because it is cheap, and because letting it through spends a reviewer's
     * time on something no reviewer should ever have been shown.
     */
    if (/^(\d)\1+$/.test(value)) fail('That does not look like a real NID', 'NID_IMPLAUSIBLE')
  },

  mask: (value) => maskTail(value, 4),
}

/** A type that is named but not yet accepted. Declared once rather than three near-copies. */
function plannedType(
  type: IdentityType,
  options: { readonly hasBackSide: boolean },
): IdentityTypeDescriptor {
  return {
    type,
    submittable: false,
    hasBackSide: options.hasBackSide,
    revealedTail: 4,
    normalize: (raw) => normalizeDigits(raw).replace(/[\s-]/g, '').toUpperCase(),
    // Refused before syntax is ever consulted: an unsupported document has no correct format, and
    // an error about its length would imply the right length would have worked.
    validate: () => fail('That document type is not accepted yet', 'IDENTITY_TYPE_UNSUPPORTED'),
    mask: (value) => maskTail(value, 4),
  }
}

export const IDENTITY_DESCRIPTORS: Record<IdentityType, IdentityTypeDescriptor> = {
  NID: nidDescriptor,
  BIRTH_CERTIFICATE: plannedType('BIRTH_CERTIFICATE', { hasBackSide: false }),
  PASSPORT: plannedType('PASSPORT', { hasBackSide: false }),
  DRIVING_LICENCE: plannedType('DRIVING_LICENCE', { hasBackSide: true }),
}

/** The types a user may actually submit right now. */
export const SUBMITTABLE_IDENTITY_TYPES: readonly IdentityType[] = IDENTITY_TYPES.filter(
  (type) => IDENTITY_DESCRIPTORS[type].submittable,
)

export interface NormalizedIdentity {
  readonly type: IdentityType
  /** The full number. Encrypted before storage and never logged, returned or rendered. */
  readonly number: string
  /** What may be shown. Safe for a screen, an audit row or a log line. */
  readonly masked: string
  /** The trailing digits kept in clear so a mask can be rendered without decrypting. */
  readonly last4: string
}

/**
 * Normalise and validate a submitted identity number.
 *
 * The one entry point. Everything that accepts an identity number goes through here, so there is
 * exactly one implementation of "an NID is 10, 13 or 17 digits" and exactly one decision about
 * how much of it may be shown.
 *
 * The returned `number` is the sensitive value. Callers are expected to hand it straight to the
 * cipher and keep only `masked` and `last4` anywhere else.
 */
export function normalizeIdentity(type: unknown, raw: unknown): NormalizedIdentity {
  if (!isIdentityType(type)) fail('Unknown document type', 'IDENTITY_TYPE_UNKNOWN', 'identityType')

  const descriptor = IDENTITY_DESCRIPTORS[type]
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail('Enter the number on your document', 'IDENTITY_NUMBER_REQUIRED')
  }

  const normalized = descriptor.normalize(raw)
  descriptor.validate(normalized)

  return {
    type,
    number: normalized,
    masked: descriptor.mask(normalized),
    last4: normalized.slice(-descriptor.revealedTail),
  }
}

/**
 * Render a mask from the digits kept in clear.
 *
 * Used on every read path. A screen showing somebody their own submission does not need the
 * number decrypted to tell them which card it was — and a read path that never decrypts is a
 * read path that cannot leak.
 */
export function maskFromLast4(type: IdentityType, last4: string, totalLength: number): string {
  const reveal = IDENTITY_DESCRIPTORS[type].revealedTail
  const hidden = Math.max(totalLength - reveal, 0)
  return `${'•'.repeat(hidden)}${last4.slice(-reveal)}`
}
