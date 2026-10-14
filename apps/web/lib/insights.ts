/**
 * Dashboard figures: read-only aggregates for the farmer, buyer and admin dashboards.
 *
 * Every function takes an id the CALLER has already authorized — the farmer profile of the
 * signed-in actor, the actor's own user id, or (for the platform view) an actor that passed
 * `requirePermission`. Nothing here decides who may see what; it only counts. Each query is
 * scoped by that id in its WHERE clause, so a farmer's dashboard cannot aggregate another
 * farmer's rows even by mistake.
 *
 * Money stays exact: `Poisha` (branded bigint), summed through the money module, never a float.
 * A chart that needs a bar height converts at the very last step (`chartTaka` in viz-format.ts);
 * every amount a reader sees is formatted from the exact value.
 */

import 'server-only'
import { prisma } from '@langgol/db'
import * as Money from '@langgol/domain/money'
import type { Poisha } from '@langgol/domain/money'

/** Kilograms from base units. Quantities, not money: a float is fine for weight on a chart. */
const kg = (base: bigint | null | undefined) => Number((base ?? 0n) / 1000n) / 1000

const poisha = (value: bigint | null | undefined): Poisha => Money.fromPoisha(value ?? 0n)
const NONE: Poisha = Money.fromPoisha(0n)

/** The most recent calendar months, oldest first, as { key: 'YYYY-MM', start: Date }. */
export function recentMonths(count = 6, now = new Date()): { key: string; start: Date }[] {
  const months: { key: string; start: Date }[] = []
  for (let back = count - 1; back >= 0; back -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    months.push({ key: start.toISOString().slice(0, 7), start })
  }
  return months
}

const monthKey = (date: Date) => date.toISOString().slice(0, 7)

/* -------------------------------------------------------------------- farmer */

export interface SeasonPoint {
  readonly season: string
  readonly year: number
  readonly revenuePoisha: Poisha
  readonly costPoisha: Poisha
  readonly producedKg: number
}

export interface FarmerInsights {
  readonly seasons: SeasonPoint[]
  readonly cropMix: { readonly nameEn: string; readonly nameBn: string; readonly kg: number }[]
  readonly salesByMonth: {
    readonly key: string
    readonly netPoisha: Poisha
    readonly orders: number
  }[]
  readonly listings: {
    readonly nameEn: string
    readonly nameBn: string
    readonly availableKg: number
    readonly totalKg: number
    readonly pricePoisha: Poisha
  }[]
  readonly totals: {
    readonly revenueThisYearPoisha: Poisha
    readonly revenueLastYearPoisha: Poisha
    readonly costThisYearPoisha: Poisha
    readonly harvestKgThisYear: number
    readonly harvestKgLastYear: number
    readonly ordersLast30: number
    readonly rating: number | null
    readonly farms: number
    readonly plots: number
  }
}

