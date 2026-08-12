/**
 * Prisma-backed marketplace adapters.
 *
 * Repositories return domain-shaped records, not Prisma models, so a schema change does not leak
 * into a use case. Filtering happens in the query, never in application code afterwards.
 *
 * The interesting one is `orderPlacement`: it is the only place inventory moves, and it does so
 * inside a single transaction using the conditional UPDATE that docs/02_DATABASE.md §13 makes
 * normative. Read-then-write in application code would oversell under concurrency, and
 * overselling destroys farmer trust faster than any bug.
 *
 * Refs: docs/02_DATABASE.md §13; docs/04_MARKETPLACE.md §8-9; docs/03_ARCHITECTURE.md §2.1
 */

import { prisma } from '@langgol/db'
import type {
  AddressRepository,
  ConfigPort,
  DeliveryDestination,
  ListingPricingSnapshot,
  ListingRepository,
  OrderNumberGenerator,
  OrderPlacementPort,
  PlaceOrderCommand,
  PlaceOrderOutcome,
  QuoteRepository,
  StoredQuote,
  SubsidyBudgetPort,
} from '@langgol/application'
import type { ConfigSnapshot } from '@langgol/domain/config'
import type { PerishabilityClass } from '@langgol/domain/pricing'
import { randomBytes, randomUUID } from 'node:crypto'
import { getConfig } from '../config/loader.js'

/* ------------------------------------------------------------------------ config */

/**
 * Adapts the existing cached loader to the application's `ConfigPort`.
 *
 * Deliberately the cached accessor rather than a fresh read per quote: configuration changes are
 * rare, quotes are not, and the loader already bounds staleness to a minute so a rate change
 * reaches every instance without a deploy.
 */
export const configPort: ConfigPort = {
  snapshot(at: Date): Promise<ConfigSnapshot> {
    return getConfig(at)
  },
}

/* ----------------------------------------------------------------------- listings */

/** The columns the pricing engine needs, and nothing the client could tamper with. */
const LISTING_SELECT = {
  id: true,
  version: true,
  farmerProfileId: true,
  productId: true,
  varietyId: true,
  grade: true,
  saleUnit: true,
  saleUnitInBaseUnits: true,
  unitPricePoisha: true,
  quantityAvailableBase: true,
  minOrderBase: true,
  allowsPartialFill: true,
  status: true,
  availableFrom: true,
  availableTo: true,
  shelfLifeHours: true,
  harvestedAt: true,
  latitude: true,
  longitude: true,
  adminAreaId: true,
  offersPickup: true,
  offersSellerDelivery: true,
  offersFundedDelivery: true,
  moderationFlag: true,
  farm: { select: { name: true, area: { select: { parentId: true } } } },
  product: {
    select: { nameEn: true, nameBn: true, perishability: true, defaultShelfLifeHours: true },
  },
  farmer: {
    select: {
      ordersAccepted: true,
      ordersCompleted: true,
      ratingSumStarsMilli: true,
      ratingCount: true,
      verificationStatus: true,
      user: { select: { status: true } },
    },
  },
} as const

type ListingRow = {
  id: string
  version: number
  farmerProfileId: string
  productId: string
  grade: string
  saleUnit: string
  saleUnitInBaseUnits: bigint
  unitPricePoisha: bigint
  quantityAvailableBase: bigint
  minOrderBase: bigint
  allowsPartialFill: boolean
  status: string
  availableFrom: Date
  availableTo: Date
  shelfLifeHours: number | null
  harvestedAt: Date | null
  latitude: unknown
  longitude: unknown
  adminAreaId: string
  offersPickup: boolean
  offersSellerDelivery: boolean
  offersFundedDelivery: boolean
  moderationFlag: string | null
  farm: { name: string; area: { parentId: string | null } }
  product: {
    nameEn: string
    nameBn: string
    perishability: string
    defaultShelfLifeHours: number
  }
  farmer: {
    ordersAccepted: number
    ordersCompleted: number
    ratingSumStarsMilli: number
    ratingCount: number
    verificationStatus: string
    user: { status: string }
  }
}

