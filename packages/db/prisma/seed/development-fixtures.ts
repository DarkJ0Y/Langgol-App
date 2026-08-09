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

import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import type { PrismaClient, Role } from '../../generated/client/index.js'

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

  return { created, existing, skipped: false }
}
