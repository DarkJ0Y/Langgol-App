/**
 * Account and role integration tests.
 *
 * These check the half of Phase 1 that the unit tests structurally cannot: the constraints,
 * indexes and foreign keys that hold even when the application layer is bypassed. A CHECK is only
 * a guarantee if it is actually in the database, and the only way to know is to try to break it.
 *
 * Skipped unless a real database is configured — see database.test.ts for the run instructions.
 *
 * Refs: docs/07_SECURITY.md §4.1, §4.3, §10
 */

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import { ROLES, isPrivilegedRole, isSelfSelectableRole } from '@langgol/domain/identity'
import { accountRepository } from '../repositories/account.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()

/** Reserved for these tests, well clear of the development-fixture block at ...0001-0009. */
const TEST_PHONE = '+8801796000001'
const ADMIN_PHONE = '+8801796000002'

afterAll(async () => {
  await prisma.$disconnect()
})

/** A throwaway user and an admin to act on them, both removed afterwards. */
async function withUsers(
  body: (subjectId: string, adminId: string) => Promise<void>,
): Promise<void> {
  const subject = await prisma.user.create({
    data: { phone: TEST_PHONE, fullName: 'Role Integration Subject' },
  })
  const admin = await prisma.user.create({
    data: { phone: ADMIN_PHONE, fullName: 'Role Integration Admin' },
  })

  try {
    await body(subject.id, admin.id)
  } finally {
    // Role rows cascade from the SUBJECT, but the admin is only referenced as a grantor, and that
    // reference is RESTRICT. Clear the assignments before deleting either account.
    await prisma.userRoleAssignment.deleteMany({
      where: { userId: { in: [subject.id, admin.id] } },
    })
    await prisma.user.deleteMany({ where: { id: { in: [subject.id, admin.id] } } })
  }
}

suite('the role catalogue matches the code', () => {
  it('has exactly one seeded definition per role the domain knows', async () => {
    // Three places name roles — the Prisma enum, the domain catalogue and this table. A role in
    // one but not another can be held and never labelled, or offered and never granted.
    const rows = await prisma.roleDefinition.findMany({ select: { role: true } })
    expect(rows.map((row) => row.role).sort()).toEqual([...ROLES].sort())
  })

  it('agrees with the domain about which roles a user may pick for themselves', async () => {
    // The server-side allowlist is the boundary, but a table that disagreed with it would put
    // the wrong choices on the signup screen.
    const rows = await prisma.roleDefinition.findMany({
      select: { role: true, selfSelectable: true, privileged: true },
    })
    for (const row of rows) {
      expect(row.selfSelectable).toBe(isSelfSelectableRole(row.role))
      expect(row.privileged).toBe(isPrivilegedRole(row.role))
    }
  })

  it('never marks a privileged role as self-selectable', async () => {
    const wrong = await prisma.roleDefinition.findMany({
      where: { privileged: true, selfSelectable: true },
    })
    expect(wrong).toEqual([])
  })
})

