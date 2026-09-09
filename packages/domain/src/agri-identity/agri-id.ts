/**
 * The AGRI-ID — a public name for a person in the agricultural economy.
 *
 * `AGRI-BD-7K4M2QX9`. It goes on a certificate, a delivery note, a cooperative's register and,
 * eventually, a loan application. It is meant to be spoken aloud, written on paper, and read back
 * by somebody who has never seen the platform.
 *
 * ## The one rule the whole module exists to keep
 *
 * **It is random, and it is derived from nothing.**
 *
 * The obvious implementation is a hash of something already unique — the user id, the NID, the
 * phone number. Every one of those is wrong, and the NID version is dangerous: a national ID has
 * perhaps a few billion plausible values, which is nothing to a machine. Anybody holding a
 * hashed-NID AGRI-ID could enumerate the space offline and recover the NID exactly. The same
 * argument retires the phone number, where the space is smaller still.
 *
 * So the body is CSPRNG output and carries no information about its owner at all. There is
 * nothing to invert, because there is no function.
 *
 * ## Public identifier, never a credential
 *
 * The corollary matters as much as the rule. An AGRI-ID is printed on things; it must therefore
 * never be sufficient to *do* anything. Knowing somebody's AGRI-ID must grant no access, exactly
 * as knowing their name does not. Every lookup that takes one has to authorize the caller
 * separately — which is why the only endpoint in this phase is `/me`, taking no identifier at all.
 *
 * ## Why the alphabet excludes four letters
 *
 * Crockford's base32: no `I`, `L`, `O` or `U`. The first three are unreadable next to `1` and `0`
 * in the handwriting this will actually be copied in, and `U` is dropped so that no accidental
 * profanity appears on a farmer's certificate. Input folds `I` and `L` to `1` and `O` to `0`, so
 * somebody who types what they see is not punished for it.
 *
 * Refs: docs/07_SECURITY.md §7; docs/08_BANGLADESH_CONTEXT.md §2
 */

export class AgriIdError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AgriIdError'
  }
}

/** Crockford base32. Thirty-two symbols, none of which can be confused for another. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BASE = ALPHABET.length

/** The prefix every identifier carries, so a bare code is recognisable out of context. */
export const AGRI_ID_PREFIX = 'AGRI'

/**
 * The country segment.
 *
 * Present from the first identifier rather than added later, because retrofitting a country into
 * an identifier already printed on paper is not possible. Bangladesh is the only value today.
 */
export const AGRI_ID_COUNTRIES = ['BD'] as const
export type AgriIdCountry = (typeof AGRI_ID_COUNTRIES)[number]
export const DEFAULT_AGRI_ID_COUNTRY: AgriIdCountry = 'BD'

/**
 * Seven random characters and one check character.
 *
 * Seven symbols of base32 is 35 bits, about thirty-four billion. That is chosen for a person
 * reading it off a card, not for secrecy — see the note above about this never being a
 * credential. Collisions are prevented by a UNIQUE constraint and a retry, not by the width.
 */
export const AGRI_ID_BODY_LENGTH = 8
const RANDOM_LENGTH = AGRI_ID_BODY_LENGTH - 1

/** Bytes needed to fill the random portion without bias. See `agriIdFromBytes`. */
export const AGRI_ID_RANDOM_BYTES = RANDOM_LENGTH

/**
 * Odd weights, so every single-character error changes the checksum.
 *
 * With weight `w` and a character misread by `d`, the checksum shifts by `w·d (mod 32)`. Odd `w`
 * makes that zero only when `d` is a multiple of 32, and `d` is bounded by ±31 — so no single
 * substitution can survive. Transpositions are mostly caught but not universally, which is stated
 * rather than glossed: this detects typing mistakes, and is not a signature.
 */
const WEIGHTS = [1, 3, 5, 7, 9, 11, 13] as const

function checkCharacter(body: string): string {
  let total = 0
  for (let index = 0; index < body.length; index += 1) {
    const value = ALPHABET.indexOf(body[index] ?? '')
    if (value < 0) throw new AgriIdError('Not an AGRI-ID character', 'AGRI_ID_ALPHABET')
    total += value * (WEIGHTS[index] ?? 1)
  }
  return ALPHABET[total % BASE] ?? '0'
}

