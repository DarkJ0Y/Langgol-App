/**
 * Phone and email verification tests.
 *
 * The doubles below reproduce the real adapters' SEMANTICS, not just their signatures: challenge
 * lookup is scoped by purpose, revocation marks rather than deletes, and marking an email
 * verified is conditional on the address still matching. A permissive fake here would let every
 * one of these tests pass while the property it names went unenforced — which is exactly how the
 * purpose-scoping bug survived until now.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.2, §3.3
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createConfigSnapshot, type ConfigSnapshot } from '@langgol/domain/config'
import { Money } from '@langgol/domain/money'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import type { E164Phone, OtpPurpose, VerificationPurpose } from '@langgol/domain/identity'
import type {
  AccountRepository,
  AuditPort,
  Clock,
  EmailDeliveryPort,
  OtpChallengeRecord,
  OtpChallengeRepository,
  OtpDeliveryPort,
  RandomSource,
  RoleAssignmentRecord,
  RoleDefinitionRecord,
  SecretHasher,
  UserProfileRecord,
  UserRepository,
  VerificationTokenRecord,
  VerificationTokenRepository,
} from '../../ports/index.js'
import { confirmPhoneVerification, requestPhoneVerification } from './phone.js'
import { confirmEmail, emailVerificationStatus, requestEmailVerification } from './email.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const PHONE = '+8801712345678' as E164Phone
const EMAIL = 'rahim@example.com'
const START = new Date('2026-08-21T09:00:00.000Z')

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: USER_ID, roles: ['FARMER'], status: 'ACTIVE', ...overrides }
}

/* ------------------------------------------------------------------- doubles */

class TestClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000)
  }
}

/** Reversible "hash" — these tests are about policy, not about the KDF. */
const hasher: SecretHasher = {
  hash: (secret) => Promise.resolve(`hashed:${secret}`),
  verify: (secret, stored) => Promise.resolve(stored === `hashed:${secret}`),
  hashToken: (token) => `tokenhash:${token}`,
}

class FixedRandom implements RandomSource {
  code = '123456'
  private issued = 0
  numericCode(): string {
    return this.code
  }
  sessionToken(): string {
    return 'session'
  }
  token(): string {
    this.issued += 1
    return `token-${String(this.issued)}`
  }
}

type MutableChallenge = { -readonly [K in keyof OtpChallengeRecord]: OtpChallengeRecord[K] } & {
  purpose: OtpPurpose
  requestIp: string | null
}

class FakeChallenges implements OtpChallengeRepository {
  rows: MutableChallenge[] = []
  private nextId = 1
  constructor(private clock: TestClock) {}

  create(input: Parameters<OtpChallengeRepository['create']>[0]): Promise<OtpChallengeRecord> {
    const row: MutableChallenge = {
      id: `challenge-${String(this.nextId++)}`,
      phone: input.phone,
      codeHash: input.codeHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      consumedAt: null,
      createdAt: this.clock.now(),
      requestIp: input.requestIp,
    }
    this.rows.push(row)
    return Promise.resolve(row)
  }

  // Scoped by purpose, exactly as the SQL is.
  findLatestActive(
    phone: E164Phone,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<OtpChallengeRecord | null> {
    const live = this.rows.filter(
      (row) =>
        row.phone === phone &&
        row.purpose === purpose &&
        row.consumedAt === null &&
        row.expiresAt > now,
    )
    return Promise.resolve(live.at(-1) ?? null)
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

  invalidateOutstanding(
    input: Parameters<OtpChallengeRepository['invalidateOutstanding']>[0],
  ): Promise<number> {
    const live = this.rows.filter(
      (row) =>
        row.phone === input.phone && row.purpose === input.purpose && row.consumedAt === null,
    )
    for (const row of live) row.consumedAt = input.at
    return Promise.resolve(live.length)
  }

  recentRequestTimes(
    input: Parameters<OtpChallengeRepository['recentRequestTimes']>[0],
  ): Promise<Date[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.purpose === input.purpose)
        .filter((row) => (input.phone === undefined ? true : row.phone === input.phone))
        .filter((row) => (input.ip === undefined ? true : row.requestIp === input.ip))
        .filter((row) => row.createdAt >= input.since)
        .map((row) => row.createdAt),
    )
  }
}

type MutableToken = { -readonly [K in keyof VerificationTokenRecord]: VerificationTokenRecord[K] }