/** Prisma returns `Decimal` for numeric columns; coordinates cross into the domain as numbers. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value.toString())
  return Number.isFinite(parsed) ? parsed : null
}

function toSnapshot(row: ListingRow): ListingPricingSnapshot {
  return {
    listingId: row.id,
    version: row.version,
    farmerProfileId: row.farmerProfileId,
    farmName: row.farm.name,
    productId: row.productId,
    productNameEn: row.product.nameEn,
    productNameBn: row.product.nameBn,
    varietyName: null,
    grade: row.grade as ListingPricingSnapshot['grade'],
    perishability: row.product.perishability as PerishabilityClass,
    shelfLifeHours: row.shelfLifeHours ?? row.product.defaultShelfLifeHours,
    saleUnit: row.saleUnit,
    saleUnitInBaseUnits: row.saleUnitInBaseUnits,
    unitPricePoisha: row.unitPricePoisha,
    quantityAvailableBase: row.quantityAvailableBase,
    minOrderBase: row.minOrderBase,
    allowsPartialFill: row.allowsPartialFill,
    status: row.status,
    availableFrom: row.availableFrom,
    availableTo: row.availableTo,
    harvestedAt: row.harvestedAt,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    adminAreaId: row.adminAreaId,
    // The district is the parent of the listing's area, and keys the circuity factor.
    districtKey: row.farm.area.parentId,
    offersPickup: row.offersPickup,
    offersSellerDelivery: row.offersSellerDelivery,
    offersFundedDelivery: row.offersFundedDelivery,
    sellerSuspended: row.farmer.user.status !== 'ACTIVE',
    moderationFlag: row.moderationFlag,
    ordersAccepted: row.farmer.ordersAccepted,
    ordersCompleted: row.farmer.ordersCompleted,
    ratingSumStarsMilli: row.farmer.ratingSumStarsMilli,
    ratingCount: row.farmer.ratingCount,
    farmerVerified: row.farmer.verificationStatus === 'VERIFIED',
  }
}

export const listingRepository: ListingRepository = {
  async findPricingSnapshot(listingId) {
    const row = await prisma.listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: LISTING_SELECT,
    })
    return row ? toSnapshot(row as unknown as ListingRow) : null
  },

  async findPublishedCandidates(input) {
    // docs/04 §5.1 candidate generation: published, inside the availability window, enough stock
    // (or partial fill allowed), seller not suspended, not under a moderation hold.
    const rows = await prisma.listing.findMany({
      where: {
        productId: input.productId,
        status: 'PUBLISHED',
        deletedAt: null,
        availableFrom: { lte: input.at },
        availableTo: { gte: input.at },
        moderationFlag: null,
        farmer: { user: { status: 'ACTIVE' } },
        OR: [
          { quantityAvailableBase: { gte: input.requestedQuantityBase } },
          { allowsPartialFill: true },
        ],
      },
      select: LISTING_SELECT,
      take: input.limit,
    })
    return rows.map((row) => toSnapshot(row as unknown as ListingRow))
  },
}

/* ---------------------------------------------------------------------- addresses */

export const addressRepository: AddressRepository = {
  async findForBuyer(addressId, buyerUserId): Promise<DeliveryDestination | null> {
    // Ownership is part of the query. An address that is not this buyer's is not found.
    const row = await prisma.address.findFirst({
      where: { id: addressId, userId: buyerUserId, deletedAt: null },
      select: {
        id: true,
        recipientName: true,
        recipientPhone: true,
        addressLine: true,
        adminAreaId: true,
        latitude: true,
        longitude: true,
        area: { select: { parentId: true } },
      },
    })
    if (!row) return null

    return {
      addressId: row.id,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      addressLine: row.addressLine,
      adminAreaId: row.adminAreaId,
      districtKey: row.area.parentId,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
    }
  },
}

/* ------------------------------------------------------------------------- quotes */

type QuoteRow = Awaited<ReturnType<typeof prisma.orderQuote.create>>

