/**
 * OTP policy — pure decisions about a one-time code's lifecycle.
 *
 * Deliberately free of crypto and I/O: generating a code needs a CSPRNG and comparing one needs
 * a hash, both of which live in infrastructure. What lives here is the part that must be
 * obviously correct and exhaustively tested — when a challenge is dead, when an attempt is
 * allowed, and when a request should be refused.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.2
 */

import { Money, type Poisha } from '../money/index.js'

/** Six digits. Long enough with a 5-minute TTL and a 5-attempt cap; short enough to read aloud. */
export const OTP_LENGTH = 6

export interface OtpChallengeState {
  readonly expiresAt: Date
  readonly attempts: number
  readonly maxAttempts: number
  readonly consumedAt: Date | null
}

export type OtpVerdict = 'ACCEPTED' | 'EXPIRED' | 'ALREADY_USED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT'

export interface OtpEvaluation {
  readonly verdict: OtpVerdict
  /** Burn the challenge: it can never be used again, whatever the caller does next. */
  readonly burn: boolean
  readonly attemptsRemaining: number
}

/**
 * Decide the outcome of a verification attempt.
 *
 * Order matters and is deliberate: expiry and reuse are checked **before** correctness, so a
 * correct code presented to a dead challenge is still refused and cannot be used to probe
 * whether a guess was right.
 */
export function evaluateOtpAttempt(
  state: OtpChallengeState,
  codeMatches: boolean,
  now: Date,
): OtpEvaluation {
  if (state.consumedAt !== null) {
    return { verdict: 'ALREADY_USED', burn: false, attemptsRemaining: 0 }
  }

  if (state.expiresAt.getTime() <= now.getTime()) {
    return { verdict: 'EXPIRED', burn: true, attemptsRemaining: 0 }
  }

  if (state.attempts >= state.maxAttempts) {
    return { verdict: 'TOO_MANY_ATTEMPTS', burn: true, attemptsRemaining: 0 }
  }

  const attemptsAfter = state.attempts + 1
  const remaining = Math.max(0, state.maxAttempts - attemptsAfter)

  if (codeMatches) {
    return { verdict: 'ACCEPTED', burn: true, attemptsRemaining: remaining }
  }

  // Burn on the final wrong attempt so the challenge cannot be probed further.
  return { verdict: 'INCORRECT', burn: remaining === 0, attemptsRemaining: remaining }
}

export interface RateLimitWindow {
  readonly limit: number
  readonly windowSeconds: number
}

export interface RateLimitVerdict {
  readonly allowed: boolean
  readonly retryAfterSeconds: number
}

/**
 * Decide whether another request is allowed, given the timestamps of recent ones.
 *
 * `retryAfterSeconds` is computed from the oldest request still inside the window, so the caller
 * can tell the user when to try again instead of "please wait".
 */
export function evaluateRateLimit(
  recentRequests: readonly Date[],
  window: RateLimitWindow,
  now: Date,
): RateLimitVerdict {
  const cutoff = now.getTime() - window.windowSeconds * 1000
  const inWindow = recentRequests
    .filter((at) => at.getTime() > cutoff)
    .sort((a, b) => a.getTime() - b.getTime())

  if (inWindow.length < window.limit) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const oldest = inWindow[0]
  if (oldest === undefined) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const freesAt = oldest.getTime() + window.windowSeconds * 1000
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)),
  }
}

/**
 * Resend cooldown.
 *
 * Distinct from the rate limit: a user who taps "resend" twice in three seconds is impatient,
 * not hostile, and should be told to wait rather than locked out for fifteen minutes.
 */
export function resendCooldownRemaining(
  lastRequestAt: Date | null,
  cooldownSeconds: number,
  now: Date,
): number {
  if (lastRequestAt === null) return 0
  const elapsed = (now.getTime() - lastRequestAt.getTime()) / 1000
  return Math.max(0, Math.ceil(cooldownSeconds - elapsed))
}

/**
 * Is there SMS budget left to send this message?
 *
 * An SMS gateway without a spend cap is an open invoice to an attacker: a script requesting OTPs
 * for random numbers costs us real money per message. docs/07_SECURITY.md §3.2, T14
 */
export function hasSmsBudget(sentToday: number, unitCost: Poisha, dailyBudget: Poisha): boolean {
  const projectedSpend = Money.multiply(unitCost, sentToday + 1)
  return Money.compare(projectedSpend, dailyBudget) <= 0
}
