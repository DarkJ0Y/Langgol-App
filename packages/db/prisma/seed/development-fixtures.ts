/**
 * Development authentication fixtures.
 *
 * Created ONLY outside production, and only from the closed allowlist in the domain. The
 * database CHECK constraint confines the fixture flag to a reserved phone block, so even a
 * mistake here cannot flag a real user's row.
 *
 * These rows are the *only* accounts development sign-in can authenticate.
 *
 * Refs: docs/03_ARCHITECTURE.md ADR-22
 */

import { DEMO_IDENTITY_KEY, DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import { AdminPermission, type PrismaClient, type Role } from '../../generated/client/index.js'

export interface FixtureSeedResult {
  readonly created: number
  readonly existing: number
  readonly skipped: boolean
}

export async function seedDevelopmentFixtures(
  prisma: PrismaClient,
  appEnv: string,
): Promise<FixtureSeedResult> {
  if (appEnv === 'production') {
    // Not an error — the seed is expected to run in production for reference data. It simply
    // must never create a fixture there.
    return { created: 0, existing: 0, skipped: true }
  }

  let created = 0
  let existing = 0

  for (const identity of DEVELOPMENT_IDENTITIES) {
    const found = await prisma.user.findUnique({
      where: { phone: identity.phone },
      select: { id: true },
    })

    if (found) {
      existing += 1
      continue
    }

    await prisma.user.create({
      data: {
        phone: identity.phone,
        fullName: identity.fullName,
        preferredLanguage: identity.preferredLanguage,
        phoneVerifiedAt: new Date(),
        isDevelopmentFixture: true,
        roles: { create: identity.roles.map((role) => ({ role: role as Role })) },
      },
    })
    created += 1
  }

  await grantDemoPermissions(prisma)

  return { created, existing, skipped: false }
}

/**
 * Every admin permission for the all-features demo account, granted by Dev Admin.
 *
 * Granted by ANOTHER administrator because the database requires it — `admin_permission_granted_by_
 * another` forbids a grant to oneself — and the record should say truthfully who did it. Dev Admin
 * then receives the same set from the demo account, so both fixtures can open every admin screen.
 * Idempotent: a permission already live is left alone, so re-seeding never duplicates a grant.
 */
async function grantDemoPermissions(prisma: PrismaClient): Promise<void> {
  const byKey = async (key: string) => {
    const identity = DEVELOPMENT_IDENTITIES.find((candidate) => candidate.key === key)
    if (identity === undefined) return null
    return prisma.user.findUnique({ where: { phone: identity.phone }, select: { id: true } })
  }

  const demo = await byKey(DEMO_IDENTITY_KEY)
  const admin = await byKey('admin')
  if (demo === null || admin === null) return

  const pairs: readonly (readonly [string, string])[] = [
    [demo.id, admin.id],
    [admin.id, demo.id],
  ]

  for (const [userId, grantedById] of pairs) {
    for (const permission of Object.values(AdminPermission)) {
      const live = await prisma.adminPermissionGrant.findFirst({
        where: { userId, permission, revokedAt: null },
        select: { id: true },
      })
      if (live === null) {
        await prisma.adminPermissionGrant.create({ data: { userId, permission, grantedById } })
      }
    }
  }
}