export async function farmerInsights(farmerProfileId: string): Promise<FarmerInsights> {
  const year = new Date().getUTCFullYear()
  const since = recentMonths(6)[0]?.start ?? new Date()

  const [productions, orders, listings, profile, farms, plots] = await Promise.all([
    prisma.production.findMany({
      where: { farmerProfileId, deletedAt: null },
      select: {
        season: true,
        year: true,
        harvestDate: true,
        revenuePoisha: true,
        productionCostPoisha: true,
        productionQuantityBase: true,
        product: { select: { nameEn: true, nameBn: true } },
      },
    }),
    prisma.order.findMany({
      where: { sellerFarmerProfileId: farmerProfileId, placedAt: { gte: since } },
      select: { placedAt: true, status: true, sellerNetPoisha: true },
    }),
    prisma.listing.findMany({
      where: { farmerProfileId, deletedAt: null, status: 'PUBLISHED' },
      select: {
        quantityAvailableBase: true,
        quantityTotalBase: true,
        unitPricePoisha: true,
        product: { select: { nameEn: true, nameBn: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 6,
    }),
    prisma.farmerProfile.findUnique({
      where: { id: farmerProfileId },
      select: { ratingSumStarsMilli: true, ratingCount: true },
    }),
    prisma.farm.count({ where: { farmerProfileId, deletedAt: null } }),
    prisma.plot.count({ where: { farm: { farmerProfileId }, deletedAt: null } }),
  ])

  // Harvests by season, in harvest order; the last eight seasons.
  const bySeason = new Map<string, SeasonPoint & { at: number }>()
  for (const row of productions) {
    if (row.season === null || row.year === null) continue
    const key = `${String(row.year)}-${row.season}`
    const previous = bySeason.get(key) ?? {
      season: row.season,
      year: row.year,
      revenuePoisha: NONE,
      costPoisha: NONE,
      producedKg: 0,
      at: 0,
    }
    bySeason.set(key, {
      ...previous,
      revenuePoisha: Money.add(previous.revenuePoisha, poisha(row.revenuePoisha)),
      costPoisha: Money.add(previous.costPoisha, poisha(row.productionCostPoisha)),
      producedKg: previous.producedKg + kg(row.productionQuantityBase),
      at: Math.max(previous.at, row.harvestDate?.getTime() ?? 0),
    })
  }
  const seasons = [...bySeason.values()]
    .sort((a, b) => a.at - b.at)
    .slice(-8)
    .map(({ at: _at, ...point }) => point)

  // What the farm grows, by weight over all recorded harvests.
  const byCrop = new Map<string, { nameEn: string; nameBn: string; kg: number }>()
  for (const row of productions) {
    if (row.product === null) continue
    const entry = byCrop.get(row.product.nameEn) ?? { ...row.product, kg: 0 }
    entry.kg += kg(row.productionQuantityBase)
    byCrop.set(row.product.nameEn, entry)
  }

  const salesByMonth = recentMonths(6).map((month) => {
    const inMonth = orders.filter(
      (order) => monthKey(order.placedAt) === month.key && order.status !== 'CANCELLED',
    )
    return {
      key: month.key,
      orders: inMonth.length,
      netPoisha: Money.sum(inMonth.map((order) => poisha(order.sellerNetPoisha))),
    }
  })

  const ofYear = (y: number) => productions.filter((row) => row.year === y)

  /*
   * Last year cut at today's date, so "vs last year" compares January-to-today with
   * January-to-today. Against the whole of last year, every year in progress would look like a
   * bad year until December.
   */
  const today = new Date()
  const lastYearToDate = productions.filter((row) => {
    if (row.year !== year - 1 || row.harvestDate === null) return false
    const cutoff = new Date(Date.UTC(year - 1, today.getUTCMonth(), today.getUTCDate(), 23, 59))
    return row.harvestDate.getTime() <= cutoff.getTime()
  })
  const revenue = (rows: typeof productions) =>
    Money.sum(rows.map((row) => poisha(row.revenuePoisha)))
  const harvested = (rows: typeof productions) =>
    rows.reduce((total, row) => total + kg(row.productionQuantityBase), 0)

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  return {
    seasons,
    cropMix: [...byCrop.values()].sort((a, b) => b.kg - a.kg),
    salesByMonth,
    listings: listings.map((listing) => ({
      nameEn: listing.product.nameEn,
      nameBn: listing.product.nameBn,
      availableKg: kg(listing.quantityAvailableBase),
      totalKg: kg(listing.quantityTotalBase),
      pricePoisha: poisha(listing.unitPricePoisha),
    })),
    totals: {
      revenueThisYearPoisha: revenue(ofYear(year)),
      revenueLastYearPoisha: revenue(lastYearToDate),
      costThisYearPoisha: Money.sum(ofYear(year).map((row) => poisha(row.productionCostPoisha))),
      harvestKgThisYear: harvested(ofYear(year)),
      harvestKgLastYear: harvested(lastYearToDate),
      ordersLast30: orders.filter(
        (order) => order.placedAt.getTime() >= thirtyDaysAgo && order.status !== 'CANCELLED',
      ).length,
      rating:
        profile === null || profile.ratingCount === 0
          ? null
          : profile.ratingSumStarsMilli / profile.ratingCount / 1000,
      farms,
      plots,
    },
  }
}

/* --------------------------------------------------------------------- buyer */

export interface BuyerOrderRow {
  readonly id: string
  readonly orderNumber: string
  readonly status: string
  readonly placedAt: Date
  readonly totalPoisha: Poisha
  readonly items: string
  readonly itemsBn: string
  readonly farm: string
}

export interface BuyerInsights {
  readonly spendByMonth: {
    readonly key: string
    readonly totalPoisha: Poisha
    readonly orders: number
  }[]
  readonly byStatus: { readonly status: string; readonly count: number }[]
  readonly topProducts: { readonly nameEn: string; readonly nameBn: string; readonly kg: number }[]
  readonly recent: BuyerOrderRow[]
  readonly totals: {
    readonly orders: number
    readonly spentPoisha: Poisha
    readonly deliveryPoisha: Poisha
    readonly kg: number
    readonly active: number
  }
}

const ACTIVE = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT']

export async function buyerInsights(buyerUserId: string): Promise<BuyerInsights> {
  const orders = await prisma.order.findMany({
    where: { buyerUserId },
    orderBy: { placedAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      placedAt: true,
      buyerTotalPoisha: true,
      deliveryFeePoisha: true,
      items: {
        select: { productNameEn: true, productNameBn: true, quantityBase: true, farmName: true },
      },
    },
  })

  const live = orders.filter((order) => order.status !== 'CANCELLED')

  const spendByMonth = recentMonths(6).map((month) => {
    const inMonth = live.filter((order) => monthKey(order.placedAt) === month.key)
    return {
      key: month.key,
      orders: inMonth.length,
      totalPoisha: Money.sum(inMonth.map((order) => poisha(order.buyerTotalPoisha))),
    }
  })

  const statusCounts = new Map<string, number>()
  for (const order of orders) {
    statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1)
  }

  const products = new Map<string, { nameEn: string; nameBn: string; kg: number }>()
  for (const order of live) {
    for (const item of order.items) {
      const entry = products.get(item.productNameEn) ?? {
        nameEn: item.productNameEn,
        nameBn: item.productNameBn,
        kg: 0,
      }
      entry.kg += kg(item.quantityBase)
      products.set(item.productNameEn, entry)
    }
  }

  return {
    spendByMonth,
    byStatus: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    topProducts: [...products.values()].sort((a, b) => b.kg - a.kg).slice(0, 6),
    recent: orders.slice(0, 8).map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      placedAt: order.placedAt,
      totalPoisha: poisha(order.buyerTotalPoisha),
      items: order.items.map((item) => item.productNameEn).join(', '),
      itemsBn: order.items.map((item) => item.productNameBn).join(', '),
      farm: order.items[0]?.farmName ?? '',
    })),
    totals: {
      orders: live.length,
      spentPoisha: Money.sum(live.map((order) => poisha(order.buyerTotalPoisha))),
      deliveryPoisha: Money.sum(live.map((order) => poisha(order.deliveryFeePoisha))),
      kg: [...products.values()].reduce((total, product) => total + product.kg, 0),
      active: orders.filter((order) => ACTIVE.includes(order.status)).length,
    },
  }
}