class FakeTokens implements VerificationTokenRepository {
  rows: (MutableToken & { purpose: VerificationPurpose; tokenHash: string })[] = []
  private nextId = 1
  constructor(private clock: TestClock) {}

  create(
    input: Parameters<VerificationTokenRepository['create']>[0],
  ): Promise<VerificationTokenRecord> {
    const row = {
      id: `token-${String(this.nextId++)}`,
      userId: input.userId,
      purpose: input.purpose,
      destination: input.destination,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      consumedAt: null as Date | null,
      revokedAt: null as Date | null,
      createdAt: this.clock.now(),
    }
    this.rows.push(row)
    return Promise.resolve(row)
  }

  findByHash(tokenHash: string): Promise<VerificationTokenRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.tokenHash === tokenHash) ?? null)
  }

  consume(id: string, at: Date): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row) row.consumedAt = at
    return Promise.resolve()
  }

  invalidateOutstanding(
    input: Parameters<VerificationTokenRepository['invalidateOutstanding']>[0],
  ): Promise<number> {
    const live = this.rows.filter(
      (row) =>
        row.userId === input.userId &&
        row.purpose === input.purpose &&
        row.consumedAt === null &&
        row.revokedAt === null,
    )
    for (const row of live) row.revokedAt = input.at
    return Promise.resolve(live.length)
  }

  recentRequestTimes(
    input: Parameters<VerificationTokenRepository['recentRequestTimes']>[0],
  ): Promise<Date[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.userId === input.userId &&
            row.purpose === input.purpose &&
            row.createdAt >= input.since,
        )
        .map((row) => row.createdAt),
    )
  }
}

class FakeAccounts implements AccountRepository {
  profiles = new Map<string, UserProfileRecord>()

  constructor() {
    this.profiles.set(USER_ID, {
      id: USER_ID,
      phone: PHONE,
      phoneVerifiedAt: null,
      email: null,
      emailVerifiedAt: null,
      fullName: 'Rahim Uddin',
      preferredLanguage: 'BN',
      status: 'ACTIVE',
      onboardingStatus: 'READY',
      profilePhotoKey: null,
      dateOfBirth: null,
      gender: null,
      roles: ['FARMER'],
      lastLoginAt: START,
      createdAt: START,
      updatedAt: START,
    })
  }

  patch(userId: string, changes: Partial<UserProfileRecord>): void {
    const existing = this.profiles.get(userId)
    if (existing) this.profiles.set(userId, { ...existing, ...changes })
  }

  findProfile(userId: string): Promise<UserProfileRecord | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null)
  }

  // Conditional on the address still matching, exactly as the UPDATE ... WHERE email = $1 is.
  markEmailVerified({
    userId,
    email,
    at,
  }: Parameters<AccountRepository['markEmailVerified']>[0]): Promise<boolean> {
    const profile = this.profiles.get(userId)
    if (!profile || profile.email !== email) return Promise.resolve(false)
    this.profiles.set(userId, { ...profile, emailVerifiedAt: at })
    return Promise.resolve(true)
  }

  updateProfile(): Promise<UserProfileRecord | null> {
    return Promise.resolve(null)
  }
  listRoleDefinitions(): Promise<readonly RoleDefinitionRecord[]> {
    return Promise.resolve([])
  }
  listRolesFor(): Promise<readonly RoleAssignmentRecord[]> {
    return Promise.resolve([])
  }
  assignRole(): Promise<{ roles: readonly string[]; added: boolean }> {
    return Promise.resolve({ roles: [], added: false })
  }
  revokeRole(): Promise<{ roles: readonly string[]; removed: boolean }> {
    return Promise.resolve({ roles: [], removed: false })
  }
}

class FakeUsers implements Partial<UserRepository> {
  verifiedAt: Date | null = null
  constructor(private accounts: FakeAccounts) {}
  markPhoneVerified(userId: string, at: Date): Promise<void> {
    this.verifiedAt = at
    this.accounts.patch(userId, { phoneVerifiedAt: at })
    return Promise.resolve()
  }
}

