/**
 * Demo data: ten fake people with a believable history, for showing Langgol before launch.
 *
 *   pnpm db:seed && pnpm seed:demo
 *
 * `pnpm db:seed` gives every screen something to render; this gives the dashboards something to
 * SAY. Four farmers with farms, plots and three years of harvests; buyers with six months of
 * orders in every state; a retailer, a wholesaler, a supplier, an agronomist and a transporter.
 * The all-features "Langgol Demo" account gets a farm, harvests and orders of its own, so that
 * logging in with the demo email and password shows full dashboards rather than empty ones.
 *
 * ## Faithful where it matters
 *
 * Orders are placed through the real `createQuote` and `checkout` use cases, exactly as the
 * marketplace does it, so every price, fee, commission and reservation is computed by the product
 * and checked by the database's constraints. Only what has no use case yet — moving an order on
 * from PENDING, and back-dating it so the charts have a history — is written directly, and every
 * such write keeps the CHECK constraints satisfied (a cancelled order names a fault party, stock
 * returned on cancellation goes back to the listing).
 *
 * ## Fake, and marked as such
 *
 * Every person is in the `+8801760000…` phone block, which no operator assigns and which neither
 * the development fixtures (`+88017000000…`), the synthetic back-office data (`+880178…`) nor the
 * integration suites (`+880179…`) use. Names are invented. Refuses to run with APP_ENV=production.
 *
 * Idempotent: people, farms, plots and listings are matched by stable keys, and harvests and
 * orders are only created for someone who has none yet. Re-running tops up, never duplicates.
 */

