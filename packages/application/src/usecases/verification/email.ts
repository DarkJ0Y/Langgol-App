/**
 * Email verification — optional, and optional all the way down.
 *
 * The MVP requirements are explicit that signup and login are by phone, "email optional". So
 * nothing here blocks anything: an account with no address is complete, an account with an
 * unverified address is complete, and a deployment with no email provider at all is a supported
 * configuration rather than a broken one. What this flow offers is a way for someone who *does*
 * have an inbox to prove it, so that a future surface which genuinely needs a reachable address
 * has something trustworthy to read.
 *
 * The token is 256 bits of CSPRNG output, so unlike an OTP there is nothing to guess and no
 * attempt cap to enforce. What matters instead:
 *
 *  - it is stored only as a SHA-256 hash, so a leaked database yields no redeemable links;
 *  - it expires;
 *  - it is single-use;
 *  - requesting a new one revokes the old, enforced by a partial unique index as well as here;
 *  - it proves control of the address it was SENT to, which is re-checked at redemption — a link
 *    mailed to an old address must not verify a new one.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.3; docs/01_MVP_REQUIREMENTS.md §79
 */

import {
  evaluateRateLimit,
  evaluateVerificationToken,
  maskEmail,
  resendCooldownRemaining,
  VERIFICATION_TOKEN_BYTES,
} from '@langgol/domain/identity'
import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AccountRepository,
  AuditPort,
  Clock,
  EmailDeliveryPort,
  RandomSource,
  SecretHasher,
  VerificationTokenRepository,
} from '../../ports/index.js'

const PURPOSE = 'EMAIL_VERIFY' as const

export interface EmailVerificationDeps {
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly random: RandomSource
  readonly hasher: SecretHasher
  readonly tokens: VerificationTokenRepository
  readonly accounts: AccountRepository
  readonly delivery: EmailDeliveryPort
  readonly audit: AuditPort
  /** Base URL for the redemption link, e.g. `https://langgol.app`. */
  readonly appUrl: string
}

export interface EmailVerificationStatus {
  readonly email: string | null
  readonly verified: boolean
  /** False when no provider is configured — the UI must not offer a button that cannot work. */
  readonly available: boolean
  /** True only when there is an address, it is unproven, and sending is possible. */
  readonly canRequest: boolean
}

/* ------------------------------------------------------------------- status */

/**
 * What the account screen needs in order to decide whether to show a reminder.
 *
 * Returns a shape that makes "do nothing" the easy branch: with no address, no provider, or an
 * already-proven address, `canRequest` is false and the UI has nothing to render.
 */
export async function emailVerificationStatus(
  actor: MaybeActor,
  deps: EmailVerificationDeps,
): Promise<Result<EmailVerificationStatus, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'user:read-self')) return err(Errors.forbidden())

  const profile = await deps.accounts.findProfile(actor.userId)
  if (profile === null) return err(Errors.notFound('Account'))

  const verified = profile.emailVerifiedAt !== null
  return ok({
    email: profile.email,
    verified,
    available: deps.delivery.available,
    canRequest: profile.email !== null && !verified && deps.delivery.available,
  })
}

/* ---------------------------------------------------------- request / resend */

export interface RequestEmailVerificationResult {
  readonly maskedEmail: string
  readonly expiresInSeconds: number
  readonly resendAvailableInSeconds: number
  readonly alreadyVerified: boolean
}

/**
 * Send (or resend) a verification link to the address on the account.
 *
 * As with phone verification there is no address parameter: the address verified is the one
 * already stored. Accepting one from the caller would turn this into an open relay that sends
 * Langgol-branded mail to any address an attacker names.
 */
