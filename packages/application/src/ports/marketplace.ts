/**
 * Marketplace ports — the interfaces the quote and checkout use cases own.
 *
 * The checkout write is deliberately a **single port method** rather than a set of repository
 * calls the use case orchestrates. Reserving inventory, creating the order and consuming the
 * quote must happen in one database transaction; expressing that as three ports would let a
 * caller do two of the three, which is precisely the bug that oversells a farmer's crop.
 *
 * Refs: docs/03_ARCHITECTURE.md §2.1; docs/02_DATABASE.md §13
 */

import type { ConfigSnapshot } from '@langgol/domain/config'
import type {
  DeliveryFundingModel,
  FulfilmentMode,
  PerishabilityClass,
} from '@langgol/domain/pricing'

/** Resolved platform configuration at a point in time. Every price records the versions used. */
export interface ConfigPort {
  snapshot(at: Date): Promise<ConfigSnapshot>
}

/**
 * Everything the pricing engine needs about one listing, read server-side.
 *
 * The client never supplies any of it. There is no code path that reads a price, a seller id or
 * a total from a request body. docs/07_SECURITY.md §5
 */
export interface ListingPricingSnapshot {
  readonly listingId: string
  readonly version: number
  readonly farmerProfileId: string
  readonly farmName: string
  readonly productId: string
  readonly productNameEn: string
  readonly productNameBn: string
  readonly varietyName: string | null
  readonly grade: 'A' | 'B' | 'C' | 'UNGRADED'
  readonly perishability: PerishabilityClass
  readonly shelfLifeHours: number
  readonly saleUnit: string
  readonly saleUnitInBaseUnits: bigint
  readonly unitPricePoisha: bigint
  readonly quantityAvailableBase: bigint
  readonly minOrderBase: bigint
  readonly allowsPartialFill: boolean
  readonly status: string
  readonly availableFrom: Date
  readonly availableTo: Date
  readonly harvestedAt: Date | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly adminAreaId: string
  readonly districtKey: string | null
  readonly offersPickup: boolean
  readonly offersSellerDelivery: boolean
  readonly offersFundedDelivery: boolean
  readonly sellerSuspended: boolean
  readonly moderationFlag: string | null
  /** Reputation inputs for ranking. Derived, never authoritative for money. */
  readonly ordersAccepted: number
  readonly ordersCompleted: number
  readonly ratingSumStarsMilli: number
  readonly ratingCount: number
  readonly farmerVerified: boolean
}

export interface ListingRepository {
  findPricingSnapshot(listingId: string): Promise<ListingPricingSnapshot | null>
  /** Candidate generation for ranking — docs/04 §5.1 filters applied in the query. */
  findPublishedCandidates(input: {
    readonly productId: string
    readonly at: Date
    readonly requestedQuantityBase: bigint
    readonly limit: number
  }): Promise<ListingPricingSnapshot[]>
}

/** A delivery destination, resolved server-side from the buyer's saved address. */
export interface DeliveryDestination {
  readonly addressId: string
  readonly recipientName: string
  readonly recipientPhone: string
  readonly addressLine: string
  readonly adminAreaId: string
  readonly districtKey: string | null
  readonly latitude: number | null
  readonly longitude: number | null
}

export interface AddressRepository {
  findForBuyer(addressId: string, buyerUserId: string): Promise<DeliveryDestination | null>
}

export interface StoredQuote {
  readonly id: string
  readonly buyerUserId: string
  readonly sellerFarmerProfileId: string
  readonly listingId: string
  readonly listingVersion: number
  readonly quantityBase: bigint
  readonly fulfilmentMode: FulfilmentMode
  readonly deliveryAddressId: string | null
  readonly unitPricePoisha: bigint
  readonly subtotalPoisha: bigint
  readonly deliveryFeePoisha: bigint
  readonly handlingFeePoisha: bigint
  readonly platformFeePoisha: bigint
  readonly buyerTotalPoisha: bigint
  readonly sellerGrossPoisha: bigint
  readonly commissionPoisha: bigint
  readonly commissionBps: number
  readonly sellerNetPoisha: bigint
  readonly deliveryFundingModel: DeliveryFundingModel
  readonly deliveryTariffPoisha: bigint
  readonly deliveryFundedBySellerPoisha: bigint
  readonly deliveryFundedByRetailerPoisha: bigint
  readonly promotionalSubsidyPoisha: bigint
  readonly subsidyReason: string | null
  readonly contributionMarginPoisha: bigint
  readonly expectedCostPoisha: bigint
  readonly distanceMeters: number | null
  readonly distanceSource: string | null
  readonly pricingVersion: string
  readonly configVersions: Record<string, number>
  readonly breakdown: unknown
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly createdAt: Date
}

