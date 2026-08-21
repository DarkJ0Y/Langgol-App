/**
 * Verification policy — what a challenge is FOR, and when a token is still good.
 *
 * Two mechanisms, deliberately different, because the secrets are different:
 *
 *  - A **phone OTP** is six digits. A million possibilities is brute-forceable, so it is slow-
 *    hashed (scrypt), attempt-capped, short-lived, and rate-limited on every axis.
 *  - An **email token** is 256 bits of CSPRNG output. There is nothing to guess, so an attempt
 *    cap would be theatre; what matters is that it expires, is single-use, and is stored only as
 *    a fast hash. This is the same reasoning already applied to session tokens in
 *    `infrastructure/crypto/hash.ts`, and it is applied here for the same reason.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.3; docs/01_MVP_REQUIREMENTS.md §79
 */

/**
 * What a phone challenge is for.
 *
 * Scoping matters more than it looks. Rate limits, lookups and invalidation are ALL applied per
 * purpose: without that, a farmer verifying their number would spend the same per-phone budget
 * that their next login needs, and could lock themselves out of their own account by doing
 * exactly what the screen asked them to do.
 */
export const OTP_PURPOSES = ['LOGIN', 'PHONE_VERIFY', 'PHONE_CHANGE', 'PAYOUT_CHANGE'] as const
export type OtpPurpose = (typeof OTP_PURPOSES)[number]

export function isOtpPurpose(value: string): value is OtpPurpose {
  return (OTP_PURPOSES as readonly string[]).includes(value)
}

/** What a token-based (emailed) verification is for. */
export const VERIFICATION_PURPOSES = ['EMAIL_VERIFY'] as const
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number]

export function isVerificationPurpose(value: string): value is VerificationPurpose {
  return (VERIFICATION_PURPOSES as readonly string[]).includes(value)
}

/**
 * 256 bits, matching the session token.
 *
 * A verification link IS a bearer credential for the duration of its life — anyone holding it
 * can prove control of the address. Sizing it below a session token would be treating it as
 * less sensitive than it is.
 */
export const VERIFICATION_TOKEN_BYTES = 32

/**
 * Is a verified email address required to use Langgol?
 *
 * **No**, and this is a product decision rather than an oversight. The MVP requirements are
 * explicit: "Phone-number signup/login via OTP (primary), email optional". A farmer with a
 * feature phone and no email address is the primary user, not an edge case, and a flow that
 * stalls waiting for an inbox they do not have is a flow that loses them.
 *
 * Exported as a function rather than inlined as `false` so that the single place this is decided
 * is greppable, and so a future surface that genuinely does need a verified address (a payout
 * destination, say) has somewhere to state that rather than scattering `if (email)` checks.
 *
 * Refs: docs/01_MVP_REQUIREMENTS.md §79
 */
export function emailVerificationRequired(): boolean {
  return false
}

export interface VerificationTokenState {
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly revokedAt: Date | null
}

export type VerificationVerdict = 'ACCEPTED' | 'EXPIRED' | 'ALREADY_USED' | 'REVOKED'

/**
 * Decide whether a presented token may be redeemed.
 *
 * Reuse and revocation are checked BEFORE expiry, so the reason reported is the one that
 * happened first in the token's life. The caller is expected to collapse every non-accepted
 * verdict into one user-facing message; the distinction is for the audit log, not the screen.
 */
export function evaluateVerificationToken(
  state: VerificationTokenState,
  now: Date,
): VerificationVerdict {
  if (state.consumedAt !== null) return 'ALREADY_USED'
  if (state.revokedAt !== null) return 'REVOKED'
  if (state.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'ACCEPTED'
}

/**
 * Mask an address for an audit row or a log line.
 *
 * `rahim.uddin@example.com` → `r*********n@example.com`. The domain survives because it is what
 * makes a log entry useful when investigating a bounce or an abusive signup pattern; the local
 * part does not, because that is the part that identifies a person.
 *
 * The counterpart of `maskPhone`, and used for the same reason: a full address must never reach
 * a table with a different retention policy. docs/07_SECURITY.md §11
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '****'

  const local = email.slice(0, at)
  const domain = email.slice(at)

  // Too short to mask meaningfully — showing one of two characters reveals half of it.
  if (local.length <= 2) return `**${domain}`

  return `${local[0] ?? ''}${'*'.repeat(local.length - 2)}${local[local.length - 1] ?? ''}${domain}`
}
