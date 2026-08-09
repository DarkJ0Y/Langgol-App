/**
 * Integer money arithmetic for Langgol.
 *
 * Every taka that moves through the platform passes through this module. It is deliberately
 * small, total (no silent failure paths), and held to 100% test coverage in CI.
 *
 * Design rules:
 *  - Amounts are integer **poisha** in a `bigint`. No floats, ever.
 *  - Rates are **basis points**, never fractions. `0.03` cannot be represented exactly in
 *    binary floating point; `300` bps can.
 *  - Rounding is half-up (away from zero on a tie) and happens **once**, where the domain says
 *    it happens — at the line level. See docs/02_DATABASE.md §1.1.
 *  - Allocation never loses or invents a poisha; the remainder goes where the caller says.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §2, §4
 */

import { MoneyError } from './errors.js'
import type { Poisha, RoundingMode } from './types.js'

/** 1 BDT = 100 poisha. */
export const POISHA_PER_TAKA = 100n

/** Rates are expressed in basis points: 300 bps = 3%. */
export const BPS_DENOMINATOR = 10000n

/**
 * ±10^18 poisha (≈ ±৳10 quadrillion). Bangladesh's entire annual agricultural output does not
 * approach this. A value beyond the bound is a bug or hostile input, not an amount, and is
 * rejected rather than stored.
 */
export const MAX_POISHA = 1000000000000000000n
export const MIN_POISHA = -MAX_POISHA

const DIGITS = /^[0-9]+$/

function brand(value: bigint): Poisha {
  return value as Poisha
}

function guard(value: bigint, operation: string): Poisha {
  if (value > MAX_POISHA || value < MIN_POISHA) {
    throw new MoneyError(
      'OUT_OF_RANGE',
      `Money value out of representable range in ${operation}`,
      value.toString(),
    )
  }
  return brand(value)
}

function toInteger(value: bigint | number, operation: string): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      'INVALID_INPUT',
      `${operation} requires a safe integer, received ${String(value)}`,
    )
  }
  return BigInt(value)
}

/* ------------------------------------------------------------------ construction */

/** Zero taka. */
export const zero: Poisha = brand(0n)

/**
 * Build money from a raw poisha count.
 *
 * Accepts `bigint` (preferred), a safe-integer `number`, or a digit string — the last being how
 * money arrives from JSON, since `bigint` has no JSON representation.
 */
export function fromPoisha(value: bigint | number | string): Poisha {
  if (typeof value === 'bigint') return guard(value, 'fromPoisha')
  if (typeof value === 'number') return guard(toInteger(value, 'fromPoisha'), 'fromPoisha')

  const raw = value.trim()
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  if (!DIGITS.test(unsigned)) {
    throw new MoneyError('INVALID_INPUT', `Not a poisha string: "${value}"`)
  }
  const magnitude = BigInt(unsigned)
  return guard(negative ? -magnitude : magnitude, 'fromPoisha')
}

/**
 * Build money from a taka string such as `"1234.50"`.
 *
 * Strict by design: it takes a **string**, never a `number`, because `0.1 + 0.2` is the reason
 * this module exists. More than two decimal places is a `PRECISION_LOSS` error rather than a
 * silent truncation — losing a farmer's poisha quietly is worse than failing loudly.
 */
export function fromTaka(value: string): Poisha {
  const raw = value.trim()
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const dot = unsigned.indexOf('.')
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot)
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1)

  if (!DIGITS.test(whole)) {
    throw new MoneyError('INVALID_INPUT', `Not a taka amount: "${value}"`)
  }
  if (dot !== -1 && !DIGITS.test(fraction)) {
    throw new MoneyError('INVALID_INPUT', `Not a taka amount: "${value}"`)
  }
  if (fraction.length > 2) {
    throw new MoneyError(
      'PRECISION_LOSS',
      `Taka amount "${value}" has sub-poisha precision that would be silently lost`,
    )
  }

  const paisa = (fraction + '00').slice(0, 2)
  const magnitude = BigInt(whole) * POISHA_PER_TAKA + BigInt(paisa)
  return guard(negative ? -magnitude : magnitude, 'fromTaka')
}

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Convert Bangla digits to ASCII so a farmer typing `১২৩` is understood. */
export function normalizeDigits(input: string): string {
  let out = ''
  for (const character of input) {
    const index = BANGLA_DIGITS.indexOf(character)
    out += index === -1 ? character : String(index)
  }
  return out
}

/**
 * Parse money as a human typed it: Bangla or ASCII digits, optional `৳`, optional grouping
 * separators and stray whitespace. Validation still happens — this is lenient about
 * *presentation*, never about *precision*.
 */
export function parseTakaInput(input: string): Poisha {
  const cleaned = normalizeDigits(input).replace(/[৳,\s]/g, '')
  return fromTaka(cleaned)
}