export interface QuoteRepository {
  create(input: Omit<StoredQuote, 'id' | 'consumedAt' | 'createdAt'>): Promise<StoredQuote>
  /**
   * Scoped to the owner by design. Another user's quote id returns `null`, which the boundary
   * renders as *not found* rather than *forbidden* — a 403 confirms the resource exists, and
   * that is itself a disclosure. docs/04 §8; docs/07_SECURITY.md §4.4
   */
  findOwned(quoteId: string, buyerUserId: string): Promise<StoredQuote | null>
}

export interface PlacedOrder {
  readonly id: string
  readonly orderNumber: string
  readonly status: string
  readonly buyerTotalPoisha: bigint
  readonly acceptanceDeadline: Date
  readonly placedAt: Date
}

/** Why a checkout could not complete. Each maps to a distinct buyer-facing message. */
export type CheckoutFailureReason =
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_ALREADY_USED'
  | 'LISTING_CHANGED'
  | 'LISTING_UNAVAILABLE'
  | 'INSUFFICIENT_INVENTORY'

export interface PlaceOrderCommand {
  readonly quote: StoredQuote
  readonly idempotencyKey: string
  readonly paymentMethod: string
  readonly buyerSegment: 'CONSUMER' | 'RETAILER'
  readonly orderNumber: string
  readonly acceptanceDeadline: Date
  readonly reservationExpiresAt: Date
  readonly now: Date
  readonly item: {
    readonly listingId: string
    readonly productId: string
    readonly productNameEn: string
    readonly productNameBn: string
    readonly varietyName: string | null
    readonly grade: string
    readonly farmName: string
    readonly saleUnit: string
    readonly saleUnitInBaseUnits: bigint
    readonly unitPricePoisha: bigint
    readonly quantityBase: bigint
    readonly lineTotalPoisha: bigint
    readonly harvestedAt: Date | null
  }
  readonly delivery: {
    readonly recipientName: string | null
    readonly recipientPhone: string | null
    readonly addressLine: string | null
    readonly areaId: string | null
    readonly latitude: number | null
    readonly longitude: number | null
    readonly distanceMeters: number | null
  }
}

export type PlaceOrderOutcome =
  | { readonly kind: 'PLACED'; readonly order: PlacedOrder }
  /** An identical request already succeeded. The stored order is returned, not a second one. */
  | { readonly kind: 'REPLAYED'; readonly order: PlacedOrder }
  | { readonly kind: 'FAILED'; readonly reason: CheckoutFailureReason }

/**
 * The atomic checkout write.
 *
 * One transaction: re-read the listing at its quoted version, reserve inventory with the
 * conditional UPDATE of docs/02 §13, create the order with money copied from the quote, mark the
 * quote consumed. Any failure rolls back the whole thing — a reservation without an order is a
 * farmer's crop locked for nothing.
 */
export interface OrderPlacementPort {
  place(command: PlaceOrderCommand): Promise<PlaceOrderOutcome>
}

/** Generates the human-readable order number, e.g. `LG-260813-0A3F2`. */
export interface OrderNumberGenerator {
  next(at: Date): string
}

/**
 * Whether the pilot loss budget still has headroom for a subsidised delivery.
 *
 * Spend is derived from the ledger, never self-reported. Until the budget is set — an open
 * product decision — this returns false and subsidised models are refused rather than assumed
 * affordable. docs/06 §6.1; docs/10 §9.
 */
export interface SubsidyBudgetPort {
  hasHeadroom(at: Date): Promise<boolean>
}
