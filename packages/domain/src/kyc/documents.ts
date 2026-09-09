/**
 * What a KYC document may be.
 *
 * Separate rules from listing photographs, and deliberately stricter. A listing image is decor:
 * the worst a bad one does is look wrong. A KYC document is evidence that an operator will open
 * on their own machine, which makes an upload endpoint here a delivery route into the back
 * office if it accepts the wrong thing.
 *
 * ## Why the type is checked twice, by two different means
 *
 * A browser's `Content-Type` is a claim by the uploader, and an uploader who is attacking you
 * lies. So the declared type must be on the allowlist AND the bytes must begin with that type's
 * magic number. Neither check alone is worth much: the header is trivially forged, and sniffing
 * alone would accept a file the rest of the pipeline believes is something else.
 *
 * Refs: docs/07_SECURITY.md §6, §7
 */

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'DocumentError'
  }
}

/**
 * 5 MiB.
 *
 * Lower than the 8 MiB allowed for listing photographs, because a legible photograph of a card is
 * far smaller than a field of crops, and because every megabyte here is a megabyte a farmer pays
 * for on a metered connection. A limit generous enough for an unresized phone photograph is
 * generous enough to be a free file host.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

/**
 * Small enough to be nothing.
 *
 * A few hundred bytes cannot be a photograph of a card. Catching it here saves a reviewer being
 * shown a blank rectangle and having to reject it by hand.
 */
export const MIN_DOCUMENT_BYTES = 1024

/**
 * The accepted types, each with the bytes a real file of that type starts with.
 *
 * PDF is accepted because a scanner produces one and a scan of a card is exactly what is being
 * asked for. Nothing else is: no archives, no office formats, no SVG. SVG is worth naming as a
 * refusal rather than an omission — it is an image to a person and a script container to a
 * browser, and it is the file that turns a document viewer into a cross-site scripting sink.
 */
interface Signature {
  readonly offset: number
  readonly bytes: readonly number[]
}

interface DocumentTypeRule {
  readonly contentType: string
  readonly extension: string
  readonly signatures: readonly Signature[]
}

const DOCUMENT_TYPES: readonly DocumentTypeRule[] = [
  {
    contentType: 'image/jpeg',
    extension: 'jpg',
    signatures: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  },
  {
    contentType: 'image/png',
    extension: 'png',
    signatures: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  {
    contentType: 'image/webp',
    extension: 'webp',
    // "RIFF" then four size bytes then "WEBP" — both halves are checked, because "RIFF" alone is
    // also how an AVI begins.
    signatures: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
  {
    contentType: 'application/pdf',
    extension: 'pdf',
    signatures: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }],
  },
]

export const ALLOWED_DOCUMENT_TYPES: readonly string[] = DOCUMENT_TYPES.map(
  (rule) => rule.contentType,
)

/** Which side of a document an upload is. Named so an error can say which one failed. */
export const DOCUMENT_SIDES = ['FRONT', 'BACK'] as const
export type DocumentSide = (typeof DOCUMENT_SIDES)[number]

export interface DocumentCandidate {
  readonly side: DocumentSide
  readonly contentType: string
  readonly bytes: Uint8Array
}

export interface ValidatedDocument {
  readonly side: DocumentSide
  readonly contentType: string
  readonly extension: string
  readonly byteLength: number
}

function matches(bytes: Uint8Array, signature: Signature): boolean {
  if (bytes.length < signature.offset + signature.bytes.length) return false
  return signature.bytes.every((expected, index) => bytes[signature.offset + index] === expected)
}

/**
 * Judge one uploaded file.
 *
 * Order matters. Size is checked before content because reading the head of a file the caller
 * has already been told is too large is work done for nothing, and because a size failure is the
 * one a person can act on immediately.
 *
 * Every error names the side, so a submission with two files produces a message that says which
 * of them to retake rather than sending the person back to redo both.
 */
export function validateDocument(candidate: DocumentCandidate): ValidatedDocument {
  const field = `document${candidate.side === 'FRONT' ? 'Front' : 'Back'}`

  if (candidate.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentError('That file is too large', 'DOCUMENT_TOO_LARGE', field)
  }
  if (candidate.bytes.byteLength < MIN_DOCUMENT_BYTES) {
    throw new DocumentError('That file is empty or damaged', 'DOCUMENT_TOO_SMALL', field)
  }

  const rule = DOCUMENT_TYPES.find((entry) => entry.contentType === candidate.contentType)
  if (rule === undefined) {
    throw new DocumentError('Send a photo or a PDF', 'DOCUMENT_TYPE_NOT_ALLOWED', field)
  }

  /*
   * The declared type must be borne out by the bytes.
   *
   * A `Content-Type` header is a claim by whoever uploaded the file. This is the check that makes
   * the allowlist mean anything: without it, `image/jpeg` on a zip archive passes, and the
   * allowlist has only ever inspected a string the attacker wrote.
   */
  if (!rule.signatures.every((signature) => matches(candidate.bytes, signature))) {
    throw new DocumentError(
      'That file is not the kind it claims to be',
      'DOCUMENT_CONTENT_MISMATCH',
      field,
    )
  }

  return {
    side: candidate.side,
    contentType: rule.contentType,
    extension: rule.extension,
    byteLength: candidate.bytes.byteLength,
  }
}

/**
 * Judge a whole submission.
 *
 * The front is always required — a document with no front is not evidence. The back is required
 * only for the document types that have one, which is why the descriptor carries `hasBackSide`
 * rather than this module assuming every card is two-sided.
 */
export function validateSubmissionDocuments(input: {
  readonly front: DocumentCandidate | null
  readonly back: DocumentCandidate | null
  readonly backRequired: boolean
}): { readonly front: ValidatedDocument; readonly back: ValidatedDocument | null } {
  if (input.front === null) {
    throw new DocumentError('Add a photo of the front', 'DOCUMENT_FRONT_REQUIRED', 'documentFront')
  }
  const front = validateDocument(input.front)

  if (input.back === null) {
    if (input.backRequired) {
      throw new DocumentError('Add a photo of the back', 'DOCUMENT_BACK_REQUIRED', 'documentBack')
    }
    return { front, back: null }
  }

  return { front, back: validateDocument(input.back) }
}
