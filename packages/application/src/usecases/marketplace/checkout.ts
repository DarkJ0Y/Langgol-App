/**
 * Checkout.
 *
 * The request carries `{ quoteId, idempotencyKey, paymentMethod }` and **nothing else that
 * matters**: no prices, no totals, no seller id, no discounts. Those fields are not read from the
 * request body anywhere in this file or below it.
 *
 * ```text
 * owns? · not consumed? · not expired? · listing still PUBLISHED at the same price? · stock?
 *   pass -> reserve inventory -> create Order (money copied from the quote) -> consume quote
 *   fail -> typed error + a freshly generated quote, with the difference shown to the buyer
 * ```
 *
 * Price drift never silently reprices. The buyer is told and re-consents.
 *
 * Refs: docs/04_MARKETPLACE.md §8, §9; docs/06_FINANCIAL_ARCHITECTURE.md §7
 */

import { Errors, err, ok, type Result, type AppError } from '@langgol/shared'
import type { Clock } from '../../ports/index.js'
import type {
  CheckoutFailureReason,
  ConfigPort,
  ListingRepository,
  OrderNumberGenerator,
  OrderPlacementPort,
  PlacedOrder,
  QuoteRepository,
  StoredQuote,
} from '../../ports/marketplace.js'
import { createQuote, type CreateQuoteDeps, type CreateQuoteResult } from './create-quote.js'

export interface CheckoutInput {
  readonly buyerUserId: string
  readonly buyerSegment: 'CONSUMER' | 'RETAILER'
  readonly quoteId: string
  readonly idempotencyKey: string
  readonly paymentMethod: string
}

export interface CheckoutSuccess {
  readonly order: PlacedOrder
  /** True when an identical request had already succeeded and no second order was created. */
  readonly replayed: boolean
}

/**
 * A checkout that failed for a reason the buyer can act on, carrying a fresh quote so the app can
 * show what changed rather than dead-ending.
 */
export interface CheckoutRejected {
  readonly reason: CheckoutFailureReason
  readonly message: string
  readonly replacementQuote: CreateQuoteResult | null
}

export interface CheckoutDeps extends CreateQuoteDeps {
  readonly clock: Clock
  readonly config: ConfigPort
  readonly quotes: QuoteRepository
  readonly listings: ListingRepository
  readonly orders: OrderPlacementPort
  readonly orderNumbers: OrderNumberGenerator
}

export async function checkout(
  input: CheckoutInput,
  deps: CheckoutDeps,
): Promise<Result<CheckoutSuccess, AppError | CheckoutRejected>> {
  const now = deps.clock.now()
  const config = await deps.config.snapshot(now)

  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    return err(Errors.validation('An idempotency key is required'))
  }

  const enabledMethods = config.require('payments.methods.enabled')
  if (!(enabledMethods as readonly string[]).includes(input.paymentMethod)) {
    // Prepaid stays off until the custody/escrow review completes — decision D4, a hard gate.
    return err(
      Errors.validation('This payment method is not available', {
        paymentMethod: input.paymentMethod,
      }),
    )
  }

  /* ------------------------------------------------------------ the quote, re-read */

  // Scoped to the owner: another buyer's quote id is *not found*, never *forbidden*.
  const quote = await deps.quotes.findOwned(input.quoteId, input.buyerUserId)
  if (!quote) {
    return err(rejection('QUOTE_NOT_FOUND', 'This quote could not be found', null))
  }

  if (quote.consumedAt !== null) {
    return err(
      rejection('QUOTE_ALREADY_USED', 'This quote has already been used to place an order', null),
    )
  }

  if (quote.expiresAt <= now) {
    const replacement = await requote(quote, input, deps)
    return err(
      rejection('QUOTE_EXPIRED', 'This price has expired. Here is the current price.', replacement),
    )
  }

  /* --------------------------------------------- the listing must not have drifted */

  const listing = await deps.listings.findPricingSnapshot(quote.listingId)
  if (!listing || listing.status !== 'PUBLISHED' || listing.sellerSuspended) {
    return err(rejection('LISTING_UNAVAILABLE', 'This listing is no longer available', null))
  }

  if (listing.unitPricePoisha !== quote.unitPricePoisha) {
    const replacement = await requote(quote, input, deps)
    return err(
      rejection(
        'LISTING_CHANGED',
        'The farmer changed the price after this quote was made. Please review the new price.',
        replacement,
      ),
    )
  }

  if (listing.quantityAvailableBase < quote.quantityBase) {
    const replacement = await requote(quote, input, deps)
    return err(
      rejection(
        'INSUFFICIENT_INVENTORY',
        'The farmer no longer has this quantity available',
        replacement,
      ),
    )
  }

  /* --------------------------------------------------------------- the atomic write */

  const acceptanceWindowMinutes = config.require('order.acceptanceWindowMinutes')
  const acceptanceDeadline = new Date(now.getTime() + acceptanceWindowMinutes * 60_000)

  const outcome = await deps.orders.place({
    quote,
    idempotencyKey: input.idempotencyKey,
    paymentMethod: input.paymentMethod,
    buyerSegment: input.buyerSegment,
    orderNumber: deps.orderNumbers.next(now),
    acceptanceDeadline,
    // The reservation is held only as long as the farmer has to accept. docs/04 §9.
    reservationExpiresAt: acceptanceDeadline,
    now,
    item: {
      listingId: listing.listingId,
      productId: listing.productId,
      productNameEn: listing.productNameEn,
      productNameBn: listing.productNameBn,
      varietyName: listing.varietyName,
      grade: listing.grade,
      farmName: listing.farmName,
      saleUnit: listing.saleUnit,
      saleUnitInBaseUnits: listing.saleUnitInBaseUnits,
      // Money copied from the QUOTE, never recomputed from the live listing.
      unitPricePoisha: quote.unitPricePoisha,
      quantityBase: quote.quantityBase,
      lineTotalPoisha: quote.subtotalPoisha,
      harvestedAt: listing.harvestedAt,
    },
    delivery: await resolveDeliverySnapshot(quote, input, deps),
  })

  if (outcome.kind === 'FAILED') {
    const replacement =
      outcome.reason === 'INSUFFICIENT_INVENTORY' || outcome.reason === 'LISTING_CHANGED'
        ? await requote(quote, input, deps)
        : null
    return err(rejection(outcome.reason, failureMessage(outcome.reason), replacement))
  }

  return ok({ order: outcome.order, replayed: outcome.kind === 'REPLAYED' })
}