suite('role assignment constraints', () => {
  it('refuses a second row for the same user and role', async () => {
    await withUsers(async (subjectId) => {
      await prisma.userRoleAssignment.create({ data: { userId: subjectId, role: 'FARMER' } })
      await expect(
        prisma.userRoleAssignment.create({ data: { userId: subjectId, role: 'FARMER' } }),
      ).rejects.toThrow()
    })
  })

  it('refuses a revocation that names nobody', async () => {
    // An unexplained, unattributed revocation can lock a farmer out of their own listings. The
    // application checks this too; the database is what makes it true regardless of caller.
    await withUsers(async (subjectId) => {
      const row = await prisma.userRoleAssignment.create({
        data: { userId: subjectId, role: 'FARMER' },
      })
      await expect(
        prisma.userRoleAssignment.update({
          where: { id: row.id },
          data: { revokedAt: new Date() },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a revocation whose reason is only whitespace', async () => {
    await withUsers(async (subjectId, adminId) => {
      const row = await prisma.userRoleAssignment.create({
        data: { userId: subjectId, role: 'FARMER' },
      })
      await expect(
        prisma.userRoleAssignment.update({
          where: { id: row.id },
          data: { revokedAt: new Date(), revokedById: adminId, revokeReason: '   ' },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses attribution to a user who does not exist', async () => {
    await withUsers(async (subjectId) => {
      await expect(
        prisma.userRoleAssignment.create({
          data: {
            userId: subjectId,
            role: 'FARMER',
            grantedById: '00000000-0000-4000-8000-000000000000',
          },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses to delete an administrator whose grants are still on record', async () => {
    // RESTRICT, not CASCADE. Deleting the grantor must not silently erase the record of who made
    // whom a wholesaler.
    await withUsers(async (subjectId, adminId) => {
      await prisma.userRoleAssignment.create({
        data: { userId: subjectId, role: 'WHOLESALER', grantedById: adminId },
      })
      await expect(prisma.user.delete({ where: { id: adminId } })).rejects.toThrow()
    })
  })
})

suite('user profile constraints', () => {
  it('refuses a blank name', async () => {
    await expect(
      prisma.user.create({ data: { phone: '+8801796000003', fullName: '   ' } }),
    ).rejects.toThrow()
  })

  it('refuses a mixed-case email, so the unique index cannot be evaded', async () => {
    // Rahim@Example.com and rahim@example.com must not be able to become two accounts.
    await expect(
      prisma.user.create({
        data: { phone: '+8801796000004', fullName: 'Case Test', email: 'Rahim@Example.com' },
      }),
    ).rejects.toThrow()
  })

  it('refuses an implausible date of birth', async () => {
    await expect(
      prisma.user.create({
        data: {
          phone: '+8801796000005',
          fullName: 'Date Test',
          dateOfBirth: new Date('1823-01-01T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow()
  })

  it('starts a new account at REGISTERED rather than claiming setup it has not done', async () => {
    const user = await prisma.user.create({
      data: { phone: '+8801796000006', fullName: 'Default Test' },
    })
    try {
      expect(user.onboardingStatus).toBe('REGISTERED')
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })
})

suite('the account repository against real SQL', () => {
  it('grants, lists, revokes and re-grants without ever losing the history', async () => {
    await withUsers(async (subjectId, adminId) => {
      const at = new Date()

      const granted = await accountRepository.assignRole({
        userId: subjectId,
        role: 'WHOLESALER',
        grantedById: adminId,
        at,
      })
      expect(granted.added).toBe(true)
      expect(granted.roles).toContain('WHOLESALER')

      // Granting again is idempotent, not a conflict — an administrator may double-click.
      const again = await accountRepository.assignRole({
        userId: subjectId,
        role: 'WHOLESALER',
        grantedById: adminId,
        at,
      })
      expect(again.added).toBe(false)

      const revoked = await accountRepository.revokeRole({
        userId: subjectId,
        role: 'WHOLESALER',
        revokedById: adminId,
        reason: 'Trade licence expired',
        at,
      })
      expect(revoked.removed).toBe(true)
      expect(revoked.roles).not.toContain('WHOLESALER')

      // A revoked assignment must never leak into a role list — that would be a live privilege
      // with a paper trail saying it was removed.
      const live = await accountRepository.listRolesFor(subjectId)
      expect(live.map((entry) => entry.role)).not.toContain('WHOLESALER')

      // But the row is still there, still saying who took it away and why.
      const history = await prisma.userRoleAssignment.findMany({ where: { userId: subjectId } })
      expect(history).toHaveLength(1)
      expect(history[0]?.revokedById).toBe(adminId)
      expect(history[0]?.revokeReason).toBe('Trade licence expired')

      // Re-granting reactivates that same row rather than starting a second story.
      const regranted = await accountRepository.assignRole({
        userId: subjectId,
        role: 'WHOLESALER',
        grantedById: adminId,
        at,
      })
      expect(regranted.added).toBe(true)
      expect(await prisma.userRoleAssignment.count({ where: { userId: subjectId } })).toBe(1)
    })
  })

  it('reports a second revoke as a no-op instead of overwriting the first revoker', async () => {
    await withUsers(async (subjectId, adminId) => {
      const at = new Date()
      await accountRepository.assignRole({
        userId: subjectId,
        role: 'SUPPLIER',
        grantedById: adminId,
        at,
      })
      await accountRepository.revokeRole({
        userId: subjectId,
        role: 'SUPPLIER',
        revokedById: adminId,
        reason: 'First reason',
        at,
      })

      const second = await accountRepository.revokeRole({
        userId: subjectId,
        role: 'SUPPLIER',
        revokedById: adminId,
        reason: 'Second reason',
        at,
      })
      expect(second.removed).toBe(false)

      const row = await prisma.userRoleAssignment.findFirst({
        where: { userId: subjectId, role: 'SUPPLIER' },
      })
      expect(row?.revokeReason).toBe('First reason')
    })
  })

  it('holds several roles at once', async () => {
    await withUsers(async (subjectId, adminId) => {
      const at = new Date()
      for (const role of ['FARMER', 'RETAILER', 'LOGISTICS_PROVIDER'] as const) {
        await accountRepository.assignRole({ userId: subjectId, role, grantedById: adminId, at })
      }

      const profile = await accountRepository.findProfile(subjectId)
      expect([...(profile?.roles ?? [])].sort()).toEqual([
        'FARMER',
        'LOGISTICS_PROVIDER',
        'RETAILER',
      ])
    })
  })

  it('writes only the fields it was given', async () => {
    await withUsers(async (subjectId) => {
      const before = await accountRepository.findProfile(subjectId)
      const updated = await accountRepository.updateProfile(subjectId, { gender: 'FEMALE' })

      expect(updated?.gender).toBe('FEMALE')
      // The name it was not asked to touch is untouched, in the SQL and not merely in the object.
      expect(updated?.fullName).toBe(before?.fullName)
      expect(updated?.email).toBeNull()
    })
  })

  it('does not find a soft-deleted account', async () => {
    // `deletedAt: null` belongs in the WHERE clause. Fetching and then filtering is the version
    // of this that leaks.
    await withUsers(async (subjectId) => {
      await prisma.user.update({ where: { id: subjectId }, data: { deletedAt: new Date() } })
      expect(await accountRepository.findProfile(subjectId)).toBeNull()
      await prisma.user.update({ where: { id: subjectId }, data: { deletedAt: null } })
    })
  })
})
