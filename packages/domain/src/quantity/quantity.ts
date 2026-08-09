/**
 * Agricultural quantities.
 *
 * The metric base unit is authoritative: every quantity in the platform is an integer count of
 * milligrams, millilitres or pieces. `mon`, `seer`, `hali` and `kg` are how people talk about
 * produce, and the product must speak that language — but it converts at the edge and stores
 * the integer. A farmer may list in `mon` and a consumer may buy in `kg`; the listing, the
 * order and the ledger all see one exact number.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §5, docs/02_DATABASE.md §6, §6.1
 */

import { absBigInt, divideRounded, pow10, type RoundingMode } from '../math/integer.js'
import { toAsciiDigits } from '../intl/numerals.js'
import { QuantityError } from './errors.js'
import type { BaseQuantity, SaleUnit } from './types.js'
import { areCompatible, baseUnitsPer } from './units.js'

const DIGITS = /^[0-9]+$/

/** Beyond ~10^18 base units (10^9 kg) an input is a typo or an attack, not a consignment. */
export const MAX_BASE_QUANTITY = 1000000000000000000n

/** More than nine decimal places in a typed quantity is noise, not precision. */
const MAX_INPUT_SCALE = 9

function brand(value: bigint): BaseQuantity {
  return value as BaseQuantity
}

function guard(value: bigint, operation: string): BaseQuantity {
  if (value > MAX_BASE_QUANTITY || value < -MAX_BASE_QUANTITY) {
    throw new QuantityError(
      'OUT_OF_RANGE',
      `Quantity out of representable range in ${operation}`,
      value.toString(),
    )
  }
  return brand(value)
}

export const zero: BaseQuantity = brand(0n)

/** A decimal string parsed into an exact scaled integer: `"5.5"` → `{ digits: 55n, scale: 1 }`. */
interface ParsedDecimal {
  readonly negative: boolean
  readonly digits: bigint
  readonly scale: number
}

function parseDecimal(input: string): ParsedDecimal {
  const raw = input.trim()
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const dot = unsigned.indexOf('.')
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot)
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1)

  if (!DIGITS.test(whole)) {
    throw new QuantityError('INVALID_INPUT', `Not a quantity: "${input}"`)
  }
  if (dot !== -1 && !DIGITS.test(fraction)) {
    throw new QuantityError('INVALID_INPUT', `Not a quantity: "${input}"`)
  }
  if (fraction.length > MAX_INPUT_SCALE) {
    throw new QuantityError('PRECISION_LOSS', `Quantity "${input}" has implausible precision`)
  }

  return { negative, digits: BigInt(whole + fraction), scale: fraction.length }
}

/**
 * Convert a human-entered amount in some sale unit into base units.
 *
 * Accepts a decimal string (`"5.5"`, `"২.৫"`), a whole `bigint`, or a safe-integer `number`.
 * A value that cannot be represented exactly in base units raises `PRECISION_LOSS` rather than
 * rounding — at this layer, rounding a farmer's stated quantity is not ours to do.
 */
export function toBase(amount: string | bigint | number, unit: SaleUnit): BaseQuantity {
  const per = baseUnitsPer(unit)

  if (typeof amount === 'bigint') return guard(amount * per, 'toBase')
  if (typeof amount === 'number') {
    if (!Number.isSafeInteger(amount)) {
      throw new QuantityError(
        'INVALID_INPUT',
        `toBase requires a safe integer or a decimal string, received ${String(amount)}`,
      )
    }
    return guard(BigInt(amount) * per, 'toBase')
  }

  const { negative, digits, scale } = parseDecimal(toAsciiDigits(amount))
  const numerator = digits * per
  const denominator = pow10(scale)
  if (numerator % denominator !== 0n) {
    throw new QuantityError(
      'PRECISION_LOSS',
      `${amount} ${unit} is not a whole number of base units`,
      `${numerator.toString()} / ${denominator.toString()}`,
    )
  }
  const magnitude = numerator / denominator
  return guard(negative ? -magnitude : magnitude, 'toBase')
}

/** Is this quantity an exact whole number of the given sale unit? */
export function isExactIn(quantity: BaseQuantity, unit: SaleUnit): boolean {
  return quantity % baseUnitsPer(unit) === 0n
}

