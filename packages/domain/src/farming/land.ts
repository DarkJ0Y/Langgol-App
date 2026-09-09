/**
 * Land area: the farmer's own number, in the farmer's own unit.
 *
 * The storage shape is a pair — an integer amount and the unit it was given in — rather than one
 * normalised number, and that is deliberate. Normalising on the way in loses the answer: a farmer
 * who says "two bigha" and is shown "66 decimals" next year will reasonably conclude the record
 * is wrong. Keeping the unit means the profile can always say back exactly what was said to it.
 *
 * Comparison and aggregation still need a common unit, so `toMilliDecimals` converts on demand.
 * The canonical unit is the **decimal** (শতক) — 1/100 acre — because that is what `Farm.landAreaDecimals`
 * already uses; a second canonical unit in the same schema would be a bug waiting to happen.
 *
 * ## Why integers
 *
 * "2.5 bigha" is a normal answer, so the amount is scaled by 1000 and stored as an integer:
 * 2.5 bigha → `2500`. Floating point in a column that is later summed across thousands of farmers
 * drifts, and the house rule everywhere else in this schema (poisha, milligrams) is that a
 * fractional quantity is an integer in a smaller unit.
 *
 * These factors are UNIT CONVERSIONS, not business rates — a bigha does not change because the
 * pricing committee met. They belong in code, not in `PlatformConfig`.
 */

import type { LandUnit } from './catalogue.js'

/** The scale applied to the farmer's number before storing it. 2.5 bigha → 2500. */
import { toAsciiDigits } from '../intl/numerals.js'

export const LAND_AMOUNT_SCALE = 1000

/**
 * Milli-decimals in one of each unit.
 *
 * `KATHA` and `BIGHA` follow the **Dhaka convention**: 1 bigha = 20 katha = 33 decimals. Other
 * regions use different bigha sizes (Sylhet and parts of Rajshahi notably differ), so a farmer
 * outside the Dhaka convention who reports in bigha will be recorded slightly off. That is a
 * known limitation, and it is why the entered unit is preserved: the original answer survives
 * even if the conversion is later corrected per region.
 *
 * `HECTARE` is 247.105 decimals, truncated at milli precision.
 */
const MILLI_DECIMALS_PER_UNIT: Record<LandUnit, number> = {
  DECIMAL: 1_000,
  KATHA: 1_650,
  BIGHA: 33_000,
  ACRE: 100_000,
  HECTARE: 247_105,
}

/**
 * The largest area the form will accept, in milli-decimals — 1000 acres.
 *
 * Not an agricultural judgement about how much land somebody may own. It is a typo guard: the
 * realistic Bangladeshi smallholding is under 250 decimals, so anything past a thousand acres is
 * a slipped decimal point or a phone number in the wrong box, and letting it through would
 * poison every average computed over this column.
 */
export const MAX_LAND_MILLI_DECIMALS = 100_000_000

/**
 * Convert a stored (amount, unit) pair to milli-decimals.
 *
 * Rounded, not truncated. Land area is a measurement, not money — there is no counterparty to be
 * short-changed by a half-unit — so the nearest value is the honest one. `Math.round` is safe
 * here because the inputs are bounded well inside `Number.MAX_SAFE_INTEGER`.
 */
export function toMilliDecimals(amountMilli: number, unit: LandUnit): number {
  return Math.round((amountMilli * MILLI_DECIMALS_PER_UNIT[unit]) / LAND_AMOUNT_SCALE)
}

/** The same value in whole decimals (শতক), rounded. For display and for comparison with `Farm`. */
export function toDecimals(amountMilli: number, unit: LandUnit): number {
  return Math.round(toMilliDecimals(amountMilli, unit) / LAND_AMOUNT_SCALE)
}

export class LandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'LandError'
  }
}

/**
 * Parse what a farmer typed into a storable integer amount.
 *
 * Accepts `"2"`, `"2.5"`, `"০.৫"` — Bangla digits are normalised first, because a Bangla-first
 * interface that then refuses Bangla numerals is a trap for exactly the users it was built for.
 *
 * An empty string is `null`, not an error: leaving the land question blank is allowed, and the
 * caller distinguishes "did not say" from "said zero".
 */
export function parseLandAmount(input: string): number | null {
  const trimmed = normalizeDigits(input).trim()
  if (trimmed === '') return null

  if (!/^\d{1,9}(\.\d{1,3})?$/.test(trimmed)) {
    throw new LandError(
      'Enter the area as a number, for example 2 or 2.5',
      'INVALID',
      'totalLandArea',
    )
  }

  const amountMilli = Math.round(Number(trimmed) * LAND_AMOUNT_SCALE)
  if (amountMilli <= 0) {
    throw new LandError('Enter an area greater than zero', 'NOT_POSITIVE', 'totalLandArea')
  }
  return amountMilli
}

/**
 * Bangla-Indic digits (০–৯) to ASCII.
 *
 * Delegates to `intl/numerals.ts`, which is where this transliteration lives for the whole domain.
 * The P15 audit found four hand-rolled copies of the same character arithmetic; identical copies of
 * a pure function are harmless right up until one of them is fixed.
 */
export function normalizeDigits(input: string): string {
  return toAsciiDigits(input)
}

/** Render a stored amount back as the farmer would read it: `2500` → `"2.5"`. */
export function formatLandAmount(amountMilli: number): string {
  const whole = Math.trunc(amountMilli / LAND_AMOUNT_SCALE)
  const fraction = Math.abs(amountMilli % LAND_AMOUNT_SCALE)
  if (fraction === 0) return String(whole)
  return `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`
}
