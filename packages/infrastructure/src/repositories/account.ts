/**
 * Prisma-backed account and role repository.
 *
 * Two things are load-bearing here and easy to get wrong elsewhere:
 *
 *  - **Role history is kept, not overwritten.** Revoking sets `revokedAt`, a revoker and a reason
 *    rather than deleting the row, so "who made this person an administrator, and who took it
 *    away?" stays answerable. Re-granting a previously revoked role reactivates that row.
 *  - **Every read filters `revokedAt: null`.** A revoked assignment that leaked into a session's
 *    role list would be a live privilege with a paper trail saying it was removed.
 *
 * Refs: docs/07_SECURITY.md §4.3, §10
 */

import { prisma, type $Enums } from '@langgol/db'
import type {
  AccountRepository,
  RoleAssignmentRecord,
  RoleDefinitionRecord,
  UserProfileRecord,
} from '@langgol/application'

/*
 * The generated enums, not hand-written unions. The port speaks `string` because the application
 * layer must not depend on Prisma; the cast happens here, at the boundary, against the type the
 * database actually generated. A union maintained by hand drifts silently the moment a role is
 * added — which is exactly what these casts would then be lying about.
 */
type Role = $Enums.Role
type Gender = $Enums.Gender
type OnboardingStatus = $Enums.OnboardingStatus

/** The columns the account surface reads. Never `select: *`. */
const PROFILE_SELECT = {
  id: true,
  phone: true,
  phoneVerifiedAt: true,
  email: true,
  emailVerifiedAt: true,
  fullName: true,
  preferredLanguage: true,
  status: true,
  onboardingStatus: true,
  profilePhotoKey: true,
  dateOfBirth: true,
  gender: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    where: { revokedAt: null },
    select: { role: true },
    orderBy: { grantedAt: 'asc' },
  },
} as const

interface ProfileRow {
  id: string
  phone: string
  phoneVerifiedAt: Date | null
  email: string | null
  emailVerifiedAt: Date | null
  fullName: string
  preferredLanguage: string
  status: string
  onboardingStatus: string
  profilePhotoKey: string | null
  dateOfBirth: Date | null
  gender: string | null
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
  roles: { role: string }[]
}