/**
 * Render a base quantity in a sale unit as a decimal string, rounding half-up at
 * `maxDecimals` and trimming trailing zeros: `"5"`, `"5.5"`, `"0.25"`.
 */
export function toUnitString(
  quantity: BaseQuantity,
  unit: SaleUnit,
  maxDecimals = 3,
  mode: RoundingMode = 'HALF_UP',
): string {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > MAX_INPUT_SCALE) {
    throw new QuantityError('INVALID_INPUT', `maxDecimals ${String(maxDecimals)} is out of range`)
  }

  const per = baseUnitsPer(unit)
  const negative = quantity < 0n
  const scaled = absBigInt(quantity) * pow10(maxDecimals)
  const value = divideRounded(scaled, per, mode)
  const sign = negative && value !== 0n ? '-' : ''

  if (maxDecimals === 0) return `${sign}${value.toString()}`

  const padded = value.toString().padStart(maxDecimals + 1, '0')
  const whole = padded.slice(0, padded.length - maxDecimals)
  const fraction = padded.slice(padded.length - maxDecimals).replace(/0+$/, '')
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`
}

/**
 * Convert an amount from one sale unit to another, e.g. `"1"` mon → `"37.324"` kg.
 * Units measuring different dimensions cannot be converted; that is an error, not a guess.
 */
export function convert(
  amount: string | bigint | number,
  from: SaleUnit,
  to: SaleUnit,
  maxDecimals = 3,
): string {
  if (!areCompatible(from, to)) {
    throw new QuantityError(
      'INCOMPATIBLE_UNITS',
      `Cannot convert ${from} to ${to}: they measure different things`,
    )
  }
  return toUnitString(toBase(amount, from), to, maxDecimals)
}

/* ------------------------------------------------------------------- arithmetic */

export function add(a: BaseQuantity, b: BaseQuantity): BaseQuantity {
  return guard(a + b, 'add')
}

export function subtract(a: BaseQuantity, b: BaseQuantity): BaseQuantity {
  return guard(a - b, 'subtract')
}

export function multiply(quantity: BaseQuantity, factor: bigint | number): BaseQuantity {
  if (typeof factor === 'number' && !Number.isSafeInteger(factor)) {
    throw new QuantityError('INVALID_INPUT', `multiply requires a whole factor`)
  }
  return guard(quantity * BigInt(factor), 'multiply')
}

export function compare(a: BaseQuantity, b: BaseQuantity): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isZero(quantity: BaseQuantity): boolean {
  return quantity === 0n
}

export function fromBaseUnits(value: bigint | number | string): BaseQuantity {
  if (typeof value === 'bigint') return guard(value, 'fromBaseUnits')
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new QuantityError('INVALID_INPUT', `Not a base quantity: ${String(value)}`)
    }
    return guard(BigInt(value), 'fromBaseUnits')
  }
  const raw = value.trim()
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  if (!DIGITS.test(unsigned)) {
    throw new QuantityError('INVALID_INPUT', `Not a base quantity: "${value}"`)
  }
  const magnitude = BigInt(unsigned)
  return guard(negative ? -magnitude : magnitude, 'fromBaseUnits')
}

/** Quantities cross a process boundary as strings, for the same reason money does. */
export function serialize(quantity: BaseQuantity): string {
  return quantity.toString()
}

export function deserialize(value: string): BaseQuantity {
  return fromBaseUnits(value)
}

/**
 * Assert a quantity is strictly positive. A listing of zero kilograms, or of minus five, is not
 * a listing.
 */
export function requirePositive(quantity: BaseQuantity, label: string): BaseQuantity {
  if (quantity <= 0n) {
    throw new QuantityError(
      'NEGATIVE_NOT_ALLOWED',
      `${label} must be greater than zero`,
      quantity.toString(),
    )
  }
  return quantity
}

/** Assert a quantity is not negative. Available stock may legitimately be zero. */
export function requireNonNegative(quantity: BaseQuantity, label: string): BaseQuantity {
  if (quantity < 0n) {
    throw new QuantityError(
      'NEGATIVE_NOT_ALLOWED',
      `${label} must not be negative`,
      quantity.toString(),
    )
  }
  return quantity
}
