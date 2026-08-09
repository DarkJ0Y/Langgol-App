/**
 * Money types for Langgol.
 *
 * Money is an integer count of **poisha** (1 BDT = 100 poisha) carried as a `bigint`.
 * Floating point never touches money — not in calculation, not in transport, not in storage.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §2
 */

declare const poishaBrand: unique symbol

/**
 * An amount of money in integer poisha.
 *
 * Branded so a bare `bigint` cannot be passed where money is expected. The brand is a
 * compile-time construct with zero runtime cost; at runtime a `Poisha` is simply a `bigint`.
 *
 * Signed: negative amounts are legitimate in a double-entry ledger (adjustments, clawbacks,
 * reversals). Operations that require a non-negative amount say so explicitly.
 */
export type Poisha = bigint & { readonly [poishaBrand]: 'Poisha' }

/**
 * Rounding behaviour for division.
 *
 * - `HALF_UP` — ties round **away from zero** (2.5 → 3, −2.5 → −3). This is the normative
 *   rounding rule for line totals and fees. See docs/02_DATABASE.md §1.1.
 * - `TRUNCATE` — drop the remainder, rounding **toward zero**. Used where a conservative
 *   share is wanted and the remainder is redistributed explicitly (see `allocate`).
 */
export type RoundingMode = 'HALF_UP' | 'TRUNCATE'

/** Supported display locales. Bangla is the default for farmer-facing surfaces. */
export type MoneyLocale = 'bn' | 'en'

export interface FormatOptions {
  /** Display locale. Defaults to `'en'`. */
  readonly locale?: MoneyLocale
  /** Include the `৳` symbol. Defaults to `true`. */
  readonly withSymbol?: boolean
}