function toProfile(row: ProfileRow): UserProfileRecord {
  return {
    id: row.id,
    phone: row.phone,
    phoneVerifiedAt: row.phoneVerifiedAt,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    fullName: row.fullName,
    preferredLanguage: row.preferredLanguage as 'BN' | 'EN',
    status: row.status as 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED',
    onboardingStatus: row.onboardingStatus,
    profilePhotoKey: row.profilePhotoKey,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    roles: row.roles.map((assignment) => assignment.role),
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const accountRepository: AccountRepository = {
  async findProfile(userId) {
    // `deletedAt: null` is in the WHERE clause: a soft-deleted account is not found, not found
    // and then filtered.
    const row = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: PROFILE_SELECT,
    })
    return row ? toProfile(row as unknown as ProfileRow) : null
  },

  async updateProfile(userId, changes) {
    const existing = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    })
    if (!existing) return null

    const row = await prisma.user.update({
      where: { id: userId },
      // Spread only the keys present, so a partial update stays partial all the way to the SQL.
      data: {
        ...(changes.fullName !== undefined ? { fullName: changes.fullName } : {}),
        /*
         * Changing the address retracts the proof in the same statement that changes it. The
         * verification was evidence about the OLD address; carrying it over would mark an
         * address nobody has ever proven as verified, which is worse than having no signal at
         * all because something downstream would trust it.
         */
        ...(changes.email !== undefined ? { email: changes.email, emailVerifiedAt: null } : {}),
        ...(changes.preferredLanguage !== undefined
          ? { preferredLanguage: changes.preferredLanguage }
          : {}),
        ...(changes.dateOfBirth !== undefined ? { dateOfBirth: changes.dateOfBirth } : {}),
        ...(changes.gender !== undefined ? { gender: changes.gender as Gender | null } : {}),
        ...(changes.profilePhotoKey !== undefined
          ? { profilePhotoKey: changes.profilePhotoKey }
          : {}),
        ...(changes.onboardingStatus !== undefined
          ? { onboardingStatus: changes.onboardingStatus as OnboardingStatus }
          : {}),
      },
      select: PROFILE_SELECT,
    })
    return toProfile(row as unknown as ProfileRow)
  },

  /**
   * Stamp the address as proven, but only if it is still the address that was proven.
   *
   * The `email` value is in the WHERE clause, not compared afterwards. A user who changed their
   * address between requesting a link and clicking it updates zero rows and gets `false` — the
   * proof does not transfer to whatever address the account holds now.
   */
  async markEmailVerified({ userId, email, at }) {
    const result = await prisma.user.updateMany({
      where: { id: userId, email, deletedAt: null },
      data: { emailVerifiedAt: at },
    })
    return result.count > 0
  },

  async listRoleDefinitions(): Promise<readonly RoleDefinitionRecord[]> {
    const rows = await prisma.roleDefinition.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
    return rows.map((row) => ({
      role: row.role,
      nameBn: row.nameBn,
      nameEn: row.nameEn,
      descriptionBn: row.descriptionBn,
      descriptionEn: row.descriptionEn,
      selfSelectable: row.selfSelectable,
      privileged: row.privileged,
      sortOrder: row.sortOrder,
    }))
  },

  async listRolesFor(userId): Promise<readonly RoleAssignmentRecord[]> {
    const rows = await prisma.userRoleAssignment.findMany({
      where: { userId, revokedAt: null },
      orderBy: { grantedAt: 'asc' },
      select: { role: true, grantedAt: true, grantedById: true },
    })
    return rows.map((row) => ({
      role: row.role,
      grantedAt: row.grantedAt,
      grantedById: row.grantedById,
      // A null grantor means the user picked it at signup; docs/07 §4.1 makes that distinction.
      selfSelected: row.grantedById === null,
    }))
  },

  async assignRole(input) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.userRoleAssignment.findUnique({
        where: { userId_role: { userId: input.userId, role: input.role as Role } },
        select: { id: true, revokedAt: true },
      })

      let added = false

      if (!existing) {
        await tx.userRoleAssignment.create({
          data: {
            userId: input.userId,
            role: input.role as Role,
            grantedById: input.grantedById,
            grantedAt: input.at,
          },
        })
        added = true
      } else if (existing.revokedAt !== null) {
        /*
         * Reactivate rather than insert a second row. The (user_id, role) unique index forbids a
         * duplicate anyway, and keeping one row per pairing means the grant/revoke history reads
         * as a single story instead of a pile of fragments.
         */
        await tx.userRoleAssignment.update({
          where: { id: existing.id },
          data: {
            revokedAt: null,
            revokedById: null,
            revokeReason: null,
            grantedById: input.grantedById,
            grantedAt: input.at,
          },
        })
        added = true
      }
      // else: already held and live. Idempotent — added stays false.

      const roles = await tx.userRoleAssignment.findMany({
        where: { userId: input.userId, revokedAt: null },
        select: { role: true },
        orderBy: { grantedAt: 'asc' },
      })

      return { roles: roles.map((row) => row.role), added }
    })
  },

  async revokeRole(input) {
    return await prisma.$transaction(async (tx) => {
      /*
       * Conditional on `revokedAt: null`, so a concurrent second revoke updates zero rows and
       * reports `removed: false` rather than overwriting the first revoker's reason.
       */
      const affected = await tx.userRoleAssignment.updateMany({
        where: { userId: input.userId, role: input.role as Role, revokedAt: null },
        data: {
          revokedAt: input.at,
          revokedById: input.revokedById,
          revokeReason: input.reason,
        },
      })

      const roles = await tx.userRoleAssignment.findMany({
        where: { userId: input.userId, revokedAt: null },
        select: { role: true },
        orderBy: { grantedAt: 'asc' },
      })

      return { roles: roles.map((row) => row.role), removed: affected.count > 0 }
    })
  },
}
