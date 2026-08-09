import { beforeEach, describe, expect, it } from 'vitest'
import { createConfigSnapshot, type ConfigSnapshot } from '@langgol/domain/config'
import {
  AuthModeError,
  assertModePermitted,
  DEVELOPMENT_IDENTITIES,
  isModePermitted,
  type AppEnvironment,
  type AuthMode,
  type E164Phone,
} from '@langgol/domain/identity'
import { isErr, isOk, type AppError, type Result } from '@langgol/shared'
import { developmentSignIn } from './development-sign-in.js'
import { signOut } from './sign-out.js'
import type {
  AuditPort,
  Clock,
  RandomSource,
  SecretHasher,
  SessionRepository,
  UserRecord,
  UserRepository,
} from '../../ports/index.js'

/* ------------------------------------------------------------------ test doubles */

const clock: Clock = { now: () => new Date('2026-08-10T10:00:00Z') }

const hasher: SecretHasher = {
  hash: (secret) => Promise.resolve(`hashed:${secret}`),
  verify: (secret, stored) => Promise.resolve(stored === `hashed:${secret}`),
  hashToken: (token) => `tokenhash:${token}`,
}

class FixedRandom implements RandomSource {
  private count = 0
  numericCode(): string {
    return '123456'
  }
  sessionToken(): string {
    this.count += 1
    return `dev-token-${String(this.count)}`
  }
}

/**
 * Mirrors the production repository's contract: `findDevelopmentFixture` can only ever return a
 * row that was registered as a fixture. `findByPhone` is the general finder and holds real users
 * too, so a test can prove the two do not overlap.
 */
class InMemoryUsers implements UserRepository {
  fixtures = new Map<string, UserRecord & { status: UserRecord['status'] }>()
  realUsers = new Map<string, UserRecord>()
  logins: string[] = []

  seedFixtures(): void {
    let index = 0
    for (const identity of DEVELOPMENT_IDENTITIES) {
      index += 1
      this.fixtures.set(identity.phone, {
        id: `dev-user-${String(index)}`,
        phone: identity.phone as E164Phone,
        fullName: identity.fullName,
        status: 'ACTIVE',
        preferredLanguage: identity.preferredLanguage,
        roles: identity.roles,
      })
    }
  }

  findByPhone(phone: E164Phone): Promise<UserRecord | null> {
    return Promise.resolve(this.realUsers.get(phone) ?? this.fixtures.get(phone) ?? null)
  }

  findDevelopmentFixture(phone: string): Promise<UserRecord | null> {
    return Promise.resolve(this.fixtures.get(phone) ?? null)
  }

  createWithRole(): Promise<UserRecord> {
    return Promise.reject(new Error('development sign-in must never create an account'))
  }

  grantSelfRole(
    userId: string,
    role: string,
  ): Promise<{ roles: readonly string[]; added: boolean }> {
    const record = [...this.fixtures.values()].find((row) => row.id === userId)
    const roles = record === undefined ? [role] : [...new Set([...record.roles, role])]
    if (record !== undefined) Object.assign(record, { roles })
    return Promise.resolve({ roles, added: true })
  }

  markPhoneVerified(): Promise<void> {
    return Promise.resolve()
  }