export async function requestEmailVerification(
  actor: MaybeActor,
  command: { readonly ipAddress: string | null; readonly locale: 'bn' | 'en' },
  deps: EmailVerificationDeps,
): Promise<Result<RequestEmailVerificationResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'user:update-self')) return err(Errors.forbidden())

  const profile = await deps.accounts.findProfile(actor.userId)
  if (profile === null) return err(Errors.notFound('Account'))

  if (profile.email === null) {
    return err(Errors.validation('Add an email address to your account first.', { field: 'email' }))
  }

  const now = deps.clock.now()

  if (profile.emailVerifiedAt !== null) {
    // Idempotent: no token, no send, no rate-limit consumption.
    return ok({
      maskedEmail: maskEmail(profile.email),
      expiresInSeconds: 0,
      resendAvailableInSeconds: 0,
      alreadyVerified: true,
    })
  }

  if (!deps.delivery.available) {
    // A deployment choice, not a fault. Said plainly rather than pretending a mail was sent.
    return err(Errors.providerUnavailable('Email delivery'))
  }

  const ttlSeconds = deps.config.require('auth.emailVerification.ttlSeconds')
  const limits = deps.config.require('auth.emailVerification.rateLimits')

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const requests = await deps.tokens.recentRequestTimes({
    userId: actor.userId,
    purpose: PURPOSE,
    since: dayAgo,
  })

  // --- Resend cooldown ------------------------------------------------------
  const mostRecent = requests.reduce<Date | null>(
    (latest, at) => (latest === null || at > latest ? at : latest),
    null,
  )
  const cooldown = resendCooldownRemaining(mostRecent, limits.resendCooldownSeconds, now)
  if (cooldown > 0) return err(Errors.rateLimited(cooldown))

  // --- Per-user limits ------------------------------------------------------
  const window = evaluateRateLimit(requests, limits.perUser, now)
  if (!window.allowed) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'EMAIL_VERIFY_RATE_LIMITED',
      entityType: 'user',
      entityId: actor.userId,
      reason: 'PER_USER_WINDOW',
      ipAddress: command.ipAddress,
    })
    return err(Errors.rateLimited(window.retryAfterSeconds))
  }

  if (requests.length >= limits.perUser.dailyLimit) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'EMAIL_VERIFY_RATE_LIMITED',
      entityType: 'user',
      entityId: actor.userId,
      reason: 'PER_USER_DAILY',
      ipAddress: command.ipAddress,
    })
    return err(Errors.rateLimited(24 * 60 * 60))
  }

  // --- Issue ----------------------------------------------------------------
  // Revoke first: a widening set of live links is a widening set of ways in. The database
  // enforces this too, via a partial unique index on (user, purpose) where still live.
  await deps.tokens.invalidateOutstanding({ userId: actor.userId, purpose: PURPOSE, at: now })

  const token = deps.random.token(VERIFICATION_TOKEN_BYTES)

  await deps.tokens.create({
    userId: actor.userId,
    purpose: PURPOSE,
    destination: profile.email,
    // A fast hash is correct for a 256-bit secret; see the module header.
    tokenHash: deps.hasher.hashToken(token),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    requestIp: command.ipAddress,
  })

  const delivered = await deps.delivery.deliver({
    to: profile.email,
    link: `${deps.appUrl.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(token)}`,
    locale: command.locale,
    expiresInSeconds: ttlSeconds,
    userId: actor.userId,
  })

  if (!delivered.accepted) return err(Errors.providerUnavailable('Email delivery'))

  // MASKED in the audit row. The full address belongs in the users table, not in a log with a
  // different retention policy — and the token never appears anywhere but the message itself.
  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'EMAIL_VERIFY_REQUESTED',
    entityType: 'user',
    entityId: actor.userId,
    reason: maskEmail(profile.email),
    ipAddress: command.ipAddress,
  })

  return ok({
    maskedEmail: maskEmail(profile.email),
    expiresInSeconds: ttlSeconds,
    resendAvailableInSeconds: limits.resendCooldownSeconds,
    alreadyVerified: false,
  })
}

/* -------------------------------------------------------------- redeem a token */

export interface ConfirmEmailResult {
  readonly email: string
  readonly verifiedAt: Date
}

/**
 * Redeem a verification link.
 *
 * Deliberately does NOT require a session. The link arrives in an inbox that may be opened on a
 * different device from the one that is signed in, and forcing a login first would strand the
 * majority of people who click it. The token itself is the credential, which is why it is
 * 256 bits and single-use.
 *
 * It also grants nothing beyond the verification: no session is issued, no privilege is
 * conferred. Someone who steals a link can mark an address verified — which they already
 * controlled, by definition of having received it — and nothing else.
 */
export async function confirmEmail(
  command: { readonly token: string; readonly ipAddress: string | null },
  deps: EmailVerificationDeps,
): Promise<Result<ConfirmEmailResult, AppError>> {
  const now = deps.clock.now()

  // Look up BY HASH. The plaintext token is never stored, so this is the only way to find it,
  // and there is no query here that takes a user id and returns a live token.
  const record = await deps.tokens.findByHash(deps.hasher.hashToken(command.token))

  if (record === null) {
    // One message for "no such token" and every other failure below. Distinguishing them would
    // tell someone probing links which of their guesses had ever been a real token.
    return err(Errors.validation('This link is no longer valid. Request a new one.'))
  }

  const verdict = evaluateVerificationToken(record, now)
  if (verdict !== 'ACCEPTED') {
    await deps.audit.record({
      actorUserId: record.userId,
      action: 'EMAIL_VERIFY_FAILED',
      entityType: 'user',
      entityId: record.userId,
      reason: verdict,
      ipAddress: command.ipAddress,
    })
    return err(Errors.validation('This link is no longer valid. Request a new one.'))
  }

  /*
   * Consume BEFORE applying the effect. If the write below fails the token is still spent, which
   * is the safe direction to fail in: the user requests another link, rather than holding one
   * that can be replayed.
   */
  await deps.tokens.consume(record.id, now)

  // The token proves control of `record.destination`. If the account's address has changed since
  // the link was sent, that proof says nothing about the address held now.
  const applied = await deps.accounts.markEmailVerified({
    userId: record.userId,
    email: record.destination,
    at: now,
  })

  if (!applied) {
    await deps.audit.record({
      actorUserId: record.userId,
      action: 'EMAIL_VERIFY_FAILED',
      entityType: 'user',
      entityId: record.userId,
      reason: 'ADDRESS_CHANGED',
      ipAddress: command.ipAddress,
    })
    return err(Errors.validation('This link was sent to a different address. Request a new one.'))
  }

  await deps.audit.record({
    actorUserId: record.userId,
    action: 'EMAIL_VERIFIED',
    entityType: 'user',
    entityId: record.userId,
    reason: maskEmail(record.destination),
    ipAddress: command.ipAddress,
  })

  return ok({ email: record.destination, verifiedAt: now })
}