function rejection(
  reason: CheckoutFailureReason,
  message: string,
  replacementQuote: CreateQuoteResult | null,
): CheckoutRejected {
  return { reason, message, replacementQuote }
}

function failureMessage(reason: CheckoutFailureReason): string {
  switch (reason) {
    case 'INSUFFICIENT_INVENTORY':
      return 'The farmer no longer has this quantity available'
    case 'LISTING_CHANGED':
      return 'The listing changed after this quote was made'
    case 'LISTING_UNAVAILABLE':
      return 'This listing is no longer available'
    case 'QUOTE_ALREADY_USED':
      return 'This quote has already been used to place an order'
    case 'QUOTE_EXPIRED':
      return 'This price has expired'
    case 'QUOTE_NOT_FOUND':
      return 'This quote could not be found'
  }
}

/**
 * Re-price on failure so the buyer sees the current number and can re-consent.
 *
 * A failure to re-quote must not mask the original failure, so this returns `null` rather than
 * propagating: the buyer still gets the correct typed error.
 */
async function requote(
  quote: StoredQuote,
  input: CheckoutInput,
  deps: CheckoutDeps,
): Promise<CreateQuoteResult | null> {
  const fresh = await createQuote(
    {
      buyerUserId: input.buyerUserId,
      listingId: quote.listingId,
      quantityBase: quote.quantityBase,
      fulfilmentMode: quote.fulfilmentMode,
      deliveryAddressId: quote.deliveryAddressId,
      paymentMethod: input.paymentMethod,
      fundingModel: quote.deliveryFundingModel,
      subsidyReason: quote.subsidyReason,
    },
    deps,
  )
  return fresh.ok ? fresh.value : null
}

async function resolveDeliverySnapshot(
  quote: StoredQuote,
  input: CheckoutInput,
  deps: CheckoutDeps,
): Promise<{
  recipientName: string | null
  recipientPhone: string | null
  addressLine: string | null
  areaId: string | null
  latitude: number | null
  longitude: number | null
  distanceMeters: number | null
}> {
  if (!quote.deliveryAddressId) {
    return {
      recipientName: null,
      recipientPhone: null,
      addressLine: null,
      areaId: null,
      latitude: null,
      longitude: null,
      distanceMeters: null,
    }
  }

  const address = await deps.addresses.findForBuyer(quote.deliveryAddressId, input.buyerUserId)
  return {
    recipientName: address?.recipientName ?? null,
    recipientPhone: address?.recipientPhone ?? null,
    addressLine: address?.addressLine ?? null,
    areaId: address?.adminAreaId ?? null,
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
    distanceMeters: quote.distanceMeters,
  }
}
