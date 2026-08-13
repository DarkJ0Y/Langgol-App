/**
 * Payment registry tests.
 *
 * The gates are the point of this suite. A payment method that slips past `prepaidEnabled`, or a
 * simulator that resolves in production, is not a bug that shows up in a test run — it shows up
 * in a regulator's letter or a customer's bank statement.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §11, §13.8
 */

import { describe, expect, it } from 'vitest'
import { fixtureConfig } from '@langgol/domain/testing'
import * as Money from '@langgol/domain/money'
import { createPaymentRegistry } from './registry.js'
import { codAdapter } from './cod.js'
import { createMockMfsAdapter } from './mfs-mock.js'

const bothMethods = {
  key: 'payments.methods.enabled',
  version: 2,
  value: ['CASH_ON_DELIVERY', 'MFS'],
}
const prepaidOn = { key: 'payments.prepaidEnabled', version: 2, value: true }

describe('COD adapter', () => {
  it('captures nothing at initiation — the promise lives in the order, not the ledger', async () => {
    const result = await codAdapter.initiate({
      orderId: 'order-1',
      buyerUserId: 'buyer-1',
      amountPoisha: Money.fromTaka('256.00'),
      idempotencyKey: 'k1',
    })
    expect(result.status).toBe('PENDING')
    expect(Money.isZero(result.feePoisha)).toBe(true)
  })

  it('reports capture once the agent confirms collection', async () => {
    const result = await codAdapter.confirm({
      orderId: 'order-1',
      providerRef: 'COD:order-1',
      amountPoisha: Money.fromTaka('256.00'),
    })
    expect(result.status).toBe('CAPTURED')
  })

  it('is collected on delivery, so Langgol never holds funds beforehand', () => {
    expect(codAdapter.timing).toBe('ON_DELIVERY')
    expect(codAdapter.isMock).toBe(false)
  })
})

describe('mock MFS adapter', () => {
  const adapter = createMockMfsAdapter({ rateBps: 150, fixedPoisha: 500 })

  it('charges the provider fee as bps + fixed, through the Money module', async () => {
    // 1.5% of ৳256.00 = ৳3.84, plus the ৳5.00 fixed fee.
    const result = await adapter.initiate({
      orderId: 'order-1',
      buyerUserId: 'buyer-1',
      amountPoisha: Money.fromTaka('256.00'),
      idempotencyKey: 'k1',
    })
    expect(Money.toTakaString(result.feePoisha)).toBe('8.84')
    expect(result.status).toBe('AUTHORIZED')
  })

  it('returns a stable provider reference so a replayed webhook posts once', async () => {
    const first = await adapter.initiate({
      orderId: 'order-42',
      buyerUserId: 'b',
      amountPoisha: Money.fromTaka('10.00'),
      idempotencyKey: 'k',
    })
    const second = await adapter.initiate({
      orderId: 'order-42',
      buyerUserId: 'b',
      amountPoisha: Money.fromTaka('10.00'),
      idempotencyKey: 'k2',
    })
    expect(first.providerRef).toBe(second.providerRef)
  })

  it('can simulate a provider decline, so the failure path is exercised', async () => {
    const failing = createMockMfsAdapter({ rateBps: 150, fixedPoisha: 500, failOrderIds: ['bad'] })
    const result = await failing.initiate({
      orderId: 'bad',
      buyerUserId: 'b',
      amountPoisha: Money.fromTaka('10.00'),
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('FAILED')
    expect(result.failureReason).toBe('SIMULATED_PROVIDER_DECLINE')
  })

  it('declares itself a mock', () => {
    expect(adapter.isMock).toBe(true)
    expect(adapter.timing).toBe('PREPAID')
  })
})

describe('the registry enforces every gate', () => {
  it('resolves COD in the seeded configuration', () => {
    const registry = createPaymentRegistry({
      config: fixtureConfig(),
      environment: 'development',
    })
    expect(registry.resolve('CASH_ON_DELIVERY').method).toBe('CASH_ON_DELIVERY')
  })

  it('refuses a method that is not in payments.methods.enabled', () => {
    const registry = createPaymentRegistry({
      config: fixtureConfig(),
      environment: 'development',
    })
    expect(() => registry.resolve('MFS')).toThrow(
      expect.objectContaining({ code: 'METHOD_NOT_ENABLED' }),
    )
  })

  it('refuses a prepaid method while prepaidEnabled is false — decision D4', () => {
    // Enabled in the list, but the hard gate is still shut. This is the case that matters:
    // it would be easy to switch the list on and believe prepaid was ready.
    const registry = createPaymentRegistry({
      config: fixtureConfig([bothMethods]),
      environment: 'development',
    })
    expect(() => registry.resolve('MFS')).toThrow(
      expect.objectContaining({ code: 'PREPAID_DISABLED' }),
    )
  })

  it('refuses a mock adapter in production even when everything else is enabled', () => {
    const registry = createPaymentRegistry({
      config: fixtureConfig([bothMethods, prepaidOn]),
      environment: 'production',
    })
    expect(() => registry.resolve('MFS')).toThrow(
      expect.objectContaining({ code: 'MOCK_IN_PRODUCTION' }),
    )
  })

  it('refuses a mock adapter in staging too', () => {
    const registry = createPaymentRegistry({
      config: fixtureConfig([bothMethods, prepaidOn]),
      environment: 'staging',
    })
    expect(() => registry.resolve('MFS')).toThrow(
      expect.objectContaining({ code: 'MOCK_IN_PRODUCTION' }),
    )
  })

  it('resolves the mock only in development, once both gates are open', () => {
    const registry = createPaymentRegistry({
      config: fixtureConfig([bothMethods, prepaidOn]),
      environment: 'development',
    })
    const adapter = registry.resolve('MFS')
    expect(adapter.method).toBe('MFS')
    expect(adapter.isMock).toBe(true)
  })

  it('reports a missing adapter distinctly from a disabled method', () => {
    const registry = createPaymentRegistry({
      config: fixtureConfig([
        { key: 'payments.methods.enabled', version: 3, value: ['CASH_ON_DELIVERY', 'CARD'] },
      ]),
      environment: 'development',
    })
    expect(() => registry.resolve('CARD')).toThrow(expect.objectContaining({ code: 'NO_ADAPTER' }))
  })

  it('a real (non-mock) prepaid adapter still passes the production check once prepaid is on', () => {
    // Proves the production gate keys on isMock, not on timing — a licensed partner's adapter
    // must be able to run in production.
    const licensed = { ...createMockMfsAdapter({ rateBps: 150, fixedPoisha: 500 }), isMock: false }
    const registry = createPaymentRegistry({
      config: fixtureConfig([bothMethods, prepaidOn]),
      environment: 'production',
      adapters: [codAdapter, licensed],
    })
    expect(registry.resolve('MFS').isMock).toBe(false)
  })
})
