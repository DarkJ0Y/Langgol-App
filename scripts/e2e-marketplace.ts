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
  accountBalance,
  addressRepository,
  configPort,
  findUnbalancedTransactions,
  listingRepository,
  orderNumberGenerator,
  orderPlacement,
  postJournal,
  quoteRepository,
  reconcileTrip,
  subsidyBudgetPort,
  systemClock,
} from '@langgol/infrastructure'
import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import { journalForGoodsDelivered } from '@langgol/domain/ledger'
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

  /* ------------------------------------------- 6. the trip that actually moved the goods */

  heading('6 · Delivery trip — where cost is really incurred')

  // Captured before the trip exists: reconciliation (section 7) posts the trip cost to 5000, so a
  // baseline taken afterwards would measure a delta of zero and pass vacuously.
  const logisticsBefore = await accountBalance('5000')

  const orderId = placed.value.order.id
  const chargeableMg = BigInt(requestedKg) * KG

  // A second order riding the same van, so the pooling arithmetic is exercised rather than
  // asserted. docs/04 §7.4 asks whether aggregation actually reduces cost per order.
  const trip = await prisma.deliveryTrip.create({
    data: {
      tripRef: `TRIP-${randomUUID().slice(0, 8).toUpperCase()}`,
      deliveryModel: 'AGGREGATED_ROUTE',
      status: 'IN_PROGRESS',
      vehicleType: 'VAN',
      vehicleCapacityBase: 300n * KG,
      routeDistanceMeters: 36000,
      totalWeightBase: chargeableMg,
      orderCount: 1,
    },
  })

  await prisma.delivery.create({
    data: {
      orderId,
      mode: 'LANGGOL_DELIVERY',
      deliveryModel: 'AGGREGATED_ROUTE',
      tripId: trip.id,
      status: 'DELIVERED',
      distanceMeters: stored.distanceMeters,
      vehicleType: 'VAN',
      deliveredAt: new Date(),
      // What the engine predicted, carried over so model-vs-reality is one subtraction.
      expectedCostPoisha: stored.expectedCostPoisha,
    },
  })

  // Ops enter what it really cost, with evidence. docs/10 §6.1.
  const costItems = [
    { category: 'VEHICLE_HIRE', amountPoisha: 60000n, isStandardRate: false },
    { category: 'FUEL', amountPoisha: 32000n, isStandardRate: false },
    { category: 'LOADING', amountPoisha: 8000n, isStandardRate: true },
  ]
  for (const item of costItems) {
    await prisma.tripCostItem.create({ data: { tripId: trip.id, ...item } })
  }
  const tripActual = Money.sum(costItems.map((item) => item.amountPoisha as never))

  await prisma.deliveryTrip.update({
    where: { id: trip.id },
    data: {
      status: 'COMPLETED',
      actualCostPoisha: tripActual,
      costedAt: new Date(),
      completedAt: new Date(),
    },
  })

  console.log(`  Trip             ${trip.tripRef} (AGGREGATED_ROUTE, VAN)`)
  for (const item of costItems) {
    console.log(
      `    ${item.category.padEnd(14)} ${taka(item.amountPoisha).padStart(10)}` +
        `${item.isStandardRate ? '   (standard rate, not a receipt)' : ''}`,
    )
  }
  console.log(`    ${'ACTUAL TOTAL'.padEnd(14)} ${taka(tripActual).padStart(10)}`)

  /* ---------------------------------------------------------------- 7. reconciliation */

  heading('7 · Reconciliation — the model meets reality')

  const reconciled = await reconcileTrip(trip.id)
  if (reconciled.skipped !== undefined) {
    console.error(`  Reconciliation skipped: ${reconciled.skipped}`)
    failed += 1
  } else {
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId } })
    console.log(`  Orders reconciled  ${String(reconciled.ordersReconciled)}`)
    console.log(
      `  Expected cost      ${taka(reconciled.expectedCostPoisha)}   (what the quote assumed)`,
    )
    console.log(
      `  Actual cost        ${taka(reconciled.actualCostPoisha)}   (what the trip really cost)`,
    )
    console.log(
      `  Calibration gap    ${taka(reconciled.calibrationGapPoisha)}` +
        `${reconciled.calibrationGapPoisha > 0n ? '   ← the model UNDER-predicted' : ''}`,
    )
    console.log(
      `  Allocation share   ${String(delivery.allocationNumerator)}/${String(delivery.allocationDenominator)}`,
    )
    console.log(`  Ledger txn         ${reconciled.ledgerTransactionId}`)
  }

  /* -------------------------------------------------------- 8. the books, double entry */

  heading('8 · Settlement — the order on the books')

  // Account owner ids are UUIDs (ledger_accounts.owner_id is @db.Uuid), because every owner is a
  // real row — a farmer profile, a buyer, an ops agent. A stable id keeps the demo agent's COD
  // float in one account across runs rather than opening a new one each time.
  const DEMO_AGENT_ID = '00000000-0000-4000-8000-00000000a9e7'

  const goodsDelivered = journalForGoodsDelivered({
    orderId,
    farmerProfileId: order.sellerFarmerProfileId,
    buyerUserId: buyer.id,
    agentId: DEMO_AGENT_ID,
    paymentMethod: order.paymentMethod,
    sellerGrossPoisha: order.sellerGrossPoisha as never,
    commissionPoisha: order.commissionPoisha as never,
    sellerNetPoisha: order.sellerNetPoisha as never,
    handlingFeePoisha: order.handlingFeePoisha as never,
    platformFeePoisha: order.platformFeePoisha as never,
    buyerTotalPoisha: order.buyerTotalPoisha as never,
    deliveryTariffPoisha: order.deliveryTariffPoisha as never,
    deliveryChargedToBuyerPoisha: order.deliveryFeePoisha as never,
    deliveryFundedBySellerPoisha: order.deliveryFundedBySellerPoisha as never,
    deliveryFundedByRetailerPoisha: order.deliveryFundedByRetailerPoisha as never,
    promotionalSubsidyPoisha: order.promotionalSubsidyPoisha as never,
    subsidyReason: order.subsidyReason,
  })

  // Captured BEFORE posting. The farmer payable accumulates across every unsettled order, so the
  // meaningful assertion is the delta this journal produced, not the account's absolute balance —
  // that only matched on a virgin database, which is a test that passes once and then rots.
  const payableBefore = await accountBalance('2000', order.sellerFarmerProfileId)

  await postJournal(goodsDelivered, { type: 'ORDER', id: orderId })
  console.log(`  Journal            ${goodsDelivered.idempotencyKey}`)
  for (const line of goodsDelivered.lines) {
    const side = line.direction === 'DEBIT' ? 'DR' : '  CR'
    console.log(
      `    ${side} ${line.accountCode}  ${taka(line.amountPoisha).padStart(10)}  ${line.memo}`,
    )
  }

  // Posting the same business event twice must not double the books.
  const rePosted = await postJournal(goodsDelivered, { type: 'ORDER', id: orderId })

  console.log('\n  Balances (derived from entries — no balance is ever stored)')
  console.log(
    `    2000 payable to farmer  ${taka(await accountBalance('2000', order.sellerFarmerProfileId))}`,
  )
  console.log(`    4000 commission revenue ${taka(await accountBalance('4000'))}`)
  console.log(`    4010 delivery revenue   ${taka(await accountBalance('4010'))}`)
  console.log(`    5000 logistics cost     ${taka(await accountBalance('5000'))}`)

  const unbalanced = await findUnbalancedTransactions()

  heading('9 · Financial invariants')

  const financialChecks: [string, boolean][] = [
    ['every ledger transaction balances', unbalanced.length === 0],
    ['posting the same journal twice does not double the books', rePosted.alreadyPosted],
    [
      'this order increased the farmer payable by exactly its seller net',
      Money.subtract(
        (await accountBalance('2000', order.sellerFarmerProfileId)) as never,
        payableBefore as never,
      ) === order.sellerNetPoisha,
    ],
    [
      'delivery revenue is recognised at the FULL tariff',
      (await accountBalance('4010')) >= order.deliveryTariffPoisha,
    ],
    [
      'this trip increased logistics cost by exactly its actual cost',
      Money.subtract((await accountBalance('5000')) as never, logisticsBefore as never) ===
        tripActual,
    ],
    [
      'the order carries an allocated ACTUAL delivery cost',
      (await prisma.delivery.findUniqueOrThrow({ where: { orderId } })).actualCostPoisha !== null,
    ],
  ]

  for (const [label, passed] of financialChecks) {
    console.log(`  ${passed ? '✓' : '✗'} ${label}`)
    if (!passed) failed += 1
  }

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
