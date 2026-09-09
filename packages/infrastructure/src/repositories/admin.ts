/**
 * Prisma-backed back office.
 *
 * ## Every list names its columns and takes a page
 *
 * The tables read here hold phone numbers, email addresses and dates of birth. A search returning
 * fifty users must not carry fifty of each, so the projection is explicit and the phone is masked
 * before it leaves this module — no caller has to remember to do it, because there is nothing
 * unmasked for a caller to receive.
 *
 * ## Searching by phone, without listing phones
 *
 * An operator taking a support call has a number and needs the account. That is a legitimate
 * lookup, so the search matches against the phone — but only when the term looks like a number,
 * and the results still come back masked. Finding somebody by a number you already have is a
 * different thing from being shown everybody's.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §11
 */

import { prisma, type Prisma } from '@langgol/db'
import { maskPhone, normalizePhone } from '@langgol/domain/identity'
import type { AdminPermission } from '@langgol/domain/admin'
import type {
  AdminRepository,
  AdminUserDetail,
  AdminUserSummary,
  AuditEntry,
  Page,
} from '@langgol/application'

/** The columns a user summary is built from. Never the email, never the date of birth. */
const SUMMARY_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  status: true,
  onboardingStatus: true,
  createdAt: true,
  roles: { where: { revokedAt: null }, select: { role: true } },
} as const

type SummaryRow = {
  id: string
  fullName: string
  phone: string
  status: string
  onboardingStatus: string
  createdAt: Date
  roles: { role: string }[]
}

function toSummary(row: SummaryRow): AdminUserSummary {
  return {
    userId: row.id,
    fullName: row.fullName,
    // Masked here, so there is no unmasked form for a caller to leak.
    phoneMasked: maskPhone(row.phone),
    status: row.status,
    onboardingStatus: row.onboardingStatus,
    roles: row.roles.map((entry) => entry.role),
    createdAt: row.createdAt,
  }
}

/**
 * Build the WHERE clause from the filter.
 *
 * A term that looks like a Bangladeshi number is normalised and matched exactly against the phone;
 * anything else is matched against the name. Matching a partial number with a LIKE would let an
 * operator enumerate numbers by prefix, which is a different capability from looking one up.
 */
function whereFor(filter: {
  search?: string | undefined
  role?: string | undefined
  status?: string | undefined
  onboardingStatus?: string | undefined
}): Prisma.UserWhereInput {
  const clauses: Prisma.UserWhereInput[] = []

  const term = filter.search?.trim() ?? ''
  if (term !== '') {
    let phone: string | null = null
    try {
      phone = normalizePhone(term)
    } catch {
      // Not a number. Fall through to a name search.
      phone = null
    }

    clauses.push(phone === null ? { fullName: { contains: term, mode: 'insensitive' } } : { phone })
  }

  if (filter.role !== undefined && filter.role !== '') {
    clauses.push({ roles: { some: { role: filter.role as never, revokedAt: null } } })
  }
  if (filter.status !== undefined && filter.status !== '') {
    clauses.push({ status: filter.status as never })
  }
  if (filter.onboardingStatus !== undefined && filter.onboardingStatus !== '') {
    clauses.push({ onboardingStatus: filter.onboardingStatus as never })
  }

  return clauses.length === 0 ? {} : { AND: clauses }
}

