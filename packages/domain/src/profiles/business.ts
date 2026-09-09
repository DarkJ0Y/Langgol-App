/**
 * Business identity — the credentials a trading entity carries.
 *
 * Retailers, wholesalers and suppliers all present the same three documents, so they are
 * validated in one place rather than three. That is the "do not duplicate validation logic"
 * instruction taken literally: a TIN typed into the supplier form and a TIN typed into the
 * retailer form must be judged by the same rule, or the two forms will drift and one of them
 * will start accepting numbers the other rejects.
 *
 * ## What is NOT validated here, and why
 *
 * None of these checks proves a document is real — only that it has the shape of one. A
 * well-formed TIN belonging to somebody else passes every rule below. Real verification means
 * checking the number against NBR and the licence against the issuing city corporation, which is
 * an operational process with evidence behind it, not a regular expression. That is what
 * `verificationStatus` is for, and why it starts at `UNVERIFIED` and is never set by the person
 * being verified.
 *
 * Refs: docs/07_SECURITY.md §7; docs/06_FINANCIAL_ARCHITECTURE.md §10
 */

import { toAsciiDigits } from '../intl/numerals.js'

export class BusinessIdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'BusinessIdentityError'
  }
}

function fail(message: string, code: string, field: string): never {
  throw new BusinessIdentityError(message, code, field)
}

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

/**
 * Bangladeshi e-TIN: twelve digits.
 *
 * Spaces and dashes are stripped before checking, because the number is printed on the
 * certificate in groups and people copy it the way they see it. Rejecting a correct number over
 * its formatting is the kind of validation that teaches users to distrust a form.
 */
export function normalizeTin(input: string): string | null {
  const raw = normalizeDigits(input).replace(/[\s-]/g, '')
  if (raw === '') return null
  if (!/^\d{12}$/.test(raw)) {
    fail('A TIN is twelve digits', 'TIN_FORMAT', 'tin')
  }
  return raw
}

/**
 * Business Identification Number — the VAT registration, thirteen digits.
 *
 * Distinct from the TIN and frequently confused with it, which is exactly why both are validated
 * by length: a BIN typed into the TIN box is caught here rather than reaching the tax hooks in
 * docs/06 §10 as a number that will never match anything.
 */
export function normalizeBin(input: string): string | null {
  const raw = normalizeDigits(input).replace(/[\s-]/g, '')
  if (raw === '') return null
  if (!/^\d{13}$/.test(raw)) {
    fail('A BIN is thirteen digits', 'BIN_FORMAT', 'bin')
  }
  return raw
}

/**
 * Trade licence number.
 *
 * Deliberately loose. Every city corporation and union parishad issues its own format — some are
 * numeric, some carry a ward prefix, some carry a year — and there is no national pattern to
 * check against. A strict rule here would reject valid licences from whichever districts the
 * author had not seen, so this only refuses what is obviously not a licence number at all.
 */
export function normalizeTradeLicence(input: string): string | null {
  const raw = normalizeDigits(input).trim()
  if (raw === '') return null
  if (raw.length > 40) {
    fail('That licence number is too long', 'LICENCE_TOO_LONG', 'tradeLicence')
  }
  if (!/^[A-Za-z0-9/\\\-\s.]+$/.test(raw)) {
    fail(
      'A licence number has no punctuation beyond dashes and slashes',
      'LICENCE_FORMAT',
      'tradeLicence',
    )
  }
  return raw
}

/** A business name, or a company name. The one field none of these roles can do without. */
export function normalizeBusinessName(input: string, field = 'businessName'): string {
  const name = input.trim()
  if (name === '') fail('Enter the business name', 'NAME_EMPTY', field)
  if (name.length > 160) fail('That name is too long', 'NAME_TOO_LONG', field)
  return name
}

export interface BusinessIdentityInput {
  readonly tin?: string | null
  readonly bin?: string | null
  readonly tradeLicence?: string | null
}

export interface BusinessIdentity {
  readonly tin: string | null
  readonly bin: string | null
  readonly tradeLicence: string | null
}

/**
 * Validate whichever business documents were supplied.
 *
 * All three are optional at this layer. A shopkeeper registering at nine in the evening does not
 * have their licence to hand, and a form that refuses to save without it means they never come
 * back. Which documents are REQUIRED to trade is a policy decision that belongs with
 * verification, not with a text input.
 */
export function validateBusinessIdentity(input: BusinessIdentityInput): Partial<BusinessIdentity> {
  const changes: Partial<Record<keyof BusinessIdentity, string | null>> = {}

  if (input.tin !== undefined) changes.tin = input.tin === null ? null : normalizeTin(input.tin)
  if (input.bin !== undefined) changes.bin = input.bin === null ? null : normalizeBin(input.bin)
  if (input.tradeLicence !== undefined) {
    changes.tradeLicence =
      input.tradeLicence === null ? null : normalizeTradeLicence(input.tradeLicence)
  }

  return changes
}
