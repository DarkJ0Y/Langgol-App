/**
 * Role definitions — reference data, seeded in every environment including production.
 *
 * Unlike the development fixtures, this is not activity data: it is the label set for an enum the
 * code already knows about, and the signup screen cannot render without it.
 *
 * Seeded from `ROLE_CATALOGUE` in the domain rather than a literal list here, so there is exactly
 * one place a role's name is written. Upserted rather than created-if-absent, because a corrected
 * translation should reach an environment that already ran the seed — these rows are labels, not
 * history, and unlike `PlatformConfig` they carry no versioning obligation.
 *
 * Refs: packages/domain/src/identity/roles.ts; docs/02_DATABASE.md §15
 */

import { ROLE_CATALOGUE } from '@langgol/domain/identity'
import type { PrismaClient, Role } from '../../generated/client/index.js'

export interface RoleSeedResult {
  readonly created: number
  readonly updated: number
}

export async function seedRoleDefinitions(prisma: PrismaClient): Promise<RoleSeedResult> {
  let created = 0
  let updated = 0

  for (const descriptor of ROLE_CATALOGUE) {
    const existing = await prisma.roleDefinition.findUnique({
      where: { role: descriptor.role as Role },
      select: { role: true },
    })

    const values = {
      nameBn: descriptor.nameBn,
      nameEn: descriptor.nameEn,
      descriptionBn: descriptor.descriptionBn,
      descriptionEn: descriptor.descriptionEn,
      selfSelectable: descriptor.selfSelectable,
      privileged: descriptor.privileged,
      sortOrder: descriptor.sortOrder,
      isActive: true,
    }

    await prisma.roleDefinition.upsert({
      where: { role: descriptor.role as Role },
      update: values,
      create: { role: descriptor.role as Role, ...values },
    })

    if (existing) updated += 1
    else created += 1
  }

  return { created, updated }
}