export const adminRepository: AdminRepository = {
  async searchUsers(filter): Promise<Page<AdminUserSummary>> {
    const where = whereFor(filter)
    const limit = filter.limit ?? 20
    const offset = filter.offset ?? 0

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ])

    return { items: rows.map((row) => toSummary(row as SummaryRow)), total, limit, offset }
  },

  async userDetail(userId): Promise<AdminUserDetail | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...SUMMARY_SELECT,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        // Type and status only. Never the identity record, which is a join away and stays there.
        verifications: { select: { type: true, status: true } },
        adminPermissions: { where: { revokedAt: null }, select: { permission: true } },
      },
    })
    if (row === null) return null

    const detail = row as SummaryRow & {
      phoneVerifiedAt: Date | null
      emailVerifiedAt: Date | null
      verifications: { type: string; status: string }[]
      adminPermissions: { permission: string }[]
    }

    return {
      ...toSummary(detail),
      phoneVerified: detail.phoneVerifiedAt !== null,
      emailVerified: detail.emailVerifiedAt !== null,
      verifications: detail.verifications.map((entry) => ({
        type: entry.type,
        status: entry.status,
      })),
      permissions: detail.adminPermissions.map((entry) => entry.permission as AdminPermission),
      /*
       * Read from the audit log rather than a column, because there is no column: a suspension
       * reason belongs with the record of who did it and when, and duplicating it onto the user row
       * would give it a second home to fall out of step with.
       */
      suspendedReason:
        detail.status !== 'SUSPENDED'
          ? null
          : ((
              await prisma.auditLog.findFirst({
                where: { entityType: 'user', entityId: userId, action: 'ACCOUNT_SUSPENDED' },
                orderBy: { createdAt: 'desc' },
                select: { reason: true },
              })
            )?.reason ?? null),
    }
  },

  /**
   * Suspend or restore.
   *
   * `updateMany` with the expected status in the WHERE clause. Two operators pressing suspend at
   * the same moment produce one change and one loser who is told the account was not active,
   * rather than two audit lines claiming two suspensions.
   */
  async setUserStatus(input) {
    const from = input.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'

    const affected = await prisma.user.updateMany({
      where: { id: input.userId, status: from },
      data: { status: input.status, updatedAt: input.now },
    })

    return affected.count > 0
  },

  async permissionsFor(userId) {
    const rows = await prisma.adminPermissionGrant.findMany({
      where: { userId, revokedAt: null },
      select: { permission: true },
    })
    return rows.map((row) => row.permission as AdminPermission)
  },

  /**
   * Grant one.
   *
   * The insert is attempted directly. The partial unique index on live grants is what arbitrates a
   * double-grant, and a read-then-write check would lose that race with itself — leaving somebody
   * holding two rows for one permission, of which revoking one appears to do nothing.
   */
  async grantPermission(input) {
    try {
      await prisma.adminPermissionGrant.create({
        data: {
          userId: input.userId,
          permission: input.permission as never,
          grantedById: input.grantedById,
          grantedAt: input.now,
        },
      })
      return true
    } catch {
      // Already held, or the self-grant CHECK refused it. Both mean "no change".
      return false
    }
  },

  /**
   * Revoke one.
   *
   * A timestamp, never a delete. "Who could decrypt identity numbers last March?" is a question an
   * incident review will ask, and a row that was removed cannot answer it.
   */
  async revokePermission(input) {
    const affected = await prisma.adminPermissionGrant.updateMany({
      where: { userId: input.userId, permission: input.permission as never, revokedAt: null },
      data: {
        revokedAt: input.now,
        revokedById: input.revokedById,
        revokeReason: input.reason,
      },
    })
    return affected.count > 0
  },

  async auditLog(filter): Promise<Page<AuditEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.actorUserId === undefined || filter.actorUserId === ''
        ? {}
        : { actorUserId: filter.actorUserId }),
      ...(filter.action === undefined || filter.action === '' ? {} : { action: filter.action }),
      ...(filter.entityType === undefined || filter.entityType === ''
        ? {}
        : { entityType: filter.entityType }),
      ...(filter.entityId === undefined || filter.entityId === ''
        ? {}
        : { entityId: filter.entityId }),
    }

    const limit = filter.limit ?? 20
    const offset = filter.offset ?? 0

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        /*
         * `before` and `after` are deliberately not selected.
         *
         * Those columns can hold whatever a past write put there, which is exactly the shape of
         * thing that should not be rendered onto a screen by default. An investigation that needs
         * them is a deliberate query, not a page of the log.
         */
        select: {
          id: true,
          actorUserId: true,
          action: true,
          entityType: true,
          entityId: true,
          reason: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ])

    return { items: rows, total, limit, offset }
  },
}