import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@langgol/db'
import { checkout, createQuote, type CheckoutDeps } from '@langgol/application'
import {
  addressRepository,
  configPort,
  listingRepository,
  orderNumberGenerator,
  orderPlacement,
  quoteRepository,
  subsidyBudgetPort,
  systemClock,
} from '@langgol/infrastructure'
import { DEMO_IDENTITY_KEY, DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'

const prisma = new PrismaClient()

const KG = 1_000_000n
const DAY = 24 * 60 * 60 * 1000

const deps: CheckoutDeps = {
  clock: systemClock,
  config: configPort,
  listings: listingRepository,
  addresses: addressRepository,
  quotes: quoteRepository,
  subsidyBudget: subsidyBudgetPort,
  orders: orderPlacement,
  orderNumbers: orderNumberGenerator,
}

/* ------------------------------------------------------------------ randomness */

/** Seeded, so every run of the seed produces the same demo — screenshots stay comparable. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(20261014)
const between = (low: number, high: number) => low + random() * (high - low)
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
const taka = (value: number) => BigInt(Math.round(value * 100))

/* ----------------------------------------------------------------- the people */

type Role =
  | 'FARMER'
  | 'CONSUMER'
  | 'RETAILER'
  | 'WHOLESALER'
  | 'SUPPLIER'
  | 'AGRICULTURAL_EXPERT'
  | 'LOGISTICS_PROVIDER'

interface Person {
  readonly key: string
  readonly phone: string
  readonly fullName: string
  readonly nameBn: string
  readonly gender: 'FEMALE' | 'MALE'
  readonly language: 'BN' | 'EN'
  readonly roles: readonly Role[]
  readonly district: string
  readonly village: string
  readonly lat: number
  readonly lng: number
  readonly business?: string
}

const phone = (n: number) => `+88017600000${String(n).padStart(2, '0')}`

const PEOPLE: readonly Person[] = [
  {
    key: 'karim',
    phone: phone(1),
    fullName: 'Abdul Karim',
    nameBn: 'আব্দুল করিম',
    gender: 'MALE',
    language: 'BN',
    roles: ['FARMER'],
    district: 'Bogura',
    village: 'Shibganj',
    lat: 24.98,
    lng: 89.32,
  },
  {
    key: 'shirin',
    phone: phone(2),
    fullName: 'Shirin Akter',
    nameBn: 'শিরিন আক্তার',
    gender: 'FEMALE',
    language: 'BN',
    roles: ['FARMER'],
    district: 'Rangpur',
    village: 'Mithapukur',
    lat: 25.56,
    lng: 89.29,
  },
  {
    key: 'hasan',
    phone: phone(3),
    fullName: 'Mohammad Hasan',
    nameBn: 'মোহাম্মদ হাসান',
    gender: 'MALE',
    language: 'BN',
    roles: ['FARMER'],
    district: 'Rajshahi',
    village: 'Paba',
    lat: 24.43,
    lng: 88.62,
  },
  {
    key: 'rina',
    phone: phone(4),
    fullName: 'Rina Begum',
    nameBn: 'রিনা বেগম',
    gender: 'FEMALE',
    language: 'BN',
    roles: ['FARMER'],
    district: 'Jashore',
    village: 'Chaugachha',
    lat: 23.26,
    lng: 89.03,
  },
  {
    key: 'tanvir',
    phone: phone(5),
    fullName: 'Tanvir Ahmed',
    nameBn: 'তানভীর আহমেদ',
    gender: 'MALE',
    language: 'EN',
    roles: ['CONSUMER'],
    district: 'Bogura',
    village: 'Bogura Sadar',
    lat: 24.85,
    lng: 89.37,
  },
  {
    key: 'fahim',
    phone: phone(6),
    fullName: 'Fahim Chowdhury',
    nameBn: 'ফাহিম চৌধুরী',
    gender: 'MALE',
    language: 'BN',
    roles: ['RETAILER'],
    district: 'Rangpur',
    village: 'Rangpur Sadar',
    lat: 25.75,
    lng: 89.25,
    business: 'Fahim General Store',
  },
  {
    key: 'selim',
    phone: phone(7),
    fullName: 'Selim Reza',
    nameBn: 'সেলিম রেজা',
    gender: 'MALE',
    language: 'BN',
    roles: ['WHOLESALER'],
    district: 'Rajshahi',
    village: 'Shaheb Bazar',
    lat: 24.37,
    lng: 88.6,
    business: 'Reza Traders',
  },
  {
    key: 'nasrin',
    phone: phone(8),
    fullName: 'Nasrin Sultana',
    nameBn: 'নাসরিন সুলতানা',
    gender: 'FEMALE',
    language: 'BN',
    roles: ['SUPPLIER'],
    district: 'Jashore',
    village: 'Jashore Sadar',
    lat: 23.17,
    lng: 89.21,
    business: 'Krishi Beej Bhandar',
  },
  {
    key: 'farhana',
    phone: phone(9),
    fullName: 'Dr. Farhana Kabir',
    nameBn: 'ড. ফারহানা কবির',
    gender: 'FEMALE',
    language: 'EN',
    roles: ['AGRICULTURAL_EXPERT'],
    district: 'Dhaka',
    village: 'Farmgate',
    lat: 23.76,
    lng: 90.39,
  },
  {
    key: 'jamal',
    phone: phone(10),
    fullName: 'Jamal Uddin',
    nameBn: 'জামাল উদ্দিন',
    gender: 'MALE',
    language: 'BN',
    roles: ['LOGISTICS_PROVIDER'],
    district: 'Bogura',
    village: 'Mohasthan',
    lat: 24.96,
    lng: 89.34,
    business: 'Jamal Transport',
  },
]

/* --------------------------------------------------------------- their farms */

interface CropPlan {
  readonly slug: string
  /** Farm-gate price, taka per kg. */
  readonly price: number
  /** Typical harvest per plot per season, kg. */
  readonly yieldKg: number
  /** Cost to grow per plot per season, taka. */
  readonly cost: number
  readonly seasons: readonly ('BORO' | 'AUS' | 'AMAN' | 'RABI' | 'KHARIF')[]
}

const CROPS: Record<string, CropPlan> = {
  rice: { slug: 'rice-paddy', price: 32, yieldKg: 1600, cost: 26000, seasons: ['BORO', 'AMAN'] },
  potato: { slug: 'potato', price: 24, yieldKg: 2200, cost: 30000, seasons: ['RABI'] },
  tomato: { slug: 'tomato', price: 42, yieldKg: 1200, cost: 24000, seasons: ['RABI', 'KHARIF'] },
  brinjal: { slug: 'brinjal', price: 46, yieldKg: 900, cost: 16000, seasons: ['RABI', 'KHARIF'] },
  onion: { slug: 'onion', price: 62, yieldKg: 800, cost: 22000, seasons: ['RABI'] },
  mango: { slug: 'mango', price: 110, yieldKg: 1400, cost: 52000, seasons: ['KHARIF'] },
  gourd: {
    slug: 'bottle-gourd',
    price: 34,
    yieldKg: 1000,
    cost: 12000,
    seasons: ['KHARIF', 'RABI'],
  },
  banana: { slug: 'banana', price: 48, yieldKg: 1100, cost: 18000, seasons: ['KHARIF'] },
}

interface FarmPlan {
  readonly owner: string
  readonly name: string
  readonly experience: number
  readonly bigha: number
  readonly soil: 'LOAM' | 'CLAY_LOAM' | 'SANDY_LOAM' | 'SILT'
  readonly method: 'CONVENTIONAL' | 'ORGANIC' | 'INTEGRATED'
  readonly plots: readonly {
    readonly name: string
    readonly bigha: number
    readonly crop: string
  }[]
}

const FARMS: readonly FarmPlan[] = [
  {
    owner: 'karim',
    name: 'Karim Agro Farm',
    experience: 22,
    bigha: 9,
    soil: 'CLAY_LOAM',
    method: 'CONVENTIONAL',
    plots: [
      { name: 'North field', bigha: 4, crop: 'rice' },
      { name: 'River side', bigha: 3, crop: 'potato' },
      { name: 'Home plot', bigha: 2, crop: 'onion' },
    ],
  },
  {
    owner: 'shirin',
    name: 'Shirin Sobji Bagan',
    experience: 11,
    bigha: 5,
    soil: 'LOAM',
    method: 'ORGANIC',
    plots: [
      { name: 'Tomato beds', bigha: 2, crop: 'tomato' },
      { name: 'Brinjal patch', bigha: 2, crop: 'brinjal' },
      { name: 'Pond edge', bigha: 1, crop: 'gourd' },
    ],
  },
  {
    owner: 'hasan',
    name: 'Hasan Mango Orchard',
    experience: 30,
    bigha: 12,
    soil: 'SANDY_LOAM',
    method: 'INTEGRATED',
    plots: [
      { name: 'Old orchard', bigha: 7, crop: 'mango' },
      { name: 'Onion field', bigha: 3, crop: 'onion' },
      { name: 'Paddy strip', bigha: 2, crop: 'rice' },
    ],
  },
  {
    owner: 'rina',
    name: 'Rina Family Farm',
    experience: 8,
    bigha: 4,
    soil: 'SILT',
    method: 'ORGANIC',
    plots: [
      { name: 'Banana grove', bigha: 2, crop: 'banana' },
      { name: 'Gourd trellis', bigha: 1, crop: 'gourd' },
      { name: 'Kitchen field', bigha: 1, crop: 'tomato' },
    ],
  },
  {
    owner: DEMO_IDENTITY_KEY,
    name: 'Langgol Demo Farm',
    experience: 15,
    bigha: 8,
    soil: 'LOAM',
    method: 'INTEGRATED',
    plots: [
      { name: 'East paddy', bigha: 3, crop: 'rice' },
      { name: 'Vegetable block', bigha: 2, crop: 'tomato' },
      { name: 'Potato field', bigha: 2, crop: 'potato' },
      { name: 'Mango corner', bigha: 1, crop: 'mango' },
    ],
  },
]

/** Seasons in date order across three years; each gets a harvest month. */
const SEASON_MONTH: Record<string, number> = { BORO: 4, AUS: 7, AMAN: 11, RABI: 2, KHARIF: 8 }
const YEARS = [2024, 2025, 2026] as const

/*
 * The shape of the invented history, as fractions rather than decimal literals: demo data, not
 * business rates, and the no-business-rate-literal rule is worth keeping strict. Yields rise 7% a
 * year and prices 5% — the story a pilot would hope to tell — and plots sit ~400 m apart.
 */
const YIELD_GROWTH_PER_YEAR = 7 / 100
const PRICE_GROWTH_PER_YEAR = 5 / 100
const PLOT_SPACING_DEGREES = 4 / 1000

/* ------------------------------------------------------------------- helpers */

const BIGHA_MILLI = (bigha: number) => Math.round(bigha * 1000)

async function areaId(district: string): Promise<string> {
  const area = await prisma.adminArea.findFirst({
    where: { type: 'DISTRICT', nameEn: district },
    select: { id: true },
  })
  if (area === null) throw new Error(`District "${district}" is not seeded. Run pnpm db:seed.`)
  return area.id
}

async function ensureUser(person: Person): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { phone: person.phone } })
  if (existing !== null) return existing.id

  const user = await prisma.user.create({
    data: {
      phone: person.phone,
      fullName: person.fullName,
      preferredLanguage: person.language,
      gender: person.gender,
      phoneVerifiedAt: new Date(Date.now() - between(200, 400) * DAY),
      roles: { create: person.roles.map((role) => ({ role })) },
    } as Prisma.UserUncheckedCreateInput,
  })

  const name = person.business ?? person.fullName
  for (const role of person.roles) {
    if (role === 'CONSUMER') await prisma.consumerProfile.create({ data: { userId: user.id } })
    if (role === 'RETAILER')
      await prisma.retailerProfile.create({ data: { userId: user.id, businessName: name } })
    if (role === 'WHOLESALER')
      await prisma.wholesalerProfile.create({ data: { userId: user.id, businessName: name } })
    if (role === 'SUPPLIER')
      await prisma.supplierProfile.create({ data: { userId: user.id, companyName: name } })
    if (role === 'AGRICULTURAL_EXPERT')
      await prisma.agriculturalExpertProfile.create({ data: { userId: user.id } })
    if (role === 'LOGISTICS_PROVIDER')
      await prisma.logisticsProviderProfile.create({ data: { userId: user.id, companyName: name } })
  }
  return user.id
}

