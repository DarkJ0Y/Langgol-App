/**
 * Ports — the interfaces the application layer owns and infrastructure implements.
 *
 * Every external service sits behind one of these. Provider choice must be a configuration
 * change, not a refactor: the SMS aggregator, the payout rail and the clock are all replaceable
 * without touching a use case. It is also what makes the use cases testable without a network.
 *
 * Refs: docs/03_ARCHITECTURE.md §2.1
 */

import type { E164Phone, OtpPurpose, VerificationPurpose } from '@langgol/domain/identity'
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
  /** A URL-safe token of the given byte length, for verification links. */
  token(bytes: number): string
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

/**
 * Phone challenges, scoped by purpose throughout.
 *
 * Every method takes a `purpose`, and that is load-bearing rather than tidy. Logging in and
 * verifying a number are separate budgets: if they shared one, a farmer who verified their
 * number when the screen asked them to would have spent the per-phone allowance they need to
 * sign in, and would be locked out by following instructions.
 */
export interface OtpChallengeRepository {
  create(input: {
    readonly phone: E164Phone
    readonly codeHash: string
    readonly purpose: OtpPurpose
    readonly expiresAt: Date
    readonly maxAttempts: number
    readonly requestIp: string | null
    readonly requestDevice: string | null
  }): Promise<OtpChallengeRecord>

  findLatestActive(
    phone: E164Phone,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<OtpChallengeRecord | null>
  recordAttempt(id: string): Promise<void>
  consume(id: string, at: Date): Promise<void>
  burn(id: string, at: Date): Promise<void>

  /**
   * Burn every live challenge for this phone and purpose.
   *
   * Called when a new code is issued. Without it each request adds another usable code, so N
   * requests give an attacker N x maxAttempts guesses against the same number — the attempt cap
   * would count per challenge while the real exposure grew without bound.
   */
  invalidateOutstanding(input: {
    readonly phone: E164Phone
    readonly purpose: OtpPurpose
    readonly at: Date
  }): Promise<number>

  /** Creation timestamps of recent challenges, for rate limiting. */
  recentRequestTimes(input: {
    readonly phone?: E164Phone
    readonly ip?: string
    readonly purpose: OtpPurpose
    readonly since: Date
  }): Promise<Date[]>
}

export interface VerificationTokenRecord {
  readonly id: string
  readonly userId: string
  readonly destination: string
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly revokedAt: Date | null
  readonly createdAt: Date
}

/**
 * Tokens emailed to an address to prove the recipient controls it.
 *
 * Lookup is BY HASH, never by user: the caller holds a token and asks what it unlocks, which is
 * the only question a redemption endpoint should be able to ask. A `findByUser` would invite an
 * endpoint that takes a user id and returns their live token.
 */
export interface VerificationTokenRepository {
  create(input: {
    readonly userId: string
    readonly purpose: VerificationPurpose
    readonly destination: string
    readonly tokenHash: string
    readonly expiresAt: Date
    readonly requestIp: string | null
  }): Promise<VerificationTokenRecord>

  findByHash(tokenHash: string): Promise<VerificationTokenRecord | null>
  consume(id: string, at: Date): Promise<void>

  /** Revoke every live token for a user and purpose. Returns how many were affected. */
  invalidateOutstanding(input: {
    readonly userId: string
    readonly purpose: VerificationPurpose
    readonly at: Date
  }): Promise<number>

