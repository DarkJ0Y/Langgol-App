/**
 * Short-lived, signed grants for viewing a KYC document.
 *
 * ## Why Langgol mints these itself
 *
 * "Signed URLs where needed" normally means asking the object store for one. Langgol cannot: the
 * storage adapter uses the Firebase **client** SDK, whose `getDownloadURL` returns a long-lived
 * tokenised link that does not expire and is not bound to a viewer. Handing that to a reviewer
 * would put a permanent, transferable link to somebody's NID in a browser history.
 *
 * So the grant is ours. Nothing in this application ever hands out a link to the bucket: the
 * adapter refuses to mint a public URL for a private folder, and the bytes reach a reviewer only
 * through a route that verifies one of these first. The grant names *who* may use it, which a
 * provider-signed URL does not.
 *
 * ## What this does NOT do on its own — a deployment requirement
 *
 * This controls the APPLICATION's path to the object. It cannot control the bucket's. Langgol
 * uses the Firebase client SDK with no service account, so its reads and writes execute as an
 * anonymous principal — which means the bucket's own Storage Rules must be the thing that stops
 * a stranger fetching `kyc-documents/...` directly, and those rules live in the Firebase project
 * rather than in this repository.
 *
 * Until they deny anonymous access to that prefix, the real protection on a KYC document is the
 * unguessability of its UUID key, which is weaker than everything above implies. Stated here
 * rather than assumed, because a security property nobody wrote down is a security property
 * nobody checks. See docs/07_SECURITY.md §7 for the rules that must be deployed.
 *
 * ## What a grant binds, and why each part is there
 *
 *  - **the object** — so a grant for one side of a card cannot fetch the other,
 *  - **the viewer** — so a link copied out of a reviewer's browser is useless to anybody else,
 *    which is the property a bare expiring URL does not have,
 *  - **the record** — so a grant survives only as long as the submission it was issued against,
 *  - **an expiry** — measured in minutes, because a reviewer looks at a document once.
 *
 * The signature covers all four. Changing any of them invalidates the token, so none of them is
 * a claim the holder can edit.
 *
 * ## Key separation
 *
 * Derived from `AUTH_SECRET` through HKDF with its own label, so a grant signature and a session
 * token never share key material. One leaked subkey must not become the other.
 *
 * Refs: docs/07_SECURITY.md §3.3, §7
 */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { DocumentGrant, DocumentGrantRequest, DocumentGrantSigner } from '@langgol/application'
import { env } from '@langgol/shared'

const HKDF_SALT = Buffer.from('langgol.kyc.hkdf.v1')
const GRANT_INFO = Buffer.from('langgol.kyc.document-grant.signing')
const KEY_BYTES = 32

/**
 * Ten minutes.
 *
 * Long enough to open two sides of a card and read them, short enough that a token left in a
 * proxy log or a browser history is dead before anybody finds it. A reviewer who needs longer
 * reloads the queue, which re-issues.
 *
 * ## Why this is a constant rather than platform configuration
 *
 * Windows and thresholds in Langgol normally live in versioned `PlatformConfig`, because they are
 * product decisions somebody should be able to change without a deploy. This is not one. It is
 * the lifetime of a credential that opens somebody's identity document, and making it editable at
 * runtime would mean an operator could widen it to a year from a settings screen — turning a
 * hardening measure into a checkbox. The failure direction of a code constant is a deploy; the
 * failure direction of a configurable one is a permanent bearer token.
 */
export const GRANT_LIFETIME_SECONDS = 600

/** A ceiling no caller can exceed, whatever it asks for. Same reasoning as above. */
const MAX_GRANT_LIFETIME_SECONDS = 3600

let cachedKey: Buffer | null = null
let cachedFrom: string | null = null

function signingKey(): Buffer {
  const secret = env().AUTH_SECRET
  if (cachedKey !== null && cachedFrom === secret) return cachedKey

  const derived = Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), HKDF_SALT, GRANT_INFO, KEY_BYTES),
  )
  cachedKey = derived
  cachedFrom = secret
  return derived
}

/**
 * The wire form.
 *
 * Single-letter keys keep the token short enough to sit in a path segment without being
 * truncated by anything in the middle. The names are documented here rather than guessable from
 * the payload, which is fine: this is a signed blob, not an interchange format.
 */
interface GrantPayload {
  /** storage key */
  readonly k: string
  /** viewer user id */
  readonly v: string
  /** verification record id */
  readonly r: string
  /** expiry, epoch seconds */
  readonly e: number
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingKey()).update(encodedPayload).digest('base64url')
}

export const documentGrantSigner: DocumentGrantSigner = {
  issue(grant: DocumentGrantRequest, now: Date, lifetimeSeconds = GRANT_LIFETIME_SECONDS): string {
    const lifetime = Math.min(Math.max(Math.floor(lifetimeSeconds), 1), MAX_GRANT_LIFETIME_SECONDS)
    const payload: GrantPayload = {
      k: grant.storageKey,
      v: grant.viewerUserId,
      r: grant.verificationId,
      e: Math.floor(now.getTime() / 1000) + lifetime,
    }

    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    return `${encoded}.${sign(encoded)}`
  },

  /**
   * Verify a presented token.
   *
   * Returns null for every failure — forged, altered, expired, malformed — with no indication of
   * which. A caller distinguishing "expired" from "bad signature" would be telling a forger that
   * their signature was right, which is the one piece of information they were probing for.
   */
  verify(token: string, now: Date): DocumentGrant | null {
    const separator = token.lastIndexOf('.')
    if (separator <= 0) return null

    const encoded = token.slice(0, separator)
    const presented = token.slice(separator + 1)

    const expected = Buffer.from(sign(encoded), 'utf8')
    const actual = Buffer.from(presented, 'utf8')

    // Length is checked first because `timingSafeEqual` throws on a mismatch rather than
    // returning false. The length of a signature is not a secret.
    if (expected.byteLength !== actual.byteLength) return null
    if (!timingSafeEqual(expected, actual)) return null

    let payload: GrantPayload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as GrantPayload
    } catch {
      return null
    }

    if (
      typeof payload.k !== 'string' ||
      typeof payload.v !== 'string' ||
      typeof payload.r !== 'string' ||
      typeof payload.e !== 'number'
    ) {
      return null
    }

    if (payload.e * 1000 <= now.getTime()) return null

    return {
      storageKey: payload.k,
      viewerUserId: payload.v,
      verificationId: payload.r,
      expiresAt: new Date(payload.e * 1000),
    }
  },
}