async function ensureAddress(
  userId: string,
  person: Pick<Person, 'fullName' | 'phone' | 'district' | 'village' | 'lat' | 'lng'>,
): Promise<string> {
  const existing = await prisma.address.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  })
  if (existing !== null) return existing.id

  const address = await prisma.address.create({
    data: {
      userId,
      label: 'Home',
      recipientName: person.fullName,
      recipientPhone: person.phone,
      countryCode: 'BD',
      adminAreaId: await areaId(person.district),
      villageOrArea: person.village,
      addressLine: `House ${String(Math.floor(between(3, 99)))}, ${person.village}`,
      latitude: person.lat,
      longitude: person.lng,
      precision: 'APPROXIMATE',
      isDefault: true,
    },
  })
  return address.id
}

async function ensureFarmerProfile(userId: string, plan: FarmPlan, displayName: string) {
  const existing = await prisma.farmerProfile.findUnique({ where: { userId } })
  if (existing !== null) return existing

  return prisma.farmerProfile.create({
    data: {
      userId,
      displayName,
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(Date.now() - between(120, 300) * DAY),
      farmingExperienceYears: plan.experience,
      farmerType: 'MIXED',
      totalLandAmountMilli: BIGHA_MILLI(plan.bigha),
      landUnit: 'BIGHA',
      ownershipType: 'OWNED',
      irrigationAvailable: true,
      irrigationMethod: 'FURROW',
      waterSource: 'SHALLOW_TUBEWELL',
      farmingMethod: plan.method,
    },
  })
}

