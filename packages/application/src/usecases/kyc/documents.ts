/**
 * Reaching a KYC document, and — separately and rarely — the number itself.
 *
 * ## Two authorizations, not one
 *
 * Issuing a grant and redeeming it are separate steps that each check permission. That looks
 * redundant and is not: the grant is a bearer credential for a few minutes, and a system that
 * only checked at issue time would keep serving bytes to a token whose holder had since been
 * suspended, demoted, or had their access revoked. The redemption re-reads the actor's live
 * standing every time.
 *
 * ## Why the bytes are streamed rather than linked
 *
 * The object store holds these under a folder the adapter refuses to produce a public URL for.
 * The only way to the bytes is through a route that verifies a grant naming this viewer and this
 * object. A link copied out of a reviewer's browser is therefore useless to anybody else, which
 * is the property a provider-signed expiring URL does not have.
 *
 * ## Revealing the number
 *
 * `revealIdentityNumber` exists because a reviewer has to compare the number against the card,
 * and it is the only function in the system that returns one. It is ADMIN-only, it refuses the
 * reviewer's own record, and it writes an audit row BEFORE it decrypts — so an operator who
 * opened somebody's NID is recorded even if the decryption then fails, and even if the process
 * dies immediately afterwards.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §11
 */

import type { DocumentSide } from '@langgol/domain/kyc'
import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { DocumentGrantSigner, IdentityCipher } from '../../ports/index.js'
import type { KycDeps } from './identity.js'

export interface DocumentDeps extends KycDeps {
  readonly grants: DocumentGrantSigner
}

/**
 * May this actor look at this record's documents?
 *
 * The subject may see their own — a person is entitled to check that the photograph they sent is
 * the one being judged. An administrator may see any. Nobody else exists in this answer, and an
 * unauthorized caller gets NOT_FOUND so that an id reveals nothing by the shape of its refusal.
 */
async function authorizeDocumentAccess(
  actor: MaybeActor,
  verificationId: string,
  deps: DocumentDeps,
): Promise<Result<{ readonly ownerUserId: string }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'kyc:document-view')) return err(Errors.forbidden())

  const record = await deps.verifications.findById(verificationId)
  if (record === null) return err(Errors.notFound('Verification'))

  const isSubject = record.userId === actor.userId
  if (!isSubject && !allowed(actor, 'kyc:read-any')) return err(Errors.notFound('Verification'))

  return ok({ ownerUserId: record.userId })
}

export interface IssuedGrant {
  readonly token: string
  readonly expiresAt: Date
}

/**
 * Mint a short-lived grant for one side of one document.
 *
 * The storage key is resolved here and never travels through the caller. A function that accepted
 * a key from the browser would let anybody who guessed one have it signed.
 */
export async function issueDocumentGrant(
  actor: MaybeActor,
  verificationId: string,
  side: DocumentSide,
  deps: DocumentDeps,
): Promise<Result<IssuedGrant, AppError>> {
  const authorized = await authorizeDocumentAccess(actor, verificationId, deps)
  if (!('value' in authorized)) return authorized
  const viewer = actor as { userId: string }

  const keys = await deps.verifications.documentKeys(verificationId)
  if (keys === null) return err(Errors.notFound('Document'))

  const storageKey = side === 'FRONT' ? keys.front : keys.back
  if (storageKey === null) return err(Errors.notFound('Document'))

  const now = deps.clock.now()
  const token = deps.grants.issue({ storageKey, viewerUserId: viewer.userId, verificationId }, now)
  const decoded = deps.grants.verify(token, now)

  await deps.audit.record({
    actorUserId: viewer.userId,
    action: 'KYC_DOCUMENT_GRANT_ISSUED',
    entityType: 'verification',
    entityId: verificationId,
    // The side, never the key. A storage key in an audit row is a durable pointer at the object
    // in a table with a wider audience than the one that holds it.
    meta: { side },
  })

  return ok({
    token,
    expiresAt: decoded?.expiresAt ?? new Date(now.getTime() + 600_000),
  })
}

export interface ServedDocument {
  readonly contentType: string
  readonly data: Uint8Array
}

/**
 * Redeem a grant and return the bytes.
 *
 * Every check is repeated against the CURRENT actor rather than trusting the token's claim. The
 * token says who it was minted for; this function proves that the person presenting it is that
 * person, is still permitted, and still stands in the same relation to the record. A grant is a
 * convenience for addressing an object, never a substitute for authorization.
 */
