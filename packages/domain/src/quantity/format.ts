/**
 * Quantity display.
 *
 * Bangla-first: `৫ কেজি` reads naturally to a farmer, `5 kg` to an English-reading buyer.
 * The number and the unit label are localised together, because a Bangla numeral next to an
 * English unit is worse than either alone.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §1, §5
 */

import { toBanglaDigits } from '../intl/numerals.js'
import { toUnitString } from './quantity.js'
import type { BaseQuantity, QuantityFormatOptions, SaleUnit } from './types.js'
import { unitDefinition } from './units.js'

/** `5500000` mg in `KG`, bn → `৫.৫ কেজি`. */
export function format(
  quantity: BaseQuantity,
  unit: SaleUnit,
  options: QuantityFormatOptions = {},
): string {
  const locale = options.locale ?? 'en'
  const maxDecimals = options.maxDecimals ?? 3
  const withUnit = options.withUnit ?? true

  const numeric = toUnitString(quantity, unit, maxDecimals)
  const rendered = locale === 'bn' ? toBanglaDigits(numeric) : numeric
  if (!withUnit) return rendered

  const definition = unitDefinition(unit)
  const label = locale === 'bn' ? definition.labelBn : definition.labelEn
  return `${rendered} ${label}`
}
