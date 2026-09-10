/**
 * Firebase sign-in.
 *
 * The interesting cases are not the happy path. They are the ones where a token verifies and the
 * account still must not get a session, and the ones where the boundary between "Firebase said
 * so" and "Langgol decided" has to hold.
 */

import { describe, expect, it } from 'vitest'
import { createConfigSnapshot, type ConfigSnapshot } from '@langgol/domain/config'
import {
  AuthModeError,
  type AppEnvironment,
  type AuthMode,
  type E164Phone,
} from '@langgol/domain/identity'
import { isErr, isOk, type AppError, type Result } from '@langgol/shared'
import { firebaseSignIn } from './firebase-sign-in.js'
import type {
  AuditPort,
  Clock,
  FirebaseIdentityVerifier,
  RandomSource,
  SecretHasher,
  SessionRepository,
  UserRecord,
  UserRepository,
  VerifiedFirebaseIdentity,
} from '../../ports/index.js'

/* ------------------------------------------------------------------ test doubles */

const NOW = new Date('2026-09-10T10:00:00Z')
const VERIFIED_AT = new Date('2026-09-10T09:59:30Z')

const clock: Clock = { now: () => NOW }

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
  token(bytes: number): string {
    return `verify-token-${String(bytes)}`
  }
  sessionToken(): string {
    this.count += 1
    return `fb-token-${String(this.count)}`
  }
}

/**
 * Accepts exactly one token string and rejects every other.
 *
 * Records what it was handed, so a test can assert the raw token never travelled anywhere it
 * should not have.
 */
class StubVerifier implements FirebaseIdentityVerifier {
  seen: string[] = []

  constructor(
    private readonly accepts: string,
    private readonly identity: VerifiedFirebaseIdentity,
  ) {}

  verifyIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
    this.seen.push(idToken)
    return Promise.resolve(idToken === this.accepts ? this.identity : null)
  }
}

class InMemoryUsers implements UserRepository {
  rows = new Map<string, UserRecord>()
  created: { phone: string; role: string; verifiedAt: Date }[] = []
  logins: string[] = []
  verifiedAt: { userId: string; at: Date }[] = []

  seed(user: UserRecord): void {
    this.rows.set(user.phone, user)
  }

  findByPhone(phone: E164Phone): Promise<UserRecord | null> {
    return Promise.resolve(this.rows.get(phone) ?? null)
  }

  findDevelopmentFixture(): Promise<UserRecord | null> {
    // Firebase sign-in must never reach the fixture path. A trap, not a stub.
    return Promise.reject(new Error('firebase sign-in must not look up development fixtures'))
  }

  createWithRole(input: {
    phone: E164Phone
    fullName: string
    role: string
    preferredLanguage: 'BN' | 'EN'
    verifiedAt: Date
  }): Promise<UserRecord> {
    this.created.push({ phone: input.phone, role: input.role, verifiedAt: input.verifiedAt })
    const record: UserRecord = {
      id: `user-${String(this.rows.size + 1)}`,
      phone: input.phone,
      fullName: input.fullName,
      status: 'ACTIVE',
      preferredLanguage: input.preferredLanguage,
      roles: [input.role],
    }
    this.rows.set(input.phone, record)
    return Promise.resolve(record)
  }

  grantSelfRole(): Promise<{ roles: readonly string[]; added: boolean }> {
    return Promise.reject(new Error('not used'))
  }