function toStoredQuote(
  row: QuoteRow,
  listing: {
    listingId: string
    listingVersion: number
    quantityBase: bigint
    unitPricePoisha: bigint
  },
): StoredQuote {
  return {
    id: row.id,
    buyerUserId: row.buyerUserId,
    sellerFarmerProfileId: row.sellerFarmerProfileId,
    listingId: listing.listingId,
    listingVersion: listing.listingVersion,
    quantityBase: listing.quantityBase,
    fulfilmentMode: row.fulfilmentMode as StoredQuote['fulfilmentMode'],
    deliveryAddressId: row.deliveryAddressId,
    unitPricePoisha: listing.unitPricePoisha,
    subtotalPoisha: row.subtotalPoisha,
    deliveryFeePoisha: row.deliveryFeePoisha,
    handlingFeePoisha: row.handlingFeePoisha,
    platformFeePoisha: row.platformFeePoisha,
    buyerTotalPoisha: row.buyerTotalPoisha,
    sellerGrossPoisha: row.sellerGrossPoisha,
    commissionPoisha: row.commissionPoisha,
    commissionBps: row.commissionBps,
    sellerNetPoisha: row.sellerNetPoisha,
    deliveryFundingModel: row.deliveryFundingModel as StoredQuote['deliveryFundingModel'],
    deliveryTariffPoisha: row.deliveryTariffPoisha,
    deliveryFundedBySellerPoisha: row.deliveryFundedBySellerPoisha,
    deliveryFundedByRetailerPoisha: row.deliveryFundedByRetailerPoisha,
    promotionalSubsidyPoisha: row.promotionalSubsidyPoisha,
    subsidyReason: row.subsidyReason,
    contributionMarginPoisha: row.contributionMarginPoisha,
    expectedCostPoisha: row.expectedCostPoisha,
    distanceMeters: row.distanceMeters,
    distanceSource: row.distanceSource,
    pricingVersion: row.pricingVersion,
    configVersions: row.configVersions as Record<string, number>,
    breakdown: row.breakdown,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  }
}

/**
 * The line detail (which listing, at what version, how much) lives in the `lines` JSON column
 * per docs/02 §7, so it is read back from there rather than duplicated into columns.
 */
function readLine(lines: unknown): {
  listingId: string
  listingVersion: number
  quantityBase: bigint
  unitPricePoisha: bigint
} {
  const [first] = Array.isArray(lines) ? (lines as Record<string, string>[]) : []
  return {
    listingId: first?.['listingId'] ?? '',
    listingVersion: Number(first?.['listingVersion'] ?? 0),
    quantityBase: BigInt(first?.['quantityBase'] ?? '0'),
    unitPricePoisha: BigInt(first?.['unitPricePoisha'] ?? '0'),
  }
}

export const quoteRepository: QuoteRepository = {
  async create(input) {
    const row = await prisma.orderQuote.create({
      data: {
        buyerUserId: input.buyerUserId,
        sellerFarmerProfileId: input.sellerFarmerProfileId,
        deliveryAddressId: input.deliveryAddressId,
        fulfilmentMode: input.fulfilmentMode,
        lines: [
          {
            listingId: input.listingId,
            listingVersion: input.listingVersion,
            quantityBase: input.quantityBase.toString(),
            unitPricePoisha: input.unitPricePoisha.toString(),
            lineTotalPoisha: input.subtotalPoisha.toString(),
          },
        ],
        subtotalPoisha: input.subtotalPoisha,
        deliveryFeePoisha: input.deliveryFeePoisha,
        handlingFeePoisha: input.handlingFeePoisha,
        platformFeePoisha: input.platformFeePoisha,
        buyerTotalPoisha: input.buyerTotalPoisha,
        sellerGrossPoisha: input.sellerGrossPoisha,
        commissionPoisha: input.commissionPoisha,
        commissionBps: input.commissionBps,
        sellerNetPoisha: input.sellerNetPoisha,
        deliveryFundingModel: input.deliveryFundingModel,
        deliveryTariffPoisha: input.deliveryTariffPoisha,
        deliveryFundedBySellerPoisha: input.deliveryFundedBySellerPoisha,
        deliveryFundedByRetailerPoisha: input.deliveryFundedByRetailerPoisha,
        promotionalSubsidyPoisha: input.promotionalSubsidyPoisha,
        subsidyReason: input.subsidyReason,
        contributionMarginPoisha: input.contributionMarginPoisha,
        expectedCostPoisha: input.expectedCostPoisha,
        distanceMeters: input.distanceMeters,
        distanceSource: input.distanceSource,
        breakdown: input.breakdown as object,
        pricingVersion: input.pricingVersion,
        configVersions: input.configVersions,
        expiresAt: input.expiresAt,
      },
    })

    return toStoredQuote(row, {
      listingId: input.listingId,
      listingVersion: input.listingVersion,
      quantityBase: input.quantityBase,
      unitPricePoisha: input.unitPricePoisha,
    })
  },

  async findOwned(quoteId, buyerUserId) {
    // Ownership is in the WHERE clause: another buyer's quote id returns null, which the
    // boundary renders as NOT FOUND. A 403 would confirm the quote exists.
    const row = await prisma.orderQuote.findFirst({
      where: { id: quoteId, buyerUserId },
    })
    if (!row) return null
    return toStoredQuote(row, readLine(row.lines))
  },
}