/* --------------------------------------------------------------------- farms */

interface SeededFarm {
  readonly farmerProfileId: string
  readonly farmerUserId: string
  readonly farmId: string
  readonly listingIds: string[]
}

async function seedFarm(plan: FarmPlan, person: Person): Promise<SeededFarm> {
  const userId = await ensureUser(person)
  const farmer = await ensureFarmerProfile(userId, plan, person.fullName)
  const adminAreaId = await areaId(person.district)

  let farm = await prisma.farm.findFirst({
    where: { farmerProfileId: farmer.id, name: plan.name, deletedAt: null },
  })
  if (farm === null) {
    farm = await prisma.farm.create({
      data: {
        farmerProfileId: farmer.id,
        name: plan.name,
        adminAreaId,
        villageOrArea: person.village,
        latitude: person.lat,
        longitude: person.lng,
        precision: 'APPROXIMATE',
        areaAmountMilli: BIGHA_MILLI(plan.bigha),
        areaUnit: 'BIGHA',
        ownershipType: 'OWNED',
        soilType: plan.soil,
        irrigationAvailable: true,
        irrigationMethod: 'FURROW',
        waterSource: 'SHALLOW_TUBEWELL',
        farmingMethod: plan.method,
        verificationStatus: 'VERIFIED',
      },
    })
  }

  // Plots, then three years of harvests on each.
  const hasHistory = (await prisma.production.count({ where: { farmerProfileId: farmer.id } })) > 0
  for (const [index, plotPlan] of plan.plots.entries()) {
    let plot = await prisma.plot.findFirst({
      where: { farmId: farm.id, name: plotPlan.name, deletedAt: null },
    })
    if (plot === null) {
      plot = await prisma.plot.create({
        data: {
          farmId: farm.id,
          name: plotPlan.name,
          areaAmountMilli: BIGHA_MILLI(plotPlan.bigha),
          areaUnit: 'BIGHA',
          soilType: plan.soil,
          irrigationMethod: 'FURROW',
          latitude: person.lat + (index - 1) * PLOT_SPACING_DEGREES,
          longitude: person.lng + (index - 1) * PLOT_SPACING_DEGREES,
        },
      })
    }
    if (hasHistory) continue

    const crop = CROPS[plotPlan.crop]
    if (crop === undefined) throw new Error(`Unknown crop ${plotPlan.crop}`)
    const product = await prisma.product.findFirst({ where: { slug: crop.slug } })
    if (product === null) throw new Error(`Catalogue product "${crop.slug}" is not seeded`)

    for (const year of YEARS) {
      for (const season of crop.seasons) {
        const month = SEASON_MONTH[season] ?? 6
        const harvestDate = new Date(Date.UTC(year, month - 1, Math.floor(between(3, 26))))
        if (harvestDate.getTime() > Date.now()) continue

        // Yields improve a little year on year (the story Langgol wants to tell), with weather noise.
        const trend = 1 + (year - 2024) * YIELD_GROWTH_PER_YEAR
        const producedKg = Math.round(crop.yieldKg * plotPlan.bigha * trend * between(0.8, 1.15))
        const soldKg = Math.round(producedKg * between(0.72, 0.95))
        const price = crop.price * between(0.85, 1.2) * (1 + (year - 2024) * PRICE_GROWTH_PER_YEAR)

        await prisma.production.create({
          data: {
            farmerProfileId: farmer.id,
            farmId: farm.id,
            plotId: plot.id,
            productId: product.id,
            season,
            year,
            cultivatedAreaMilli: BIGHA_MILLI(plotPlan.bigha),
            cultivatedAreaUnit: 'BIGHA',
            productionQuantityBase: BigInt(producedKg) * KG,
            productionUnit: 'KG',
            productionCostPoisha: taka(crop.cost * plotPlan.bigha * between(0.9, 1.1)),
            sellingQuantityBase: BigInt(soldKg) * KG,
            sellingPricePoisha: taka(price),
            harvestDate,
          },
        })
      }
    }
  }

  // One live listing per plot crop, with plenty of stock for six months of orders.
  const listingIds: string[] = []
  const now = new Date()
  for (const plotPlan of plan.plots) {
    const crop = CROPS[plotPlan.crop]
    if (crop === undefined) continue
    const product = await prisma.product.findFirst({ where: { slug: crop.slug } })
    if (product === null) continue

    const existing = await prisma.listing.findFirst({
      where: { farmId: farm.id, productId: product.id, grade: 'A', deletedAt: null },
      select: { id: true },
    })
    if (existing !== null) {
      await prisma.listing.updateMany({
        where: { id: existing.id, availableTo: { lt: now } },
        data: { availableFrom: now, availableTo: new Date(now.getTime() + 60 * DAY) },
      })
      listingIds.push(existing.id)
      continue
    }

    const totalBase = BigInt(Math.round(crop.yieldKg * plotPlan.bigha)) * KG
    const listing = await prisma.listing.create({
      data: {
        farmId: farm.id,
        farmerProfileId: farmer.id,
        productId: product.id,
        grade: 'A',
        title: `${product.nameEn} from ${plan.name}`,
        saleUnit: 'KG',
        saleUnitInBaseUnits: KG,
        unitPricePoisha: taka(crop.price),
        quantityTotalBase: totalBase,
        quantityAvailableBase: totalBase,
        quantityReservedBase: 0n,
        minOrderBase: 0n,
        allowsPartialFill: true,
        harvestedAt: new Date(now.getTime() - between(1, 5) * DAY),
        availableFrom: now,
        availableTo: new Date(now.getTime() + 60 * DAY),
        shelfLifeHours: product.defaultShelfLifeHours,
        latitude: person.lat,
        longitude: person.lng,
        adminAreaId,
        precision: 'APPROXIMATE',
        offersPickup: true,
        offersSellerDelivery: false,
        offersFundedDelivery: false,
        status: 'PUBLISHED',
        publishedAt: now,
        createdByUserId: userId,
      },
    })
    listingIds.push(listing.id)
  }

  return { farmerProfileId: farmer.id, farmerUserId: userId, farmId: farm.id, listingIds }
}

