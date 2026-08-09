export type QuantityErrorCode =
  | 'INVALID_INPUT'
  | 'PRECISION_LOSS'
  | 'INCOMPATIBLE_UNITS'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'OUT_OF_RANGE'

export class QuantityError extends Error {
  readonly code: QuantityErrorCode
  readonly detail: string | undefined

  constructor(code: QuantityErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'QuantityError'
    this.code = code
    this.detail = detail
  }
}
