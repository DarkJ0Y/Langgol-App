/**
 * Bangladeshi mobile number handling.
 *
 * The phone number is the primary identity in Langgol — most users have no email — so
 * normalisation is an identity concern, not a formatting nicety. Storing `01712-345678` and
 * `+8801712345678` as two rows means one person becomes two accounts, two reputations and,
 * eventually, two payouts. The database enforces the normalised form as well
 * (`users_phone_e164_bd`); this is the layer that produces it.
 *
 * Accepted inputs, because these are what people actually type:
 *   01712345678 · 01712-345678 · 0171 234 5678 · 8801712345678 · +8801712345678
 *   1712345678 (leading zero dropped) · ০১৭১২৩৪৫৬৭৮ (Bangla digits)
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §4; docs/07_SECURITY.md §3.1
 */

import { toAsciiDigits } from '../intl/numerals.js'

declare const phoneBrand: unique symbol

/** A Bangladeshi mobile number in E.164 form: `+8801XXXXXXXXX`. */
export type E164Phone = string & { readonly [phoneBrand]: 'E164Phone' }

export type PhoneErrorCode = 'EMPTY' | 'NOT_NUMERIC' | 'WRONG_LENGTH' | 'UNKNOWN_OPERATOR'

export class PhoneError extends Error {
  readonly code: PhoneErrorCode

  constructor(code: PhoneErrorCode, message: string) {
    super(message)
    this.name = 'PhoneError'
    this.code = code
  }
}

const COUNTRY_CODE = '880'
const NATIONAL_DIGITS = 10 // after the trunk zero: 1XXXXXXXXX

/**
 * Operator prefixes in use in Bangladesh (the digit following `01`).
 *
 * Kept as an explicit set rather than a loose `[0-9]` so that a typo like `01212345678` is
 * rejected at the boundary instead of becoming an account that can never receive an OTP.
 */
const OPERATOR_DIGITS = new Set(['3', '4', '5', '6', '7', '8', '9'])

/**
 * Normalise a typed phone number to E.164, or explain why it cannot be.
 *
 * Throws `PhoneError` rather than returning null so the caller cannot accidentally proceed with
 * an unnormalised value; every rejection carries a code the interface layer can translate.
 */
export function normalizePhone(input: string): E164Phone {
  if (input.trim().length === 0) {
    throw new PhoneError('EMPTY', 'A phone number is required')
  }

  // Bangla digits first, then strip everything a human might use as separators.
  const digitsOnly = toAsciiDigits(input).replace(/[\s\-().+]/g, '')

  if (!/^[0-9]+$/.test(digitsOnly)) {
    throw new PhoneError('NOT_NUMERIC', 'A phone number may only contain digits')
  }

  let national: string
  if (digitsOnly.startsWith(COUNTRY_CODE)) {
    national = digitsOnly.slice(COUNTRY_CODE.length)
  } else {
    national = digitsOnly
  }

  // Drop the trunk prefix if present: 01712345678 → 1712345678
  if (national.length === NATIONAL_DIGITS + 1 && national.startsWith('0')) {
    national = national.slice(1)
  }

  if (national.length !== NATIONAL_DIGITS) {
    throw new PhoneError(
      'WRONG_LENGTH',
      'A Bangladeshi mobile number has 11 digits, starting with 01',
    )
  }

  const operator = national.charAt(1)
  if (!national.startsWith('1') || !OPERATOR_DIGITS.has(operator)) {
    throw new PhoneError('UNKNOWN_OPERATOR', 'That does not look like a Bangladeshi mobile number')
  }

  return `+${COUNTRY_CODE}${national}` as E164Phone
}

/** Non-throwing variant for input that is expected to be invalid sometimes. */
export function tryNormalizePhone(input: string): E164Phone | null {
  try {
    return normalizePhone(input)
  } catch (error) {
    if (error instanceof PhoneError) return null
    throw error
  }
}

export function isE164Phone(value: string): value is E164Phone {
  return /^\+8801[3-9][0-9]{8}$/.test(value)
}

/**
 * Mask for logs, support screens and anywhere a full number is not needed.
 * `+8801712345678` → `+88017****5678`.
 *
 * Logs never contain a full phone number. It is directly identifying, it is the account
 * identifier, and it is the first thing an attacker needs. docs/07_SECURITY.md §9.2
 */
export function maskPhone(phone: E164Phone | string): string {
  if (phone.length < 8) return '****'
  return `${phone.slice(0, 7)}****${phone.slice(-4)}`
}

/** Render for a Bangladeshi reader: `+8801712345678` → `01712-345678`. */
export function formatPhoneNational(phone: E164Phone): string {
  const national = `0${phone.slice(`+${COUNTRY_CODE}`.length)}`
  return `${national.slice(0, 5)}-${national.slice(5)}`
}
