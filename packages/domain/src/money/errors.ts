/**
 * Money errors are typed and specific. A money operation never fails silently, never returns
 * `NaN`, and never coerces bad input into a plausible-looking amount.
 */

export type MoneyErrorCode =
  | 'INVALID_INPUT'
  | 'PRECISION_LOSS'
  | 'OUT_OF_RANGE'
  | 'DIVISION_BY_ZERO'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'INVALID_ALLOCATION'

export class MoneyError extends Error {
  readonly code: MoneyErrorCode
  readonly detail: string | undefined

  constructor(code: MoneyErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'MoneyError'
    this.code = code
    this.detail = detail
  }
}