/** Render as a plain taka string with two decimals, e.g. `"-1234.50"`. No symbol, no grouping. */
export function toTakaString(value: Poisha): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const whole = magnitude / POISHA_PER_TAKA
  const fraction = magnitude % POISHA_PER_TAKA
  return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(2, '0')}`
}

/** Money crosses a process boundary as a string. `bigint` is not JSON-representable. */
export function serialize(value: Poisha): string {
  return value.toString()
}

/** Inverse of {@link serialize}. */
export function deserialize(value: string): Poisha {
  return fromPoisha(value)
}

/* -------------------------------------------------------------------- arithmetic */

export function add(a: Poisha, b: Poisha): Poisha {
  return guard(a + b, 'add')
}

export function subtract(a: Poisha, b: Poisha): Poisha {
  return guard(a - b, 'subtract')
}

export function sum(values: readonly Poisha[]): Poisha {
  let total = 0n
  for (const value of values) total += value
  return guard(total, 'sum')
}

/** Multiply by a whole number — a count of units, not a rate. */
export function multiply(value: Poisha, factor: bigint | number): Poisha {
  return guard(value * toInteger(factor, 'multiply'), 'multiply')
}

function divideBigInt(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new MoneyError('DIVISION_BY_ZERO', 'Division by zero in money arithmetic')
  }

  // Normalise so the denominator is positive; the sign rides on the numerator.
  const n = denominator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator

  const quotient = n / d
  const remainder = n % d
  if (remainder === 0n) return quotient
  if (mode === 'TRUNCATE') return quotient

  // HALF_UP: ties round away from zero.
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n
  if (twiceRemainder >= d) return remainder > 0n ? quotient + 1n : quotient - 1n
  return quotient
}

/** Divide by a whole number, rounding half-up by default. */
export function divide(
  value: Poisha,
  divisor: bigint | number,
  mode: RoundingMode = 'HALF_UP',
): Poisha {
  return guard(divideBigInt(value, toInteger(divisor, 'divide'), mode), 'divide')
}

/**
 * Scale money by an exact rational `numerator / denominator`.
 *
 * This is the only way a rate is ever applied to money. Rates arrive as integers (basis points,
 * unit counts, weights) so the computation stays exact until the single documented rounding step.
 */
export function multiplyByRatio(
  value: Poisha,
  numerator: bigint | number,
  denominator: bigint | number,
  mode: RoundingMode = 'HALF_UP',
): Poisha {
  const n = toInteger(numerator, 'multiplyByRatio')
  const d = toInteger(denominator, 'multiplyByRatio')
  return guard(divideBigInt(value * n, d, mode), 'multiplyByRatio')
}

/**
 * Apply a rate expressed in basis points. `percentBps(x, 300)` is 3% of `x`.
 *
 * Commission, platform fees and pro-rata reversals all route through here, which is why the
 * commission rate can live in `PlatformConfig` as an integer and never as `0.03`.
 */
export function percentBps(
  value: Poisha,
  bps: bigint | number,
  mode: RoundingMode = 'HALF_UP',
): Poisha {
  return multiplyByRatio(value, bps, BPS_DENOMINATOR, mode)
}

/* -------------------------------------------------------------------- allocation */

/**
 * Split an amount across weights so the parts sum **exactly** to the whole.
 *
 * Each share is truncated, then the leftover poisha are added to `remainderTo`. Langgol's
 * convention is that the remainder goes to the platform, never to the farmer or the buyer —
 * so the caller passes the platform's index. Making it a required argument rather than a
 * default is deliberate: silently favouring index 0 is how rounding quietly becomes policy.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §2
 */
export function allocate(total: Poisha, weights: readonly bigint[], remainderTo: number): Poisha[] {
  if (total < 0n) {
    throw new MoneyError('NEGATIVE_NOT_ALLOWED', 'Cannot allocate a negative amount')
  }
  if (weights.length === 0) {
    throw new MoneyError('INVALID_ALLOCATION', 'Allocation requires at least one weight')
  }
  if (!Number.isInteger(remainderTo) || remainderTo < 0 || remainderTo >= weights.length) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      `remainderTo ${String(remainderTo)} is not a valid weight index`,
    )
  }

  let totalWeight = 0n
  for (const weight of weights) {
    if (weight < 0n) {
      throw new MoneyError('INVALID_ALLOCATION', 'Allocation weights must be non-negative')
    }
    totalWeight += weight
  }
  if (totalWeight === 0n) {
    throw new MoneyError('INVALID_ALLOCATION', 'Allocation weights must not sum to zero')
  }

  let distributed = 0n
  const shares: bigint[] = []
  for (const weight of weights) {
    const share = (total * weight) / totalWeight
    shares.push(share)
    distributed += share
  }

  const leftover = total - distributed
  return shares.map((share, index) => brand(index === remainderTo ? share + leftover : share))
}

/* ------------------------------------------------------------------- comparison */

export function compare(a: Poisha, b: Poisha): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function equals(a: Poisha, b: Poisha): boolean {
  return a === b
}

export function isZero(value: Poisha): boolean {
  return value === 0n
}

export function isPositive(value: Poisha): boolean {
  return value > 0n
}

export function isNegative(value: Poisha): boolean {
  return value < 0n
}

export function negate(value: Poisha): Poisha {
  return guard(-value, 'negate')
}

export function abs(value: Poisha): Poisha {
  return value < 0n ? guard(-value, 'abs') : value
}

export function min(a: Poisha, b: Poisha): Poisha {
  return a < b ? a : b
}

export function max(a: Poisha, b: Poisha): Poisha {
  return a > b ? a : b
}

/**
 * Assert an amount is not negative.
 *
 * Money is signed because a ledger needs reversals, but most business quantities — a price, a
 * fee, a payout — must never be negative. Call this at the boundary where that is true.
 */
export function requireNonNegative(value: Poisha, label: string): Poisha {
  if (value < 0n) {
    throw new MoneyError('NEGATIVE_NOT_ALLOWED', `${label} must not be negative`, value.toString())
  }
  return value
}
