/**
 * Cash on delivery.
 *
 * The launch payment method, and the one that matches actual Bangladeshi buyer behaviour. It is
 * also the lowest-regulatory-friction path: no money is held before delivery, so Langgol never
 * has custody of a buyer's funds (docs/06 §11, model A).
 *
 * "No money moves" is not quite true and the difference matters: once the agent takes the cash it
 * is **third-party money in Langgol's hands**, carried in `1020 Cash in transit — COD float` per
 * agent and aged. This adapter therefore records intent at initiation and only reports capture
 * when the agent confirms collection.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §5.1, §11
 */

import type { PaymentAdapter, PaymentIntent, PaymentResult } from '@langgol/application'
import * as Money from '@langgol/domain/money'

export const codAdapter: PaymentAdapter = {
  method: 'CASH_ON_DELIVERY',
  timing: 'ON_DELIVERY',
  isMock: false,

  initiate(intent: PaymentIntent): Promise<PaymentResult> {
    // Nothing is captured, authorised or reserved. The buyer has promised to pay at the door and
    // that promise lives in the order record, not in the ledger.
    return Promise.resolve({
      status: 'PENDING',
      providerRef: `COD:${intent.orderId}`,
      feePoisha: Money.zero,
    })
  },

  confirm(input): Promise<PaymentResult> {
    /*
     * The agent has the cash. There is no external provider to call and nothing that can fail
     * here — a failure to collect is an order-lifecycle event (delivery failed, buyer refused),
     * not a payment error, and is handled by the order state machine with a fault party.
     *
     * The COD handling cost lives in `payments.cost` and is applied by the pricing engine; it is
     * not a provider fee, so it is zero here.
     */
    return Promise.resolve({
      status: 'CAPTURED',
      providerRef: input.providerRef,
      feePoisha: Money.zero,
    })
  },
}
