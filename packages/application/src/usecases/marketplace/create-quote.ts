/**
 * Create a quote.
 *
 * The quote is the pricing authority and the anti-tampering mechanism. Everything economic is
 * computed here, server-side, from the listing as it actually is and from versioned
 * `PlatformConfig`. The client sends what it wants to buy; it never sends what anything costs.
 *
 * ```text
 * Buyer selects listing + quantity + address + fulfilment mode
 *   -> compute breakdown -> persist OrderQuote (TTL from config)
 *   -> client receives quoteId + rendered breakdown
 * ```
 *
 * Refs: docs/04_MARKETPLACE.md §8; docs/P2_DELIVERED_COST.md §7; docs/07_SECURITY.md §5
 */

import { Geo } from '@langgol/domain/geo'
import {
  computeBreakdown,
  PricingError,
  serializeBreakdown,
  toBuyerFacing,
  type DeliveryFundingModel,
  type FulfilmentMode,
  type SerializedBreakdown,
} from '@langgol/domain/pricing'
import { Errors, err, ok, type Result } from '@langgol/shared'
import type { Clock } from '../../ports/index.js'
import type {
  AddressRepository,
  ConfigPort,
  ListingRepository,
  QuoteRepository,
  StoredQuote,
  SubsidyBudgetPort,
} from '../../ports/marketplace.js'
import { AppError } from '@langgol/shared'

export interface CreateQuoteInput {
  readonly buyerUserId: string
  readonly listingId: string
  /** Requested quantity in base units. Milligrams for mass. */
  readonly quantityBase: bigint
  readonly fulfilmentMode: FulfilmentMode
  readonly deliveryAddressId?: string | null
  readonly paymentMethod: string
  /** Defaults to `delivery.fundingModel.default` when absent. */
  readonly fundingModel?: DeliveryFundingModel
  readonly subsidyReason?: string | null
  /** Ops-only: the amount of tariff the platform absorbs under PROMOTIONAL_SUBSIDY. */
  readonly requestedSubsidyPoisha?: bigint
}

export interface CreateQuoteResult {
  readonly quoteId: string
  readonly expiresAt: Date
  /** Safe to send to a browser: no margin, no trip cost, no seller economics. */
  readonly breakdown: Omit<SerializedBreakdown, 'internal' | 'seller'>
  readonly listing: {
    readonly listingId: string
    readonly productNameEn: string
    readonly productNameBn: string
    readonly farmName: string
    readonly grade: string
  }
}

export interface CreateQuoteDeps {
  readonly clock: Clock
  readonly config: ConfigPort
  readonly listings: ListingRepository
  readonly addresses: AddressRepository
  readonly quotes: QuoteRepository
  readonly subsidyBudget: SubsidyBudgetPort
}

/** Vehicle chosen by weight — the smallest class that can carry the load. */
const VEHICLE_BY_CAPACITY_ORDER = ['MOTORCYCLE', 'VAN', 'CNG', 'PICKUP', 'TRUCK'] as const

const MG_PER_KG = 1000000n

