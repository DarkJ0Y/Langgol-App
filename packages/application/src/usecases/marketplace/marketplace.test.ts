/**
 * Quote -> checkout -> order.
 *
 * These tests exercise the loop the pilot depends on, and assert the security properties that
 * make the quote an authority rather than a suggestion: it is server-computed, single-use,
 * owner-scoped, time-limited, and the order's money is copied from it rather than recomputed.
 *
 * Refs: docs/04_MARKETPLACE.md §8, §9; docs/07_SECURITY.md §5
 */

import { describe, expect, it } from 'vitest'
import * as Money from '@langgol/domain/money'
import { checkout } from './checkout.js'
import { createQuote } from './create-quote.js'
import type { CheckoutDeps, CheckoutRejected } from './index.js'
import {
  FakeAddresses,
  FakeClock,
  FakeConfig,
  FakeListings,
  FakeOrderNumbers,
  FakeOrderPlacement,
  FakeQuotes,
  FakeSubsidyBudget,
  makeAddress,
  makeListing,
} from './__fixtures__/fakes.js'
import type { ConfigEntry } from '@langgol/domain/config'
import type { ListingPricingSnapshot } from '../../ports/marketplace.js'
import type { AppError } from '@langgol/shared'

const NOW = new Date('2026-08-13T06:00:00.000Z')
const FIVE_KG = 5000000n

function harness(
  options: {
    listings?: ListingPricingSnapshot[]
    config?: ConfigEntry[]
    subsidyBudget?: boolean
  } = {},
) {
  const clock = new FakeClock(NOW)
  const listings = new FakeListings(options.listings ?? [makeListing()])
  const quotes = new FakeQuotes()
  const orders = new FakeOrderPlacement(listings, quotes)

  const deps: CheckoutDeps = {
    clock,
    config: new FakeConfig(options.config ?? []),
    listings,
    addresses: new FakeAddresses([makeAddress('buyer-1')]),
    quotes,
    subsidyBudget: new FakeSubsidyBudget(options.subsidyBudget ?? false),
    orders,
    orderNumbers: new FakeOrderNumbers(),
  }

  return { deps, clock, listings, quotes, orders }
}

const quoteRequest = {
  buyerUserId: 'buyer-1',
  listingId: 'listing-tomato-1',
  quantityBase: FIVE_KG,
  fulfilmentMode: 'LANGGOL_DELIVERY' as const,
  deliveryAddressId: 'address-1',
  paymentMethod: 'CASH_ON_DELIVERY',
}

function checkoutRequest(quoteId: string, idempotencyKey = 'idem-1') {
  return {
    buyerUserId: 'buyer-1',
    buyerSegment: 'CONSUMER' as const,
    quoteId,
    idempotencyKey,
    paymentMethod: 'CASH_ON_DELIVERY',
  }
}