  markPhoneVerified(userId: string, at: Date): Promise<void> {
    this.verifiedAt.push({ userId, at })
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

  revoke(): Promise<void> {
    return Promise.resolve()
  }

  revokeAllForUser(): Promise<number> {
    return Promise.resolve(0)
  }
}

class RecordingAudit implements AuditPort {
  entries: { action: string; entityId: string; reason?: string; meta?: Record<string, unknown> }[] =
    []
  record(input: {
    action: string
    entityId: string
    reason?: string
    meta?: Record<string, unknown>
  }): Promise<void> {
    this.entries.push(input)
    return Promise.resolve()
  }
}

const CONFIG: ConfigSnapshot = createConfigSnapshot(
  [{ key: 'auth.session.idleTimeoutDays', version: 1, value: { DEFAULT: 30, ADMIN: 0.333 } }],
  NOW,
)

const GOOD_TOKEN = 'a-valid-firebase-id-token'
const PHONE = '+8801712345678'

const IDENTITY: VerifiedFirebaseIdentity = {
  uid: 'firebase-uid-abc',
  phone: PHONE,
  verifiedAt: VERIFIED_AT,
}

function harness(
  environment: AppEnvironment = 'development',
  authMode: AuthMode = 'firebase',
  identity: VerifiedFirebaseIdentity = IDENTITY,
) {
  const users = new InMemoryUsers()
  const sessions = new InMemorySessions()
  const audit = new RecordingAudit()
  const firebase = new StubVerifier(GOOD_TOKEN, identity)

  return {
    users,
    sessions,
    audit,
    firebase,
    deps: {
      environment,
      authMode,
      config: CONFIG,
      clock,
      random: new FixedRandom(),
      hasher,
      firebase,
      users,
      sessions,
      audit,
    },
  }
}

const SIGNUP = { fullName: 'Rahima Begum', role: 'FARMER', preferredLanguage: 'BN' } as const

function expectError(result: Result<unknown, AppError>, code: string): void {
  expect(isErr(result)).toBe(true)
  if (isErr(result)) expect(result.error.code).toBe(code)
}

/* ------------------------------------------------------------------------ tests */

describe('a token that does not verify', () => {
  it('refuses, and says nothing about why', async () => {
    const h = harness()
    const result = await firebaseSignIn(
      { idToken: 'forged', signup: SIGNUP, ipAddress: '1.2.3.4', userAgent: null },
      h.deps,
    )

    expectError(result, 'VALIDATION_FAILED')
    expect(h.sessions.rows).toHaveLength(0)
    expect(h.users.created).toHaveLength(0)
  })

  it('records the rejection without anything the token claimed', async () => {
    /*
     * An unverified token establishes nothing, so nothing inside it may be treated as fact. Its
     * claimed phone number is attacker-controlled text, and writing it to an audit row would put
     * that text in front of an operator as though the system had checked it.
     */
    const h = harness()
    await firebaseSignIn(
      { idToken: 'forged', signup: SIGNUP, ipAddress: '1.2.3.4', userAgent: null },
      h.deps,
    )

    const entry = h.audit.entries.find((e) => e.action === 'FIREBASE_SIGN_IN_REJECTED')
    expect(entry).toBeDefined()
    expect(entry?.entityId).toBe('unverified')
  })

  it('never puts the token itself into the audit trail', async () => {
    // It is a bearer credential. An audit table has a different retention policy and a much wider
    // audience than the request that carried it.
    const h = harness()
    await firebaseSignIn(
      { idToken: 'forged-but-secret', signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(JSON.stringify(h.audit.entries)).not.toContain('forged-but-secret')
  })
})

describe('the mode gate', () => {
  it('refuses when Firebase is not the configured mode', async () => {
    const h = harness('development', 'otp')
    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    expectError(result, 'PRECONDITION_FAILED')
    expect(h.sessions.rows).toHaveLength(0)
    // The token is not even presented for verification: the mode is checked first.
    expect(h.firebase.seen).toHaveLength(0)
  })

  it('is permitted in production, because it verifies the number', async () => {
    /*
     * The counterpart of the development-mode test. Production forbids modes that prove nothing,
     * not modes we happen to have added most recently.
     */
    expect(() => {
      const h = harness('production', 'firebase')
      return h
    }).not.toThrow(AuthModeError)

    const h = harness('production', 'firebase')
    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )
    expect(isOk(result)).toBe(true)
  })
})

describe('a verified token', () => {
  it('creates the account on first sign-in and issues a session', async () => {
    const h = harness()
    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return

    expect(result.value.isNewAccount).toBe(true)
    expect(result.value.roles).toEqual(['FARMER'])
    expect(h.sessions.rows).toHaveLength(1)
  })

  it('stores only a hash of the session token', async () => {
    const h = harness()
    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return

    const stored = h.sessions.rows[0]?.tokenHash
    expect(stored).toBe(`tokenhash:${result.value.sessionToken}`)
    expect(stored).not.toBe(result.value.sessionToken)
  })

  it('dates the verification from the token, not from the clock', async () => {
    /*
     * Firebase performed the check; the moment it did so is the moment the phone was proven. Using
     * our own clock would record when the token happened to be presented, which is a different
     * fact and would drift under retries.
     */
    const h = harness()
    await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(h.users.created[0]?.verifiedAt).toEqual(VERIFIED_AT)
  })

  it('signs a returning user in without creating anything', async () => {
    const h = harness()
    h.users.seed({
      id: 'existing-1',
      phone: PHONE as E164Phone,
      fullName: 'Rahima Begum',
      status: 'ACTIVE',
      preferredLanguage: 'BN',
      roles: ['FARMER', 'CONSUMER'],
    })

    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return

    expect(result.value.isNewAccount).toBe(false)
    expect(result.value.roles).toEqual(['FARMER', 'CONSUMER'])
    expect(h.users.created).toHaveLength(0)
  })

  it('asks an unregistered caller to choose a role rather than guessing one', async () => {
    const h = harness()
    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, ipAddress: null, userAgent: null },
      h.deps,
    )

    expectError(result, 'VALIDATION_FAILED')
    expect(h.sessions.rows).toHaveLength(0)
  })
})

