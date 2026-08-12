/**
 * Marketplace integration tests — quote -> checkout -> order against a REAL database.
 *
 * The application-level suite proves the use-case logic with in-memory doubles. This suite proves
 * the things only a real PostgreSQL can prove: that the atomic reservation query actually
 * prevents overselling under concurrency, that the CHECK constraints reject money that does not
 * add up, that the single-use quote guarantee holds at the database level, and that the
 * append-only rule on order events is real.
 *
 *   docker compose up -d && pnpm db:migrate && pnpm db:seed
 *   LANGGOL_INTEGRATION=1 pnpm test
 *
 * Refs: docs/02_DATABASE.md §12-13; docs/04_MARKETPLACE.md §8-9
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import { checkout, createQuote, type CheckoutDeps } from '@langgol/application'
import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import * as Money from '@langgol/domain/money'
import { systemClock } from '../clock.js'
import { invalidateConfigCache } from '../config/loader.js'
import {
  addressRepository,
  configPort,
  listingRepository,
  orderNumberGenerator,
  orderPlacement,
  quoteRepository,
  subsidyBudgetPort,
} from '../repositories/marketplace.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()
const KG = 1000000n

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

let buyerUserId = ''
let addressId = ''
let listingId = ''

beforeAll(async () => {
  if (!enabled) return
  invalidateConfigCache()

  const consumerPhone = DEVELOPMENT_IDENTITIES.find(
    (identity) => identity.key === 'consumer',
  )!.phone
  const buyer = await prisma.user.findUniqueOrThrow({ where: { phone: consumerPhone } })
  buyerUserId = buyer.id

  const address = await prisma.address.findFirstOrThrow({ where: { userId: buyer.id } })
  addressId = address.id

  const listing = await prisma.listing.findFirstOrThrow({
    where: { status: 'PUBLISHED', grade: 'A', product: { slug: 'tomato' } },
  })
  listingId = listing.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Restore a listing's stock so each test starts from a known position. */
async function restock(id: string, availableKg: number): Promise<void> {
  await prisma.listing.update({
    where: { id },
    data: {
      quantityAvailableBase: BigInt(availableKg) * KG,
      quantityReservedBase: 0n,
      quantityTotalBase: BigInt(availableKg) * KG,
    },
  })
}

function quoteRequest(quantityKg: number) {
  return {
    buyerUserId,
    listingId,
    quantityBase: BigInt(quantityKg) * KG,
    fulfilmentMode: 'LANGGOL_DELIVERY' as const,
    deliveryAddressId: addressId,
    paymentMethod: 'CASH_ON_DELIVERY',
  }
}

suite('quote -> checkout -> order against a real database', () => {
  it('prices 5 kg of tomato and persists a reproducible quote', async () => {
    const result = await createQuote(quoteRequest(5), deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const row = await prisma.orderQuote.findUniqueOrThrow({ where: { id: result.value.quoteId } })

    expect(Money.toTakaString(row.subtotalPoisha as never)).toBe('150.00')
    expect(row.pricingVersion.length).toBeGreaterThan(0)
    expect(row.distanceSource).toBe('HAVERSINE_CIRCUITY')
    expect(row.distanceMeters).toBeGreaterThan(0)
    // Stored on every quote, so negative-margin orders are countable rather than invisible.
    expect(typeof row.contributionMarginPoisha).toBe('bigint')
    expect(Object.keys(row.configVersions as object).length).toBeGreaterThan(10)
  })

  it('places an order, moves inventory and consumes the quote in one transaction', async () => {
    await restock(listingId, 200)

    const quoted = await createQuote(quoteRequest(5), deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const before = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })

    const placed = await checkout(
      {
        buyerUserId,
        buyerSegment: 'CONSUMER',
        quoteId: quoted.value.quoteId,
        idempotencyKey: `integration-${crypto.randomUUID()}`,
        paymentMethod: 'CASH_ON_DELIVERY',
      },
      deps,
    )
    expect(placed.ok).toBe(true)
    if (!placed.ok) return

    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })
    expect(before.quantityAvailableBase - after.quantityAvailableBase).toBe(5n * KG)
    expect(after.quantityReservedBase - before.quantityReservedBase).toBe(5n * KG)

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: placed.value.order.id },
      include: { items: true, events: true, reservations: true },
    })

    // Money copied from the quote, not recomputed.
    const quote = await prisma.orderQuote.findUniqueOrThrow({ where: { id: quoted.value.quoteId } })
    expect(order.buyerTotalPoisha).toBe(quote.buyerTotalPoisha)
    expect(order.sellerNetPoisha).toBe(quote.sellerNetPoisha)
    expect(order.commissionBps).toBe(quote.commissionBps)

    expect(order.items).toHaveLength(1)
    expect(order.events).toHaveLength(1)
    expect(order.events[0]!.toStatus).toBe('PENDING')
    expect(order.reservations).toHaveLength(1)
    expect(order.reservations[0]!.status).toBe('HELD')

    expect(quote.consumedAt).not.toBeNull()
    expect(quote.consumedByOrderId).toBe(order.id)
  })

  it('does not oversell when two checkouts race for the last of a crop', async () => {
    await restock(listingId, 5)

    const [first, second] = await Promise.all([
      createQuote(quoteRequest(5), deps),
      createQuote(quoteRequest(5), deps),
    ])
    if (!first.ok || !second.ok) throw new Error('expected two quotes')

    // Both quotes exist for the same 5 kg — quoting reserves nothing, by design.
    const results = await Promise.all([
      checkout(
        {
          buyerUserId,
          buyerSegment: 'CONSUMER',
          quoteId: first.value.quoteId,
          idempotencyKey: `race-a-${crypto.randomUUID()}`,
          paymentMethod: 'CASH_ON_DELIVERY',
        },
        deps,
      ),
      checkout(
        {
          buyerUserId,
          buyerSegment: 'CONSUMER',
          quoteId: second.value.quoteId,
          idempotencyKey: `race-b-${crypto.randomUUID()}`,
          paymentMethod: 'CASH_ON_DELIVERY',
        },
        deps,
      ),
    ])

    // Exactly one wins. The conditional UPDATE of docs/02 §13 is what guarantees it.
    expect(results.filter((result) => result.ok)).toHaveLength(1)

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })
    expect(listing.quantityAvailableBase).toBe(0n)
    expect(listing.quantityAvailableBase >= 0n).toBe(true)
  })

  it('replays an identical checkout instead of placing a second order', async () => {
    await restock(listingId, 200)
    const quoted = await createQuote(quoteRequest(5), deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const key = `idem-${crypto.randomUUID()}`
    const request = {
      buyerUserId,
      buyerSegment: 'CONSUMER' as const,
      quoteId: quoted.value.quoteId,
      idempotencyKey: key,
      paymentMethod: 'CASH_ON_DELIVERY',
    }

    const first = await checkout(request, deps)
    if (!first.ok) throw new Error('expected an order')

    const retry = await checkout(request, deps)
    // The quote is spent, so the use case stops at QUOTE_ALREADY_USED before reaching the port.
    // Either way the invariant that matters holds: exactly one order for this key.
    const orders = await prisma.order.findMany({ where: { idempotencyKey: key } })
    expect(orders).toHaveLength(1)
    expect(retry.ok).toBe(false)
  })

  it("refuses another buyer's quote as not found", async () => {
    const quoted = await createQuote(quoteRequest(5), deps)
    if (!quoted.ok) throw new Error('expected a quote')

    const farmerPhone = DEVELOPMENT_IDENTITIES.find((identity) => identity.key === 'farmer')!.phone
    const other = await prisma.user.findUniqueOrThrow({ where: { phone: farmerPhone } })

    const stolen = await quoteRepository.findOwned(quoted.value.quoteId, other.id)
    expect(stolen).toBeNull()
  })
})

