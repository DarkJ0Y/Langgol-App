import { describe, expect, it } from 'vitest'
import {
  normalizePhone,
  tryNormalizePhone,
  isE164Phone,
  maskPhone,
  formatPhoneNational,
  PhoneError,
  evaluateOtpAttempt,
  evaluateRateLimit,
  resendCooldownRemaining,
  hasSmsBudget,
  type OtpChallengeState,
} from './index.js'
import { Money } from '../money/index.js'

describe('phone normalisation', () => {
  it('accepts every form a Bangladeshi user actually types', () => {
    const expected = '+8801712345678'
    for (const input of [
      '01712345678',
      '01712-345678',
      '0171 234 5678',
      '(017) 1234-5678',
      '8801712345678',
      '+8801712345678',
      '+88 01712 345678',
      '1712345678',
      '০১৭১২৩৪৫৬৭৮',
    ]) {
      expect(normalizePhone(input)).toBe(expected)
    }
  })

  it('accepts every operator prefix in use', () => {
    for (const digit of ['3', '4', '5', '6', '7', '8', '9']) {
      expect(normalizePhone(`01${digit}12345678`)).toBe(`+8801${digit}12345678`)
    }
  })

  it('rejects an impossible operator prefix rather than creating an unreachable account', () => {
    expect(() => normalizePhone('01212345678')).toThrow(PhoneError)
    expect(() => normalizePhone('01012345678')).toThrow(PhoneError)
  })

  it('rejects empty, non-numeric and wrong-length input with a specific code', () => {
    const codeOf = (input: string): string => {
      try {
        normalizePhone(input)
      } catch (error) {
        return (error as PhoneError).code
      }
      return 'NO_ERROR'
    }
    expect(codeOf('')).toBe('EMPTY')
    expect(codeOf('   ')).toBe('EMPTY')
    expect(codeOf('017abc45678')).toBe('NOT_NUMERIC')
    expect(codeOf('0171234')).toBe('WRONG_LENGTH')
    expect(codeOf('017123456789012')).toBe('WRONG_LENGTH')
  })

  it('offers a non-throwing variant', () => {
    expect(tryNormalizePhone('01712345678')).toBe('+8801712345678')
    expect(tryNormalizePhone('nonsense')).toBeNull()
  })

  it('recognises the normalised form', () => {
    expect(isE164Phone('+8801712345678')).toBe(true)
    expect(isE164Phone('01712345678')).toBe(false)
    expect(isE164Phone('+8801212345678')).toBe(false)
  })

  it('masks for logs — a full number never reaches a log line', () => {
    expect(maskPhone('+8801712345678')).toBe('+880171****5678')
    expect(maskPhone('short')).toBe('****')
  })

  it('renders nationally for a Bangladeshi reader', () => {
    expect(formatPhoneNational(normalizePhone('01712345678'))).toBe('01712-345678')
  })
})

describe('OTP attempt policy', () => {
  const now = new Date('2026-08-10T10:00:00Z')
  const base = (over: Partial<OtpChallengeState> = {}): OtpChallengeState => ({
    expiresAt: new Date('2026-08-10T10:05:00Z'),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    ...over,
  })

  it('accepts a correct code and burns the challenge', () => {
    const result = evaluateOtpAttempt(base(), true, now)
    expect(result.verdict).toBe('ACCEPTED')
    expect(result.burn).toBe(true)
  })

  it('rejects an incorrect code and counts down', () => {
    const result = evaluateOtpAttempt(base({ attempts: 1 }), false, now)
    expect(result.verdict).toBe('INCORRECT')
    expect(result.attemptsRemaining).toBe(3)
    expect(result.burn).toBe(false)
  })

  it('burns on the final wrong attempt so it cannot be probed further', () => {
    const result = evaluateOtpAttempt(base({ attempts: 4 }), false, now)
    expect(result.verdict).toBe('INCORRECT')
    expect(result.attemptsRemaining).toBe(0)
    expect(result.burn).toBe(true)
  })

  it('checks expiry BEFORE correctness, so a correct code cannot revive a dead challenge', () => {
    const expired = base({ expiresAt: new Date('2026-08-10T09:59:59Z') })
    expect(evaluateOtpAttempt(expired, true, now).verdict).toBe('EXPIRED')
    expect(evaluateOtpAttempt(expired, false, now).verdict).toBe('EXPIRED')
  })

  it('treats expiry as inclusive at the boundary', () => {
    const atBoundary = base({ expiresAt: now })
    expect(evaluateOtpAttempt(atBoundary, true, now).verdict).toBe('EXPIRED')
  })

  it('refuses a consumed challenge, whatever the code', () => {
    const used = base({ consumedAt: new Date('2026-08-10T09:59:00Z') })
    expect(evaluateOtpAttempt(used, true, now).verdict).toBe('ALREADY_USED')
  })

  it('refuses once the attempt cap is reached', () => {
    const capped = base({ attempts: 5 })
    expect(evaluateOtpAttempt(capped, true, now).verdict).toBe('TOO_MANY_ATTEMPTS')
    expect(evaluateOtpAttempt(capped, true, now).burn).toBe(true)
  })
})

describe('rate limiting', () => {
  const now = new Date('2026-08-10T10:00:00Z')
  const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000)

  it('allows a request below the limit', () => {
    const verdict = evaluateRateLimit([at(10), at(20)], { limit: 3, windowSeconds: 900 }, now)
    expect(verdict.allowed).toBe(true)
    expect(verdict.retryAfterSeconds).toBe(0)
  })

  it('refuses at the limit and says when to try again', () => {
    const verdict = evaluateRateLimit(
      [at(100), at(50), at(10)],
      { limit: 3, windowSeconds: 900 },
      now,
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.retryAfterSeconds).toBe(800)
  })

  it('ignores requests that have aged out of the window', () => {
    const verdict = evaluateRateLimit(
      [at(1000), at(2000), at(3000)],
      { limit: 3, windowSeconds: 900 },
      now,
    )
    expect(verdict.allowed).toBe(true)
  })

  it('handles an empty history', () => {
    expect(evaluateRateLimit([], { limit: 1, windowSeconds: 60 }, now).allowed).toBe(true)
  })
})

describe('resend cooldown', () => {
  const now = new Date('2026-08-10T10:00:00Z')

  it('is zero when nothing was ever sent', () => {
    expect(resendCooldownRemaining(null, 30, now)).toBe(0)
  })

  it('counts down, and treats an impatient user differently from a hostile one', () => {
    expect(resendCooldownRemaining(new Date(now.getTime() - 5000), 30, now)).toBe(25)
    expect(resendCooldownRemaining(new Date(now.getTime() - 40000), 30, now)).toBe(0)
  })
})

describe('SMS budget', () => {
  // ৳0.50 per message against a ৳5,000 daily cap — 10,000 messages.
  const unitCost = Money.fromTaka('0.50')
  const dailyBudget = Money.fromTaka('5000.00')

  it('allows sending while inside the daily budget', () => {
    expect(hasSmsBudget(0, unitCost, dailyBudget)).toBe(true)
    expect(hasSmsBudget(9998, unitCost, dailyBudget)).toBe(true)
  })

  it('allows exactly the message that reaches the cap, and refuses the next', () => {
    expect(hasSmsBudget(9999, unitCost, dailyBudget)).toBe(true)
    expect(hasSmsBudget(10000, unitCost, dailyBudget)).toBe(false)
    expect(hasSmsBudget(99999, unitCost, dailyBudget)).toBe(false)
  })
})
