/**
 * Exact integer arithmetic shared by money and quantity.
 *
 * Both modules need the same rounding semantics, and having two implementations of "divide and
 * round" in a codebase that handles farmers' earnings is precisely the kind of duplication that
 * drifts apart. One implementation, one set of tests.
 */

/**
 * - `HALF_UP` — ties round **away from zero** (2.5 → 3, −2.5 → −3). The normative rule for
 *   line totals and fees. See docs/02_DATABASE.md §1.1.
 * - `TRUNCATE` — drop the remainder, rounding **toward zero**.
 */
export type RoundingMode = 'HALF_UP' | 'TRUNCATE'

/**
 * Divide two integers with an explicit rounding mode.
 *
 * **Precondition:** `denominator !== 0n`. Callers validate and raise their own domain error, so
 * this function stays free of any particular error vocabulary.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  // Normalise so the denominator is positive; the sign rides on the numerator.
  const n = denominator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator

  const quotient = n / d
  const remainder = n % d
  if (remainder === 0n) return quotient
  if (mode === 'TRUNCATE') return quotient

  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n
  if (twiceRemainder >= d) return remainder > 0n ? quotient + 1n : quotient - 1n
  return quotient
}

/** Absolute value of an integer. */
export function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value
}

/** `10n ** exponent`, for exponents in the range this codebase actually uses. */
export function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}