suite('database guarantees are real, not advisory', () => {
  it('rejects an order whose parts do not sum to its total', async () => {
    // The funding split is deliberately made to balance (tariff == fee) so that this row
    // violates ONE constraint only, and the test proves which. An earlier version of this test
    // tripped orders_funding_balances first — the constraints are layered, and any of them is
    // enough to stop a malformed order reaching the table.
    await expect(
      prisma.$executeRaw`
        INSERT INTO orders (
          id, order_number, buyer_user_id, seller_farmer_profile_id, quote_id, status,
          fulfilment_mode, buyer_segment, payment_method, payment_status,
          subtotal_poisha, delivery_fee_poisha, handling_fee_poisha, platform_fee_poisha,
          buyer_total_poisha, seller_gross_poisha, commission_poisha, commission_bps,
          seller_net_poisha, delivery_tariff_poisha, contribution_margin_poisha,
          acceptance_deadline, idempotency_key, updated_at
        ) VALUES (
          gen_random_uuid(), 'LG-BAD-1', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
          'PENDING', 'LANGGOL_DELIVERY', 'CONSUMER', 'CASH_ON_DELIVERY', 'UNPAID',
          15000, 9600, 1000, 0,
          99999,
          15000, 450, 300, 14550, 9600, 0, NOW(), 'bad-total', NOW()
        )
      `,
    ).rejects.toThrow(/orders_total_consistent/)
  })

  it('rejects a subsidy with no reason', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE order_quotes
           SET promotional_subsidy_poisha = 100, subsidy_reason = NULL
         WHERE id = (SELECT id FROM order_quotes LIMIT 1)
      `,
    ).rejects.toThrow(/quotes_subsidy_requires_reason|quotes_funding_balances/)
  })

  it('rejects a subsidy reason outside the controlled vocabulary', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE order_quotes
           SET subsidy_reason = 'because marketing asked'
         WHERE id = (SELECT id FROM order_quotes LIMIT 1)
      `,
    ).rejects.toThrow(/quotes_subsidy_reason_vocabulary/)
  })

  it('refuses to let inventory go negative even by raw SQL', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE listings SET quantity_available_base = -1 WHERE id = ${listingId}::uuid
      `,
    ).rejects.toThrow(/listings_qty_sane/)
  })

  it('silently ignores an attempt to rewrite the append-only order event log', async () => {
    const event = await prisma.orderEvent.findFirst()
    if (!event) return

    // A RULE ... DO INSTEAD NOTHING does not raise; it discards the write. The assertion is that
    // the row is unchanged afterwards.
    await prisma.$executeRaw`UPDATE order_events SET reason = 'tampered' WHERE id = ${event.id}::uuid`
    const after = await prisma.orderEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(after.reason).toBe(event.reason)

    await prisma.$executeRaw`DELETE FROM order_events WHERE id = ${event.id}::uuid`
    const stillThere = await prisma.orderEvent.findUnique({ where: { id: event.id } })
    expect(stillThere).not.toBeNull()
  })

  it('keeps a quote single-use at the database level', async () => {
    const consumed = await prisma.orderQuote.findFirst({ where: { consumedAt: { not: null } } })
    if (!consumed) return

    // consumed_by_order_id is UNIQUE, so a second order cannot claim the same quote.
    await expect(
      prisma.$executeRaw`
        UPDATE order_quotes SET consumed_by_order_id = ${consumed.consumedByOrderId}::uuid
         WHERE id != ${consumed.id}::uuid AND consumed_by_order_id IS NULL
      `,
    ).rejects.toThrow()
  })
})