export async function createQuote(
  input: CreateQuoteInput,
  deps: CreateQuoteDeps,
): Promise<Result<CreateQuoteResult, AppError>> {
  const now = deps.clock.now()
  const config = await deps.config.snapshot(now)

  if (input.quantityBase <= 0n) {
    return err(Errors.validation('Quantity must be greater than zero'))
  }

  /* ------------------------------------------------------- the listing, server-side */

  const listing = await deps.listings.findPricingSnapshot(input.listingId)
  if (!listing || listing.status !== 'PUBLISHED' || listing.sellerSuspended) {
    return err(Errors.notFound('Listing'))
  }
  if (now < listing.availableFrom || now > listing.availableTo) {
    return err(Errors.preconditionFailed('This listing is outside its availability window'))
  }

  const fullyCovers = listing.quantityAvailableBase >= input.quantityBase
  if (!fullyCovers && !listing.allowsPartialFill) {
    return err(
      Errors.validation('The farmer does not have this much available', {
        availableBase: listing.quantityAvailableBase.toString(),
      }),
    )
  }
  const quantityBase = fullyCovers ? input.quantityBase : listing.quantityAvailableBase

  if (quantityBase < listing.minOrderBase) {
    return err(
      Errors.validation('Below the minimum order for this listing', {
        minOrderBase: listing.minOrderBase.toString(),
      }),
    )
  }

  /* -------------------------------------------------------------- fulfilment mode */

  if (input.fulfilmentMode === 'BUYER_PICKUP' && !listing.offersPickup) {
    return err(Errors.preconditionFailed('This listing does not offer pickup'))
  }
  if (input.fulfilmentMode === 'SELLER_DELIVERY' && !listing.offersSellerDelivery) {
    return err(Errors.preconditionFailed('This farmer does not deliver'))
  }

  /* ------------------------------------------------------------------- distance */

  const needsAddress = input.fulfilmentMode !== 'BUYER_PICKUP'
  let destination = null
  if (needsAddress) {
    if (!input.deliveryAddressId) {
      return err(Errors.validation('A delivery address is required for this fulfilment mode'))
    }
    destination = await deps.addresses.findForBuyer(input.deliveryAddressId, input.buyerUserId)
    if (!destination) return err(Errors.notFound('Address'))
  }

  const circuityFactor = Geo.resolveCircuityFactor(
    config.require('delivery.circuityFactor'),
    destination?.districtKey ?? listing.districtKey,
  )

  let roadMeters = 0
  let distanceSource: string | null = null

  if (needsAddress) {
    const from = {
      latitude: listing.latitude ?? Number.NaN,
      longitude: listing.longitude ?? Number.NaN,
    }
    const to = {
      latitude: destination?.latitude ?? Number.NaN,
      longitude: destination?.longitude ?? Number.NaN,
    }
    if (!Geo.isValidPoint(from) || !Geo.isValidPoint(to)) {
      // Many rural addresses have no coordinates at all. Refusing is more honest than pricing a
      // delivery on a distance we cannot compute. docs/08_BANGLADESH_CONTEXT.md §2
      return err(
        Errors.preconditionFailed(
          'Delivery cannot be priced without coordinates for both the farm and the address',
        ),
      )
    }
    const estimate = Geo.estimateRoadDistance(from, to, circuityFactor)
    roadMeters = estimate.roadMeters
    distanceSource = estimate.source
  }

  /* ------------------------------------------------------------- funding decision */

  const fundingModel = input.fundingModel ?? config.require('delivery.fundingModel.default')
  const subsidyBudgetAvailable = await deps.subsidyBudget.hasHeadroom(now)

  /* ---------------------------------------------------------------- the breakdown */

  const transitHours = estimateTransitHours(roadMeters)

  let breakdown
  try {
    breakdown = computeBreakdown(
      {
        lines: [
          {
            listingId: listing.listingId,
            productId: listing.productId,
            unitPricePoisha: listing.unitPricePoisha as never,
            saleUnitInBaseUnits: listing.saleUnitInBaseUnits,
            quantityBase,
            perishability: listing.perishability,
          },
        ],
        fulfilmentMode: input.fulfilmentMode,
        fundingModel,
        fundingContext: {
          subsidyBudgetAvailable,
          subsidyReason: input.subsidyReason ?? null,
          ...(input.requestedSubsidyPoisha === undefined
            ? {}
            : { requestedSubsidyPoisha: input.requestedSubsidyPoisha as never }),
          sellerOffersFundedDelivery: listing.offersFundedDelivery,
        },
        paymentMethod: input.paymentMethod,
        roadMeters,
        vehicleClass: selectVehicleClass(quantityBase, config),
        transitHours,
        hasColdChain: false,
        stops: 1,
      },
      config,
    )
  } catch (cause) {
    if (cause instanceof PricingError) {
      return err(pricingErrorToAppError(cause))
    }
    throw cause
  }

  /* ------------------------------------------------------------------- persist */

  const ttlMinutes = config.require('quote.ttlMinutes')
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000)
  const serialized = serializeBreakdown(breakdown)

  const stored: Omit<StoredQuote, 'id' | 'consumedAt' | 'createdAt'> = {
    buyerUserId: input.buyerUserId,
    sellerFarmerProfileId: listing.farmerProfileId,
    listingId: listing.listingId,
    listingVersion: listing.version,
    quantityBase,
    fulfilmentMode: input.fulfilmentMode,
    deliveryAddressId: destination?.addressId ?? null,
    unitPricePoisha: listing.unitPricePoisha,
    subtotalPoisha: breakdown.buyer.subtotalPoisha,
    deliveryFeePoisha: breakdown.buyer.deliveryFeePoisha,
    handlingFeePoisha: breakdown.buyer.handlingFeePoisha,
    platformFeePoisha: breakdown.buyer.platformFeePoisha,
    buyerTotalPoisha: breakdown.buyer.buyerTotalPoisha,
    sellerGrossPoisha: breakdown.seller.sellerGrossPoisha,
    commissionPoisha: breakdown.seller.commissionPoisha,
    commissionBps: breakdown.seller.commissionBps,
    sellerNetPoisha: breakdown.seller.sellerNetPoisha,
    deliveryFundingModel: fundingModel,
    deliveryTariffPoisha: breakdown.funding.tariffPoisha,
    deliveryFundedBySellerPoisha: breakdown.funding.fundedBySellerPoisha,
    deliveryFundedByRetailerPoisha: breakdown.funding.fundedByRetailerPoisha,
    promotionalSubsidyPoisha: breakdown.funding.promotionalSubsidyPoisha,
    subsidyReason: breakdown.funding.subsidyReason,
    contributionMarginPoisha: breakdown.internal.margin.marginPoisha,
    expectedCostPoisha: breakdown.internal.cost.totalPoisha,
    distanceMeters: needsAddress ? roadMeters : null,
    distanceSource,
    pricingVersion: breakdown.pricingVersion,
    configVersions: breakdown.configVersions,
    breakdown: serialized,
    expiresAt,
  }

  const saved = await deps.quotes.create(stored)

  return ok({
    quoteId: saved.id,
    expiresAt: saved.expiresAt,
    breakdown: toBuyerFacing(serialized),
    listing: {
      listingId: listing.listingId,
      productNameEn: listing.productNameEn,
      productNameBn: listing.productNameBn,
      farmName: listing.farmName,
      grade: listing.grade,
    },
  })
}

