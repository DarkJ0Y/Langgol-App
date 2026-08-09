import { beforeEach, describe, expect, it } from 'vitest'
import { createConfigSnapshot, type ConfigSnapshot } from '@langgol/domain/config'
import { Money } from '@langgol/domain/money'
import { normalizePhone, type E164Phone } from '@langgol/domain/identity'
import { isErr, isOk, type AppError, type Result } from '@langgol/shared'
import { requestOtp } from './request-otp.js'
import { verifyOtp } from './verify-otp.js'
import type {
  AuditPort,
  Clock,
  OtpChallengeRecord,
  OtpChallengeRepository,
  OtpDeliveryPort,
  RandomSource,
  SecretHasher,
  SessionRepository,
  UserRecord,
  UserRepository,
} from '../../ports/index.js'

/* ------------------------------------------------------------------ test doubles */

class TestClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000)
  }
}

/** Reversible "hash" — the point of these tests is the policy, not the KDF. */
const hasher: SecretHasher = {
  hash: (secret) => Promise.resolve(`hashed:${secret}`),
  verify: (secret, stored) => Promise.resolve(stored === `hashed:${secret}`),
  hashToken: (token) => `tokenhash:${token}`,
}

class FixedRandom implements RandomSource {
  constructor(public code = '123456') {}
  private tokenCount = 0
  numericCode(): string {
    return this.code
  }
  sessionToken(): string {
    this.tokenCount += 1
    return `session-token-${String(this.tokenCount)}`
  }
}

/** Mutable mirror of OtpChallengeRecord — the real record is readonly, this fake is not. */
type MutableChallenge = { -readonly [K in keyof OtpChallengeRecord]: OtpChallengeRecord[K] } & {
  requestIp: string | null
}

class InMemoryChallenges implements OtpChallengeRepository {
  rows: MutableChallenge[] = []
  private nextId = 1

  create(input: {
    phone: E164Phone
    codeHash: string
    expiresAt: Date
    maxAttempts: number
    requestIp: string | null
  }): Promise<OtpChallengeRecord> {
    const row = {
      id: `challenge-${String(this.nextId++)}`,
      phone: input.phone,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      consumedAt: null as Date | null,
      createdAt: this.createdAt,
      requestIp: input.requestIp,
    }
    this.rows.push(row)
    return Promise.resolve(row)
  }

  createdAt = new Date()

  findLatestActive(phone: E164Phone): Promise<OtpChallengeRecord | null> {
    const active = this.rows.filter((row) => row.phone === phone && row.consumedAt === null)
    return Promise.resolve(active.at(-1) ?? null)
  }

  recordAttempt(id: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row) row.attempts += 1
    return Promise.resolve()
  }

  consume(id: string, at: Date): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row) row.consumedAt = at
    return Promise.resolve()
  }

  burn(id: string, at: Date): Promise<void> {
    return this.consume(id, at)
  }

  recentRequestTimes(input: { phone?: E164Phone; ip?: string; since: Date }): Promise<Date[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => (input.phone === undefined ? true : row.phone === input.phone))
        .filter((row) => (input.ip === undefined ? true : row.requestIp === input.ip))
        .filter((row) => row.createdAt >= input.since)
        .map((row) => row.createdAt),
    )
  }
}

class RecordingDelivery implements OtpDeliveryPort {
  sent: { phone: string; code: string }[] = []
  accept = true
  unitCost = Money.fromPoisha(50)
  dailyBudget = Money.fromPoisha(500000)
  private todayCount = 0

  deliver(input: { phone: E164Phone; code: string }): Promise<{ accepted: boolean }> {
    if (!this.accept) return Promise.resolve({ accepted: false })
    this.sent.push({ phone: input.phone, code: input.code })
    this.todayCount += 1
    return Promise.resolve({ accepted: true })
  }

  sentToday(): Promise<number> {
    return Promise.resolve(this.todayCount)
  }

  exhaustBudget(): void {
    this.todayCount = 10_000
  }
}

class InMemoryUsers implements UserRepository {
  rows: (UserRecord & { phoneVerifiedAt: Date | null; lastLoginAt: Date | null })[] = []
  private nextId = 1

