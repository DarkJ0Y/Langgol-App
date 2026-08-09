/**
 * Prisma-backed repositories for the authentication use cases.
 *
 * Repositories return domain-shaped records, not Prisma models, so a schema change does not leak
 * into a use case. Filtering happens in the query, never in application code after the fact.
 *
 * Refs: docs/07_SECURITY.md §4.3
 */

import { prisma } from '@langgol/db'
import type { E164Phone } from '@langgol/domain/identity'
import type {
  AuditPort,
  OtpChallengeRecord,
  OtpChallengeRepository,
  SessionRepository,
  UserRecord,
  UserRepository,
} from '@langgol/application'

interface ChallengeRow {
  id: string
  phone: string
  codeHash: string
  expiresAt: Date
  attempts: number
  maxAttempts: number
  consumedAt: Date | null
  createdAt: Date
}

function toChallenge(row: ChallengeRow): OtpChallengeRecord {
  return {
    id: row.id,
    phone: row.phone as E164Phone,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  }
}

export const otpChallengeRepository: OtpChallengeRepository = {
  async create(input) {
    const row = await prisma.otpChallenge.create({
      data: {
        phone: input.phone,
        codeHash: input.codeHash,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
        maxAttempts: input.maxAttempts,
        requestIp: input.requestIp,
        requestDevice: input.requestDevice,
      },
    })
    return toChallenge(row)
  },

  async findLatestActive(phone, now) {
    const row = await prisma.otpChallenge.findFirst({
      where: { phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    })
    return row === null ? null : toChallenge(row)
  },

  async recordAttempt(id) {
    await prisma.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } })
  },

  async consume(id, at) {
    await prisma.otpChallenge.update({ where: { id }, data: { consumedAt: at } })
  },

  async burn(id, at) {
    await prisma.otpChallenge.update({ where: { id }, data: { consumedAt: at } })
  },

  async recentRequestTimes({ phone, ip, since }) {
    const rows = await prisma.otpChallenge.findMany({
      where: {
        createdAt: { gte: since },
        ...(phone === undefined ? {} : { phone }),
        ...(ip === undefined ? {} : { requestIp: ip }),
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return rows.map((row) => row.createdAt)
  },
}

interface UserRow {
  id: string
  phone: string
  fullName: string
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  preferredLanguage: 'BN' | 'EN'
  roles: { role: string }[]
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    phone: row.phone as E164Phone,
    fullName: row.fullName,
    status: row.status,
    preferredLanguage: row.preferredLanguage,
    roles: row.roles.map((assignment) => assignment.role),
  }
}

export const userRepository: UserRepository = {
  async findByPhone(phone) {
    const row = await prisma.user.findUnique({
      where: { phone },
      include: { roles: { where: { revokedAt: null }, select: { role: true } } },
    })
    return row === null ? null : toUser(row)
  },

  async createWithRole(input) {
    const row = await prisma.user.create({
      data: {
        phone: input.phone,
        fullName: input.fullName,
        preferredLanguage: input.preferredLanguage,
        phoneVerifiedAt: input.verifiedAt,
        roles: { create: { role: input.role as 'FARMER' | 'CONSUMER' | 'RETAILER' } },
      },
      include: { roles: { where: { revokedAt: null }, select: { role: true } } },
    })
    return toUser(row)
  },

  async findDevelopmentFixture(phone) {
    // The fixture flag is in the WHERE clause, not checked afterwards. A code path that forgot
    // the check would return nothing rather than a real user.
    const row = await prisma.user.findFirst({
      where: { phone, isDevelopmentFixture: true },
      include: { roles: { where: { revokedAt: null }, select: { role: true } } },
    })
    return row === null ? null : toUser(row)
  },

  async grantSelfRole(userId, role) {
    // upsert on the (user, role) unique key: a repeated tap is a no-op, not a duplicate row.
    const before = await prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId, role: role as 'FARMER' | 'CONSUMER' | 'RETAILER' } },
      select: { id: true, revokedAt: true },
    })

    if (before === null || before.revokedAt !== null) {
      await prisma.userRoleAssignment.upsert({
        where: { userId_role: { userId, role: role as 'FARMER' | 'CONSUMER' | 'RETAILER' } },
        create: { userId, role: role as 'FARMER' | 'CONSUMER' | 'RETAILER' },
        update: { revokedAt: null },
      })
    }

    const rows = await prisma.userRoleAssignment.findMany({
      where: { userId, revokedAt: null },
      select: { role: true },
    })

    return {
      roles: rows.map((row) => row.role),
      added: before === null || before.revokedAt !== null,
    }
  },

  async markPhoneVerified(userId, at) {
    await prisma.user.update({ where: { id: userId }, data: { phoneVerifiedAt: at } })
  },

  async recordLogin(userId, at) {
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: at } })
  },
}

export const sessionRepository: SessionRepository = {
  async create(input) {
    return prisma.session.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      select: { id: true },
    })
  },

  async revoke({ tokenHash, at, reason }) {
    await prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: at, revokeReason: reason },
    })
  },

  async revokeAllForUser({ userId, at, reason }) {
    const result = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at, revokeReason: reason },
    })
    return result.count
  },
}

export const auditPort: AuditPort = {
  async record(input) {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason ?? null,
        ...(input.meta === undefined ? {} : { after: input.meta }),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  },
}
