/**
 * Development marketplace fixtures — a farm, listings and a buyer address.
 *
 * Created **only** outside production, exactly like the authentication fixtures, and hung off the
 * same closed allowlist of development identities. The seed's standing rule is that it never
 * creates activity data that could reach an environment and then a report; this file keeps that
 * rule by refusing to run when `APP_ENV=production`.
 *
 * **On the coordinates.** `admin-areas.ts` deliberately seeds no centroids, because inventing
 * them would make every distance and delivery quote silently wrong while appearing to work. The
 * coordinates here are different in kind: they are the location of a *fixture* farm and a
 * *fixture* address, not a claim about where Shibganj is. They are real points on the
 * Shibganj–Bogura corridor so the delivered-cost engine has something honest to price, and they
 * exist only in development.
 *
 * Refs: docs/03_ARCHITECTURE.md ADR-22; docs/02_DATABASE.md §15
 */

import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import type { PrismaClient } from '../../generated/client/index.js'

export interface MarketplaceSeedResult {
  readonly created: number
  readonly existing: number
  readonly skipped: boolean
}

/** Shibganj, Bogura — where the nearby fixture farm sits. */
const FARM_LOCATION = { latitude: 24.9505, longitude: 89.3016 }
/** Bogura town — where the fixture buyers receive deliveries. About 12 km from Shibganj. */
const BUYER_LOCATION = { latitude: 24.8465, longitude: 89.3776 }
/**
 * Rangpur, roughly 120 km north — the "Farmer B" of the docs/04 §7 worked example.
 *
 * Cheaper at the farm gate and dearer to deliver, so the delivered-cost engine has a genuine
 * trade-off to resolve rather than a single option to rubber-stamp. This is what makes the
 * ranking demonstrable at all.
 */
const DISTANT_FARM_LOCATION = { latitude: 25.7439, longitude: 89.2752 }

const KG = 1000000n

interface ListingSeed {
  readonly productSlug: string
  readonly title: string
  readonly grade: 'A' | 'B' | 'C' | 'UNGRADED'
  readonly takaPerKg: string
  readonly totalKg: number
  readonly allowsPartialFill: boolean
}

const LISTINGS: readonly ListingSeed[] = [
  {
    productSlug: 'tomato',
    title: 'Fresh tomato, picked this morning',
    grade: 'A',
    takaPerKg: '30.00',
    totalKg: 200,
    allowsPartialFill: false,
  },
  {
    productSlug: 'tomato',
    title: 'Tomato, grade B',
    grade: 'B',
    takaPerKg: '24.00',
    totalKg: 120,
    allowsPartialFill: true,
  },
  {
    productSlug: 'potato',
    title: 'Potato from cold store',
    grade: 'A',
    takaPerKg: '22.00',
    totalKg: 500,
    allowsPartialFill: true,
  },
  {
    productSlug: 'brinjal',
    title: 'Long brinjal',
    grade: 'A',
    takaPerKg: '40.00',
    totalKg: 80,
    allowsPartialFill: false,
  },
]

/** Parse a taka string to integer poisha. The seed may state prices the way a human does. */
function poishaFromTaka(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole ?? '0') * 100n + BigInt((fraction + '00').slice(0, 2))
}

/**
 * Put a fixture listing back on sale once its window has closed.
 *
 * Listings are created with a 30-day window, and the market shows only those still inside it. The
 * seed is idempotent, so without this a second run a month later skipped every fixture as
 * "already present" and the development market quietly emptied — which looks exactly like a
 * broken market page. Renewed only when lapsed, so a run inside the window changes nothing.
 * Fixtures only: this module refuses to run when APP_ENV=production.
 */
async function keepOnSale(
  prisma: PrismaClient,
  listingId: string,
  now: Date,
  availableTo: Date,
): Promise<void> {
  await prisma.listing.updateMany({
    where: { id: listingId, availableTo: { lt: now } },
    data: { availableFrom: now, availableTo },
  })
}