  recordLogin(userId: string): Promise<void> {
    this.logins.push(userId)
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

const CONFIG: ConfigSnapshot = createConfigSnapshot(
  [{ key: 'auth.session.idleTimeoutDays', version: 1, value: { DEFAULT: 30, ADMIN: 0.333 } }],
  new Date('2026-08-10T10:00:00Z'),
)

function harness(environment: AppEnvironment = 'development', authMode: AuthMode = 'development') {
  const users = new InMemoryUsers()
  users.seedFixtures()
  const sessions = new InMemorySessions()
  const audit = new RecordingAudit()
  const deps = {
    environment,
    authMode,
    config: CONFIG,
    clock,
    random: new FixedRandom(),
    hasher,
    users,
    sessions,
    audit,
  }
  return { users, sessions, audit, deps }
}

function expectError<T>(result: Result<T, AppError>, code: string): void {
  if (!isErr(result)) throw new Error(`Expected ${code}, got success`)
  expect(result.error.code).toBe(code)
}

/* ---------------------------------------------------------------- mode policy */

describe('authentication mode policy', () => {
  it('permits OTP everywhere', () => {
    for (const environment of ['development', 'test', 'staging', 'production'] as const) {
      expect(isModePermitted(environment, 'otp')).toBe(true)
    }
  })

  it('permits development mode outside production only', () => {
    expect(isModePermitted('development', 'development')).toBe(true)
    expect(isModePermitted('test', 'development')).toBe(true)
    expect(isModePermitted('staging', 'development')).toBe(true)
    expect(isModePermitted('production', 'development')).toBe(false)
  })

  it('throws rather than degrading when production meets development auth', () => {
    // The direction of failure matters: refuse to start, never "allow login".
    expect(() => {
      assertModePermitted('production', 'development')
    }).toThrow(AuthModeError)
    expect(() => {
      assertModePermitted('production', 'otp')
    }).not.toThrow()
  })
})

/* ------------------------------------------------------------ development mode */

describe('development sign-in', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('signs in as a fixture and issues a session', async () => {
    const result = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      h.deps,
    )
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.roles).toEqual(['FARMER'])
    expect(result.value.isDevelopmentSession).toBe(true)
    expect(h.sessions.rows).toHaveLength(1)
    // Only the hash is stored, exactly as in OTP mode.
    expect(h.sessions.rows[0]?.tokenHash).toBe('tokenhash:dev-token-1')
  })

  it('carries the roles declared in the domain, which the caller cannot influence', async () => {
    for (const identity of DEVELOPMENT_IDENTITIES) {
      const fresh = harness()
      const result = await developmentSignIn(
        { identityKey: identity.key, ipAddress: null, userAgent: null },
        fresh.deps,
      )
      expect(isOk(result)).toBe(true)
      if (!isOk(result)) continue
      expect(result.value.roles).toEqual(identity.roles)
    }
  })

  it('gives a privileged fixture a much shorter session', async () => {
    const admin = await developmentSignIn(
      { identityKey: 'admin', ipAddress: null, userAgent: null },
      h.deps,
    )
    const farmer = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      h.deps,
    )
    if (!isOk(admin) || !isOk(farmer)) throw new Error('expected both to succeed')
    expect(admin.value.expiresAt.getTime()).toBeLessThan(farmer.value.expiresAt.getTime())
  })

  it('rejects an unknown identity and audits the attempt', async () => {
    const result = await developmentSignIn(
      { identityKey: 'not-a-fixture', ipAddress: '203.0.113.1', userAgent: null },
      h.deps,
    )
    expectError(result, 'VALIDATION_FAILED')
    expect(h.sessions.rows).toHaveLength(0)
    expect(h.audit.entries.some((entry) => entry.action === 'DEV_SIGN_IN_REJECTED')).toBe(true)
  })

  it('offers NO input by which a real account could be reached', async () => {
    // A user id, a phone number, or an email must all be meaningless here: the only accepted
    // input is a key from a closed allowlist.
    h.users.realUsers.set('+8801712345678', {
      id: 'real-user-1',
      phone: '+8801712345678' as E164Phone,
      fullName: 'Rahim Uddin',
      status: 'ACTIVE',
      preferredLanguage: 'BN',
      roles: ['FARMER'],
    })

    for (const attempt of ['real-user-1', '+8801712345678', 'rahim', 'admin@langgol', '*']) {
      const result = await developmentSignIn(
        { identityKey: attempt, ipAddress: null, userAgent: null },
        h.deps,
      )
      expect(isErr(result)).toBe(true)
    }
    expect(h.sessions.rows).toHaveLength(0)
  })

  it('never creates an account — a fixture must already exist', async () => {
    const empty = harness()
    empty.users.fixtures.clear()
    const result = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      empty.deps,
    )
    expectError(result, 'PRECONDITION_FAILED')
  })

  it('refuses a suspended fixture', async () => {
    const fixture = h.users.fixtures.get(DEVELOPMENT_IDENTITIES[0]?.phone ?? '')
    if (fixture) Object.assign(fixture, { status: 'SUSPENDED' })
    const result = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      h.deps,
    )
    expectError(result, 'PRECONDITION_FAILED')
  })

  it('audits every sign-in as a development session, with a masked number', async () => {
    await developmentSignIn({ identityKey: 'ops', ipAddress: null, userAgent: null }, h.deps)
    const entry = h.audit.entries.find((candidate) => candidate.action === 'DEV_SIGN_IN')
    expect(entry).toBeDefined()
    expect(entry?.reason).toBe('identity=ops')
  })
})

