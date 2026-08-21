/**
 * Phone verification for a signed-in user.
 *
 * Distinct from login, which already proves a number as a side effect of signing in. This flow
 * exists for the accounts login cannot reach: one created by an administrator, one migrated in,
 * or a development fixture — all of which can hold an unproven number indefinitely.
 *
 * Everything here reuses the login machinery rather than reimplementing it: the same
 * `evaluateOtpAttempt`, the same rate-limit and cooldown policy, the same scrypt hasher, the
 * same SMS delivery port with its spend circuit breaker. What differs is one field — the
 * purpose — and that difference is exactly what keeps the two flows from spending each other's
 * budget.
 *
 * Security properties, each of which is a requirement and not a nicety:
 *
 *  - The code is generated from a CSPRNG, hashed before storage, and **never** returned, logged
 *    or persisted in plaintext. It exists in memory long enough to be hashed and handed to the
 *    delivery port.
 *  - Requesting a new code **invalidates every outstanding one**. Otherwise each request adds
 *    another live code and the attempt cap counts per challenge while real exposure grows.
 *  - Expiry and reuse are evaluated before correctness, so a correct code presented to a dead
 *    challenge is still refused and cannot confirm a guess.
 *  - Failures are indistinguishable to the caller: wrong, expired, already used and never issued
 *    all produce one message.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.2
 */

import {
  evaluateOtpAttempt,
  evaluateRateLimit,
  hasSmsBudget,
  maskPhone,
  normalizePhone,
  resendCooldownRemaining,
  OTP_LENGTH,
  PhoneError,
  type E164Phone,
} from '@langgol/domain/identity'
import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AccountRepository,
  AuditPort,
  Clock,
  OtpChallengeRepository,
  OtpDeliveryPort,
  RandomSource,
  SecretHasher,
  UserRepository,
} from '../../ports/index.js'

/** A resend sooner than this is impatience; the user is told to wait, not blocked. */
const RESEND_COOLDOWN_SECONDS = 30

const PURPOSE = 'PHONE_VERIFY' as const

export interface PhoneVerificationDeps {
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly random: RandomSource
  readonly hasher: SecretHasher
  readonly challenges: OtpChallengeRepository
  readonly delivery: OtpDeliveryPort
  readonly accounts: AccountRepository
  readonly users: UserRepository
  readonly audit: AuditPort
}

export interface RequestPhoneVerificationResult {
  readonly maskedPhone: string
  readonly expiresInSeconds: number
  readonly resendAvailableInSeconds: number
  /** True when the number was already proven and no code was sent. */
  readonly alreadyVerified: boolean
}

/* --------------------------------------------------------------- request a code */

/**
 * Send a verification code to the number already on the account.
 *
 * There is deliberately no phone parameter. The number verified is the one on the account, read
 * server-side — a command carrying a phone number would be a way to have Langgol send an SMS to
 * an arbitrary number at our expense, which is the same abuse the login rate limits exist to
 * stop, dressed as a feature.
 */
