/**
 * Pricing errors.
 *
 * Every one of these is an **expected** outcome the caller must handle, not a bug: an order too
 * heavy for the published tariff, a subsidy requested without a reason, a funding model the
 * pilot budget can no longer afford. They are thrown from pure domain code and converted to
 * typed `Result` errors at the application boundary.
 */

export type PricingErrorCode =
  /** Chargeable weight exceeds the top published band — ops must quote it by hand. docs/04 §3. */
  | 'OPS_QUOTE_ONLY'
  /** A subsidising funding model was selected without a controlled-vocabulary reason. */
  | 'SUBSIDY_REASON_REQUIRED'
  /** A reason string that is not in the controlled vocabulary. docs/10 §9.3. */
  | 'SUBSIDY_REASON_UNKNOWN'
  /** The funding split did not reconcile to the tariff. An invariant breach, never user input. */
  | 'FUNDING_SPLIT_UNBALANCED'
  /** `SELLER_FUNDED` requires the farmer's explicit opt-in on the listing. docs/04 §3.1. */
  | 'SELLER_FUNDING_NOT_OFFERED'
  /** The funding model is not in `delivery.fundingModel.enabled`. */
  | 'FUNDING_MODEL_DISABLED'
  /**
   * The pilot loss budget is exhausted, so subsidising models are refused in the quoting path.
   * Cost-recovering, pickup, seller- and retailer-funded stay available: the marketplace keeps
   * working, it just stops paying for itself to be used. docs/06 §6.1, docs/10 §9.2.
   */
  | 'SUBSIDY_BUDGET_EXHAUSTED'
  /** A required input was absent or nonsensical. */
  | 'INVALID_INPUT'
  /** No tariff band matched — a malformed configuration rather than a user error. */
  | 'NO_TARIFF_BAND'

export class PricingError extends Error {
  readonly code: PricingErrorCode
  readonly detail: string | undefined

  constructor(code: PricingErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'PricingError'
    this.code = code
    this.detail = detail
  }
}
