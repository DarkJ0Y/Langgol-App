/**
 * Seed reference data.
 *
 * Idempotent: safe to run repeatedly against the same database. Seeds only **reference** data —
 * administrative geography and platform configuration. It never creates users, listings or
 * transactions, so there is no path by which fake activity reaches an environment and then a
 * report.
 *
 * Usage: pnpm db:seed
 */

import { Prisma, PrismaClient, type AdminAreaType } from '../../generated/client/index.js'
import { DIVISIONS, type AreaSeed } from './admin-areas.js'
import { PLATFORM_CONFIG_V1 } from './platform-config.js'
import { seedDevelopmentFixtures } from './development-fixtures.js'
import { CATALOGUE } from './catalogue.js'
import { seedDevelopmentMarketplace } from './development-marketplace.js'

const prisma = new PrismaClient()

const LEVELS: readonly AdminAreaType[] = ['DIVISION', 'DISTRICT', 'UPAZILA', 'UNION']

async function seedAreas(
  areas: readonly AreaSeed[],
  depth: number,
  parentId: string | null,
): Promise<{ created: number; existing: number }> {
  const type = LEVELS[depth]
  if (type === undefined) throw new Error(`Administrative depth ${depth} is beyond UNION`)

  let created = 0
  let existing = 0

  for (const area of areas) {
    // Names are unique within a parent, which is what makes this idempotent without inventing
    // synthetic keys. Official statistical codes are loaded later with the centroid data.
    const found = await prisma.adminArea.findFirst({
      where: { type, parentId, nameEn: area.nameEn },
      select: { id: true },
    })

    let id: string
    if (found) {
      id = found.id
      existing += 1
    } else {
      const inserted = await prisma.adminArea.create({
        data: { type, parentId, nameEn: area.nameEn, nameBn: area.nameBn },
        select: { id: true },
      })
      id = inserted.id
      created += 1
    }

    if (area.children && area.children.length > 0) {
      const child = await seedAreas(area.children, depth + 1, id)
      created += child.created
      existing += child.existing
    }
  }

  return { created, existing }
}

async function seedPlatformConfig(): Promise<{ created: number; existing: number }> {
  let created = 0
  let existing = 0

  for (const entry of PLATFORM_CONFIG_V1) {
    // Published configuration is immutable history (see the database guarantees migration), so
    // a re-run must never attempt to update an existing version.
    const found = await prisma.platformConfig.findUnique({
      where: { key_version: { key: entry.key, version: 1 } },
      select: { id: true },
    })

    if (found) {
      existing += 1
      continue
    }

    await prisma.platformConfig.create({
      data: {
        key: entry.key,
        version: 1,
        value:
          entry.value === undefined || entry.value === null
            ? Prisma.JsonNull
            : (entry.value as Prisma.InputJsonValue),
        // Effective immediately. A hard-coded date is a trap: seeded ahead of UTC "now" the
        // row loads as not-yet-effective and the app boots with NO configuration at all.
        effectiveFrom: new Date(),
        note: entry.note,
      },
    })
    created += 1
  }

  return { created, existing }
}

/**
 * The curated catalogue is reference data, like the administrative tree: it belongs in every
 * environment, including production. Farmers select from it rather than typing free text.
 */
async function seedCatalogue(): Promise<{ created: number; existing: number }> {
  let created = 0
  let existing = 0

  for (const category of CATALOGUE) {
    const savedCategory = await prisma.productCategory.upsert({
      where: { slug: category.slug },
      update: { nameEn: category.nameEn, nameBn: category.nameBn, sortOrder: category.sortOrder },
      create: {
        slug: category.slug,
        nameEn: category.nameEn,
        nameBn: category.nameBn,
        sortOrder: category.sortOrder,
      },
      select: { id: true },
    })

    for (const product of category.products) {
      const found = await prisma.product.findUnique({
        where: { slug: product.slug },
        select: { id: true },
      })
      if (found) {
        existing += 1
        continue
      }

      await prisma.product.create({
        data: {
          categoryId: savedCategory.id,
          slug: product.slug,
          nameEn: product.nameEn,
          nameBn: product.nameBn,
          searchTerms: [...product.searchTerms],
          baseUnit: product.baseUnit,
          defaultSaleUnit: product.defaultSaleUnit,
          perishability: product.perishability,
          defaultShelfLifeHours: product.defaultShelfLifeHours,
        },
      })
      created += 1
    }
  }

  return { created, existing }
}

async function main(): Promise<void> {
  console.log('Seeding Langgol reference data…')

  const areas = await seedAreas(DIVISIONS, 0, null)
  console.log(`  admin areas:      ${areas.created} created, ${areas.existing} already present`)

  const config = await seedPlatformConfig()
  console.log(`  platform config:  ${config.created} created, ${config.existing} already present`)

  const catalogue = await seedCatalogue()
  console.log(
    `  catalogue:        ${catalogue.created} created, ${catalogue.existing} already present`,
  )

  const appEnv = process.env['APP_ENV'] ?? 'development'
  const fixtures = await seedDevelopmentFixtures(prisma, appEnv)
  if (fixtures.skipped) {
    console.log('  dev fixtures:     skipped (APP_ENV=production)')
  } else {
    console.log(
      `  dev fixtures:     ${fixtures.created} created, ${fixtures.existing} already present`,
    )
  }

  const marketplace = await seedDevelopmentMarketplace(prisma, appEnv)
  if (marketplace.skipped) {
    console.log('  dev marketplace:  skipped (APP_ENV=production)')
  } else {
    console.log(
      `  dev marketplace:  ${marketplace.created} created, ${marketplace.existing} already present`,
    )
  }

  const withoutCentroid = await prisma.adminArea.count({ where: { centroidLat: null } })
  if (withoutCentroid > 0) {
    console.warn(
      `\n  ⚠  ${withoutCentroid} administrative areas have no centroid.\n` +
        '     Centroids are NOT seeded on purpose: inventing coordinates would make every\n' +
        '     distance, delivery quote and radius search silently wrong while appearing to work.\n' +
        '     Load them from an authoritative source as a P0 data task before any distance-based\n' +
        '     pricing is trusted. See prisma/seed/admin-areas.ts.\n',
    )
  }

  const unsetConfig = await prisma.platformConfig.findMany({
    where: { value: { equals: Prisma.JsonNull } },
    select: { key: true },
  })
  if (unsetConfig.length > 0) {
    console.warn(
      `  ⚠  Configuration keys awaiting a product decision: ${unsetConfig
        .map((row) => row.key)
        .join(', ')}\n` +
        '     Code paths that need these refuse to proceed rather than assuming a value.\n',
    )
  }

  console.log('Seed complete.')
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