export async function requestPhoneVerification(
  actor: MaybeActor,
  command: { readonly ipAddress: string | null; readonly locale: 'bn' | 'en' },
  deps: PhoneVerificationDeps,
): Promise<Result<RequestPhoneVerificationResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'user:update-self')) return err(Errors.forbidden())

  const profile = await deps.accounts.findProfile(actor.userId)
  if (profile === null) return err(Errors.notFound('Account'))

  let phone: E164Phone
  try {
    phone = normalizePhone(profile.phone)
  } catch (error) {
    if (error instanceof PhoneError) {
      // A stored number that no longer normalises is a data problem, not the user's mistake.
      return err(Errors.preconditionFailed('The number on this account cannot be verified.'))
    }
    throw error
  }

  const now = deps.clock.now()

  if (profile.phoneVerifiedAt !== null) {
    // Idempotent and silent: no code, no SMS spend, no rate-limit consumption.
    return ok({
      maskedPhone: maskPhone(phone),
      expiresInSeconds: 0,
      resendAvailableInSeconds: 0,
      alreadyVerified: true,
    })
  }

  const limits = deps.config.require('auth.otp.rateLimits')
  const ttlSeconds = deps.config.require('auth.otp.ttlSeconds')
  const maxAttempts = deps.config.require('auth.otp.maxAttempts')

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const requests = await deps.challenges.recentRequestTimes({
    phone,
    purpose: PURPOSE,
    since: dayAgo,
  })

  // --- Resend cooldown ------------------------------------------------------
  const mostRecent = requests.reduce<Date | null>(
    (latest, at) => (latest === null || at > latest ? at : latest),
    null,
  )
  const cooldown = resendCooldownRemaining(mostRecent, RESEND_COOLDOWN_SECONDS, now)
  if (cooldown > 0) return err(Errors.rateLimited(cooldown))

  // --- Per-phone limits -----------------------------------------------------
  const window = evaluateRateLimit(requests, limits.perPhone, now)
  if (!window.allowed) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'PHONE_VERIFY_RATE_LIMITED',
      entityType: 'phone',
      entityId: maskPhone(phone),
      reason: 'PER_PHONE_WINDOW',
      ipAddress: command.ipAddress,
    })
    return err(Errors.rateLimited(window.retryAfterSeconds))
  }

  if (requests.length >= limits.perPhone.dailyLimit) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'PHONE_VERIFY_RATE_LIMITED',
      entityType: 'phone',
      entityId: maskPhone(phone),
      reason: 'PER_PHONE_DAILY',
      ipAddress: command.ipAddress,
    })
    return err(Errors.rateLimited(24 * 60 * 60))
  }

  // --- Per-IP limit ---------------------------------------------------------
  if (command.ipAddress !== null) {
    const since = new Date(now.getTime() - limits.perIp.windowSeconds * 1000)
    const ipRequests = await deps.challenges.recentRequestTimes({
      ip: command.ipAddress,
      purpose: PURPOSE,
      since,
    })
    const ipWindow = evaluateRateLimit(ipRequests, limits.perIp, now)
    if (!ipWindow.allowed) {
      await deps.audit.record({
        actorUserId: actor.userId,
        action: 'PHONE_VERIFY_RATE_LIMITED',
        entityType: 'ip',
        entityId: command.ipAddress,
        reason: 'PER_IP_WINDOW',
        ipAddress: command.ipAddress,
      })
      return err(Errors.rateLimited(ipWindow.retryAfterSeconds))
    }
  }

  // --- Spend circuit breaker ------------------------------------------------
  const sentToday = await deps.delivery.sentToday(now)
  if (!hasSmsBudget(sentToday, deps.delivery.unitCost, deps.delivery.dailyBudget)) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'SMS_BUDGET_EXHAUSTED',
      entityType: 'sms_budget',
      entityId: now.toISOString().slice(0, 10),
      reason: 'DAILY_BUDGET_REACHED',
      meta: { sentToday },
    })
    return err(Errors.providerUnavailable('SMS delivery'))
  }

  // --- Issue --------------------------------------------------------------
  // Kill the previous code FIRST. Two live codes means two sets of attempts against one number.
  await deps.challenges.invalidateOutstanding({ phone, purpose: PURPOSE, at: now })

  const code = deps.random.numericCode(OTP_LENGTH)
  const codeHash = await deps.hasher.hash(code)

  await deps.challenges.create({
    phone,
    codeHash,
    purpose: PURPOSE,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    maxAttempts,
    requestIp: command.ipAddress,
    requestDevice: null,
  })

  const delivered = await deps.delivery.deliver({
    phone,
    code,
    locale: command.locale,
    expiresInSeconds: ttlSeconds,
  })
  if (!delivered.accepted) return err(Errors.providerUnavailable('SMS delivery'))

  // Audited with a MASKED number, never the code and never the full number.
  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'PHONE_VERIFY_REQUESTED',
    entityType: 'phone',
    entityId: maskPhone(phone),
    ipAddress: command.ipAddress,
  })

  return ok({
    maskedPhone: maskPhone(phone),
    expiresInSeconds: ttlSeconds,
    resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
    alreadyVerified: false,
  })
}

/* ---------------------------------------------------------------- confirm a code */

export interface ConfirmPhoneVerificationResult {
  readonly verifiedAt: Date
}

export async function confirmPhoneVerification(
  actor: MaybeActor,
  command: { readonly code: string; readonly ipAddress: string | null },
  deps: PhoneVerificationDeps,
): Promise<Result<ConfirmPhoneVerificationResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'user:update-self')) return err(Errors.forbidden())

  const profile = await deps.accounts.findProfile(actor.userId)
  if (profile === null) return err(Errors.notFound('Account'))

  let phone: E164Phone
  try {
    phone = normalizePhone(profile.phone)
  } catch (error) {
    if (error instanceof PhoneError) {
      return err(Errors.preconditionFailed('The number on this account cannot be verified.'))
    }
    throw error
  }

  const now = deps.clock.now()

  if (profile.phoneVerifiedAt !== null) {
    return ok({ verifiedAt: profile.phoneVerifiedAt })
  }

  const challenge = await deps.challenges.findLatestActive(phone, PURPOSE, now)
  if (challenge === null) {
    // One message whether the challenge never existed, expired, or was already used. The
    // distinction would let a caller probe the state of a challenge it does not hold.
    return err(Errors.validation('That code is not valid. Request a new one.', { field: 'code' }))
  }

  const codeMatches = await deps.hasher.verify(command.code, challenge.codeHash)
  const evaluation = evaluateOtpAttempt(
    {
      expiresAt: challenge.expiresAt,
      attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts,
      consumedAt: challenge.consumedAt,
    },
    codeMatches,
    now,
  )

  if (evaluation.verdict !== 'ACCEPTED') {
    // Recorded BEFORE returning, so a failed guess always counts even against a caller that
    // aborts the connection. This is what makes the attempt cap real rather than advisory.
    await deps.challenges.recordAttempt(challenge.id)
    if (evaluation.burn) await deps.challenges.burn(challenge.id, now)

    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'PHONE_VERIFY_FAILED',
      entityType: 'phone',
      entityId: maskPhone(phone),
      reason: evaluation.verdict,
      ipAddress: command.ipAddress,
    })

    if (evaluation.verdict === 'TOO_MANY_ATTEMPTS') return err(Errors.rateLimited(0))
    return err(
      Errors.validation('That code is not valid. Request a new one.', {
        field: 'code',
        attemptsRemaining: evaluation.attemptsRemaining,
      }),
    )
  }

  await deps.challenges.consume(challenge.id, now)
  await deps.users.markPhoneVerified(actor.userId, now)

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'PHONE_VERIFIED',
    entityType: 'user',
    entityId: actor.userId,
    ipAddress: command.ipAddress,
  })

  return ok({ verifiedAt: now })
}