/**
 * Build an identifier from random bytes.
 *
 * Pure, so the domain owns the format and the infrastructure owns the entropy — and so a test can
 * pin an exact identifier by supplying exact bytes.
 *
 * Each byte becomes one symbol by `byte % 32`. A byte holds 256 values and 256 is a multiple of
 * 32, so every symbol is equally likely: the usual modulo bias does not arise here. Stated
 * because the same line with a 33-symbol alphabet would be quietly biased.
 */
export function agriIdFromBytes(bytes: Uint8Array, country: AgriIdCountry): string {
  if (bytes.byteLength < RANDOM_LENGTH) {
    throw new AgriIdError('Not enough random material', 'AGRI_ID_ENTROPY')
  }

  let body = ''
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    body += ALPHABET[(bytes[index] ?? 0) % BASE]
  }

  return `${AGRI_ID_PREFIX}-${country}-${body}${checkCharacter(body)}`
}

const COUNTRIES: ReadonlySet<string> = new Set(AGRI_ID_COUNTRIES)

/**
 * Case and separators only.
 *
 * Deliberately does NOT fold the confusable letters. That folding must happen to the BODY alone —
 * applied to the whole string it turns the `AGRI` prefix into `AGR1`, which was exactly the bug
 * the round-trip test caught. The prefix and the country are letters that mean themselves; only
 * the random body is base32.
 */
export function normalizeAgriId(raw: string): string {
  /*
   * The ASCII hyphen is named explicitly.
   *
   * An earlier version used a Unicode dash RANGE, which runs from U+2010 and therefore does not
   * contain U+002D — so the ordinary hyphen in `AGRI-BD-...` survived normalisation and nothing
   * ever parsed. The typographic dashes are still folded, because text pasted out of a document
   * carries them.
   */
  return raw.toUpperCase().replace(/[\s_-‐-―]/g, '')
}

/**
 * Fold the four letters the alphabet excludes, for the body only.
 *
 * Reading `O` for `0` and `I` or `L` for `1` off a printed card is the commonest copying mistake
 * there is, and punishing it would be punishing the reader for the typeface.
 */
function foldConfusables(body: string): string {
  return body.replace(/[IL]/g, '1').replace(/O/g, '0')
}

export interface ParsedAgriId {
  readonly country: AgriIdCountry
  /** The eight-character body, check character included. */
  readonly body: string
  /** The canonical, printable form. */
  readonly value: string
}

/**
 * Read an identifier back, or refuse it.
 *
 * The check character is verified here rather than by whoever queries with the result. A
 * mistyped identifier that reaches a database is a lookup that either finds nothing — wasting
 * everybody's time with "no such profile" — or, far worse, finds somebody else.
 */
export function parseAgriId(raw: unknown): ParsedAgriId {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new AgriIdError('Enter an AGRI-ID', 'AGRI_ID_REQUIRED')
  }

  const normalized = normalizeAgriId(raw)
  // The dashes are stripped by normalisation, so the shape is matched on the run of characters.
  const match = /^AGRI([A-Z]{2})([0-9A-Z]{8})$/.exec(normalized)
  if (match === null) throw new AgriIdError('That is not an AGRI-ID', 'AGRI_ID_FORMAT')

  const country = match[1] ?? ''
  // Folded here and nowhere earlier, so the prefix and the country survive intact.
  const body = foldConfusables(match[2] ?? '')

  if (!COUNTRIES.has(country)) {
    throw new AgriIdError('Unknown country in that AGRI-ID', 'AGRI_ID_COUNTRY')
  }

  const payload = body.slice(0, RANDOM_LENGTH)
  const presented = body.slice(RANDOM_LENGTH)

  if (checkCharacter(payload) !== presented) {
    throw new AgriIdError('That AGRI-ID has a typing mistake', 'AGRI_ID_CHECKSUM')
  }

  return {
    country: country as AgriIdCountry,
    body,
    value: `${AGRI_ID_PREFIX}-${country}-${body}`,
  }
}

export function isAgriId(raw: unknown): boolean {
  try {
    parseAgriId(raw)
    return true
  } catch {
    return false
  }
}

/**
 * The pattern the database column is constrained to.
 *
 * Exported so the migration and the application are constrained by one expression rather than two
 * that drift. `U` is absent from the ranges, which is what `A-HJ-NP-TV-Z` encodes.
 */
export const AGRI_ID_SQL_PATTERN = '^AGRI-[A-Z]{2}-[0-9A-HJ-NP-TV-Z]{8}$'