/* ----------------------------------------------------------------- platform */

export interface PlatformInsights {
  readonly usersByRole: { readonly role: string; readonly count: number }[]
  readonly ordersByMonth: {
    readonly key: string
    readonly gmvPoisha: Poisha
    readonly orders: number
  }[]
  readonly verification: {
    readonly type: string
    readonly pending: number
    readonly verified: number
  }[]
  readonly totals: {
    readonly users: number
    readonly farms: number
    readonly liveListings: number
    readonly orders: number
    readonly gmvPoisha: Poisha
    readonly commissionPoisha: Poisha
    readonly cancelled: number
  }
}

/** Platform-wide counts. The caller must hold `admin:access`; this function does not check. */
export async function platformInsights(): Promise<PlatformInsights> {
  const since = recentMonths(6)[0]?.start ?? new Date()

  const [roles, users, farms, liveListings, recentOrders, allOrders, verifications] =
    await Promise.all([
      prisma.userRoleAssignment.groupBy({
        by: ['role'],
        where: { revokedAt: null, user: { isDevelopmentFixture: false, deletedAt: null } },
        _count: true,
      }),
      prisma.user.count({ where: { isDevelopmentFixture: false, deletedAt: null } }),
      prisma.farm.count({ where: { deletedAt: null } }),
      prisma.listing.count({
        where: { status: 'PUBLISHED', deletedAt: null, availableTo: { gte: new Date() } },
      }),
      prisma.order.findMany({
        where: { placedAt: { gte: since }, status: { not: 'CANCELLED' } },
        select: { placedAt: true, buyerTotalPoisha: true },
      }),
      prisma.order.groupBy({
        by: ['status'],
        _count: true,
        _sum: { buyerTotalPoisha: true, commissionPoisha: true },
      }),
      prisma.verification.groupBy({ by: ['type', 'status'], _count: true }),
    ])

  const ordersByMonth = recentMonths(6).map((month) => {
    const inMonth = recentOrders.filter((order) => monthKey(order.placedAt) === month.key)
    return {
      key: month.key,
      orders: inMonth.length,
      gmvPoisha: Money.sum(inMonth.map((order) => poisha(order.buyerTotalPoisha))),
    }
  })

  const types = new Map<string, { type: string; pending: number; verified: number }>()
  for (const row of verifications) {
    const entry = types.get(row.type) ?? { type: row.type, pending: 0, verified: 0 }
    if (row.status === 'PENDING' || row.status === 'UNDER_REVIEW') entry.pending += row._count
    if (row.status === 'VERIFIED') entry.verified += row._count
    types.set(row.type, entry)
  }

  const settled = allOrders.filter((row) => row.status !== 'CANCELLED')

  return {
    usersByRole: roles
      .map((row) => ({ role: row.role, count: row._count }))
      .sort((a, b) => b.count - a.count),
    ordersByMonth,
    verification: [...types.values()].sort((a, b) => b.pending - a.pending),
    totals: {
      users,
      farms,
      liveListings,
      orders: settled.reduce((total, row) => total + row._count, 0),
      gmvPoisha: Money.sum(settled.map((row) => poisha(row._sum.buyerTotalPoisha))),
      commissionPoisha: Money.sum(settled.map((row) => poisha(row._sum.commissionPoisha))),
      cancelled: allOrders.find((row) => row.status === 'CANCELLED')?._count ?? 0,
    },
  }
}