  findByPhone(phone: E164Phone): Promise<UserRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.phone === phone) ?? null)
  }

  createWithRole(input: {
    phone: E164Phone
    fullName: string
    role: string
    preferredLanguage: 'BN' | 'EN'
    verifiedAt: Date
  }): Promise<UserRecord> {
    const row = {
      id: `user-${String(this.nextId++)}`,
      phone: input.phone,
      fullName: input.fullName,
      status: 'ACTIVE' as const,
      preferredLanguage: input.preferredLanguage,
      roles: [input.role],
      phoneVerifiedAt: input.verifiedAt,
      lastLoginAt: null as Date | null,
    }
    this.rows.push(row)
    return Promise.resolve(row)
  }

  markPhoneVerified(userId: string, at: Date): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === userId)
    if (row) row.phoneVerifiedAt = at
    return Promise.resolve()
  }

  recordLogin(userId: string, at: Date): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === userId)
    if (row) row.lastLoginAt = at
    return Promise.resolve()
  }
}

class InMemorySessions implements SessionRepository {
  rows: { userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }[] = []

  create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
    this.rows.push({ ...input, revokedAt: null })
    return Promise.resolve({ id: `session-${String(this.rows.length)}` })
  }

  revoke(input: { tokenHash: string; at: Date }): Promise<void> {
    const row = this.rows.find((candidate) => candidate.tokenHash === input.tokenHash)
    if (row) row.revokedAt = input.at
    return Promise.resolve()
  }

  revokeAllForUser(input: { userId: string; at: Date }): Promise<number> {
    let count = 0
    for (const row of this.rows) {
      if (row.userId === input.userId && row.revokedAt === null) {
        row.revokedAt = input.at
        count += 1
      }
    }
    return Promise.resolve(count)
  }
}

class RecordingAudit implements AuditPort {
  entries: { action: string; entityId: string; reason?: string }[] = []
  record(input: { action: string; entityId: string; reason?: string }): Promise<void> {
    this.entries.push(input)
    return Promise.resolve()
  }
}

/* ------------------------------------------------------------------------ fixture */

const CONFIG: ConfigSnapshot = createConfigSnapshot(
  [
    { key: 'auth.otp.ttlSeconds', version: 1, value: 300 },
    { key: 'auth.otp.maxAttempts', version: 1, value: 5 },
    {
      key: 'auth.otp.rateLimits',
      version: 1,
      value: {
        perPhone: { limit: 3, windowSeconds: 900, dailyLimit: 10 },
        perIp: { limit: 10, windowSeconds: 3600 },
        perDevice: { limit: 10, windowSeconds: 3600 },
      },
    },
    { key: 'auth.session.idleTimeoutDays', version: 1, value: { DEFAULT: 30, ADMIN: 0.333 } },
  ],
  new Date('2026-08-10T10:00:00Z'),
)

const PHONE = '01712345678'

function harness() {
  const clock = new TestClock(new Date('2026-08-10T10:00:00Z'))
  const challenges = new InMemoryChallenges()
  const delivery = new RecordingDelivery()
  const users = new InMemoryUsers()
  const sessions = new InMemorySessions()
  const audit = new RecordingAudit()
  const random = new FixedRandom()

  challenges.createdAt = clock.now()

  const requestDeps = { config: CONFIG, clock, random, hasher, challenges, delivery, audit }
  const verifyDeps = { config: CONFIG, clock, random, hasher, challenges, users, sessions, audit }
  return { clock, challenges, delivery, users, sessions, audit, random, requestDeps, verifyDeps }
}

function expectError<T>(result: Result<T, AppError>, code: string): AppError {
  if (!isErr(result)) throw new Error(`Expected an error with code ${code}, got success`)
  expect(result.error.code).toBe(code)
  return result.error
}

/* -------------------------------------------------------------------------- tests */

