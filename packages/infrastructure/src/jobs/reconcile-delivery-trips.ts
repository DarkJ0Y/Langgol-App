/**
 * Delivery-trip reconciliation.
 *
 * After ops record what a trip actually cost, this job replaces the *modelled* per-order delivery
 * cost with the buyer's share of the **real** one, and records the gap between the two. That gap
 * is the pilot's calibration signal: it is how the tariff stops being a guess.
 *
 * The job is idempotent at two levels — the ledger transaction carries a deterministic key, and a
 * trip already marked reconciled is skipped — so it is safe to run on a schedule and safe to
 * re-run after a partial failure.
 *
 * ```bash
 * pnpm reconcile:trips          # every completed, costed, unreconciled trip
 * pnpm reconcile:trips <tripId> # one trip
 * ```
 *
 * Refs: docs/04_MARKETPLACE.md §4; docs/10_ECONOMIC_MEASUREMENT.md §6.3; docs/06 §5.1
 */

import { prisma } from '@langgol/db'
import { reconcileTripCost, type TripOrderInput } from '@langgol/domain/pricing'
import { journalForTripCost } from '@langgol/domain/ledger'
import * as Money from '@langgol/domain/money'
import { postJournal } from '../repositories/ledger.js'

export interface TripReconciliationResult {
  readonly tripId: string
  readonly tripRef: string
  readonly ordersReconciled: number
  readonly actualCostPoisha: bigint
  readonly expectedCostPoisha: bigint
  /** `actual − expected`. Positive means the model under-predicted the cost. */
  readonly calibrationGapPoisha: bigint
  readonly ledgerTransactionId: string
  readonly skipped?: string
}

/**
 * Reconcile one trip.
 *
 * Refuses rather than guesses when a trip is not ready: an uncosted trip has nothing true to
 * allocate, and allocating an estimate would defeat the entire purpose of recording actuals.
 */
export async function reconcileTrip(tripId: string): Promise<TripReconciliationResult> {
  const trip = await prisma.deliveryTrip.findUniqueOrThrow({
    where: { id: tripId },
    include: { deliveries: { include: { order: { include: { items: true } } } } },
  })

  const base = {
    tripId: trip.id,
    tripRef: trip.tripRef,
    ordersReconciled: 0,
    actualCostPoisha: trip.actualCostPoisha ?? 0n,
    expectedCostPoisha: 0n,
    calibrationGapPoisha: 0n,
    ledgerTransactionId: '',
  }

  if (trip.status !== 'COMPLETED') {
    return { ...base, skipped: `trip is ${trip.status}, not COMPLETED` }
  }
  if (trip.actualCostPoisha === null) {
    return { ...base, skipped: 'trip has no actual cost recorded; ops must cost it first' }
  }
  if (trip.deliveries.length === 0) {
    return { ...base, skipped: 'trip carried no orders' }
  }

  const orders: TripOrderInput[] = trip.deliveries.map((delivery) => ({
    orderId: delivery.orderId,
    // Chargeable weight is the sum of the order's line quantities, in milligrams — the same
    // figure the tariff was computed on.
    chargeableMilligrams: delivery.order.items.reduce(
      (total, item) => total + item.quantityBase,
      0n,
    ),
    expectedCostPoisha: (delivery.expectedCostPoisha ?? 0n) as never,
  }))

  const reconciliation = reconcileTripCost(
    trip.actualCostPoisha as never,
    orders,
    trip.allocationMethod === 'EQUAL_SHARE' ? 'EQUAL_SHARE' : 'WEIGHT_SHARE',
  )

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    for (const allocated of reconciliation.orders) {
      await tx.delivery.update({
        where: { orderId: allocated.orderId },
        data: {
          actualCostPoisha: allocated.actualCostPoisha,
          allocationNumerator: allocated.allocationNumerator,
          allocationDenominator: allocated.allocationDenominator,
          reconciledAt: now,
        },
      })
    }
  })

  // The trip's real cost hits the books once, keyed on the trip. docs/06 §5.1.
  const posted = await postJournal(
    journalForTripCost({ tripId: trip.id, actualCostPoisha: trip.actualCostPoisha as never }),
    { type: 'TRIP', id: trip.id },
  )

  return {
    tripId: trip.id,
    tripRef: trip.tripRef,
    ordersReconciled: reconciliation.orders.length,
    actualCostPoisha: reconciliation.allocatedTotalPoisha,
    expectedCostPoisha: reconciliation.expectedTotalPoisha,
    calibrationGapPoisha: reconciliation.calibrationGapPoisha,
    ledgerTransactionId: posted.transactionId,
  }
}

/** Every completed, costed trip that has not been reconciled yet. */
export async function reconcilePendingTrips(): Promise<TripReconciliationResult[]> {
  const pending = await prisma.deliveryTrip.findMany({
    where: {
      status: 'COMPLETED',
      actualCostPoisha: { not: null },
      deliveries: { some: { reconciledAt: null } },
    },
    select: { id: true },
    orderBy: { completedAt: 'asc' },
  })

  const results: TripReconciliationResult[] = []
  for (const trip of pending) {
    results.push(await reconcileTrip(trip.id))
  }
  return results
}

/**
 * Calibration report: how wrong the delivered-cost model has been.
 *
 * This is what the pilot reads to decide whether the tariff needs to move, and by how much. It
 * reports the raw gap rather than a tidied percentage because the absolute taka figure is what
 * consumes the loss budget.
 */
export async function calibrationSummary(): Promise<{
  readonly reconciledOrders: number
  readonly expectedTotalPoisha: bigint
  readonly actualTotalPoisha: bigint
  readonly gapPoisha: bigint
}> {
  const rows = await prisma.delivery.findMany({
    where: { reconciledAt: { not: null }, actualCostPoisha: { not: null } },
    select: { actualCostPoisha: true, expectedCostPoisha: true },
  })

  const actualTotalPoisha = Money.sum(rows.map((row) => (row.actualCostPoisha ?? 0n) as never))
  const expectedTotalPoisha = Money.sum(rows.map((row) => (row.expectedCostPoisha ?? 0n) as never))

  return {
    reconciledOrders: rows.length,
    expectedTotalPoisha,
    actualTotalPoisha,
    gapPoisha: Money.subtract(actualTotalPoisha, expectedTotalPoisha),
  }
}
