/**
 * Reading a KYC submission from a form.
 *
 * Separate from the server action so it can be tested without a request, following the same split
 * as the address and role-profile forms. It does no validating: the number, the file types and
 * the sizes are all the domain's to judge, in one place.
 *
 * What it DOES do is refuse to read a file that is obviously too large before pulling it into
 * memory. That is not a duplicate of the size rule — it is a different concern. The domain
 * decides whether a 6 MB file is acceptable; this decides whether to allocate a buffer for a
 * 500 MB one, which is a denial-of-service question rather than a validation question.
 */

import { MAX_DOCUMENT_BYTES, type DocumentCandidate, type DocumentSide } from '@langgol/domain/kyc'

export const IDENTITY_TYPE_FIELD = 'identityType'
export const IDENTITY_NUMBER_FIELD = 'identityNumber'
export const DOCUMENT_FRONT_FIELD = 'documentFront'
export const DOCUMENT_BACK_FIELD = 'documentBack'

/**
 * A ceiling on what is read into memory at all.
 *
 * Deliberately a little above the domain's limit rather than equal to it. A file one byte over
 * should be REFUSED by the domain with a message about size, not silently dropped here as though
 * it had never been attached — the two produce very different experiences for somebody whose
 * photograph is slightly too big.
 */
const READ_CEILING = MAX_DOCUMENT_BYTES * 2

async function readFile(
  value: FormDataEntryValue | null,
  side: DocumentSide,
): Promise<DocumentCandidate | null> {
  // A missing file posts an empty `File` in some browsers and nothing in others. Both mean the
  // same thing, and both must read as "not attached" rather than as an empty document.
  if (value === null || typeof value === 'string') return null
  if (value.size === 0) return null

  // Above this, nothing is read. The domain never sees it, because allocating the buffer is
  // itself the harm.
  if (value.size > READ_CEILING) {
    return { side, contentType: value.type, bytes: new Uint8Array(0) }
  }

  return {
    side,
    // The browser's claim about the type. Checked against the file's own bytes by the domain,
    // because an uploader who is attacking you lies about this header.
    contentType: value.type,
    bytes: new Uint8Array(await value.arrayBuffer()),
  }
}

export async function readKycForm(formData: FormData): Promise<{
  readonly identityType: string
  readonly identityNumber: string
  readonly documentFront: DocumentCandidate | null
  readonly documentBack: DocumentCandidate | null
}> {
  return {
    identityType: String(formData.get(IDENTITY_TYPE_FIELD) ?? ''),
    identityNumber: String(formData.get(IDENTITY_NUMBER_FIELD) ?? ''),
    documentFront: await readFile(formData.get(DOCUMENT_FRONT_FIELD), 'FRONT'),
    documentBack: await readFile(formData.get(DOCUMENT_BACK_FIELD), 'BACK'),
  }
}