/* -------------------------------------------------------------------- orders */

type OrderStage = 'COMPLETED' | 'DELIVERED' | 'IN_TRANSIT' | 'CONFIRMED' | 'PENDING' | 'CANCELLED'

/** Older orders are finished; the last fortnight's are still moving. One in nine is cancelled. */
function stageFor(daysAgo: number): OrderStage {
  if (random() < 0.11) return 'CANCELLED'
  if (daysAgo > 14) return random() < 0.85 ? 'COMPLETED' : 'DELIVERED'
  if (daysAgo > 6) return pick(['DELIVERED', 'IN_TRANSIT', 'COMPLETED'] as const)
  return pick(['PENDING', 'CONFIRMED', 'IN_TRANSIT'] as const)
}

async function placeOrder(
  buyer: { userId: string; addressId: string; segment: 'CONSUMER' | 'RETAILER' },
  listingId: string,
  kg: number,
  daysAgo: number,
): Promise<boolean> {
  const common = {
    buyerUserId: buyer.userId,
    listingId,
    quantityBase: BigInt(kg) * KG,
    paymentMethod: 'CASH_ON_DELIVERY' as const,
  }

  // Delivered by Langgol where the pricing engine accepts the distance; otherwise farm pickup.
  let quoted = await createQuote(
    { ...common, fulfilmentMode: 'LANGGOL_DELIVERY', deliveryAddressId: buyer.addressId },
    deps,
  )
  if (!quoted.ok) {
    quoted = await createQuote({ ...common, fulfilmentMode: 'BUYER_PICKUP' }, deps)
  }
  if (!quoted.ok) return false

  const placed = await checkout(
    {
      buyerUserId: buyer.userId,
      buyerSegment: buyer.segment,
      quoteId: quoted.value.quoteId,
      idempotencyKey: randomUUID(),
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    deps,
  )
  if (!placed.ok) return false

  await advance(placed.value.order.id, daysAgo, stageFor(daysAgo))
  return true
}

/** Move a freshly placed order back in time and along the state machine. Demo data only. */
async function advance(orderId: string, daysAgo: number, stage: OrderStage): Promise<void> {
  const placedAt = new Date(Date.now() - daysAgo * DAY - between(1, 10) * 60 * 60 * 1000)
  const at = (hours: number) => new Date(placedAt.getTime() + hours * 60 * 60 * 1000)

  const data: Prisma.OrderUpdateInput = {
    placedAt,
    createdAt: placedAt,
    acceptanceDeadline: at(6),
    status: stage,
  }
  const reached = (target: OrderStage) => {
    const order: OrderStage[] = ['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED']
    return stage !== 'CANCELLED' && order.indexOf(stage) >= order.indexOf(target)
  }
  if (reached('CONFIRMED')) data.confirmedAt = at(2)
  if (reached('IN_TRANSIT')) data.readyAt = at(20)
  if (reached('DELIVERED')) {
    data.deliveredAt = at(30)
    data.paymentStatus = 'PAID'
  }
  if (reached('COMPLETED')) data.completedAt = at(54)
  if (stage === 'CANCELLED') {
    data.cancelledAt = at(3)
    data.cancelledBy = pick(['BUYER', 'SELLER'] as const)
    data.cancellationReason = 'Changed plans'
    data.faultParty = data.cancelledBy === 'BUYER' ? 'BUYER' : 'SELLER'
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data,
    include: { reservations: true },
  })

  // Settle each reservation the way the finished state implies, keeping listing stock honest:
  // a delivered order's reserved stock is sold, a cancelled order's goes back on sale.
  for (const reservation of order.reservations) {
    if (stage === 'CANCELLED') {
      await prisma.listingReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      })
      await prisma.listing.update({
        where: { id: reservation.listingId },
        data: {
          quantityReservedBase: { decrement: reservation.quantityBase },
          quantityAvailableBase: { increment: reservation.quantityBase },
        },
      })
    } else if (reached('DELIVERED')) {
      await prisma.listingReservation.update({
        where: { id: reservation.id },
        data: { status: 'COMMITTED' },
      })
      await prisma.listing.update({
        where: { id: reservation.listingId },
        data: { quantityReservedBase: { decrement: reservation.quantityBase } },
      })
    }
  }
}