export async function seedDevelopmentMarketplace(
  prisma: PrismaClient,
  appEnv: string,
): Promise<MarketplaceSeedResult> {
  if (appEnv === 'production') {
    return { created: 0, existing: 0, skipped: true }
  }

  let created = 0
  let existing = 0

  const farmerIdentity = DEVELOPMENT_IDENTITIES.find((identity) => identity.key === 'farmer')
  const consumerIdentity = DEVELOPMENT_IDENTITIES.find((identity) => identity.key === 'consumer')
  if (!farmerIdentity || !consumerIdentity) {
    throw new Error('Development identities for farmer and consumer are required')
  }

  const farmerUser = await prisma.user.findUnique({ where: { phone: farmerIdentity.phone } })
  const consumerUser = await prisma.user.findUnique({ where: { phone: consumerIdentity.phone } })
  if (!farmerUser || !consumerUser) {
    throw new Error('Development auth fixtures must be seeded before the marketplace fixtures')
  }

  /* ------------------------------------------------------------------ farmer profile */

  let farmer = await prisma.farmerProfile.findUnique({ where: { userId: farmerUser.id } })
  if (!farmer) {
    farmer = await prisma.farmerProfile.create({
      data: {
        userId: farmerUser.id,
        displayName: 'Rahim Uddin',
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        // A fulfilment record, so ranking has something other than the cold-start prior to work
        // with. Deliberately imperfect: 20 of 22 accepted orders completed.
        ordersAccepted: 22,
        ordersCompleted: 20,
        ratingSumStarsMilli: 40000,
        ratingCount: 10,
      },
    })
    created += 1
  } else {
    existing += 1
  }

  /* --------------------------------------------------------------------------- farm */

  // Any union or upazila under Bogura will do for the fixture; the tree is seeded by area order.
  const area = await prisma.adminArea.findFirst({
    where: { type: 'DISTRICT', nameEn: 'Bogura' },
    select: { id: true },
  })
  const fallbackArea = area ?? (await prisma.adminArea.findFirst({ select: { id: true } }))
  if (!fallbackArea) throw new Error('Administrative areas must be seeded first')

  let farm = await prisma.farm.findFirst({
    where: { farmerProfileId: farmer.id, name: "Rahim's Farm" },
  })
  if (!farm) {
    farm = await prisma.farm.create({
      data: {
        farmerProfileId: farmer.id,
        name: "Rahim's Farm",
        adminAreaId: fallbackArea.id,
        villageOrArea: 'Shibganj',
        latitude: FARM_LOCATION.latitude,
        longitude: FARM_LOCATION.longitude,
        precision: 'APPROXIMATE',
      },
    })
    created += 1
  } else {
    existing += 1
  }

  /* ----------------------------------------------------------------------- listings */

  const now = new Date()
  const availableTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  for (const seed of LISTINGS) {
    const product = await prisma.product.findUnique({ where: { slug: seed.productSlug } })
    if (!product) throw new Error(`Catalogue product "${seed.productSlug}" must be seeded first`)

    const found = await prisma.listing.findFirst({
      where: { farmId: farm.id, productId: product.id, grade: seed.grade, deletedAt: null },
      select: { id: true },
    })
    if (found) {
      await keepOnSale(prisma, found.id, now, availableTo)
      existing += 1
      continue
    }

    const totalBase = BigInt(seed.totalKg) * KG
    await prisma.listing.create({
      data: {
        farmId: farm.id,
        farmerProfileId: farmer.id,
        productId: product.id,
        grade: seed.grade,
        title: seed.title,
        saleUnit: 'KG',
        saleUnitInBaseUnits: KG,
        unitPricePoisha: poishaFromTaka(seed.takaPerKg),
        quantityTotalBase: totalBase,
        quantityAvailableBase: totalBase,
        quantityReservedBase: 0n,
        minOrderBase: 0n,
        allowsPartialFill: seed.allowsPartialFill,
        harvestedAt: now,
        availableFrom: now,
        availableTo,
        shelfLifeHours: product.defaultShelfLifeHours,
        latitude: FARM_LOCATION.latitude,
        longitude: FARM_LOCATION.longitude,
        adminAreaId: fallbackArea.id,
        precision: 'APPROXIMATE',
        offersPickup: true,
        offersSellerDelivery: false,
        offersFundedDelivery: false,
        status: 'PUBLISHED',
        publishedAt: now,
        createdByUserId: farmerUser.id,
      },
    })
    created += 1
  }

  /* ------------------------------------------------------- buyer profile and address */

  const consumerProfile = await prisma.consumerProfile.findUnique({
    where: { userId: consumerUser.id },
  })
  if (!consumerProfile) {
    await prisma.consumerProfile.create({ data: { userId: consumerUser.id } })
    created += 1
  } else {
    existing += 1
  }

  const address = await prisma.address.findFirst({
    where: { userId: consumerUser.id, deletedAt: null },
    select: { id: true },
  })
  if (!address) {
    await prisma.address.create({
      data: {
        userId: consumerUser.id,
        label: 'Home',
        recipientName: consumerUser.fullName,
        recipientPhone: consumerUser.phone,
        adminAreaId: fallbackArea.id,
        villageOrArea: 'Bogura town',
        addressLine: '12 Station Road',
        latitude: BUYER_LOCATION.latitude,
        longitude: BUYER_LOCATION.longitude,
        precision: 'APPROXIMATE',
        isDefault: true,
      },
    })
    created += 1
  } else {
    existing += 1
  }

  /* ------------------------------------------------- the distant farmer, for ranking */

  const distantCounts = await seedCompetingFarmer(prisma, fallbackArea.id)
  created += distantCounts.created
  existing += distantCounts.existing

  /* ------------------------------------- a second buyer, for ownership and race tests */

  const secondBuyerCounts = await seedAdditionalBuyers(prisma, fallbackArea.id)
  created += secondBuyerCounts.created
  existing += secondBuyerCounts.existing

  return { created, existing, skipped: false }
}

