/**
 * Crop disease diagnosis — the rules that hold whoever answers the question.
 *
 * The model is an implementation detail behind `AdvisoryPort`. What lives here is everything that
 * must be true regardless of which provider is asked: what a photograph may be, what a diagnosis
 * is allowed to claim, and when we must refuse to ask at all.
 *
 * ## The image is never kept
 *
 * A farm photograph can contain faces, a house, and a precise location in its EXIF, and answering
 * the question means sending it outside Bangladesh. The product decision is that it exists only
 * for the duration of the request: browser → server → provider → discarded. Nothing writes it to
 * storage, so there is no retention period to honour, no bucket to leak, and no backfill to
 * explain if the policy changes later.
 *
 * That has a cost worth stating plainly: a farmer cannot revisit the photograph they sent, and an
 * agronomist cannot later check a diagnosis against it. Both are acceptable for the pilot, and
 * both become false the moment anyone stores the image — so the discard is enforced by there
 * being no storage call in the use case, not by a comment.
 *
 * Refs: docs/07_SECURITY.md §7; docs/08_BANGLADESH_CONTEXT.md §2
 */

/**
 * 4 MiB.
 *
 * Half the `StoragePort` limit, because this image is not stored — it is base64-encoded into a
 * request body, which inflates it by a third, and then sent from a phone on a metered connection.
 * A farmer photographing a leaf does not need more, and the difference between 4 and 8 MiB on 3G
 * is roughly a minute of upload they may not have.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * Formats a Bangladeshi phone camera actually produces.
 *
 * HEIC is included because iPhones default to it, and excluding it would reject photographs from
 * the exact users most likely to have a good camera. Anything not an image is refused outright:
 * this endpoint forwards bytes to a third party, so it must never become a way to send them
 * something else.
 */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]

export type DiagnosisRefusal =
  | 'NO_CONSENT'
  | 'IMAGE_MISSING'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_UNSUPPORTED_TYPE'
  | 'BUDGET_EXHAUSTED'
  | 'RATE_LIMITED'

export interface ImageCandidate {
  readonly contentType: string
  readonly byteLength: number
}

export type ImageVerdict =
  { readonly ok: true } | { readonly ok: false; readonly refusal: DiagnosisRefusal }

/**
 * Whether a photograph may be sent at all.
 *
 * Checked before any provider call, because every refusal here is free and every call is not.
 */
export function evaluateImage(candidate: ImageCandidate | null): ImageVerdict {
  if (candidate === null || candidate.byteLength === 0) {
    return { ok: false, refusal: 'IMAGE_MISSING' }
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(candidate.contentType)) {
    return { ok: false, refusal: 'IMAGE_UNSUPPORTED_TYPE' }
  }
  if (candidate.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, refusal: 'IMAGE_TOO_LARGE' }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ the answer */

/**
 * What a diagnosis is permitted to be.
 *
 * `confidence` is deliberately a coarse three-way judgement rather than a percentage. A model
 * that says "87%" invites a farmer to treat it as a measurement, and it is not one — it is the
 * model's own impression of its own guess. Three bands can be phrased honestly in Bangla and
 * cannot be mistaken for arithmetic.
 */
export const DIAGNOSIS_CONFIDENCE = ['LOW', 'MEDIUM', 'HIGH'] as const
export type DiagnosisConfidence = (typeof DIAGNOSIS_CONFIDENCE)[number]

export interface Diagnosis {
  /** The provider's answer, already in the farmer's language. Rendered as text, never as HTML. */
  readonly answer: string
  readonly confidence: DiagnosisConfidence
  /**
   * True when the provider judged the photograph unusable — too dark, too blurred, not a plant.
   * Distinct from a low-confidence diagnosis: the remedy is a better photograph, not a caveat.
   */
  readonly unusableImage: boolean
}

/**
 * Every diagnosis carries a disclaimer, and it is attached HERE rather than left to the screen.
 *
 * This is the one feature in Langgol whose output can cost a farmer their season. Wrong advice
 * about a pesticide is not a bad recommendation, it is a damaged crop or a poisoned well. A
 * disclaimer that lives in a React component can be forgotten by the next screen that renders a
 * diagnosis; one that is part of the value cannot.
 *
 * Deliberately not softened. "This may be wrong" is the honest sentence, and a farmer deciding
 * whether to spend money on a treatment deserves it before the recommendation, not beneath it.
 */
export const DISCLAIMER_BN =
  'এটি একটি স্বয়ংক্রিয় অনুমান, নিশ্চিত রোগ নির্ণয় নয়। ভুল হতে পারে। ' +
  'বড় সিদ্ধান্ত নেওয়ার আগে স্থানীয় কৃষি কর্মকর্তার সাথে কথা বলুন।'

export const DISCLAIMER_EN =
  'This is an automated suggestion, not a confirmed diagnosis. It can be wrong. ' +
  'Speak to your local agriculture officer before making a costly decision.'

export function disclaimerFor(locale: 'bn' | 'en'): string {
  return locale === 'bn' ? DISCLAIMER_BN : DISCLAIMER_EN
}
