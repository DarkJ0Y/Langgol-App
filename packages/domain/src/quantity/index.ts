export type {
  BaseUnit,
  SaleUnit,
  BaseQuantity,
  UnitDefinition,
  QuantityLocale,
  QuantityFormatOptions,
} from './types.js'
export { QuantityError, type QuantityErrorCode } from './errors.js'
export {
  UNITS,
  SALE_UNITS_BY_BASE,
  unitDefinition,
  baseUnitsPer,
  baseUnitFor,
  areCompatible,
} from './units.js'
export {
  MAX_BASE_QUANTITY,
  zero,
  toBase,
  isExactIn,
  toUnitString,
  convert,
  add,
  subtract,
  multiply,
  compare,
  isZero,
  fromBaseUnits,
  serialize,
  deserialize,
  requirePositive,
  requireNonNegative,
} from './quantity.js'
export { format } from './format.js'

import * as quantity from './quantity.js'
import * as units from './units.js'
import { format } from './format.js'

/** Namespace object: `Quantity.toBase('5.5', 'KG')`. */
export const Quantity = { ...quantity, ...units, format } as const