describe('what Firebase does NOT get to decide', () => {
  it('refuses a suspended account even with a perfectly good token', async () => {
    /*
     * The whole point of the boundary. Firebase establishes control of the number; whether that
     * person may use Langgol is this system's decision and stays in PostgreSQL.
     */
    const h = harness()
    h.users.seed({
      id: 'suspended-1',
      phone: PHONE as E164Phone,
      fullName: 'Suspended User',
      status: 'SUSPENDED',
      preferredLanguage: 'BN',
      roles: ['FARMER'],
    })

    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, ipAddress: null, userAgent: null },
      h.deps,
    )

    expectError(result, 'PRECONDITION_FAILED')
    expect(h.sessions.rows).toHaveLength(0)
    expect(h.audit.entries.some((e) => e.action === 'LOGIN_BLOCKED')).toBe(true)
  })

  it('refuses a privileged role offered at signup', async () => {
    /*
     * A verified phone number is not a claim to be an administrator. The signup role goes through
     * the same allowlist as every other entry point, and the type carrying it is erased at the
     * form boundary, so the check is a runtime one.
     */
    const h = harness()
    const result = await firebaseSignIn(
      {
        idToken: GOOD_TOKEN,
        signup: { ...SIGNUP, role: 'ADMIN' as never },
        ipAddress: null,
        userAgent: null,
      },
      h.deps,
    )

    expectError(result, 'VALIDATION_FAILED')
    expect(h.users.created).toHaveLength(0)
    expect(h.sessions.rows).toHaveLength(0)
  })

  it('gives an admin the shorter idle timeout, from our config and not the token', async () => {
    const h = harness()
    h.users.seed({
      id: 'admin-1',
      phone: PHONE as E164Phone,
      fullName: 'Admin',
      status: 'ACTIVE',
      preferredLanguage: 'EN',
      roles: ['ADMIN'],
    })

    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return

    const hours = (result.value.expiresAt.getTime() - NOW.getTime()) / (60 * 60 * 1000)
    expect(hours).toBeCloseTo(8, 1)
  })
})

describe('the phone number is normalised through the domain', () => {
  it('accepts a token whose number is written unconventionally', async () => {
    // Firebase issues E.164, but a second normalisation is cheap and two notions of "the same
    // number" in a table with a unique constraint on it are not.
    const h = harness('development', 'firebase', { ...IDENTITY, phone: '01712345678' })
    h.users.seed({
      id: 'existing-1',
      phone: PHONE as E164Phone,
      fullName: 'Rahima Begum',
      status: 'ACTIVE',
      preferredLanguage: 'BN',
      roles: ['FARMER'],
    })

    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.userId).toBe('existing-1')
  })

  it('refuses a verified number this system cannot represent', async () => {
    const h = harness('development', 'firebase', { ...IDENTITY, phone: '+14155550123' })
    const result = await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    expectError(result, 'VALIDATION_FAILED')
    expect(h.users.created).toHaveLength(0)
    const entry = h.audit.entries.find((e) => e.action === 'FIREBASE_SIGN_IN_REJECTED')
    expect(entry?.reason).toContain('UNSUPPORTED_PHONE')
  })
})

describe('the audit line', () => {
  it('records which party verified the number', async () => {
    const h = harness()
    await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    const entry = h.audit.entries.find((e) => e.action === 'FIREBASE_SIGNED_IN')
    expect(entry?.meta?.['authMode']).toBe('firebase')
  })

  it('masks the phone number', async () => {
    const h = harness()
    await firebaseSignIn(
      { idToken: GOOD_TOKEN, signup: SIGNUP, ipAddress: null, userAgent: null },
      h.deps,
    )

    const entry = h.audit.entries.find((e) => e.action === 'FIREBASE_SIGNED_IN')
    expect(entry?.meta?.['maskedPhone']).not.toBe(PHONE)
    expect(String(entry?.meta?.['maskedPhone'])).toContain('*')
  })
})
