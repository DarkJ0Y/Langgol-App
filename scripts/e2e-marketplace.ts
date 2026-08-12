/**
 * End-to-end demonstration: listing -> quote -> checkout -> order.
 *
 * Runs the real use cases against the real adapters and the real database — no mocks — and prints
 * what a buyer would see plus what only Langgol sees. It is a demonstration and a smoke test, not
 * a replacement for the suites in `packages/*`; it exists so a reviewer can watch the loop work
 * without clicking through the UI.
 *
 *   docker compose up -d
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm e2e:marketplace
 *
 * Refs: docs/04_MARKETPLACE.md §7-9
 */

import { PrismaClient } from '@langgol/db'
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
import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import * as Money from '@langgol/domain/money'
import { randomUUID } from 'node:crypto'

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

function taka(value: bigint): string {
  return `৳${Money.toTakaString(value as never)}`
}

function heading(title: string): void {
  console.log(`\n${'─'.repeat(70)}\n${title}\n${'─'.repeat(70)}`)
}

async function main(): Promise<void> {
  const requestedKg = Number(process.argv[2] ?? '5')

  /* ------------------------------------------------------- 1. an existing listing */

  heading('1 · Listing')

  const listing = await prisma.listing.findFirst({
    where: { status: 'PUBLISHED', deletedAt: null, product: { slug: 'tomato' }, grade: 'A' },
    include: { product: true, farm: true },
  })
  if (!listing) {
    throw new Error('No published tomato listing. Run `pnpm db:seed` first.')
  }

  console.log(`  ${listing.product.nameEn} (${listing.product.nameBn}) · grade ${listing.grade}`)
  console.log(`  ${listing.farm.name}, ${listing.farm.villageOrArea ?? ''}`)
  console.log(`  Farm-gate price   ${taka(listing.unitPricePoisha)}/kg`)
  console.log(`  Available         ${(listing.quantityAvailableBase / KG).toString()} kg`)

  /* ------------------------------------------------------------------ 2. the quote */

  heading(`2 · Quote for ${String(requestedKg)} kg, delivered`)

  const consumerPhone = DEVELOPMENT_IDENTITIES.find(
    (identity) => identity.key === 'consumer',
  )!.phone
  const buyer = await prisma.user.findUniqueOrThrow({ where: { phone: consumerPhone } })
  const address = await prisma.address.findFirstOrThrow({ where: { userId: buyer.id } })

  const quoted = await createQuote(
    {
      buyerUserId: buyer.id,
      listingId: listing.id,
      quantityBase: BigInt(requestedKg) * KG,
      fulfilmentMode: 'LANGGOL_DELIVERY',
      deliveryAddressId: address.id,
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    deps,
  )

  if (!quoted.ok) {
    console.error(`  Quote refused: ${quoted.error.message}`)
    process.exitCode = 1
    return
  }

  const stored = await prisma.orderQuote.findUniqueOrThrow({ where: { id: quoted.value.quoteId } })

  console.log('  What the buyer sees')
  console.log(`    Produce                 ${taka(stored.subtotalPoisha)}`)
  console.log(
    `    Delivery                ${taka(stored.deliveryFeePoisha)}` +
      `   (${String(stored.distanceMeters ?? 0)} m, ${stored.distanceSource ?? 'n/a'})`,
  )
  console.log(`    Handling                ${taka(stored.handlingFeePoisha)}`)
  console.log(`    Service charge          ${taka(stored.platformFeePoisha)}`)
  console.log(`    You pay                 ${taka(stored.buyerTotalPoisha)}`)
  console.log(
    `    Delivered price per kg  ${taka(Money.divide(stored.buyerTotalPoisha as never, requestedKg))}`,
  )

  console.log('\n  What the farmer sees (never shown to the buyer)')
  console.log(`    Your price              ${taka(stored.sellerGrossPoisha)}`)
  console.log(
    `    Langgol commission      −${taka(stored.commissionPoisha)}  (${String(stored.commissionBps)} bps)`,
  )
  console.log(`    You receive             ${taka(stored.sellerNetPoisha)}`)

  console.log('\n  What only Langgol sees')
  console.log(`    Expected cost           ${taka(stored.expectedCostPoisha)}`)
  console.log(
    `    Contribution margin     ${taka(stored.contributionMarginPoisha)}` +
      `${stored.contributionMarginPoisha < 0n ? '   ← NEGATIVE, flagged and counted' : ''}`,
  )
  console.log(`    Priced under            ${stored.pricingVersion}`)
  console.log(`    Quote expires           ${stored.expiresAt.toISOString()}`)

  /* --------------------------------------------------------------- 3. the checkout */

  heading('3 · Checkout')

  const before = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })

  const placed = await checkout(
    {
      buyerUserId: buyer.id,
      buyerSegment: 'CONSUMER',
      quoteId: quoted.value.quoteId,
      idempotencyKey: randomUUID(),
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    deps,
  )

  if (!placed.ok) {
    const error = placed.error
    console.error(`  Checkout refused: ${'reason' in error ? error.reason : error.message}`)
    process.exitCode = 1
    return
  }

  const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: placed.value.order.id },
    include: { items: true, events: true, reservations: true },
  })
  const consumedQuote = await prisma.orderQuote.findUniqueOrThrow({
    where: { id: quoted.value.quoteId },
  })

  console.log(`  Order            ${order.orderNumber}  (${order.status})`)
  console.log(`  Buyer pays       ${taka(order.buyerTotalPoisha)}`)
  console.log(`  Farmer receives  ${taka(order.sellerNetPoisha)}`)
  console.log(`  Accept by        ${order.acceptanceDeadline.toISOString()}`)

  console.log('\n  Inventory')
  console.log(
    `    available  ${(before.quantityAvailableBase / KG).toString()} kg → ${(after.quantityAvailableBase / KG).toString()} kg`,
  )
  console.log(
    `    reserved   ${(before.quantityReservedBase / KG).toString()} kg → ${(after.quantityReservedBase / KG).toString()} kg`,
  )
  console.log(`    reservation ${order.reservations[0]?.status ?? 'none'}`)

  console.log('\n  Quote')
  console.log(`    consumed at        ${consumedQuote.consumedAt?.toISOString() ?? 'NOT CONSUMED'}`)
  console.log(`    consumed by order  ${consumedQuote.consumedByOrderId ?? 'none'}`)

  /* ------------------------------------------------------------- 4. the invariants */

  heading('4 · Invariants')

  const checks: [string, boolean][] = [
    [
      'order money equals the quote, not a recomputation',
      order.buyerTotalPoisha === stored.buyerTotalPoisha &&
        order.sellerNetPoisha === stored.sellerNetPoisha,
    ],
    [
      'buyerTotal = subtotal + delivery + handling + platformFee',
      order.buyerTotalPoisha ===
        Money.sum([
          order.subtotalPoisha,
          order.deliveryFeePoisha,
          order.handlingFeePoisha,
          order.platformFeePoisha,
        ] as never),
    ],
    [
      'delivery funding reconciles to the tariff',
      order.deliveryTariffPoisha ===
        Money.sum([
          order.deliveryFeePoisha,
          order.deliveryFundedBySellerPoisha,
          order.deliveryFundedByRetailerPoisha,
          order.promotionalSubsidyPoisha,
        ] as never),
    ],
    [
      'inventory moved by exactly the ordered quantity',
      before.quantityAvailableBase - after.quantityAvailableBase === BigInt(requestedKg) * KG,
    ],
    [
      'quote is consumed and single-use',
      consumedQuote.consumedAt !== null && consumedQuote.consumedByOrderId === order.id,
    ],
    [
      'order has an append-only opening event',
      order.events.length === 1 && order.events[0]?.toStatus === 'PENDING',
    ],
    [
      'pricing and config versions recorded',
      stored.pricingVersion.length > 0 && Object.keys(stored.configVersions as object).length > 0,
    ],
  ]

  let failed = 0
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? '✓' : '✗'} ${label}`)
    if (!passed) failed += 1
  }

  /* ------------------------------------- 5. the quote cannot be spent a second time */

  heading('5 · The quote is single-use')

  const replay = await checkout(
    {
      buyerUserId: buyer.id,
      buyerSegment: 'CONSUMER',
      quoteId: quoted.value.quoteId,
      idempotencyKey: randomUUID(),
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    deps,
  )
  const replayRefused =
    !replay.ok && 'reason' in replay.error && replay.error.reason === 'QUOTE_ALREADY_USED'
  console.log(
    `  ${replayRefused ? '✓' : '✗'} a spent quote is refused under a fresh idempotency key`,
  )
  if (!replayRefused) failed += 1

  console.log(
    failed === 0 ? '\nAll invariants hold.\n' : `\n${String(failed)} invariant(s) FAILED.\n`,
  )
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error('E2E failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
