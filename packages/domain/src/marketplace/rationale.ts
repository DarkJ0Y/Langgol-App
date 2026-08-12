/**
 * Explainability — every ranked result carries a machine-readable rationale.
 *
 * ```json
 * { "listingId": "…", "rank": 1,
 *   "reasons": [ { "code": "CHEAPEST_DELIVERED", "detail": { "vsNextPoisha": "340" } },
 *                { "code": "HARVESTED_TODAY" },
 *                { "code": "NEARBY", "detail": { "distanceKm": 12 } } ] }
 * ```
 *
 * The codes are deliberately a closed set: the i18n layer renders each one as a short Bangla or
 * English label, so a farmer asking "why was I third?" gets the same answer the algorithm used,
 * not a marketing sentence written afterwards.
 *
 * **Buyer-facing reasons never mention platform margin.** Margin appears only in `internalNotes`,
 * which is stripped before anything reaches a browser.
 *
 * Refs: docs/04_MARKETPLACE.md §6, §5.3
 */

/** Codes a buyer may see. Rendered by `@langgol/i18n`, Bangla first. */
export type ReasonCode =
  | 'CHEAPEST_DELIVERED'
  | 'GOOD_VALUE_DELIVERED'
  | 'HARVESTED_TODAY'
  | 'FRESHEST'
  | 'NEARBY'
  | 'FASTEST_DELIVERY'
  | 'HIGHLY_RELIABLE'
  | 'WELL_RATED'
  | 'COVERS_FULL_QUANTITY'
  | 'PARTIAL_FILL_ONLY'
  | 'NEW_FARMER'

/** Codes that stay inside Langgol. Never serialised to a buyer response. */
export type InternalNoteCode =
  | 'NEGATIVE_CONTRIBUTION_MARGIN'
  | 'BELOW_MARGIN_FLOOR'
  | 'TIEBREAK_APPLIED_ON_MARGIN'
  | 'NEW_FARMER_BOOST_APPLIED'

export type ReasonDetail = Readonly<Record<string, string | number | boolean>>

export interface Reason {
  readonly code: ReasonCode
  readonly detail?: ReasonDetail
}

export interface InternalNote {
  readonly code: InternalNoteCode
  readonly detail?: ReasonDetail
}