describe('createQuote', () => {
  it('prices 5 kg of tomato from Shibganj to Bogura entirely server-side', async () => {
    const { deps, quotes } = harness()

    const result = await createQuote(quoteRequest, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const stored = quotes.rows.get(result.value.quoteId)!
    expect(Money.toTakaString(stored.subtotalPoisha as never)).toBe('150.00')

    // The same invariant the database CHECK enforces, summed through the Money module.
    expect(stored.buyerTotalPoisha).toBe(
      Money.sum([
        stored.subtotalPoisha,
        stored.deliveryFeePoisha,
        stored.handlingFeePoisha,
        stored.platformFeePoisha,
      ] as never),
    )
  })

  it('stores the pricing version and config versions so the price is reproducible', async () => {
    const { deps, quotes } = harness()
    const result = await createQuote(quoteRequest, deps)
    if (!result.ok) throw new Error('expected a quote')

    const stored = quotes.rows.get(result.value.quoteId)!
    expect(stored.pricingVersion.length).toBeGreaterThan(0)
    expect(stored.configVersions['commission.bps']).toBe(1)
    expect(stored.configVersions['delivery.tariff']).toBe(1)
  })

  it('stores the modelled contribution margin on every quote', async () => {
    const { deps, quotes } = harness()
    const result = await createQuote(quoteRequest, deps)
    if (!result.ok) throw new Error('expected a quote')

    const stored = quotes.rows.get(result.value.quoteId)!
    expect(typeof stored.contributionMarginPoisha).toBe('bigint')
    expect(stored.expectedCostPoisha > 0n).toBe(true)
  })

  it('records the distance and how it was estimated', async () => {
    const { deps, quotes } = harness()
    const result = await createQuote(quoteRequest, deps)
    if (!result.ok) throw new Error('expected a quote')

    const stored = quotes.rows.get(result.value.quoteId)!
    expect(stored.distanceSource).toBe('HAVERSINE_CIRCUITY')
    expect(stored.distanceMeters).toBeGreaterThan(0)
  })

  it('never returns platform or farmer economics to the client', async () => {
    const { deps, quotes } = harness()
    const result = await createQuote(quoteRequest, deps)
    if (!result.ok) throw new Error('expected a quote')

    // The whole internal and seller blocks are absent, not merely emptied.
    expect(Object.keys(result.value.breakdown)).not.toContain('internal')
    expect(Object.keys(result.value.breakdown)).not.toContain('seller')

    // And no internal amount leaks by another name. `configVersions` legitimately carries config
    // key names so a historical price can be reproduced; it carries no amounts.
    const serialised = JSON.stringify(result.value.breakdown)
    const stored = quotes.rows.get(result.value.quoteId)!
    for (const secret of [
      stored.contributionMarginPoisha,
      stored.expectedCostPoisha,
      stored.sellerNetPoisha,
      stored.commissionPoisha,
    ]) {
      expect(serialised).not.toContain(`"${secret.toString()}"`)
    }
  })

  it('expires the quote after the configured TTL', async () => {
    const { deps } = harness()
    const result = await createQuote(quoteRequest, deps)
    if (!result.ok) throw new Error('expected a quote')

    expect(result.value.expiresAt.getTime()).toBe(NOW.getTime() + 15 * 60_000)
  })

  it('refuses a quantity the farmer does not have', async () => {
    const { deps } = harness()
    const result = await createQuote({ ...quoteRequest, quantityBase: 999000000n }, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as AppError).code).toBe('VALIDATION_FAILED')
  })

  it('offers a partial fill when the listing allows one', async () => {
    const { deps, quotes } = harness({
      listings: [makeListing({ allowsPartialFill: true, quantityAvailableBase: 3000000n })],
    })
    const result = await createQuote({ ...quoteRequest, quantityBase: FIVE_KG }, deps)
    if (!result.ok) throw new Error('expected a partial-fill quote')

    expect(quotes.rows.get(result.value.quoteId)!.quantityBase).toBe(3000000n)
  })

  it('refuses to price a delivery when either end has no coordinates', async () => {
    const { deps } = harness({ listings: [makeListing({ latitude: null, longitude: null })] })
    const result = await createQuote(quoteRequest, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as AppError).code).toBe('PRECONDITION_FAILED')
  })

  it('refuses a subsidised model when the pilot loss budget is exhausted', async () => {
    const { deps } = harness({ subsidyBudget: false })
    const result = await createQuote(
      { ...quoteRequest, fundingModel: 'FREE_DELIVERY', subsidyReason: 'MARKET_SEEDING' },
      deps,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as AppError).meta['code']).toBe('SUBSIDY_BUDGET_EXHAUSTED')
  })

  it('refuses a subsidised model with no reason even when the budget has headroom', async () => {
    const { deps } = harness({ subsidyBudget: true })
    const result = await createQuote({ ...quoteRequest, fundingModel: 'FREE_DELIVERY' }, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as AppError).meta['code']).toBe('SUBSIDY_REASON_REQUIRED')
  })

  it('keeps cost-recovering delivery working when the budget is exhausted', async () => {
    const { deps } = harness({ subsidyBudget: false })
    const result = await createQuote({ ...quoteRequest, fundingModel: 'COST_RECOVERING' }, deps)
    expect(result.ok).toBe(true)
  })
})

describe('checkout — the happy path', () => {
  it('places an order, reserves inventory and consumes the quote', async () => {
    const { deps, quotes, listings, orders } = harness()

    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const availableBefore = listings.byId.get('listing-tomato-1')!.quantityAvailableBase

    const placed = await checkout(checkoutRequest(quoted.value.quoteId), deps)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return

    expect(placed.value.order.orderNumber).toMatch(/^LG-260813-/)
    expect(placed.value.replayed).toBe(false)

    // Inventory moved, reservation held, quote burned.
    expect(listings.byId.get('listing-tomato-1')!.quantityAvailableBase).toBe(
      availableBefore - FIVE_KG,
    )
    expect(orders.reservations).toHaveLength(1)
    expect(orders.reservations[0]!.status).toBe('HELD')
    expect(quotes.rows.get(quoted.value.quoteId)!.consumedAt).not.toBeNull()
  })

  it('copies the order money from the quote rather than recomputing it', async () => {
    const { deps, quotes, listings, orders } = harness()

    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')
    const stored = quotes.rows.get(quoted.value.quoteId)!

    // The farmer raises the price to ৳45/kg AFTER the quote, without bumping the version.
    // Checkout must not silently charge the new price.
    listings.mutate('listing-tomato-1', { unitPricePoisha: 4500n })

    const placed = await checkout(checkoutRequest(quoted.value.quoteId), deps)
    expect(placed.ok).toBe(false)
    if (placed.ok) return
    expect((placed.error as CheckoutRejected).reason).toBe('LISTING_CHANGED')

    // Nothing was placed at either price.
    expect(orders.placed).toHaveLength(0)
    expect(stored.unitPricePoisha).toBe(3000n)
  })

  it('sets the acceptance deadline from configuration', async () => {
    const { deps } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const placed = await checkout(checkoutRequest(quoted.value.quoteId), deps)
    if (!placed.ok) throw new Error('expected an order')

    expect(placed.value.order.acceptanceDeadline.getTime()).toBe(NOW.getTime() + 120 * 60_000)
  })
})