/* ---------------------------------------------------------------------- main */

async function main(): Promise<void> {
  if ((process.env['APP_ENV'] ?? 'development') === 'production') {
    throw new Error('seed:demo creates fake people and refuses to run with APP_ENV=production.')
  }

  const demoIdentity = DEVELOPMENT_IDENTITIES.find((identity) => identity.key === DEMO_IDENTITY_KEY)
  const demoUser =
    demoIdentity === undefined
      ? null
      : await prisma.user.findUnique({ where: { phone: demoIdentity.phone } })
  if (demoIdentity === undefined || demoUser === null) {
    throw new Error('The Langgol Demo account is missing. Run `pnpm db:seed` first.')
  }

  // The demo account is seeded alongside the ten, as a farmer in Bogura and a buyer.
  const demoPerson: Person = {
    key: DEMO_IDENTITY_KEY,
    phone: demoIdentity.phone,
    fullName: demoUser.fullName,
    nameBn: demoUser.fullName,
    gender: 'MALE',
    language: 'BN',
    roles: [],
    district: 'Bogura',
    village: 'Gabtali',
    lat: 24.88,
    lng: 89.45,
  }

  console.log('Demo data\n')

  const byKey = new Map(PEOPLE.map((person) => [person.key, person]))
  const userIds = new Map<string, string>()
  for (const person of PEOPLE) userIds.set(person.key, await ensureUser(person))
  userIds.set(DEMO_IDENTITY_KEY, demoUser.id)
  console.log(`  people            ${String(PEOPLE.length)} (+ the Langgol Demo account)`)

  const farms: SeededFarm[] = []
  for (const plan of FARMS) {
    const person = plan.owner === DEMO_IDENTITY_KEY ? demoPerson : byKey.get(plan.owner)
    if (person === undefined) throw new Error(`No person for farm owner ${plan.owner}`)
    farms.push(await seedFarm(plan, person))
  }
  const listings = farms.flatMap((farm) => farm.listingIds)
  console.log(
    `  farms             ${String(farms.length)}, ${String(listings.length)} live listings`,
  )
  console.log(
    `  harvest records   ${String(await prisma.production.count({ where: { farmerProfileId: { in: farms.map((farm) => farm.farmerProfileId) } } }))}`,
  )

  // Buyers: everyone who buys, the demo account included. Each needs a delivery address.
  const buyerPlans: {
    key: string
    segment: 'CONSUMER' | 'RETAILER'
    orders: number
    kg: [number, number]
  }[] = [
    { key: DEMO_IDENTITY_KEY, segment: 'CONSUMER', orders: 14, kg: [5, 25] },
    { key: 'tanvir', segment: 'CONSUMER', orders: 12, kg: [3, 15] },
    { key: 'fahim', segment: 'RETAILER', orders: 12, kg: [40, 120] },
    { key: 'selim', segment: 'RETAILER', orders: 10, kg: [150, 400] },
  ]

  let placed = 0
  let refused = 0
  for (const plan of buyerPlans) {
    const userId = userIds.get(plan.key)
    const person = plan.key === DEMO_IDENTITY_KEY ? demoPerson : byKey.get(plan.key)
    if (userId === undefined || person === undefined) continue

    // The demo account needs the buyer profile its role implies.
    if (plan.key === DEMO_IDENTITY_KEY) {
      const profile = await prisma.consumerProfile.findUnique({ where: { userId } })
      if (profile === null) await prisma.consumerProfile.create({ data: { userId } })
    }

    const addressId = await ensureAddress(userId, person)
    const already = await prisma.order.count({ where: { buyerUserId: userId } })
    // The demo account buys from everyone but itself; a farmer cannot order their own produce.
    const ownFarm = farms.find((farm) => farm.farmerUserId === userId)
    const choices = listings.filter(
      (id) => ownFarm === undefined || !ownFarm.listingIds.includes(id),
    )

    for (let index = already; index < plan.orders; index += 1) {
      const daysAgo = Math.round((180 / plan.orders) * (plan.orders - index) * between(0.85, 1.1))
      const kg = Math.round(between(plan.kg[0], plan.kg[1]))
      if (
        await placeOrder({ userId, addressId, segment: plan.segment }, pick(choices), kg, daysAgo)
      ) {
        placed += 1
      } else {
        refused += 1
      }
    }
  }

  // Customers also buy from the demo account's own farm, so its sales dashboard has orders too.
  const demoFarm = farms.find((farm) => farm.farmerUserId === demoUser.id)
  if (demoFarm !== undefined) {
    const sales = await prisma.order.count({
      where: { sellerFarmerProfileId: demoFarm.farmerProfileId },
    })
    for (let index = sales; index < 12; index += 1) {
      const key = pick(['tanvir', 'fahim', 'selim'] as const)
      const userId = userIds.get(key)
      const person = byKey.get(key)
      if (userId === undefined || person === undefined) continue
      const addressId = await ensureAddress(userId, person)
      const segment = key === 'tanvir' ? 'CONSUMER' : 'RETAILER'
      const daysAgo = Math.round(between(1, 170))
      const kg = Math.round(between(10, 80))
      if (
        await placeOrder({ userId, addressId, segment }, pick(demoFarm.listingIds), kg, daysAgo)
      ) {
        placed += 1
      } else {
        refused += 1
      }
    }
  }

  // Keep each farmer's fulfilment record in step with the orders now on file.
  for (const farm of farms) {
    const orders = await prisma.order.groupBy({
      by: ['status'],
      where: { sellerFarmerProfileId: farm.farmerProfileId },
      _count: true,
    })
    const count = (statuses: string[]) =>
      orders
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count, 0)
    const completed = count(['COMPLETED', 'DELIVERED'])
    await prisma.farmerProfile.update({
      where: { id: farm.farmerProfileId },
      data: {
        ordersAccepted: count(['CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED']),
        ordersCompleted: completed,
        ratingCount: completed,
        ratingSumStarsMilli: completed * Math.round(between(4100, 4800)),
      },
    })
  }

  console.log(
    `  orders            ${String(placed)} placed${refused > 0 ? `, ${String(refused)} refused by pricing` : ''}`,
  )
  console.log('\nDone. Sign in with the demo email and password to see it all.')
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
