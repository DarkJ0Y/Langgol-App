/**
 * Turning the farming vocabularies into labelled options.
 *
 * The domain owns the vocabulary and the i18n catalogue owns the words; this module is the one
 * place they meet. Building the lists from the domain constants rather than typing them out
 * means a value added to `catalogue.ts` appears on the form automatically — and, more usefully,
 * that a value REMOVED from the domain cannot linger on a screen still offering it.
 *
 * Keys follow one convention: the section prefix plus the enum member, e.g. `farmer.typeCROP`.
 * A missing key renders as the key itself (see packages/i18n), which is loud rather than silent.
 */

import {
  FARMER_TYPES,
  FARMING_METHODS,
  IRRIGATION_METHODS,
  LAND_OWNERSHIP_TYPES,
  LAND_UNITS,
  WATER_SOURCES,
} from '@langgol/domain/farming'
import type { MessageKey, Translator } from '@langgol/i18n'

export interface Option {
  readonly value: string
  readonly label: string
}

const options = (t: Translator, prefix: string, values: readonly string[]): readonly Option[] =>
  values.map((value) => ({ value, label: t.t(`farmer.${prefix}${value}` as MessageKey) }))

export const farmerTypeOptions = (t: Translator) => options(t, 'type', FARMER_TYPES)
export const landUnitOptions = (t: Translator) => options(t, 'unit', LAND_UNITS)
export const ownershipOptions = (t: Translator) => options(t, 'ownership', LAND_OWNERSHIP_TYPES)
export const irrigationMethodOptions = (t: Translator) =>
  options(t, 'irrigation', IRRIGATION_METHODS)
export const waterSourceOptions = (t: Translator) => options(t, 'water', WATER_SOURCES)
export const farmingMethodOptions = (t: Translator) => options(t, 'method', FARMING_METHODS)

/** The label for one stored value, or the "not answered" text when there is none. */
export function labelFor(
  t: Translator,
  prefix: string,
  value: string | null,
  fallback: string,
): string {
  if (value === null) return fallback
  return t.t(`farmer.${prefix}${value}` as MessageKey)
}