class FakeSmsDelivery implements OtpDeliveryPort {
  sent: { phone: string; code: string }[] = []
  accept = true
  budget = 500000
  unitCost = Money.fromPoisha(50)
  get dailyBudget() {
    return Money.fromPoisha(this.budget)
  }
  deliver(input: { phone: E164Phone; code: string }): Promise<{ accepted: boolean }> {
    if (!this.accept) return Promise.resolve({ accepted: false })
    this.sent.push({ phone: input.phone, code: input.code })
    return Promise.resolve({ accepted: true })
  }
  sentToday(): Promise<number> {
    return Promise.resolve(this.sent.length)
  }
}

class FakeEmailDelivery implements EmailDeliveryPort {
  sent: { to: string; link: string }[] = []
  available = true
  accept = true
  deliver(input: { to: string; link: string }): Promise<{ accepted: boolean }> {
    if (!this.accept) return Promise.resolve({ accepted: false })
    this.sent.push({ to: input.to, link: input.link })
    return Promise.resolve({ accepted: true })
  }
  /** The token as the recipient would read it out of the link. */
  lastToken(): string {
    const link = this.sent.at(-1)?.link ?? ''
    return decodeURIComponent(new URL(link).searchParams.get('token') ?? '')
  }
}

class FakeAudit implements AuditPort {
  entries: { action: string; reason?: string; entityId: string }[] = []
  record(input: Parameters<AuditPort['record']>[0]): Promise<void> {
    this.entries.push({
      action: input.action,
      entityId: input.entityId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    return Promise.resolve()
  }
  actions(): string[] {
    return this.entries.map((entry) => entry.action)
  }
}

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
    { key: 'auth.emailVerification.ttlSeconds', version: 1, value: 86400 },
    {
      key: 'auth.emailVerification.rateLimits',
      version: 1,
      value: {
        perUser: { limit: 3, windowSeconds: 900, dailyLimit: 10 },
        resendCooldownSeconds: 60,
      },
    },
  ],
  new Date(),
)

/* ------------------------------------------------------------------- harness */

function harness() {
  const clock = new TestClock(START)
  const challenges = new FakeChallenges(clock)
  const tokens = new FakeTokens(clock)
  const accounts = new FakeAccounts()
  const users = new FakeUsers(accounts)
  const sms = new FakeSmsDelivery()
  const email = new FakeEmailDelivery()
  const audit = new FakeAudit()
  const random = new FixedRandom()

  return {
    clock,
    challenges,
    tokens,
    accounts,
    users,
    sms,
    email,
    audit,
    random,
    phoneDeps: {
      config: CONFIG,
      clock,
      random,
      hasher,
      challenges,
      delivery: sms,
      accounts,
      users: users as unknown as UserRepository,
      audit,
    },
    emailDeps: {
      config: CONFIG,
      clock,
      random,
      hasher,
      tokens,
      accounts,
      delivery: email,
      audit,
      appUrl: 'https://langgol.app',
    },
  }
}

const REQUEST = { ipAddress: '203.0.113.7', locale: 'bn' as const }

/* ============================================================ PHONE: request */

describe('requesting a phone verification code', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('sends a code to the number on the account', async () => {
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(true)
    expect(h.sms.sent).toHaveLength(1)
    expect(h.sms.sent[0]?.phone).toBe(PHONE)
  })

  it('never returns the code to the caller', async () => {
    // The single most important assertion about this response. A code in an API response is a
    // code in a browser history, a proxy log and a screenshot.
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain(h.random.code)
  })

  it('masks the number rather than echoing it', async () => {
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)
    if (!result.ok) return
    expect(result.value.maskedPhone).not.toBe(PHONE)
    expect(result.value.maskedPhone).toContain('****')
  })

  it('stores the code hashed, never in plaintext', async () => {
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    const stored = h.challenges.rows[0]?.codeHash ?? ''
    expect(stored).not.toBe(h.random.code)
    expect(stored).toContain('hashed:')
  })

  it('sets an expiry from configuration rather than a literal', async () => {
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)
    if (!result.ok) return

    expect(result.value.expiresInSeconds).toBe(300)
    expect(h.challenges.rows[0]?.expiresAt).toEqual(new Date(START.getTime() + 300_000))
  })

  it('keeps the code out of the audit log, and the full number too', async () => {
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    const serialised = JSON.stringify(h.audit.entries)
    expect(serialised).not.toContain(h.random.code)
    expect(serialised).not.toContain(PHONE)
    expect(h.audit.actions()).toContain('PHONE_VERIFY_REQUESTED')
  })

  it('does nothing at all when the number is already verified', async () => {
    h.accounts.patch(USER_ID, { phoneVerifiedAt: START })

    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.alreadyVerified).toBe(true)
    // No SMS spend, no challenge, no rate-limit consumption.
    expect(h.sms.sent).toHaveLength(0)
    expect(h.challenges.rows).toHaveLength(0)
  })

  it('refuses to send when the SMS budget is exhausted', async () => {
    h.sms.budget = 10 // less than one message
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(false)
    expect(h.audit.actions()).toContain('SMS_BUDGET_EXHAUSTED')
  })
})