/**
 * Expected transit time, used only by the spoilage model.
 *
 * A crude average speed over an estimated road distance — deliberately so, because the MVP has no
 * routing engine and pretending otherwise would put false precision into the cost model. It is
 * replaced by measured trip durations once `DeliveryTrip` history exists.
 */
function estimateTransitHours(roadMeters: number): number {
  if (roadMeters <= 0) return 0
  const AVERAGE_SPEED_KMH = 25
  const MINIMUM_HANDLING_HOURS = 2
  return MINIMUM_HANDLING_HOURS + roadMeters / 1000 / AVERAGE_SPEED_KMH
}

/** Smallest configured vehicle that can carry the load. Capacities live in PlatformConfig. */
function selectVehicleClass(
  quantityBase: bigint,
  config: Parameters<typeof computeBreakdown>[1],
): string {
  const vehicles = config.require('delivery.internalCost').vehicles
  const requiredKg = Number(quantityBase / MG_PER_KG)

  const affordable = VEHICLE_BY_CAPACITY_ORDER.filter((name) => vehicles[name] !== undefined)
    .map((name) => ({ name, capacityKg: vehicles[name]!.capacityKg }))
    .sort((a, b) => a.capacityKg - b.capacityKg)

  const fit = affordable.find((vehicle) => vehicle.capacityKg >= requiredKg)
  return fit?.name ?? affordable[affordable.length - 1]?.name ?? 'VAN'
}

/** Pricing failures are expected outcomes with distinct buyer-facing meanings, not faults. */
function pricingErrorToAppError(error: PricingError): AppError {
  switch (error.code) {
    case 'OPS_QUOTE_ONLY':
      return new AppError('PRECONDITION_FAILED', error.message, {
        userFacing: true,
        detail: error.detail ?? '',
        meta: { code: error.code },
      })
    case 'SUBSIDY_BUDGET_EXHAUSTED':
    case 'FUNDING_MODEL_DISABLED':
    case 'SELLER_FUNDING_NOT_OFFERED':
      return new AppError('PRECONDITION_FAILED', error.message, {
        userFacing: true,
        meta: { code: error.code },
      })
    case 'SUBSIDY_REASON_REQUIRED':
    case 'SUBSIDY_REASON_UNKNOWN':
    case 'INVALID_INPUT':
      return Errors.validation(error.message, { code: error.code })
    default:
      return Errors.internal(`Pricing failed: ${error.message}`, error)
  }
}