/* ------------------------------------------------------------------ order numbers */

export const orderNumberGenerator: OrderNumberGenerator = {
  next(at: Date): string {
    const yy = String(at.getUTCFullYear()).slice(-2)
    const mm = String(at.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(at.getUTCDate()).padStart(2, '0')
    // Random rather than sequential: a guessable order number leaks daily volume to competitors
    // and invites enumeration. docs/07_SECURITY.md §4.4
    const suffix = randomBytes(3).toString('hex').toUpperCase()
    return `LG-${yy}${mm}${dd}-${suffix}`
  },
}

/* ----------------------------------------------------------------- subsidy budget */

export const subsidyBudgetPort: SubsidyBudgetPort = {
  async hasHeadroom(at: Date): Promise<boolean> {
    const snapshot = await configPort.snapshot(at)
    const budget = snapshot.get('pilot.lossBudget')
    // Open decision Q1. Until a budget exists the controls have nothing to enforce, so subsidy is
    // refused rather than assumed affordable. docs/06 §6.1
    if (!budget) return false

    const now = at.getTime()
    const withinPeriod =
      new Date(budget.periodStart).getTime() <= now && now <= new Date(budget.periodEnd).getTime()
    if (!withinPeriod) return false

    // Spend is derived from the ledger, never self-reported. The ledger arrives with the
    // settlement phase; until then a configured budget is treated as having headroom only if it
    // is non-empty, and the per-order approval controls of docs/10 §9.2 remain manual.
    return Object.keys(budget.caps).length > 0
  },
}

/* ------------------------------------------------------------- atomic order placement */

export const orderPlacement: OrderPlacementPort = {
  async place(command: PlaceOrderCommand): Promise<PlaceOrderOutcome> {
    const { quote, item } = command

    // Layer 1 idempotency: an identical request that already succeeded returns its stored order
    // rather than placing a second one. docs/06 §7
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: command.idempotencyKey },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        buyerTotalPoisha: true,
        acceptanceDeadline: true,
        placedAt: true,
      },
    })
    if (existing) {
      return { kind: 'REPLAYED', order: { ...existing, status: String(existing.status) } }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        /*
         * The normative reservation query, docs/02_DATABASE.md §13. Conditional on status,
         * version and available stock in a single statement, so two concurrent checkouts for the
         * last of a crop cannot both succeed: the second updates zero rows.
         */
        const reserved = await tx.$executeRaw`
          UPDATE listings
             SET quantity_available_base = quantity_available_base - ${item.quantityBase}::bigint,
                 quantity_reserved_base  = quantity_reserved_base  + ${item.quantityBase}::bigint,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${item.listingId}::uuid
             AND status = 'PUBLISHED'
             AND deleted_at IS NULL
             AND version = ${quote.listingVersion}
             AND unit_price_poisha = ${quote.unitPricePoisha}::bigint
             AND quantity_available_base >= ${item.quantityBase}::bigint
        `

        if (reserved === 0) {
          // Distinguish "gone" from "moved on" so the buyer gets an accurate message.
          const current = await tx.listing.findUnique({
            where: { id: item.listingId },
            select: {
              status: true,
              version: true,
              quantityAvailableBase: true,
              unitPricePoisha: true,
            },
          })
          if (!current || current.status !== 'PUBLISHED')
            throw new PlacementFailure('LISTING_UNAVAILABLE')
          if (
            current.version !== quote.listingVersion ||
            current.unitPricePoisha !== quote.unitPricePoisha
          ) {
            throw new PlacementFailure('LISTING_CHANGED')
          }
          throw new PlacementFailure('INSUFFICIENT_INVENTORY')
        }

        /*
         * Consume the quote conditionally too. `consumed_at IS NULL` in the WHERE clause makes a
         * second order against the same quote impossible even if two requests arrive at once,
         * and the UNIQUE index on consumed_by_order_id is the backstop.
         */
        const orderId = randomUUID()

        const consumed = await tx.$executeRaw`
          UPDATE order_quotes
             SET consumed_at = ${command.now},
                 consumed_by_order_id = ${orderId}::uuid
           WHERE id = ${quote.id}::uuid
             AND consumed_at IS NULL
             AND buyer_user_id = ${quote.buyerUserId}::uuid
        `
        if (consumed === 0) throw new PlacementFailure('QUOTE_ALREADY_USED')

        const order = await tx.order.create({
          data: {
            id: orderId,
            orderNumber: command.orderNumber,
            buyerUserId: quote.buyerUserId,
            sellerFarmerProfileId: quote.sellerFarmerProfileId,
            quoteId: quote.id,
            status: 'PENDING',
            fulfilmentMode: quote.fulfilmentMode,
            buyerSegment: command.buyerSegment,
            paymentMethod: command.paymentMethod as 'CASH_ON_DELIVERY',
            paymentStatus: 'UNPAID',

            // Money COPIED from the quote. Never recomputed from the live listing.
            subtotalPoisha: quote.subtotalPoisha,
            deliveryFeePoisha: quote.deliveryFeePoisha,
            handlingFeePoisha: quote.handlingFeePoisha,
            platformFeePoisha: quote.platformFeePoisha,
            buyerTotalPoisha: quote.buyerTotalPoisha,
            sellerGrossPoisha: quote.sellerGrossPoisha,
            commissionPoisha: quote.commissionPoisha,
            commissionBps: quote.commissionBps,
            sellerNetPoisha: quote.sellerNetPoisha,

            deliveryFundingModel: quote.deliveryFundingModel,
            deliveryTariffPoisha: quote.deliveryTariffPoisha,
            deliveryFundedBySellerPoisha: quote.deliveryFundedBySellerPoisha,
            deliveryFundedByRetailerPoisha: quote.deliveryFundedByRetailerPoisha,
            promotionalSubsidyPoisha: quote.promotionalSubsidyPoisha,
            subsidyReason: quote.subsidyReason,
            contributionMarginPoisha: quote.contributionMarginPoisha,

            deliveryRecipientName: command.delivery.recipientName,
            deliveryRecipientPhone: command.delivery.recipientPhone,
            deliveryAddressLine: command.delivery.addressLine,
            deliveryAreaId: command.delivery.areaId,
            deliveryLatitude: command.delivery.latitude,
            deliveryLongitude: command.delivery.longitude,
            distanceMeters: command.delivery.distanceMeters,

            acceptanceDeadline: command.acceptanceDeadline,
            placedAt: command.now,
            idempotencyKey: command.idempotencyKey,

            items: {
              create: {
                listingId: item.listingId,
                productId: item.productId,
                productNameEn: item.productNameEn,
                productNameBn: item.productNameBn,
                varietyName: item.varietyName,
                grade: item.grade as 'A',
                farmName: item.farmName,
                saleUnit: item.saleUnit,
                saleUnitInBaseUnits: item.saleUnitInBaseUnits,
                unitPricePoisha: item.unitPricePoisha,
                quantityBase: item.quantityBase,
                lineTotalPoisha: item.lineTotalPoisha,
                harvestedAt: item.harvestedAt,
              },
            },

            // The status column is a projection of this append-only log.
            events: {
              create: {
                sequence: 1,
                fromStatus: null,
                toStatus: 'PENDING',
                actorUserId: quote.buyerUserId,
                reason: 'CHECKOUT',
              },
            },

            reservations: {
              create: {
                listingId: item.listingId,
                buyerUserId: quote.buyerUserId,
                quantityBase: item.quantityBase,
                status: 'HELD',
                expiresAt: command.reservationExpiresAt,
              },
            },
          },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            buyerTotalPoisha: true,
            acceptanceDeadline: true,
            placedAt: true,
          },
        })

        return {
          kind: 'PLACED' as const,
          order: { ...order, status: String(order.status) },
        }
      })
    } catch (cause) {
      if (cause instanceof PlacementFailure) {
        return { kind: 'FAILED', reason: cause.reason }
      }
      throw cause
    }
  },
}

/** Thrown to roll the transaction back with a reason the caller can render. */
class PlacementFailure extends Error {
  constructor(
    readonly reason: NonNullable<Extract<PlaceOrderOutcome, { kind: 'FAILED' }>['reason']>,
  ) {
    super(reason)
    this.name = 'PlacementFailure'
  }
}
