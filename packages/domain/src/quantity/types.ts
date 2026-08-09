/**
 * Quantity types.
 *
 * A quantity is an integer count of **base units**. The base unit is a property of the product,
 * not of the listing, so two listings of the same product are always directly comparable.
 *
 * Refs: docs/02_DATABASE.md §6, §6.1
 */

declare const baseQuantityBrand: unique symbol

/** The authoritative, metric, integer unit a quantity is stored in. */
export type BaseUnit = 'MILLIGRAM' | 'MILLILITRE' | 'PIECE'

/**
 * A unit a human may buy, sell or read in. Local Bangladeshi units (`SEER`, `MON`, `HALI`) are
 * first-class **inputs and displays**, never storage.
 */
export type SaleUnit =
  | 'MILLIGRAM'
  | 'GRAM'
  | 'KG'
  | 'SEER'
  | 'MON'
  | 'TONNE'
  | 'MILLILITRE'
  | 'LITRE'
  | 'PIECE'
  | 'HALI'
  | 'DOZEN'

/** A quantity in base units. Branded so a bare `bigint` cannot masquerade as one. */
export type BaseQuantity = bigint & { readonly [baseQuantityBrand]: 'BaseQuantity' }

export interface UnitDefinition {
  readonly base: BaseUnit
  readonly baseUnitsPer: bigint
  readonly labelEn: string
  readonly labelBn: string
}

export type QuantityLocale = 'bn' | 'en'

export interface QuantityFormatOptions {
  /** Display locale. Defaults to `'en'`. */
  readonly locale?: QuantityLocale
  /** Maximum decimal places before trailing zeros are trimmed. Defaults to 3. */
  readonly maxDecimals?: number
  /** Append the unit label (`kg`, `কেজি`). Defaults to `true`. */
  readonly withUnit?: boolean
}
