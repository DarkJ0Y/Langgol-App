/**
 * Request a one-time code.
 *
 * Deliberate properties, each of which is a security requirement rather than a nicety:
 *
 *  - **No account enumeration.** The response is identical whether or not the number is
 *    registered. An attacker must not be able to use the login form as a directory of Langgol
 *    users. docs/07_SECURITY.md §3.1
 *  - **Layered limits.** Per-phone, per-IP and a short resend cooldown. The cooldown exists
 *    because a user who taps "resend" twice is impatient, not hostile, and should be told to
 *    wait rather than locked out for fifteen minutes.
 *  - **A spend circuit breaker.** Each SMS costs real money; an uncapped gateway is an open
 *    invoice to anyone with a script. docs/07_SECURITY.md T14
 *  - **The code is never returned, logged or stored in plaintext.** It exists in memory long
 *    enough to be hashed and handed to the delivery port.
 */

import {
  evaluateRateLimit,
  hasSmsBudget,
  normalizePhone,
  maskPhone,
  OTP_LENGTH,
  PhoneError,
  resendCooldownRemaining,
  type E164Phone,
} from '@langgol/domain/identity'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type Result, type AppError } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  OtpChallengeRepository,
  OtpDeliveryPort,
  RandomSource,
  SecretHasher,
} from '../../ports/index.js'

/** A resend sooner than this is impatience; the user is told to wait, not blocked. */
const RESEND_COOLDOWN_SECONDS = 30

export interface RequestOtpCommand {
  readonly phone: string
  readonly locale: 'bn' | 'en'
  readonly ipAddress: string | null
  readonly deviceId: string | null
}

export interface RequestOtpResult {
  /** Masked, so the UI can say "code sent to +880171****5678" without holding the full number. */
  readonly maskedPhone: string
  readonly expiresInSeconds: number
  readonly resendAvailableInSeconds: number
}

export interface RequestOtpDeps {
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly random: RandomSource
  readonly hasher: SecretHasher
  readonly challenges: OtpChallengeRepository
  readonly delivery: OtpDeliveryPort
  readonly audit: AuditPort
}

export async function requestOtp(
  command: RequestOtpCommand,
  deps: RequestOtpDeps,
): Promise<Result<RequestOtpResult, AppError>> {
  let phone: E164Phone
  try {
    phone = normalizePhone(command.phone)
  } catch (error) {
    if (error instanceof PhoneError) {
      return err(Errors.validation(error.message, { field: 'phone', code: error.code }))
    }
    throw error
  }

  const now = deps.clock.now()
  const limits = deps.config.require('auth.otp.rateLimits')
  const ttlSeconds = deps.config.require('auth.otp.ttlSeconds')
  const maxAttempts = deps.config.require('auth.otp.maxAttempts')

  // --- Resend cooldown ------------------------------------------------------
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const phoneRequests = await deps.challenges.recentRequestTimes({ phone, since: dayAgo })
  const mostRecent = phoneRequests.reduce<Date | null>(
    (latest, at) => (latest === null || at > latest ? at : latest),
    null,
  )

  const cooldown = resendCooldownRemaining(mostRecent, RESEND_COOLDOWN_SECONDS, now)
  if (cooldown > 0) {
    return err(Errors.rateLimited(cooldown))
  }

  // --- Per-phone limits (windowed and daily) --------------------------------
  const phoneWindow = evaluateRateLimit(phoneRequests, limits.perPhone, now)
  if (!phoneWindow.allowed) {
    await deps.audit.record({
      actorUserId: null,
      action: 'OTP_RATE_LIMITED',
      entityType: 'phone',
      entityId: maskPhone(phone),
      reason: 'PER_PHONE_WINDOW',
      ipAddress: command.ipAddress,
    })
    return err(Errors.rateLimited(phoneWindow.retryAfterSeconds))
  }

  if (phoneRequests.length >= limits.perPhone.dailyLimit) {
    await deps.audit.record({
      actorUserId: null,
      action: 'OTP_RATE_LIMITED',
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
      since,
    })
    const ipWindow = evaluateRateLimit(ipRequests, limits.perIp, now)
    if (!ipWindow.allowed) {
      await deps.audit.record({
        actorUserId: null,
        action: 'OTP_RATE_LIMITED',
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
      actorUserId: null,
      action: 'SMS_BUDGET_EXHAUSTED',
      entityType: 'sms_budget',
      entityId: now.toISOString().slice(0, 10),
      reason: 'DAILY_BUDGET_REACHED',
      meta: { sentToday },
    })
    // Not the user's fault, and not something to explain to them in detail.
    return err(Errors.providerUnavailable('SMS delivery'))
  }

  // --- Issue the challenge --------------------------------------------------
  const code = deps.random.numericCode(OTP_LENGTH)
  const codeHash = await deps.hasher.hash(code)
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  await deps.challenges.create({
    phone,
    codeHash,
    purpose: 'LOGIN',
    expiresAt,
    maxAttempts,
    requestIp: command.ipAddress,
    requestDevice: command.deviceId,
  })

  const delivered = await deps.delivery.deliver({
    phone,
    code,
    locale: command.locale,
    expiresInSeconds: ttlSeconds,
  })

  if (!delivered.accepted) {
    return err(Errors.providerUnavailable('SMS delivery'))
  }

  // Audited with a MASKED number. A full phone number never reaches a log or an audit row.
  await deps.audit.record({
    actorUserId: null,
    action: 'OTP_REQUESTED',
    entityType: 'phone',
    entityId: maskPhone(phone),
    ipAddress: command.ipAddress,
  })

  return ok({
    maskedPhone: maskPhone(phone),
    expiresInSeconds: ttlSeconds,
    resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
  })
}
