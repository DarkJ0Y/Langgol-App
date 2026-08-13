/**
 * Payment ports.
 *
 * A payment method is an adapter behind this interface, so adding one is an adapter plus a
 * configuration entry rather than a change to the order lifecycle. That matters because Langgol
 * launches COD-first and must be able to switch on a licensed MFS partner later **without
 * redesigning settlement under time pressure**.
 *
 * Two constraints are structural, not incidental:
 *
 *  - `payments.prepaidEnabled` is a **hard gate** (decision D4). Prepaid stays off until the
 *    custody/escrow review completes, because holding a buyer's money before delivery is a
 *    licensing question, not an engineering preference.
 *  - **No mock provider may be registrable in production** (docs/06 §13.8). The registry enforces
 *    this rather than relying on deployment discipline.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §11, §13; docs/03_ARCHITECTURE.md §2.1
 */

import type { Poisha } from '@langgol/domain/money'

export type PaymentMethod = 'CASH_ON_DELIVERY' | 'MFS' | 'CARD' | 'BANK_TRANSFER'

/** When money actually reaches Langgol relative to delivery. */
export type PaymentTiming =
  /** Collected at the door. No custody exposure before delivery. */
  | 'ON_DELIVERY'
  /** Captured before delivery, held as a liability. Requires the custody review. */
  | 'PREPAID'

export interface PaymentIntent {
  readonly orderId: string
  readonly buyerUserId: string
  readonly amountPoisha: Poisha
  /** Deterministic per order so a retry cannot capture twice. */
  readonly idempotencyKey: string
}

export interface PaymentResult {
  readonly status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED'
  /** Provider's own reference. `Payment(provider, providerRef)` is unique — a webhook delivered
   *  five times posts once. */
  readonly providerRef: string
  /** What the provider keeps. Booked to `5010`, never netted quietly into another line. */
  readonly feePoisha: Poisha
  readonly failureReason?: string
}

export interface PaymentAdapter {
  readonly method: PaymentMethod
  readonly timing: PaymentTiming
  /** True for adapters that simulate a provider. Refused outside development and test. */
  readonly isMock: boolean

  /**
   * Begin collection. For COD this records intent only — no money moves until the agent is
   * handed cash at the door.
   */
  initiate(intent: PaymentIntent): Promise<PaymentResult>

  /** Confirm money is actually in hand. Called at delivery for COD, on webhook for prepaid. */
  confirm(input: {
    readonly orderId: string
    readonly providerRef: string
    readonly amountPoisha: Poisha
  }): Promise<PaymentResult>
}

export type PaymentRegistryErrorCode =
  'METHOD_NOT_ENABLED' | 'PREPAID_DISABLED' | 'MOCK_IN_PRODUCTION' | 'NO_ADAPTER'

export class PaymentRegistryError extends Error {
  readonly code: PaymentRegistryErrorCode

  constructor(code: PaymentRegistryErrorCode, message: string) {
    super(message)
    this.name = 'PaymentRegistryError'
    this.code = code
  }
}

export interface PaymentRegistry {
  /**
   * Resolve the adapter for a method, or refuse with a typed reason.
   *
   * Every gate is checked here so no caller can reach an adapter by another route.
   */
  resolve(method: string): PaymentAdapter
  readonly enabledMethods: readonly string[]
}
