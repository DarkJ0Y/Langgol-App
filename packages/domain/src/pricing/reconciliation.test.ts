/**
 * Reconciliation tests.
 *
 * The property that matters most here is that allocation is **exact**: the shares must sum to the
 * trip cost to the poisha, for any set of weights. A reconciliation that loses money is worse
 * than no reconciliation, because it looks authoritative.
 *
 * Refs: docs/04_MARKETPLACE.md §4; docs/10_ECONOMIC_MEASUREMENT.md §6
 */

import { describe, expect, it } from 'vitest'
import * as Money from '../money/money.js'
import { computeTripMetrics, reconcileTripCost, type TripOrderInput } from './reconciliation.js'

const KG = 1000000n

function order(id: string, kg: number, expectedTaka: string): TripOrderInput {
  return {
    orderId: id,
    chargeableMilligrams: BigInt(kg) * KG,
    expectedCostPoisha: Money.fromTaka(expectedTaka),
  }
}

describe('a solo dispatch carries its whole trip cost', () => {
  it('allocates everything to the single order', () => {
    const result = reconcileTripCost(Money.fromTaka('180.00'), [order('o1', 5, '96.00')])

    expect(result.orders).toHaveLength(1)
    expect(Money.toTakaString(result.orders[0]!.actualCostPoisha)).toBe('180.00')
    // docs/06 §5.1: ৳96 delivery revenue against ৳180 actual cost is an ৳84 loss on this leg.
    expect(Money.toTakaString(result.orders[0]!.calibrationGapPoisha)).toBe('84.00')
  })

  it('reports the trip-level calibration gap', () => {
    const result = reconcileTripCost(Money.fromTaka('180.00'), [order('o1', 5, '96.00')])
    expect(Money.toTakaString(result.calibrationGapPoisha)).toBe('84.00')
    expect(Money.toTakaString(result.expectedTotalPoisha)).toBe('96.00')
  })
})

describe('pooling divides the cost by chargeable weight', () => {
  it('splits proportionally', () => {
    // 10 kg + 30 kg on one ৳400 trip → ৳100 and ৳300.
    const result = reconcileTripCost(Money.fromTaka('400.00'), [
      order('o1', 10, '150.00'),
      order('o2', 30, '250.00'),
    ])

    const byId = new Map(result.orders.map((entry) => [entry.orderId, entry]))
    expect(Money.toTakaString(byId.get('o1')!.actualCostPoisha)).toBe('100.00')
    expect(Money.toTakaString(byId.get('o2')!.actualCostPoisha)).toBe('300.00')
  })

  it('shows pooling beating a solo dispatch — the docs/04 §7.4 question', () => {
    const solo = reconcileTripCost(Money.fromTaka('400.00'), [order('o1', 10, '150.00')])
    const pooled = reconcileTripCost(Money.fromTaka('400.00'), [
      order('o1', 10, '150.00'),
      order('o2', 10, '150.00'),
      order('o3', 10, '150.00'),
      order('o4', 10, '150.00'),
    ])

    const soloCost = solo.orders[0]!.actualCostPoisha
    const pooledCost = pooled.orders[0]!.actualCostPoisha
    expect(Money.compare(pooledCost, soloCost)).toBe(-1)
    expect(Money.toTakaString(pooledCost)).toBe('100.00')
  })
})

describe('allocation is exact — no poisha is invented or lost', () => {
  it('sums to the trip cost when the weights divide evenly', () => {
    const result = reconcileTripCost(Money.fromTaka('300.00'), [
      order('o1', 10, '100.00'),
      order('o2', 20, '200.00'),
    ])
    expect(result.allocatedTotalPoisha).toBe(result.tripActualCostPoisha)
  })

  it('sums to the trip cost when they do NOT divide evenly', () => {
    // ৳100.00 across three equal orders is 3333.33… poisha each.
    const result = reconcileTripCost(Money.fromTaka('100.00'), [
      order('o1', 10, '30.00'),
      order('o2', 10, '30.00'),
      order('o3', 10, '30.00'),
    ])
    expect(result.allocatedTotalPoisha).toBe(result.tripActualCostPoisha)
    expect(Money.toTakaString(result.allocatedTotalPoisha)).toBe('100.00')
  })

  it('stays exact across awkward weights and a prime cost', () => {
    const result = reconcileTripCost(Money.fromPoisha(999983n), [
      order('o1', 7, '1.00'),
      order('o2', 11, '1.00'),
      order('o3', 13, '1.00'),
      order('o4', 17, '1.00'),
    ])
    expect(result.allocatedTotalPoisha).toBe(999983n)
  })

  it('is reproducible: a re-run on a reordered list gives identical numbers', () => {
    const a = reconcileTripCost(Money.fromTaka('100.00'), [
      order('o1', 10, '30.00'),
      order('o2', 10, '30.00'),
      order('o3', 10, '30.00'),
    ])
    const b = reconcileTripCost(Money.fromTaka('100.00'), [
      order('o3', 10, '30.00'),
      order('o1', 10, '30.00'),
      order('o2', 10, '30.00'),
    ])
    expect(a.orders.map((entry) => [entry.orderId, entry.actualCostPoisha.toString()])).toEqual(
      b.orders.map((entry) => [entry.orderId, entry.actualCostPoisha.toString()]),
    )
  })
})

describe('allocation methods', () => {
  it('EQUAL_SHARE ignores weight', () => {
    const result = reconcileTripCost(
      Money.fromTaka('300.00'),
      [order('o1', 5, '0.00'), order('o2', 95, '0.00')],
      'EQUAL_SHARE',
    )
    for (const entry of result.orders) {
      expect(Money.toTakaString(entry.actualCostPoisha)).toBe('150.00')
    }
  })

  it('STANDALONE refuses a trip carrying more than one order', () => {
    expect(() =>
      reconcileTripCost(
        Money.fromTaka('100.00'),
        [order('o1', 5, '0.00'), order('o2', 5, '0.00')],
        'STANDALONE',
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('refuses a trip with no orders rather than silently discarding the cost', () => {
    expect(() => reconcileTripCost(Money.fromTaka('100.00'), [])).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })

  it('refuses weight-share allocation when nothing on the trip has weight', () => {
    expect(() =>
      reconcileTripCost(Money.fromTaka('100.00'), [
        { orderId: 'o1', chargeableMilligrams: 0n, expectedCostPoisha: Money.zero },
      ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })
})

describe('trip metrics — the delivery-model comparison', () => {
  it('computes cost per order, per kg and utilisation', () => {
    const metrics = computeTripMetrics({
      actualCostPoisha: Money.fromTaka('400.00'),
      orderCount: 4,
      totalWeightMilligrams: 40n * KG,
      vehicleCapacityMilligrams: 300n * KG,
      routeDistanceMeters: 48000,
    })

    expect(Money.toTakaString(metrics.costPerOrderPoisha)).toBe('100.00')
    expect(Money.toTakaString(metrics.costPerKgPoisha!)).toBe('10.00')
    // 40 of 300 kg = 13.33% of capacity.
    expect(metrics.utilisationBps).toBe(1333)
    expect(metrics.averageDistancePerOrderMeters).toBe(12000)
  })

  it('reports no cost-per-kg for a trip carrying no mass', () => {
    const metrics = computeTripMetrics({
      actualCostPoisha: Money.fromTaka('50.00'),
      orderCount: 1,
      totalWeightMilligrams: 0n,
      vehicleCapacityMilligrams: 100n * KG,
      routeDistanceMeters: 1000,
    })
    expect(metrics.costPerKgPoisha).toBeNull()
  })
})