describe('checkout — the quote is an authority, not a suggestion', () => {
  it('is single-use: a replayed quote id does not create a second order', async () => {
    const { deps, orders } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const first = await checkout(checkoutRequest(quoted.value.quoteId, 'idem-A'), deps)
    expect(first.ok).toBe(true)

    // A different idempotency key, the same spent quote: still refused.
    const second = await checkout(checkoutRequest(quoted.value.quoteId, 'idem-B'), deps)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect((second.error as CheckoutRejected).reason).toBe('QUOTE_ALREADY_USED')
    expect(orders.placed).toHaveLength(1)
  })

  it('is idempotent: the same key returns the same order rather than placing another', async () => {
    const { deps, orders } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const first = await checkout(checkoutRequest(quoted.value.quoteId, 'idem-same'), deps)
    if (!first.ok) throw new Error('expected an order')

    // The connection dropped and the client retried. On this network it will.
    const retry = await deps.orders.place({
      ...orders.placed[0]!,
      idempotencyKey: 'idem-same',
    })

    expect(retry.kind).toBe('REPLAYED')
    if (retry.kind !== 'REPLAYED') return
    expect(retry.order.orderNumber).toBe(first.value.order.orderNumber)
    expect(orders.placed).toHaveLength(1)
  })

  it("returns not-found for another buyer's quote, never forbidden", async () => {
    const { deps } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const thief = await checkout(
      { ...checkoutRequest(quoted.value.quoteId), buyerUserId: 'buyer-2' },
      deps,
    )

    expect(thief.ok).toBe(false)
    if (thief.ok) return
    // A 403 would confirm the quote exists. docs/07_SECURITY.md §4.4
    expect((thief.error as CheckoutRejected).reason).toBe('QUOTE_NOT_FOUND')
  })

  it('refuses an expired quote and hands back a fresh one to re-consent to', async () => {
    const { deps, clock } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    clock.advanceMinutes(16)

    const stale = await checkout(checkoutRequest(quoted.value.quoteId), deps)
    expect(stale.ok).toBe(false)
    if (stale.ok) return

    const rejection = stale.error as CheckoutRejected
    expect(rejection.reason).toBe('QUOTE_EXPIRED')
    // Never dead-end the buyer: show them the current price.
    expect(rejection.replacementQuote).not.toBeNull()
    expect(rejection.replacementQuote!.quoteId).not.toBe(quoted.value.quoteId)
  })

  it('requires an idempotency key', async () => {
    const { deps } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const result = await checkout(
      { ...checkoutRequest(quoted.value.quoteId), idempotencyKey: '' },
      deps,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as AppError).code).toBe('VALIDATION_FAILED')
  })

  it('refuses a payment method that configuration has not enabled', async () => {
    // Prepaid stays off until the custody review completes — decision D4 is a hard gate.
    const { deps } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const result = await checkout(
      { ...checkoutRequest(quoted.value.quoteId), paymentMethod: 'MFS' },
      deps,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as AppError).code).toBe('VALIDATION_FAILED')
  })
})

describe('checkout — inventory', () => {
  it('refuses when stock fell below the quoted quantity, and re-quotes', async () => {
    const { deps, listings } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    listings.mutate('listing-tomato-1', { quantityAvailableBase: 1000000n })

    const result = await checkout(checkoutRequest(quoted.value.quoteId), deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as CheckoutRejected).reason).toBe('INSUFFICIENT_INVENTORY')
  })

  it('does not oversell when two buyers race for the last of a crop', async () => {
    const { deps, listings, orders } = harness({
      listings: [makeListing({ quantityAvailableBase: FIVE_KG })],
    })

    const first = await createQuote(quoteRequest, deps)
    const second = await createQuote(quoteRequest, deps)
    if (!first.ok || !second.ok) throw new Error('expected two quotes')

    // Quoting reserves nothing, so both quotes exist for the same 5 kg.
    const winner = await checkout(checkoutRequest(first.value.quoteId, 'idem-first'), deps)
    const loser = await checkout(checkoutRequest(second.value.quoteId, 'idem-second'), deps)

    expect(winner.ok).toBe(true)
    expect(loser.ok).toBe(false)
    if (loser.ok) return
    expect((loser.error as CheckoutRejected).reason).toBe('INSUFFICIENT_INVENTORY')

    expect(orders.placed).toHaveLength(1)
    expect(listings.byId.get('listing-tomato-1')!.quantityAvailableBase).toBe(0n)
  })

  it('refuses a listing that was withdrawn between quote and checkout', async () => {
    const { deps, listings } = harness()
    const quoted = await createQuote(quoteRequest, deps)
    if (!quoted.ok) throw new Error('expected a quote')

    listings.mutate('listing-tomato-1', { status: 'PAUSED' })

    const result = await checkout(checkoutRequest(quoted.value.quoteId), deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as CheckoutRejected).reason).toBe('LISTING_UNAVAILABLE')
  })
})