/* ================================================= PHONE: unauthorized access */

describe('unauthorized verification', () => {
  it('refuses an anonymous caller', async () => {
    const h = harness()
    const result = await requestPhoneVerification(ANONYMOUS, REQUEST, h.phoneDeps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(h.sms.sent).toHaveLength(0)
  })

  it('refuses an anonymous caller at confirmation too', async () => {
    const h = harness()
    const result = await confirmPhoneVerification(
      ANONYMOUS,
      { code: '123456', ipAddress: null },
      h.phoneDeps,
    )
    expect(result.ok).toBe(false)
  })

  it('refuses a suspended account', async () => {
    // Suspension takes effect on this request, not at the next sign-in.
    const h = harness()
    const result = await requestPhoneVerification(
      actor({ status: 'SUSPENDED' }),
      REQUEST,
      h.phoneDeps,
    )
    expect(result.ok).toBe(false)
    expect(h.sms.sent).toHaveLength(0)
  })

  it('verifies the caller’s OWN number, with no parameter that could name another', async () => {
    /*
     * Structural rather than behavioural: the command carries ipAddress and locale and nothing
     * else. There is no phone argument to point at a stranger's number, which is what stops this
     * endpoint being a way to make Langgol send SMS anywhere at our expense.
     */
    const h = harness()
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)
    expect(h.sms.sent[0]?.phone).toBe(PHONE)
    expect(Object.keys(REQUEST).sort()).toEqual(['ipAddress', 'locale'])
  })

  it('confirms against the signed-in user’s own challenge only', async () => {
    // A code issued for one account must not verify another. The actor decides whose number is
    // looked up, so a stolen code is useless without that account's session.
    const h = harness()
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    h.accounts.profiles.set(OTHER_ID, {
      ...h.accounts.profiles.get(USER_ID)!,
      id: OTHER_ID,
      phone: '+8801799999999' as E164Phone,
    })

    const result = await confirmPhoneVerification(
      actor({ userId: OTHER_ID }),
      { code: h.random.code, ipAddress: null },
      h.phoneDeps,
    )
    expect(result.ok).toBe(false)
  })
})

/* ============================================================= PHONE: confirm */

