/**
 * Firebase Authentication, as the application layer sees it.
 *
 * Under `AUTH_MODE=firebase` the browser completes a phone sign-in against Firebase and receives a
 * signed ID token. This port is the one place that token is turned into something trustworthy: a
 * phone number Google will vouch for, and Firebase's own opaque user id.
 *
 * ## The port is this narrow on purpose
 *
 * The Firebase Admin SDK can do a great deal — mint custom tokens, disable accounts, list users,
 * set custom claims. None of that belongs above this line. Roles, sessions, suspension and every
 * authorization decision stay in PostgreSQL and in the domain, exactly as they are under OTP.
 * Firebase answers ONE question: does this caller control this phone number?
 *
 * Keeping it to that question is what makes the choice reversible. Swapping back to `otp`, or to
 * another identity provider later, replaces one adapter and leaves the account model, the role
 * grants and the audit trail untouched.
 *
 * ## Why verification returns null rather than a reason
 *
 * A token can fail for many reasons: expired, wrong audience, wrong issuer, bad signature,
 * revoked, malformed. Every one of them means the same thing to a caller — this token does not
 * establish anything — and reporting which one tells an attacker how close they got. The adapter
 * logs the detail for operators; the use case receives a yes or a no.
 *
 * Refs: docs/03_ARCHITECTURE.md §2.1; docs/07_SECURITY.md §3
 */

export interface VerifiedFirebaseIdentity {
  /**
   * Firebase's own user id.
   *
   * Opaque, and deliberately NOT used as a key for anything in Langgol. It is recorded so that a
   * support question about a specific Firebase account can be answered, and so a future migration
   * has something to join on. The phone number remains the identity this system knows a person by,
   * because it is the one a farmer can actually tell you over the phone.
   */
  readonly uid: string

  /**
   * The phone number Firebase verified, as Firebase returned it.
   *
   * Firebase issues E.164, but this is not trusted to already be in Langgol's normalised form —
   * the use case normalises it through the same domain function every other entry point uses. A
   * second normalisation is cheap; two subtly different notions of "the same number" are not.
   */
  readonly phone: string

  /** When Firebase performed the sign-in, from the token's own claims. */
  readonly verifiedAt: Date
}

export interface FirebaseIdentityVerifier {
  /**
   * Verify an ID token and return what it establishes, or null if it establishes nothing.
   *
   * Implementations MUST check the signature against Google's published keys, the issuer, the
   * expiry, and — most importantly — that the audience is this project. A token that is perfectly
   * valid for somebody else's Firebase project is not a token for us, and accepting one would be
   * a complete authentication bypass, since anyone can create a Firebase project.
   *
   * Implementations must never log the token itself. It is a bearer credential.
   */
  verifyIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null>
}