/**
 * A second farmer, 120 km away, selling the same produce cheaper at the farm gate.
 *
 * This is the "Farmer B" of docs/04 §7 and it exists to make the engine's central claim
 * observable: the cheaper farm-gate price loses on delivered cost at small baskets and wins at
 * large ones. With one farmer seeded there is nothing to rank and the claim is untestable by
 * inspection.
 */
async function seedCompetingFarmer(
  prisma: PrismaClient,
  adminAreaId: string,
): Promise<{ created: number; existing: number }> {
  let created = 0
  let existing = 0

  const identity = DEVELOPMENT_IDENTITIES.find((entry) => entry.key === 'farmer-distant')
  if (!identity) return { created, existing }

  const user = await prisma.user.findUnique({ where: { phone: identity.phone } })
  if (!user) return { created, existing }

  let farmer = await prisma.farmerProfile.findUnique({ where: { userId: user.id } })
  if (!farmer) {
    farmer = await prisma.farmerProfile.create({
      data: {
        userId: user.id,
        displayName: 'Karim Mia',
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        // A weaker record than the nearby farmer, so reliability has something to separate them
        // when delivered prices land close together — the docs/04 §7.3 case.
        ordersAccepted: 12,
        ordersCompleted: 8,
        ratingSumStarsMilli: 15000,
        ratingCount: 4,
      },
    })
    created += 1
  } else {
    existing += 1
  }

  let farm = await prisma.farm.findFirst({
    where: { farmerProfileId: farmer.id, name: "Karim's Farm" },
  })
  if (!farm) {
    farm = await prisma.farm.create({
      data: {
        farmerProfileId: farmer.id,
        name: "Karim's Farm",
        adminAreaId,
        villageOrArea: 'Rangpur',
        latitude: DISTANT_FARM_LOCATION.latitude,
        longitude: DISTANT_FARM_LOCATION.longitude,
        precision: 'APPROXIMATE',
      },
    })
    created += 1
  } else {
    existing += 1
  }

  const now = new Date()
  const availableTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  // ৳25/kg against the nearby farmer's ৳30 — the exact ৳5 farm-gate advantage of docs/04 §7.
  const distantListings: readonly ListingSeed[] = [
    {
      productSlug: 'tomato',
      title: 'Tomato from Rangpur',
      grade: 'A',
      takaPerKg: '25.00',
      totalKg: 800,
      allowsPartialFill: true,
    },
    {
      productSlug: 'potato',
      title: 'Potato, bulk lot',
      grade: 'A',
      takaPerKg: '18.00',
      totalKg: 2000,
      allowsPartialFill: true,
    },
  ]

  for (const seed of distantListings) {
    const product = await prisma.product.findUnique({ where: { slug: seed.productSlug } })
    if (!product) continue

    const found = await prisma.listing.findFirst({
      where: { farmId: farm.id, productId: product.id, grade: seed.grade, deletedAt: null },
      select: { id: true },
    })
    if (found) {
      await keepOnSale(prisma, found.id, now, availableTo)
      existing += 1
      continue
    }

    const totalBase = BigInt(seed.totalKg) * KG
    await prisma.listing.create({
      data: {
        farmId: farm.id,
        farmerProfileId: farmer.id,
        productId: product.id,
        grade: seed.grade,
        title: seed.title,
        saleUnit: 'KG',
        saleUnitInBaseUnits: KG,
        unitPricePoisha: poishaFromTaka(seed.takaPerKg),
        quantityTotalBase: totalBase,
        quantityAvailableBase: totalBase,
        quantityReservedBase: 0n,
        minOrderBase: 0n,
        allowsPartialFill: seed.allowsPartialFill,
        harvestedAt: now,
        availableFrom: now,
        availableTo,
        shelfLifeHours: product.defaultShelfLifeHours,
        latitude: DISTANT_FARM_LOCATION.latitude,
        longitude: DISTANT_FARM_LOCATION.longitude,
        adminAreaId,
        precision: 'APPROXIMATE',
        offersPickup: true,
        offersSellerDelivery: false,
        offersFundedDelivery: false,
        status: 'PUBLISHED',
        publishedAt: now,
        createdByUserId: user.id,
      },
    })
    created += 1
  }

  return { created, existing }
}

