/**
 * Mock mobile financial service (bKash / Nagad / Rocket shaped).
 *
 * **This is a simulator. It moves no money and must never run in production** — the registry
 * refuses to hand it out outside development and test (docs/06 §13.8).
 *
 * It exists so the prepaid path is built, wired and tested *before* the custody/escrow review
 * concludes. Decision D4 keeps prepaid switched off at launch; when it is switched on, the work
 * should be replacing this adapter with a licensed partner's, not designing the flow.
 *
 * What it deliberately simulates, because these are the failures that actually happen on MFS:
 *  - a per-transaction fee the provider keeps, which is a real cost of a cancelled order
 *  - a provider reference that is stable per order, so a webhook delivered five times posts once
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §5.2, §11; docs/08_BANGLADESH_CONTEXT.md §6
 */

import type { PaymentAdapter, PaymentIntent, PaymentResult } from '@langgol/application'
import * as Money from '@langgol/domain/money'
import { createHash } from 'node:crypto'

/**
 * The fee the simulated provider keeps.
 *
 * Taken from `payments.cost` at the call site in production code; the value here is only used
 * when the adapter is asked to simulate a capture in a test, and is expressed as basis points
 * applied through the Money module so it never becomes a float.
 */
export interface MfsMockOptions {
  readonly rateBps: number
  readonly fixedPoisha: number
  /** Set to make a specific order fail, so the failure path is exercised in tests. */
  readonly failOrderIds?: readonly string[]
}

/** Deterministic, so a retried capture yields the same reference and cannot post twice. */
function providerRefFor(orderId: string): string {
  const digest = createHash('sha256').update(`mfs-mock:${orderId}`).digest('hex')
  return `MFSMOCK-${digest.slice(0, 12).toUpperCase()}`
}

export function createMockMfsAdapter(options: MfsMockOptions): PaymentAdapter {
  const failing = new Set(options.failOrderIds ?? [])

  function feeFor(amountPoisha: bigint): ReturnType<typeof Money.add> {
    return Money.add(
      Money.percentBps(amountPoisha as never, options.rateBps),
      Money.fromPoisha(options.fixedPoisha),
    )
  }

  return {
    method: 'MFS',
    timing: 'PREPAID',
    isMock: true,

    initiate(intent: PaymentIntent): Promise<PaymentResult> {
      if (failing.has(intent.orderId)) {
        return Promise.resolve({
          status: 'FAILED',
          providerRef: providerRefFor(intent.orderId),
          feePoisha: Money.zero,
          failureReason: 'SIMULATED_PROVIDER_DECLINE',
        })
      }

      return Promise.resolve({
        status: 'AUTHORIZED',
        providerRef: providerRefFor(intent.orderId),
        feePoisha: feeFor(intent.amountPoisha),
      })
    },

    confirm(input): Promise<PaymentResult> {
      if (failing.has(input.orderId)) {
        return Promise.resolve({
          status: 'FAILED',
          providerRef: input.providerRef,
          feePoisha: Money.zero,
          failureReason: 'SIMULATED_PROVIDER_DECLINE',
        })
      }

      return Promise.resolve({
        status: 'CAPTURED',
        providerRef: input.providerRef,
        feePoisha: feeFor(input.amountPoisha),
      })
    },
  }
}
