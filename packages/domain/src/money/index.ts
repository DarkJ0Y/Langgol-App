export type { Poisha, RoundingMode, MoneyLocale, FormatOptions } from './types.js'
export { MoneyError, type MoneyErrorCode } from './errors.js'
export { format } from './format.js'
export {
  POISHA_PER_TAKA,
  BPS_DENOMINATOR,
  MAX_POISHA,
  MIN_POISHA,
  zero,
  fromPoisha,
  fromTaka,
  parseTakaInput,
  normalizeDigits,
  toTakaString,
  serialize,
  deserialize,
  add,
  subtract,
  sum,
  multiply,
  divide,
  multiplyByRatio,
  percentBps,
  allocate,
  compare,
  equals,
  isZero,
  isPositive,
  isNegative,
  negate,
  abs,
  min,
  max,
  requireNonNegative,
} from './money.js'

import * as money from './money.js'
import { format } from './format.js'

/**
 * Namespace object for ergonomic use at call sites: `Money.percentBps(subtotal, commissionBps)`.
 * Reads closer to the domain language than a wall of bare imports.
 */
export const Money = { ...money, format } as const