describe('requestOtp', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('issues a code and delivers it, without ever returning the code', () => {
    return requestOtp(
      { phone: PHONE, locale: 'bn', ipAddress: '203.0.113.1', deviceId: null },
      h.requestDeps,
    ).then((result) => {
      expect(isOk(result)).toBe(true)
      if (!isOk(result)) return
      expect(result.value.maskedPhone).toBe('+880171****5678')
      expect(JSON.stringify(result.value)).not.toContain('123456')
      expect(h.delivery.sent).toHaveLength(1)
      expect(h.delivery.sent[0]?.code).toBe('123456')
    })
  })

  it('never stores the code in plaintext', async () => {
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)
    expect(h.challenges.rows[0]?.codeHash).toBe('hashed:123456')
    expect(h.challenges.rows[0]?.codeHash).not.toBe('123456')
  })

  it('audits with a masked number — a full phone number never reaches an audit row', async () => {
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)
    const entry = h.audit.entries.find((e) => e.action === 'OTP_REQUESTED')
    expect(entry?.entityId).toBe('+880171****5678')
    expect(entry?.entityId).not.toContain('2345678')
  })

  it('rejects an invalid phone number before doing any work', async () => {
    const result = await requestOtp(
      { phone: '01212345678', locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    expectError(result, 'VALIDATION_FAILED')
    expect(h.delivery.sent).toHaveLength(0)
  })

  it('applies a short resend cooldown rather than punishing impatience', async () => {
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)
    const immediate = await requestOtp(
      { phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    const error = expectError(immediate, 'RATE_LIMITED')
    expect(error.meta['retryAfterSeconds']).toBe(30)

    h.clock.advance(31)
    h.challenges.createdAt = h.clock.now()
    const later = await requestOtp(
      { phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    expect(isOk(later)).toBe(true)
  })

  it('enforces the per-phone window limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      h.challenges.createdAt = h.clock.now()
      const result = await requestOtp(
        { phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null },
        h.requestDeps,
      )
      expect(isOk(result)).toBe(true)
      h.clock.advance(60)
    }
    h.challenges.createdAt = h.clock.now()
    const blocked = await requestOtp(
      { phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    expectError(blocked, 'RATE_LIMITED')
    expect(h.audit.entries.some((e) => e.reason === 'PER_PHONE_WINDOW')).toBe(true)
  })

  it('refuses to send when the daily SMS budget is exhausted', async () => {
    h.delivery.exhaustBudget()
    const result = await requestOtp(
      { phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    expectError(result, 'PROVIDER_UNAVAILABLE')
    expect(h.audit.entries.some((e) => e.action === 'SMS_BUDGET_EXHAUSTED')).toBe(true)
  })

  it('reports a delivery failure rather than pretending a code was sent', async () => {
    h.delivery.accept = false
    const result = await requestOtp(
      { phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    expectError(result, 'PROVIDER_UNAVAILABLE')
  })
})

describe('verifyOtp', () => {
  let h: ReturnType<typeof harness>

  beforeEach(async () => {
    h = harness()
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)
  })

  it('creates the account on first verification and returns a session token once', async () => {
    const result = await verifyOtp(
      {
        phone: PHONE,
        code: '123456',
        signup: { fullName: 'Rahim Uddin', role: 'FARMER', preferredLanguage: 'BN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.isNewAccount).toBe(true)
    expect(result.value.roles).toEqual(['FARMER'])
    expect(result.value.sessionToken).toBe('session-token-1')
    // Only the hash is persisted.
    expect(h.sessions.rows[0]?.tokenHash).toBe('tokenhash:session-token-1')
  })

  it('logs an existing user in without touching their roles', async () => {
    await verifyOtp(
      {
        phone: PHONE,
        code: '123456',
        signup: { fullName: 'Rahim Uddin', role: 'FARMER', preferredLanguage: 'BN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )

    h.clock.advance(60)
    h.challenges.createdAt = h.clock.now()
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)

    const second = await verifyOtp(
      { phone: PHONE, code: '123456', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )
    expect(isOk(second)).toBe(true)
    if (!isOk(second)) return
    expect(second.value.isNewAccount).toBe(false)
    expect(h.users.rows).toHaveLength(1)
  })

  it('rejects a wrong code and counts the attempt', async () => {
    const result = await verifyOtp(
      { phone: PHONE, code: '000000', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )
    expectError(result, 'VALIDATION_FAILED')
    expect(h.challenges.rows[0]?.attempts).toBe(1)
  })

  it('burns the challenge after the attempt cap, so it cannot be probed further', async () => {
    for (let i = 0; i < 5; i += 1) {
      await verifyOtp(
        { phone: PHONE, code: '000000', ipAddress: null, userAgent: null },
        h.verifyDeps,
      )
    }
    // The correct code no longer works.
    const result = await verifyOtp(
      { phone: PHONE, code: '123456', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )
    expect(isErr(result)).toBe(true)
    expect(h.sessions.rows).toHaveLength(0)
  })

  it('refuses a correct code after expiry', async () => {
    h.clock.advance(301)
    const result = await verifyOtp(
      {
        phone: PHONE,
        code: '123456',
        signup: { fullName: 'Late', role: 'CONSUMER', preferredLanguage: 'BN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )
    expectError(result, 'VALIDATION_FAILED')
    expect(h.users.rows).toHaveLength(0)
  })

  it('refuses to reuse a consumed code', async () => {
    await verifyOtp(
      {
        phone: PHONE,
        code: '123456',
        signup: { fullName: 'Rahim', role: 'FARMER', preferredLanguage: 'BN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )
    const replay = await verifyOtp(
      { phone: PHONE, code: '123456', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )
    expect(isErr(replay)).toBe(true)
    expect(h.sessions.rows).toHaveLength(1)
  })

  it('requires a signup payload for an unknown number rather than inventing an account', async () => {
    const result = await verifyOtp(
      { phone: PHONE, code: '123456', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )
    expectError(result, 'VALIDATION_FAILED')
    expect(h.users.rows).toHaveLength(0)
  })

  it('gives the same error whether the challenge is absent, expired or used', async () => {
    const fresh = harness()
    const result = await verifyOtp(
      { phone: '01812345678', code: '123456', ipAddress: null, userAgent: null },
      fresh.verifyDeps,
    )
    expectError(result, 'VALIDATION_FAILED')
  })

  it('blocks a suspended account with a plain explanation', async () => {
    await verifyOtp(
      {
        phone: PHONE,
        code: '123456',
        signup: { fullName: 'Rahim', role: 'FARMER', preferredLanguage: 'BN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )
    const user = h.users.rows[0]
    if (user) Object.assign(user, { status: 'SUSPENDED' })

    h.clock.advance(60)
    h.challenges.createdAt = h.clock.now()
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)

    const result = await verifyOtp(
      { phone: PHONE, code: '123456', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )
    expectError(result, 'PRECONDITION_FAILED')
    expect(h.audit.entries.some((e) => e.action === 'LOGIN_BLOCKED')).toBe(true)
  })

  it('gives privileged roles a much shorter session', async () => {
    await verifyOtp(
      {
        phone: PHONE,
        code: '123456',
        signup: { fullName: 'Ops', role: 'CONSUMER', preferredLanguage: 'EN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )
    const consumerExpiry = h.sessions.rows[0]?.expiresAt.getTime() ?? 0

    const user = h.users.rows[0]
    if (user) Object.assign(user, { roles: ['ADMIN'] })

    h.clock.advance(60)
    h.challenges.createdAt = h.clock.now()
    await requestOtp({ phone: PHONE, locale: 'bn', ipAddress: null, deviceId: null }, h.requestDeps)
    await verifyOtp(
      { phone: PHONE, code: '123456', ipAddress: null, userAgent: null },
      h.verifyDeps,
    )

    const adminExpiry = h.sessions.rows[1]?.expiresAt.getTime() ?? 0
    expect(adminExpiry).toBeLessThan(consumerExpiry)
  })
})

describe('phone normalisation is applied consistently', () => {
  it('treats every input form as the same account', async () => {
    const h = harness()
    await requestOtp(
      { phone: '01712345678', locale: 'bn', ipAddress: null, deviceId: null },
      h.requestDeps,
    )
    const result = await verifyOtp(
      {
        phone: '+88 01712-345678',
        code: '123456',
        signup: { fullName: 'Rahim', role: 'FARMER', preferredLanguage: 'BN' },
        ipAddress: null,
        userAgent: null,
      },
      h.verifyDeps,
    )
    expect(isOk(result)).toBe(true)
    expect(h.users.rows[0]?.phone).toBe(normalizePhone('01712345678'))
  })
})
