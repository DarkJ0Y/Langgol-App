/**
 * Ports — the interfaces the application layer owns and infrastructure implements.
 *
 * Every external service sits behind one of these. Provider choice must be a configuration
 * change, not a refactor: the SMS aggregator, the payout rail and the clock are all replaceable
 * without touching a use case. It is also what makes the use cases testable without a network.
 *
 * Refs: docs/03_ARCHITECTURE.md §2.1
 */

import type { E164Phone } from '@langgol/domain/identity'
import type { Poisha } from '@langgol/domain/money'

/** Time is injected. A use case that calls `new Date()` cannot be tested at a boundary. */
export interface Clock {
  now(): Date
}

export interface SecretHasher {
  hash(secret: string): Promise<string>
  verify(secret: string, stored: string): Promise<boolean>
  hashToken(token: string): string
}

export interface RandomSource {
  numericCode(length: number): string
  sessionToken(): string
}

export type Locale = 'bn' | 'en'

/**
 * Delivery of a one-time code.
 *
 * Auth-specific on purpose: the use case should not know or care whether the code arrived by
 * SMS, IVR or push. The channel-agnostic dispatcher implements this port, so adding a channel
 * changes the adapter and never the use case. docs/03_ARCHITECTURE.md §8.1
 */
export interface OtpDeliveryPort {
  deliver(input: {
    readonly phone: E164Phone
    readonly code: string
    readonly locale: Locale
    readonly expiresInSeconds: number
  }): Promise<{ readonly accepted: boolean; readonly providerRef?: string }>

  /** Messages already sent today, for the spend circuit breaker. */
  sentToday(now: Date): Promise<number>

  readonly unitCost: Poisha
  readonly dailyBudget: Poisha
}

export interface OtpChallengeRecord {
  readonly id: string
  readonly phone: E164Phone
  readonly codeHash: string
  readonly expiresAt: Date
  readonly attempts: number
  readonly maxAttempts: number
  readonly consumedAt: Date | null
  readonly createdAt: Date
}

export interface OtpChallengeRepository {
  create(input: {
    readonly phone: E164Phone
    readonly codeHash: string
    readonly purpose: 'LOGIN'
    readonly expiresAt: Date
    readonly maxAttempts: number
    readonly requestIp: string | null
    readonly requestDevice: string | null
  }): Promise<OtpChallengeRecord>

  findLatestActive(phone: E164Phone, now: Date): Promise<OtpChallengeRecord | null>
  recordAttempt(id: string): Promise<void>
  consume(id: string, at: Date): Promise<void>
  burn(id: string, at: Date): Promise<void>

  /** Creation timestamps of recent challenges, for rate limiting. */
  recentRequestTimes(input: {
    readonly phone?: E164Phone
    readonly ip?: string
    readonly since: Date
  }): Promise<Date[]>
}

export interface UserRecord {
  readonly id: string
  readonly phone: E164Phone
  readonly fullName: string
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  readonly preferredLanguage: 'BN' | 'EN'
  readonly roles: readonly string[]
}

export interface UserRepository {
  findByPhone(phone: E164Phone): Promise<UserRecord | null>
  createWithRole(input: {
    readonly phone: E164Phone
    readonly fullName: string
    readonly role: string
    readonly preferredLanguage: 'BN' | 'EN'
    readonly verifiedAt: Date
  }): Promise<UserRecord>
  /**
   * Look up a development fixture BY PHONE, scoped at the database to rows carrying the fixture
   * flag. Deliberately not a general finder: there is no argument by which this could return a
   * real user. docs/03_ARCHITECTURE.md ADR-22
   */
  findDevelopmentFixture(phone: string): Promise<UserRecord | null>
  markPhoneVerified(userId: string, at: Date): Promise<void>
  recordLogin(userId: string, at: Date): Promise<void>
}

export interface SessionRepository {
  create(input: {
    readonly userId: string
    readonly tokenHash: string
    readonly expiresAt: Date
    readonly ipAddress: string | null
    readonly userAgent: string | null
  }): Promise<{ readonly id: string }>
  revoke(input: {
    readonly tokenHash: string
    readonly at: Date
    readonly reason: string
  }): Promise<void>
  revokeAllForUser(input: {
    readonly userId: string
    readonly at: Date
    readonly reason: string
  }): Promise<number>
}

export interface AuditPort {
  record(input: {
    readonly actorUserId: string | null
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly reason?: string
    readonly meta?: Record<string, string | number | boolean>
    readonly ipAddress?: string | null
    readonly userAgent?: string | null
  }): Promise<void>
}