export async function serveDocument(
  actor: MaybeActor,
  token: string,
  deps: DocumentDeps,
): Promise<Result<ServedDocument, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const grant = deps.grants.verify(token, deps.clock.now())
  // Forged, altered, expired — one answer for all of them, so a probe learns nothing about which.
  if (grant === null) return err(Errors.notFound('Document'))

  /*
   * The presenter must be the person the grant was minted for.
   *
   * This is what makes a leaked link inert. Without it the token would be a bearer credential
   * that anybody could redeem, which is exactly the property that makes provider-signed URLs
   * unsuitable for a document like this one.
   */
  if (grant.viewerUserId !== actor.userId) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'KYC_DOCUMENT_GRANT_MISUSED',
      entityType: 'verification',
      entityId: grant.verificationId,
      reason: 'grant presented by a different user',
    })
    return err(Errors.notFound('Document'))
  }

  // Re-checked live: a reviewer suspended since the grant was minted must not still be served.
  const authorized = await authorizeDocumentAccess(actor, grant.verificationId, deps)
  if (!('value' in authorized)) return authorized

  // And the key must still be one of this record's own, so a grant cannot outlive a re-submission
  // and point at a document the record no longer claims.
  const keys = await deps.verifications.documentKeys(grant.verificationId)
  if (keys === null) return err(Errors.notFound('Document'))
  if (grant.storageKey !== keys.front && grant.storageKey !== keys.back) {
    return err(Errors.notFound('Document'))
  }

  const object = await deps.storage.download(grant.storageKey)
  if (object === null) return err(Errors.notFound('Document'))

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'KYC_DOCUMENT_VIEWED',
    entityType: 'verification',
    entityId: grant.verificationId,
    meta: { bytes: object.data.byteLength },
  })

  return ok({ contentType: object.contentType, data: object.data })
}

export interface RevealDeps extends KycDeps {
  readonly cipher: IdentityCipher
}

/**
 * Decrypt and return an identity number.
 *
 * The only function in Langgol that returns one. Everything about it is deliberately awkward: it
 * is ADMIN-only, it takes an explicit reason, it refuses the caller's own record, and it audits
 * before it decrypts rather than after.
 *
 * Auditing first is the important ordering. An audit written afterwards is lost precisely in the
 * cases worth investigating — a crash, a timeout, a decryption failure — and "we have no record
 * of who opened it" is the wrong answer to that question.
 */
export async function revealIdentityNumber(
  actor: MaybeActor,
  verificationId: string,
  reason: string,
  deps: RevealDeps,
): Promise<Result<{ readonly identityNumber: string }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  // Reading a number is part of deciding, so it is gated on the reviewer permission rather than
  // on a read permission — an administrator who may not review may not decrypt either.
  if (!allowed(actor, 'kyc:review')) return err(Errors.forbidden())

  const trimmed = reason.trim()
  if (trimmed.length < 4) {
    return err(Errors.validation('Say why this is being opened', { field: 'reason' }))
  }

  const record = await deps.verifications.findById(verificationId)
  if (record === null) return err(Errors.notFound('Verification'))
  if (record.userId === actor.userId) return err(Errors.forbidden())

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'KYC_IDENTITY_NUMBER_REVEALED',
    entityType: 'verification',
    entityId: verificationId,
    reason: trimmed,
    meta: { subjectUserId: record.userId },
  })

  const stored = await deps.verifications.revealCiphertext(verificationId)
  if (stored === null) return err(Errors.notFound('Verification'))

  try {
    /*
     * Decrypted against the OWNER, not the reader.
     *
     * The ciphertext is bound to the user it belongs to. Passing the reviewer here would fail,
     * which is the correct behaviour and worth stating: a ciphertext moved into another row does
     * not decrypt, so this call also proves the row is intact.
     */
    return ok({
      identityNumber: deps.cipher.decrypt(stored.ciphertext, { userId: stored.ownerUserId }),
    })
  } catch {
    // The underlying error can carry fragments of the attempted plaintext. It is swallowed here
    // rather than wrapped, for the same reason the cipher swallows it.
    return err(Errors.internal('Could not read that document'))
  }
}
