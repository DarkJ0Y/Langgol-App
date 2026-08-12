/**
 * In-memory doubles for the marketplace ports.
 *
 * The `FakeOrderPlacement` deliberately reproduces the *atomicity* of the real adapter — it
 * re-checks the listing version and stock, decrements inventory, creates the reservation and
 * consumes the quote as one indivisible step, and rolls nothing back halfway. A fake that is
 * merely permissive would let the use-case tests pass while the invariant that matters goes
 * untested.
 */

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
} from '../../../ports/marketplace.js'
import type { Clock } from '../../../ports/index.js'
import { fixtureConfig } from '@langgol/domain/testing'
import type { ConfigEntry } from '@langgol/domain/config'

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000)
  }
}

export class FakeConfig implements ConfigPort {
  constructor(private readonly overrides: readonly ConfigEntry[] = []) {}
  snapshot(_at: Date): Promise<ReturnType<typeof fixtureConfig>> {
    return Promise.resolve(fixtureConfig(this.overrides))
  }
}

/** Bogura town and Shibganj — the docs/04 §7 corridor, about 12 km apart. */
export const SHIBGANJ = { latitude: 24.9505, longitude: 89.3016 }
export const BOGURA = { latitude: 24.8465, longitude: 89.3776 }

export function makeListing(
  overrides: Partial<ListingPricingSnapshot> = {},
): ListingPricingSnapshot {
  return {
    listingId: 'listing-tomato-1',
    version: 0,
    farmerProfileId: 'farmer-rahim',
    farmName: "Rahim's Farm",
    productId: 'product-tomato',
    productNameEn: 'Tomato',
    productNameBn: 'টমেটো',
    varietyName: null,
    grade: 'A',
    perishability: 'HIGHLY_PERISHABLE',
    shelfLifeHours: 96,
    saleUnit: 'KG',
    saleUnitInBaseUnits: 1000000n,
    unitPricePoisha: 3000n,
    quantityAvailableBase: 200000000n, // 200 kg
    minOrderBase: 0n,
    allowsPartialFill: false,
    status: 'PUBLISHED',
    availableFrom: new Date('2026-08-01T00:00:00.000Z'),
    availableTo: new Date('2026-09-01T00:00:00.000Z'),
    harvestedAt: new Date('2026-08-13T00:00:00.000Z'),
    latitude: SHIBGANJ.latitude,
    longitude: SHIBGANJ.longitude,
    adminAreaId: 'area-shibganj',
    districtKey: null,
    offersPickup: true,
    offersSellerDelivery: false,
    offersFundedDelivery: false,
    sellerSuspended: false,
    moderationFlag: null,
    ordersAccepted: 22,
    ordersCompleted: 20,
    ratingSumStarsMilli: 40000,
    ratingCount: 10,
    farmerVerified: true,
    ...overrides,
  }
}

export class FakeListings implements ListingRepository {
  readonly byId = new Map<string, ListingPricingSnapshot>()

  constructor(listings: readonly ListingPricingSnapshot[]) {
    for (const listing of listings) this.byId.set(listing.listingId, listing)
  }

  findPricingSnapshot(listingId: string): Promise<ListingPricingSnapshot | null> {
    return Promise.resolve(this.byId.get(listingId) ?? null)
  }

  findPublishedCandidates(input: {
    productId: string
    at: Date
    requestedQuantityBase: bigint
    limit: number
  }): Promise<ListingPricingSnapshot[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter(
          (listing) =>
            listing.productId === input.productId &&
            listing.status === 'PUBLISHED' &&
            !listing.sellerSuspended,
        )
        .slice(0, input.limit),
    )
  }

  /** Simulate the farmer editing the listing between quote and checkout. */
  mutate(listingId: string, changes: Partial<ListingPricingSnapshot>): void {
    const current = this.byId.get(listingId)
    if (current) this.byId.set(listingId, { ...current, ...changes })
  }
}

export class FakeAddresses implements AddressRepository {
  constructor(private readonly addresses: readonly (DeliveryDestination & { ownerId: string })[]) {}

  findForBuyer(addressId: string, buyerUserId: string): Promise<DeliveryDestination | null> {
    const found = this.addresses.find(
      (address) => address.addressId === addressId && address.ownerId === buyerUserId,
    )
    return Promise.resolve(found ?? null)
  }
}