describe('confirming a phone verification code', () => {
  let h: ReturnType<typeof harness>
  beforeEach(async () => {
    h = harness()
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)
  })

  it('accepts the correct code and marks the phone verified', async () => {
    const result = await confirmPhoneVerification(
      actor(),
      { code: h.random.code, ipAddress: null },
      h.phoneDeps,
    )

    expect(result.ok).toBe(true)
    expect(h.users.verifiedAt).toEqual(START)
    expect(h.audit.actions()).toContain('PHONE_VERIFIED')
  })

  it('refuses an incorrect code', async () => {
    const result = await confirmPhoneVerification(
      actor(),
      { code: '000000', ipAddress: null },
      h.phoneDeps,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(h.users.verifiedAt).toBeNull()
  })

  it('counts a wrong guess even if the caller walks away', async () => {
    await confirmPhoneVerification(actor(), { code: '000000', ipAddress: null }, h.phoneDeps)
    expect(h.challenges.rows[0]?.attempts).toBe(1)
  })

  it('refuses a single-use code the second time', async () => {
    await confirmPhoneVerification(actor(), { code: h.random.code, ipAddress: null }, h.phoneDeps)
    h.accounts.patch(USER_ID, { phoneVerifiedAt: null }) // pretend the flag did not stick

    const replay = await confirmPhoneVerification(
      actor(),
      { code: h.random.code, ipAddress: null },
      h.phoneDeps,
    )
    expect(replay.ok).toBe(false)
  })

  it('refuses an expired code, even a correct one', async () => {
    h.clock.advance(301)

    const result = await confirmPhoneVerification(
      actor(),
      { code: h.random.code, ipAddress: null },
      h.phoneDeps,
    )

    expect(result.ok).toBe(false)
    expect(h.users.verifiedAt).toBeNull()
  })

  it('gives an expired code the same message as a wrong one', async () => {
    // Distinguishing them tells an attacker whether a guess was right but late.
    const wrong = await confirmPhoneVerification(
      actor(),
      { code: '000000', ipAddress: null },
      h.phoneDeps,
    )
    h.clock.advance(301)
    const expired = await confirmPhoneVerification(
      actor(),
      { code: h.random.code, ipAddress: null },
      h.phoneDeps,
    )

    if (wrong.ok || expired.ok) throw new Error('both should fail')
    expect(expired.error.message).toBe(wrong.error.message)
  })

  it('stops accepting guesses after the attempt cap', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await confirmPhoneVerification(actor(), { code: '000000', ipAddress: null }, h.phoneDeps)
    }

    // Even the CORRECT code is refused now — the challenge is burned, not merely counted.
    const result = await confirmPhoneVerification(
      actor(),
      { code: h.random.code, ipAddress: null },
      h.phoneDeps,
    )
    expect(result.ok).toBe(false)
    expect(h.users.verifiedAt).toBeNull()
  })

  it('audits each failure with a reason, and never the code', async () => {
    await confirmPhoneVerification(actor(), { code: '000000', ipAddress: null }, h.phoneDeps)

    const entry = h.audit.entries.find((e) => e.action === 'PHONE_VERIFY_FAILED')
    expect(entry?.reason).toBe('INCORRECT')
    expect(JSON.stringify(h.audit.entries)).not.toContain('000000')
  })
})

/* ================================================ PHONE: resend and invalidation */

describe('resending a phone code', () => {
  let h: ReturnType<typeof harness>
  beforeEach(async () => {
    h = harness()
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)
  })

  it('refuses a resend inside the cooldown, and says how long to wait', async () => {
    h.clock.advance(5)
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('RATE_LIMITED')
    // "Please wait" without a number is not an answer on a slow connection.
    expect(result.error.meta['retryAfterSeconds']).toBe(25)
    expect(h.sms.sent).toHaveLength(1)
  })

  it('allows a resend once the cooldown has passed', async () => {
    h.clock.advance(31)
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(true)
    expect(h.sms.sent).toHaveLength(2)
  })

  it('invalidates the previous code when a new one is issued', async () => {
    /*
     * Otherwise every resend leaves another live code behind: the attempt cap counts per
     * challenge, so three outstanding codes quietly grant fifteen guesses against one number
     * while each individual counter still reads five.
     */
    h.clock.advance(31)
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(h.challenges.rows).toHaveLength(2)
    expect(h.challenges.rows[0]?.consumedAt).not.toBeNull()
    expect(h.challenges.rows[1]?.consumedAt).toBeNull()
  })

  it('refuses the superseded code', async () => {
    h.clock.advance(31)
    h.random.code = '654321'
    await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    const old = await confirmPhoneVerification(
      actor(),
      { code: '123456', ipAddress: null },
      h.phoneDeps,
    )
    expect(old.ok).toBe(false)

    const current = await confirmPhoneVerification(
      actor(),
      { code: '654321', ipAddress: null },
      h.phoneDeps,
    )
    expect(current.ok).toBe(true)
  })

  it('rate-limits sustained resending beyond the cooldown', async () => {
    // perPhone.limit is 3 in a 900s window; the cooldown alone would let 30 through.
    for (let index = 0; index < 2; index += 1) {
      h.clock.advance(31)
      await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)
    }
    h.clock.advance(31)
    const result = await requestPhoneVerification(actor(), REQUEST, h.phoneDeps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('RATE_LIMITED')
    expect(h.audit.actions()).toContain('PHONE_VERIFY_RATE_LIMITED')
  })

  it('does not spend the LOGIN budget, so verifying cannot lock a user out', async () => {
    /*
     * The reason every repository method takes a purpose. Before that, a farmer who verified
     * their number because the screen asked them to would have consumed the per-phone allowance
     * they needed in order to sign in — locked out by following instructions.
     */
    const loginTimes = await h.challenges.recentRequestTimes({
      phone: PHONE,
      purpose: 'LOGIN',
      since: new Date(0),
    })
    expect(loginTimes).toHaveLength(0)

    const verifyTimes = await h.challenges.recentRequestTimes({
      phone: PHONE,
      purpose: 'PHONE_VERIFY',
      since: new Date(0),
    })
    expect(verifyTimes).toHaveLength(1)
  })
})

