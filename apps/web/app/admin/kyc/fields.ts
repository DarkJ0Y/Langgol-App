/**
 * The form field names the reviewer's browser and the server both need to agree on.
 *
 * They live alone because a `'use server'` module may export only async functions, and because a
 * client component importing them would otherwise drag the action's whole import graph into the
 * bundle. The same reasoning, and the same shape, as `app/account/profile/fields.ts`.
 */

/** Which file a decision is about. */
export const VERIFICATION_ID_FIELD = 'verificationId'

/** Which decision was pressed. Carried by the submit button itself, not by a separate control. */
export const DECISION_FIELD = 'decision'

/** The reviewer's own words. Mandatory for a rejection; the person being reviewed reads them. */
export const REASON_FIELD = 'reason'
