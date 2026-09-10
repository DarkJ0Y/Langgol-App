/**
 * Firebase ID token verification.
 *
 * Implements `FirebaseIdentityVerifier` by checking the token against Google's published signing
 * keys. It answers one question — does this caller control this phone number — and nothing else.
 *
 * ## Why `jose` and not `firebase-admin`
 *
 * Verifying an ID token needs only PUBLIC keys. It is a signature check plus four claim checks,
 * and Google documents exactly this path for backends that do not otherwise need the Admin SDK.
 *
 * `firebase-admin` would bring roughly forty transitive packages and a service-account credential
 * this deployment does not have, to obtain one function. This repository states its supply-chain
 * position explicitly — `pnpm-workspace.yaml` lists every package permitted to run an install
 * script, with a reason for each — and a forty-package dependency for a signature check does not
 * sit well beside that. `jose` has no dependencies of its own.
 *
 * The trade is that the claim checks are configured here rather than inside somebody else's
 * function. They are configured DECLARATIVELY: `jwtVerify` is told the issuer, the audience and
 * the algorithm, and enforces them along with signature and expiry. No cryptography is written
 * here, and the one check the library cannot express is asserted immediately below it.
 *
 * ## The check that matters most
 *
 * `audience` must be this project. Anyone can create a Firebase project in a minute and mint
 * perfectly valid, correctly signed tokens in it. A verifier that checks the signature but not
 * the audience accepts those, and that is a complete authentication bypass rather than a
 * weakening. It is the reason `FIREBASE_PROJECT_ID` is a boot requirement of this mode.
 *
 * Refs: docs/07_SECURITY.md §3; docs/03_ARCHITECTURE.md §2.1
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { FirebaseIdentityVerifier, VerifiedFirebaseIdentity } from '@langgol/application'

/**
 * Google's public keys for Firebase ID tokens, in JWKS form.
 *
 * The x509 endpoint in Firebase's documentation serves PEM certificates; this one serves the same
 * keys as a JWKS, which is what `jose` consumes. `createRemoteJWKSet` fetches on demand, caches,
 * and refetches when it meets a key id it does not recognise — which is what makes Google's key
 * rotation a non-event rather than an outage.
 */
const GOOGLE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
)

/**
 * A Firebase ID token's phone sign-in claims.
 *
 * Only what this system uses. `sub` is the Firebase uid; `phone_number` is present because the
 * sign-in was by phone. Both are read defensively: a token can be perfectly valid and still not
 * carry a phone number, if it came from a different sign-in method.
 */
interface FirebaseClaims extends JWTPayload {
  readonly phone_number?: unknown
  readonly auth_time?: unknown
}

export interface FirebaseAuthConfig {
  /** The Firebase project this deployment trusts. Tokens for any other project are refused. */
  readonly projectId: string

  /**
   * Called with the reason a token was refused. Optional, and never given the token.
   *
   * The reason exists for an operator and must never reach the caller, because telling somebody
   * which check their token failed tells them how close they got. It is a callback rather than a
   * logger dependency so that this package stays free of one, and so the composition root decides
   * where refusals go.
   */
  readonly onRefusal?: (reason: string) => void
}

export function createFirebaseIdentityVerifier(
  config: FirebaseAuthConfig,
): FirebaseIdentityVerifier {
  const reject = (reason: string): void => {
    config.onRefusal?.(reason)
  }

  /*
   * Built once, not per request. The key set holds Google's current signing keys and their
   * cache expiry; recreating it per request would fetch the key set on every sign-in and turn a
   * local signature check into a network round trip on the login path.
   */
  const keys = createRemoteJWKSet(GOOGLE_JWKS_URL)

  return {
    async verifyIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
      if (idToken.trim() === '') return null

      try {
        const { payload } = await jwtVerify<FirebaseClaims>(idToken, keys, {
          // Google signs ID tokens with RS256. Pinning it closes the algorithm-confusion family
          // of attacks, where a token declares `none` or a symmetric algorithm and a permissive
          // verifier obliges.
          algorithms: ['RS256'],
          issuer: `https://securetoken.google.com/${config.projectId}`,
          audience: config.projectId,
        })

        /*
         * `sub` is the uid. Firebase guarantees it is non-empty and at most 128 characters; it is
         * checked rather than assumed because it becomes an audit `entity_id`, and an unbounded
         * value from a token has no business being written into a table unmeasured.
         */
        const uid = payload.sub
        if (typeof uid !== 'string' || uid === '' || uid.length > 128) {
          reject('SUB_NOT_USABLE')
          return null
        }

        /*
         * A valid token from a non-phone sign-in method carries no phone number. That is not an
         * attack and not an error in the token — it simply cannot establish what this application
         * needs, so it establishes nothing.
         */
        const phone = payload.phone_number
        if (typeof phone !== 'string' || phone === '') {
          reject('NO_PHONE_CLAIM')
          return null
        }

        return {
          uid,
          phone,
          /*
           * `auth_time` is when the user actually authenticated, which is the fact being recorded.
           * `iat` is when this particular token was issued, and a refreshed token carries a newer
           * one — using it would move the verification date every time the browser refreshed.
           */
          verifiedAt: momentFrom(payload.auth_time) ?? momentFrom(payload.iat) ?? new Date(),
        }
      } catch (error) {
        // The reason is for an operator, never for the caller: telling a caller which check failed
        // tells them how close they got.
        reject(error instanceof Error ? error.name : 'UNKNOWN')
        return null
      }
    },
  }
}

/** Seconds-since-epoch to a Date, or null if the claim is not a usable number. */
function momentFrom(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return new Date(value * 1000)
}