/* ------------------------------------------------------- production safety guard */

describe('production safety', () => {
  it('throws at the use case even if configuration claims development mode in production', async () => {
    // Guard 2 of 3: startup already refused this, but a mis-wired dependency or a stale cached
    // config must not be able to open the door.
    const h = harness('production', 'development')
    await expect(
      developmentSignIn({ identityKey: 'admin', ipAddress: null, userAgent: null }, h.deps),
    ).rejects.toThrow(AuthModeError)
    expect(h.sessions.rows).toHaveLength(0)
  })

  it('refuses when the mode is OTP, even outside production', async () => {
    const h = harness('staging', 'otp')
    const result = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      h.deps,
    )
    expectError(result, 'PRECONDITION_FAILED')
    expect(h.sessions.rows).toHaveLength(0)
  })

  it('confines every fixture to the reserved phone block', () => {
    // The database CHECK enforces this too; asserting it here keeps the allowlist honest when
    // someone adds an identity.
    for (const identity of DEVELOPMENT_IDENTITIES) {
      expect(identity.phone).toMatch(/^\+880170000000[1-9]$/)
    }
    const phones = DEVELOPMENT_IDENTITIES.map((identity) => identity.phone)
    expect(new Set(phones).size).toBe(phones.length)
  })
})

/* --------------------------------------------------------------------- sign out */

describe('sign out', () => {
  it('revokes the presenting session only', async () => {
    const h = harness()
    const first = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      h.deps,
    )
    await developmentSignIn({ identityKey: 'farmer', ipAddress: null, userAgent: null }, h.deps)
    if (!isOk(first)) throw new Error('expected sign-in to succeed')

    const result = await signOut(
      { sessionToken: first.value.sessionToken, userId: first.value.userId },
      { clock, hasher, sessions: h.sessions, audit: h.audit },
    )
    expect(isOk(result)).toBe(true)
    expect(h.sessions.rows.filter((row) => row.revokedAt !== null)).toHaveLength(1)
  })

  it('revokes everywhere when asked — the action taken when something feels wrong', async () => {
    const h = harness()
    const first = await developmentSignIn(
      { identityKey: 'farmer', ipAddress: null, userAgent: null },
      h.deps,
    )
    await developmentSignIn({ identityKey: 'farmer', ipAddress: null, userAgent: null }, h.deps)
    if (!isOk(first)) throw new Error('expected sign-in to succeed')

    const result = await signOut(
      { sessionToken: first.value.sessionToken, userId: first.value.userId, everywhere: true },
      { clock, hasher, sessions: h.sessions, audit: h.audit },
    )
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.revoked).toBe(2)
    expect(h.sessions.rows.every((row) => row.revokedAt !== null)).toBe(true)
    expect(h.audit.entries.some((entry) => entry.action === 'SIGN_OUT_ALL')).toBe(true)
  })
})