  recentRequestTimes(input: {
    readonly userId: string
    readonly purpose: VerificationPurpose
    readonly since: Date
  }): Promise<Date[]>
}

/**
 * Delivery of a verification email.
 *
 * `available` is part of the contract rather than an implementation detail: email is optional to
 * the platform, so a deployment with no provider is legitimate and every caller must be able to
 * ask before promising a user that something was sent.
 */
export interface EmailDeliveryPort {
  readonly available: boolean
  deliver(input: {
    readonly to: string
    readonly link: string
    readonly locale: Locale
    readonly expiresInSeconds: number
    readonly userId: string
  }): Promise<{ readonly accepted: boolean; readonly providerRef?: string }>
}

export interface UserRecord {
  readonly id: string
  readonly phone: E164Phone
  readonly fullName: string
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  readonly preferredLanguage: 'BN' | 'EN'
  readonly roles: readonly string[]
}

/**
 * The full account view, as opposed to the slim `UserRecord` the auth flow needs.
 *
 * Kept separate rather than widening `UserRecord`: the auth path reads on every request and has
 * no use for a date of birth, and widening it would put profile data into session resolution.
 */
export interface UserProfileRecord {
  readonly id: string
  readonly phone: string
  readonly phoneVerifiedAt: Date | null
  readonly email: string | null
  readonly emailVerifiedAt: Date | null
  readonly fullName: string
  readonly preferredLanguage: 'BN' | 'EN'
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  readonly onboardingStatus: string
  readonly profilePhotoKey: string | null
  readonly dateOfBirth: Date | null
  readonly gender: string | null
  readonly roles: readonly string[]
  readonly lastLoginAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** One role a user holds, with its provenance. */
export interface RoleAssignmentRecord {
  readonly role: string
  readonly grantedAt: Date
  readonly grantedById: string | null
  readonly selfSelected: boolean
}

/** A role the platform offers, with its label. Read from `role_definitions`. */
export interface RoleDefinitionRecord {
  readonly role: string
  readonly nameBn: string
  readonly nameEn: string
  readonly descriptionBn: string
  readonly descriptionEn: string
  readonly selfSelectable: boolean
  readonly privileged: boolean
  readonly sortOrder: number
}

/**
 * Reads and writes for the account surface.
 *
 * Separate from `UserRepository` so the authentication port stays as small as it was — a port
 * that grows every time a screen is added stops being a boundary.
 */
export interface AccountRepository {
  findProfile(userId: string): Promise<UserProfileRecord | null>

  /**
   * Apply a PARTIAL update. Only the keys present are written, so a caller editing one field
   * cannot blank the others. Returns null when the user does not exist.
   */
  updateProfile(
    userId: string,
    changes: {
      readonly fullName?: string
      readonly email?: string | null
      readonly preferredLanguage?: 'BN' | 'EN'
      readonly dateOfBirth?: Date | null
      readonly gender?: string | null
      readonly profilePhotoKey?: string | null
      readonly onboardingStatus?: string
    },
  ): Promise<UserProfileRecord | null>

  /**
   * Record that an address has been proven.
   *
   * Conditional on the address still matching: a token proves control of the address it was sent
   * to, and if the user has since changed their email the proof is about an address they no
   * longer hold. Returns false when that has happened, rather than stamping the new address as
   * verified on the strength of a link sent to the old one.
   */
  markEmailVerified(input: {
    readonly userId: string
    readonly email: string
    readonly at: Date
  }): Promise<boolean>

  listRoleDefinitions(): Promise<readonly RoleDefinitionRecord[]>
  listRolesFor(userId: string): Promise<readonly RoleAssignmentRecord[]>

  /**
   * Grant a role. Idempotent: granting a role already held returns `added: false` rather than
   * failing, because an administrator double-clicking is not a conflict.
   */
  assignRole(input: {
    readonly userId: string
    readonly role: string
    readonly grantedById: string
    readonly at: Date
  }): Promise<{ readonly roles: readonly string[]; readonly added: boolean }>

  /**
   * Revoke a role. Idempotent in the same way. The reason and the revoker are required by a
   * database CHECK, not merely by this signature.
   */
  revokeRole(input: {
    readonly userId: string
    readonly role: string
    readonly revokedById: string
    readonly reason: string
    readonly at: Date
  }): Promise<{ readonly roles: readonly string[]; readonly removed: boolean }>
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
  /**
   * Add a self-selected role. Idempotent: choosing a role already held is not an error, because
   * a farmer tapping twice on a slow connection is not a conflict.
   */
  grantSelfRole(userId: string, role: string): Promise<{ roles: readonly string[]; added: boolean }>
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

export * from './location.js'
export * from './consent.js'
export * from './farming.js'
export * from './advisory.js'
export * from './diagnosis.js'