/**
 * Profiles and addresses for the remaining buyer fixtures.
 *
 * Two buyers at the same address is deliberate: it makes the ownership-scoping tests meaningful
 * (a quote belongs to one of them, and the other must get *not found*, not *forbidden*) and lets
 * the oversell race be reproduced by hand in the UI, not only in a test.
 */
async function seedAdditionalBuyers(
  prisma: PrismaClient,
  adminAreaId: string,
): Promise<{ created: number; existing: number }> {
  let created = 0
  let existing = 0

  const buyerKeys = ['consumer-second', 'retailer'] as const

  for (const key of buyerKeys) {
    const identity = DEVELOPMENT_IDENTITIES.find((entry) => entry.key === key)
    if (!identity) continue

    const user = await prisma.user.findUnique({ where: { phone: identity.phone } })
    if (!user) continue

    if (key === 'consumer-second') {
      const profile = await prisma.consumerProfile.findUnique({ where: { userId: user.id } })
      if (!profile) {
        await prisma.consumerProfile.create({ data: { userId: user.id } })
        created += 1
      } else {
        existing += 1
      }
    } else {
      const profile = await prisma.retailerProfile.findUnique({ where: { userId: user.id } })
      if (!profile) {
        await prisma.retailerProfile.create({
          data: {
            userId: user.id,
            businessName: 'Bogura Bazar Store',
            businessType: 'GROCERY',
            verificationStatus: 'VERIFIED',
          },
        })
        created += 1
      } else {
        existing += 1
      }
    }

    const address = await prisma.address.findFirst({
      where: { userId: user.id, deletedAt: null },
      select: { id: true },
    })
    if (!address) {
      await prisma.address.create({
        data: {
          userId: user.id,
          label: key === 'retailer' ? 'Shop' : 'Home',
          recipientName: user.fullName,
          recipientPhone: user.phone,
          adminAreaId,
          villageOrArea: 'Bogura town',
          addressLine: key === 'retailer' ? '5 Bazar Road' : '19 Station Road',
          latitude: BUYER_LOCATION.latitude,
          longitude: BUYER_LOCATION.longitude,
          precision: 'APPROXIMATE',
          isDefault: true,
        },
      })
      created += 1
    } else {
      existing += 1
    }
  }

  return { created, existing }
}
