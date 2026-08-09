/**
 * Langgol domain — pure business logic.
 *
 * Nothing in this package imports a framework, a database client, or performs I/O. Every module
 * here is a deterministic function of its inputs, which is what makes the money, the pricing and
 * the state machine testable in milliseconds and portable across any future runtime.
 *
 * The root barrel deliberately exports **namespaces**, not flat functions: `Money.add` and
 * `Quantity.add` are different operations on different kinds of value, and a call site should
 * have to say which one it means.
 */

export { Money, MoneyError } from './money/index.js'
export type {
  Poisha,
  MoneyErrorCode,
  MoneyLocale,
  FormatOptions as MoneyFormatOptions,
} from './money/index.js'

export { Quantity, QuantityError } from './quantity/index.js'
export type {
  BaseQuantity,
  BaseUnit,
  SaleUnit,
  UnitDefinition,
  QuantityErrorCode,
  QuantityLocale,
  QuantityFormatOptions,
} from './quantity/index.js'

export { toBanglaDigits, toAsciiDigits } from './intl/numerals.js'
export { divideRounded, absBigInt, pow10 } from './math/integer.js'
export type { RoundingMode } from './math/integer.js'