/* ====================================================== EMAIL: status and gating */

describe('email verification is optional', () => {
  it('reports nothing to do when the account has no address', async () => {
    const h = harness()
    const result = await emailVerificationStatus(actor(), h.emailDeps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // No address is a complete account, not an incomplete one.
    expect(result.value.email).toBeNull()
    expect(result.value.canRequest).toBe(false)
  })

  it('refuses to send when there is no address to send to', async () => {
    const h = harness()
    const result = await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('reports the feature unavailable when no provider is configured', async () => {
    // A supported deployment, not a fault — so the UI can decline to offer a dead button.
    const h = harness()
    h.accounts.patch(USER_ID, { email: EMAIL })
    h.email.available = false

    const status = await emailVerificationStatus(actor(), h.emailDeps)
    if (!status.ok) return
    expect(status.value.available).toBe(false)
    expect(status.value.canRequest).toBe(false)

    const send = await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    expect(send.ok).toBe(false)
    if (send.ok) return
    expect(send.error.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('offers verification once an address exists', async () => {
    const h = harness()
    h.accounts.patch(USER_ID, { email: EMAIL })

    const result = await emailVerificationStatus(actor(), h.emailDeps)
    if (!result.ok) return
    expect(result.value.canRequest).toBe(true)
    expect(result.value.verified).toBe(false)
  })

  it('refuses an anonymous caller', async () => {
    const h = harness()
    const result = await emailVerificationStatus(ANONYMOUS, h.emailDeps)
    expect(result.ok).toBe(false)
  })
})

/* ============================================================= EMAIL: the flow */

describe('email verification', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
    h.accounts.patch(USER_ID, { email: EMAIL })
  })

  it('sends a link and verifies the address when it is redeemed', async () => {
    const sent = await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    expect(sent.ok).toBe(true)
    expect(h.email.sent).toHaveLength(1)

    const result = await confirmEmail({ token: h.email.lastToken(), ipAddress: null }, h.emailDeps)

    expect(result.ok).toBe(true)
    expect(h.accounts.profiles.get(USER_ID)?.emailVerifiedAt).toEqual(START)
    expect(h.audit.actions()).toContain('EMAIL_VERIFIED')
  })

  it('stores the token hashed, never in plaintext', async () => {
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    const plaintext = h.email.lastToken()
    expect(h.tokens.rows[0]?.tokenHash).not.toBe(plaintext)
    expect(h.tokens.rows[0]?.tokenHash).toBe(`tokenhash:${plaintext}`)
  })

  it('never puts the token or the full address in the audit log', async () => {
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    await confirmEmail({ token: h.email.lastToken(), ipAddress: null }, h.emailDeps)

    const serialised = JSON.stringify(h.audit.entries)
    expect(serialised).not.toContain(h.email.lastToken())
    expect(serialised).not.toContain(EMAIL)
    // Masked, so a bounce is still investigable.
    expect(serialised).toContain('example.com')
  })

  it('masks the address in the response', async () => {
    const result = await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    if (!result.ok) return
    expect(result.value.maskedEmail).not.toBe(EMAIL)
    expect(result.value.maskedEmail).toContain('@example.com')
  })

  it('refuses a token that was never issued', async () => {
    const result = await confirmEmail({ token: 'made-up', ipAddress: null }, h.emailDeps)
    expect(result.ok).toBe(false)
  })

  it('refuses an expired token', async () => {
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    const token = h.email.lastToken()

    h.clock.advance(86401) // one second past the configured day

    const result = await confirmEmail({ token, ipAddress: null }, h.emailDeps)

    expect(result.ok).toBe(false)
    expect(h.accounts.profiles.get(USER_ID)?.emailVerifiedAt).toBeNull()
    expect(h.audit.entries.some((e) => e.reason === 'EXPIRED')).toBe(true)
  })

  it('accepts a token on the last second before expiry', async () => {
    // The boundary in the safe direction: a link must not die early in the reader's hands.
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    const token = h.email.lastToken()

    h.clock.advance(86399)

    const result = await confirmEmail({ token, ipAddress: null }, h.emailDeps)
    expect(result.ok).toBe(true)
  })

  it('refuses a token the second time it is used', async () => {
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    const token = h.email.lastToken()

    await confirmEmail({ token, ipAddress: null }, h.emailDeps)
    const replay = await confirmEmail({ token, ipAddress: null }, h.emailDeps)

    expect(replay.ok).toBe(false)
    expect(h.audit.entries.some((e) => e.reason === 'ALREADY_USED')).toBe(true)
  })

  it('gives every failure the same message', async () => {
    // Unknown, expired and already-used must be indistinguishable to someone probing links.
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    const token = h.email.lastToken()
    await confirmEmail({ token, ipAddress: null }, h.emailDeps)

    const used = await confirmEmail({ token, ipAddress: null }, h.emailDeps)
    const unknown = await confirmEmail({ token: 'nonsense', ipAddress: null }, h.emailDeps)

    if (used.ok || unknown.ok) throw new Error('both should fail')
    expect(used.error.message).toBe(unknown.error.message)
  })

  it('does not verify a NEW address with a link sent to the old one', async () => {
    /*
     * The token proves control of the address it was mailed to. If the account's address has
     * changed since, that proof says nothing about the address held now — and stamping it
     * verified would be worse than having no signal, because something downstream trusts it.
     */
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    const token = h.email.lastToken()

    h.accounts.patch(USER_ID, { email: 'someone.else@example.com' })

    const result = await confirmEmail({ token, ipAddress: null }, h.emailDeps)

    expect(result.ok).toBe(false)
    expect(h.accounts.profiles.get(USER_ID)?.emailVerifiedAt).toBeNull()
    expect(h.audit.entries.some((e) => e.reason === 'ADDRESS_CHANGED')).toBe(true)
  })

  it('spends the token even when the address changed, so it cannot be replayed', async () => {
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    const token = h.email.lastToken()
    h.accounts.patch(USER_ID, { email: 'someone.else@example.com' })
    await confirmEmail({ token, ipAddress: null }, h.emailDeps)

    // Restoring the old address must not resurrect the link.
    h.accounts.patch(USER_ID, { email: EMAIL })
    const replay = await confirmEmail({ token, ipAddress: null }, h.emailDeps)
    expect(replay.ok).toBe(false)
  })

  it('is idempotent once verified — no second mail, no second token', async () => {
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    await confirmEmail({ token: h.email.lastToken(), ipAddress: null }, h.emailDeps)

    h.clock.advance(3600)
    const again = await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.alreadyVerified).toBe(true)
    expect(h.email.sent).toHaveLength(1)
  })
})

/* ===================================================== EMAIL: resend and limits */

describe('resending a verification email', () => {
  let h: ReturnType<typeof harness>
  beforeEach(async () => {
    h = harness()
    h.accounts.patch(USER_ID, { email: EMAIL })
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)
  })

  it('refuses a resend inside the cooldown', async () => {
    h.clock.advance(10)
    const result = await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('RATE_LIMITED')
    expect(result.error.meta['retryAfterSeconds']).toBe(50)
    expect(h.email.sent).toHaveLength(1)
  })

  it('allows a resend after the cooldown', async () => {
    h.clock.advance(61)
    const result = await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    expect(result.ok).toBe(true)
    expect(h.email.sent).toHaveLength(2)
  })

  it('revokes the previous link when a new one is sent', async () => {
    h.clock.advance(61)
    const first = h.email.lastToken()
    await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    expect(h.tokens.rows[0]?.revokedAt).not.toBeNull()

    const old = await confirmEmail({ token: first, ipAddress: null }, h.emailDeps)
    expect(old.ok).toBe(false)

    const current = await confirmEmail({ token: h.email.lastToken(), ipAddress: null }, h.emailDeps)
    expect(current.ok).toBe(true)
  })

  it('rate-limits sustained resending', async () => {
    for (let index = 0; index < 2; index += 1) {
      h.clock.advance(61)
      await requestEmailVerification(actor(), REQUEST, h.emailDeps)
    }
    h.clock.advance(61)
    const result = await requestEmailVerification(actor(), REQUEST, h.emailDeps)

    expect(result.ok).toBe(false)
    expect(h.audit.actions()).toContain('EMAIL_VERIFY_RATE_LIMITED')
  })
})