export function makeAddress(ownerId = 'buyer-1'): DeliveryDestination & { ownerId: string } {
  return {
    ownerId,
    addressId: 'address-1',
    recipientName: 'Karim Uddin',
    recipientPhone: '+8801712345678',
    addressLine: '12 Station Road',
    adminAreaId: 'area-bogura',
    districtKey: null,
    latitude: BOGURA.latitude,
    longitude: BOGURA.longitude,
  }
}

export class FakeQuotes implements QuoteRepository {
  readonly rows = new Map<string, StoredQuote>()
  private sequence = 0

  create(input: Omit<StoredQuote, 'id' | 'consumedAt' | 'createdAt'>): Promise<StoredQuote> {
    this.sequence += 1
    const row: StoredQuote = {
      ...input,
      id: `quote-${String(this.sequence)}`,
      consumedAt: null,
      createdAt: new Date(),
    }
    this.rows.set(row.id, row)
    return Promise.resolve(row)
  }

  findOwned(quoteId: string, buyerUserId: string): Promise<StoredQuote | null> {
    const row = this.rows.get(quoteId)
    // Ownership is part of the lookup, not a check afterwards: another buyer's id is not found.
    return Promise.resolve(row && row.buyerUserId === buyerUserId ? row : null)
  }

  markConsumed(quoteId: string, at: Date): void {
    const row = this.rows.get(quoteId)
    if (row) this.rows.set(quoteId, { ...row, consumedAt: at })
  }
}

export class FakeSubsidyBudget implements SubsidyBudgetPort {
  constructor(private readonly available: boolean) {}
  hasHeadroom(_at: Date): Promise<boolean> {
    return Promise.resolve(this.available)
  }
}

export class FakeOrderNumbers implements OrderNumberGenerator {
  private sequence = 0
  next(_at: Date): string {
    this.sequence += 1
    return `LG-260813-${String(this.sequence).padStart(5, '0')}`
  }
}

/**
 * Atomic order placement, in memory.
 *
 * Mirrors the real transaction: idempotency first, then the conditional stock check, then the
 * inventory move, reservation, order and quote consumption together.
 */
export class FakeOrderPlacement implements OrderPlacementPort {
  readonly placed: PlaceOrderCommand[] = []
  readonly reservations: { listingId: string; quantityBase: bigint; status: string }[] = []
  private readonly byIdempotencyKey = new Map<string, PlaceOrderOutcome>()
  private sequence = 0

  constructor(
    private readonly listings: FakeListings,
    private readonly quotes: FakeQuotes,
  ) {}

  place(command: PlaceOrderCommand): Promise<PlaceOrderOutcome> {
    const replay = this.byIdempotencyKey.get(command.idempotencyKey)
    if (replay && replay.kind === 'PLACED') {
      return Promise.resolve({ kind: 'REPLAYED', order: replay.order })
    }

    const listing = this.listings.byId.get(command.item.listingId)
    if (!listing || listing.status !== 'PUBLISHED') {
      return Promise.resolve({ kind: 'FAILED', reason: 'LISTING_UNAVAILABLE' })
    }
    if (listing.version !== command.quote.listingVersion) {
      return Promise.resolve({ kind: 'FAILED', reason: 'LISTING_CHANGED' })
    }
    // The conditional UPDATE of docs/02 §13, expressed in memory.
    if (listing.quantityAvailableBase < command.item.quantityBase) {
      return Promise.resolve({ kind: 'FAILED', reason: 'INSUFFICIENT_INVENTORY' })
    }
    if (command.quote.consumedAt !== null) {
      return Promise.resolve({ kind: 'FAILED', reason: 'QUOTE_ALREADY_USED' })
    }

    this.listings.mutate(listing.listingId, {
      quantityAvailableBase: listing.quantityAvailableBase - command.item.quantityBase,
    })
    this.reservations.push({
      listingId: listing.listingId,
      quantityBase: command.item.quantityBase,
      status: 'HELD',
    })
    this.quotes.markConsumed(command.quote.id, command.now)
    this.placed.push(command)

    this.sequence += 1
    const outcome: PlaceOrderOutcome = {
      kind: 'PLACED',
      order: {
        id: `order-${String(this.sequence)}`,
        orderNumber: command.orderNumber,
        status: 'PENDING',
        buyerTotalPoisha: command.quote.buyerTotalPoisha,
        acceptanceDeadline: command.acceptanceDeadline,
        placedAt: command.now,
      },
    }
    this.byIdempotencyKey.set(command.idempotencyKey, outcome)
    return Promise.resolve(outcome)
  }
}
