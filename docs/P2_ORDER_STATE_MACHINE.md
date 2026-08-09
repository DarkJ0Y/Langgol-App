# P2 — Order State Machine

> **Status:** Design proposal · **Baseline:** [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md), which
> remains authoritative. This document records what P2 adds.

---

## 1. States

P1 defined: `PENDING · CONFIRMED · PREPARING · READY_FOR_PICKUP · IN_TRANSIT · DELIVERED ·
COMPLETED · CANCELLED · FAILED · REFUNDED · DISPUTED`.

The brief asks about `OUT_FOR_DELIVERY`, `READY` and `REFUND_PENDING`.

| Brief's name       | P2 answer                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `READY`            | Already `READY_FOR_PICKUP`. Keep the P1 name — it says _who acts next_                                                                                                                                                               |
| `OUT_FOR_DELIVERY` | Already `IN_TRANSIT`. Keep — it covers courier, farmer and ops-coordinated equally                                                                                                                                                   |
| `REFUND_PENDING`   | **Not a new order state.** Refund progress lives on the `Refund` row (`REQUESTED → APPROVED → PROCESSING → COMPLETED`). An order stuck in `REFUND_PENDING` would conflate "what happened to the goods" with "where the money got to" |

**One new state is proposed: `AWAITING_HARVEST`**, between `CONFIRMED` and `PREPARING`, for forward
listings whose `expectedHarvestAt` has not arrived. Without it, a forward order sits in
`CONFIRMED` for days and every SLA timer misreads it as a farmer failing to prepare.

```text
PENDING → CONFIRMED → [AWAITING_HARVEST] → PREPARING → READY_FOR_PICKUP
        → IN_TRANSIT → DELIVERED → COMPLETED
        ↘ CANCELLED / FAILED → REFUNDED        DELIVERED/COMPLETED ↔ DISPUTED
```

---

## 2. Transitions added or changed in P2

The P1 table (§3 of [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md)) stands. P2 adds:

| From → To                         | Actor              | Guard                                    | Effects                                                        |
| --------------------------------- | ------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| `CONFIRMED` → `AWAITING_HARVEST`  | SYSTEM             | Listing was `PENDING_HARVEST`            | No SLA clock; buyer told the expected date                     |
| `AWAITING_HARVEST` → `PREPARING`  | FARMER             | Harvest recorded                         | Preparation SLA starts here                                    |
| `AWAITING_HARVEST` → `CANCELLED`  | FARMER             | Reason `CROP_FAILURE`                    | Full refund; **no reliability penalty**; fault `FORCE_MAJEURE` |
| `READY_FOR_PICKUP` → `IN_TRANSIT` | OPS_AGENT          | Assigned to a `DeliveryTrip`             | Trip stop created; delivery OTP issued                         |
| `IN_TRANSIT` → `DELIVERED`        | OPS_AGENT / FARMER | Delivery OTP or photo + ops confirmation | Actual weight recorded; COD captured; ledger `GOODS_DELIVERED` |

Everything else — quiet-hours acceptance windows, auto-complete, dispute holds, the illegal-
transition rejection — is unchanged.

---

## 3. Every transition still carries

`actor` · `precondition` · `authorization` (policy predicate) · `timestamp` · append-only
`OrderEvent` · notification intent · financial effect. `OrderStatus` is changed by exactly one
function, `transition()`. Assigning it anywhere else remains a review-blocking defect.

---

## 4. Cancellation

Fault attribution (`BUYER · SELLER · PLATFORM · LOGISTICS · FORCE_MAJEURE · UNDETERMINED`) is
mandatory on every cancellation, failure and dispute resolution, and is enforced by database CHECK.

| Actor        | Before confirm                           | After confirm                          | After preparation                 | After dispatch                          | After delivery |
| ------------ | ---------------------------------------- | -------------------------------------- | --------------------------------- | --------------------------------------- | -------------- |
| **Buyer**    | Free, full release                       | Free if nothing harvested              | Fee may apply → **to the farmer** | Not permitted — becomes refusal at door | Dispute only   |
| **Farmer**   | Free, reliability counted                | Full buyer refund, reliability counted | Same                              | Same                                    | Dispute only   |
| **Retailer** | As buyer                                 | As buyer, larger fee exposure          | As buyer                          | Not permitted                           | Dispute        |
| **Ops**      | Reason required                          | Reason required                        | Reason required                   | Records failure + trip cost             | —              |
| **Admin**    | Discretionary, reason mandatory, audited |                                        |                                   |                                         |                |

**Cancellation fees default to farmer compensation** (D7), with only a documented operational-cost
component retained by Langgol. Under `FORCE_MAJEURE`, `PLATFORM`, `LOGISTICS` or `UNDETERMINED`, no
fee is charged at all — ambiguity resolves in the user's favour.

**Clawbacks are never automated collection.** A dispute upheld after settlement nets against the
farmer's next settlement; beyond a threshold it goes to a human, not a demand letter. A smallholder
must never receive an automated debt notice over a ৳50 tomato.

---

## 5. Failure modes (§37 of the brief)

| Failure                      | State                                                           | Financial treatment                                                        | Fault          | Notification                   |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------- | ------------------------------ |
| Farmer doesn't respond       | `CANCELLED(SELLER_TIMEOUT)`                                     | Release, full refund                                                       | SELLER         | Both parties                   |
| Buyer cancels late           | `CANCELLED`                                                     | Fee → farmer                                                               | BUYER          | Farmer                         |
| Farmer cancels               | `CANCELLED`                                                     | Full refund                                                                | SELLER         | Buyer                          |
| Crop failure                 | `CANCELLED(CROP_FAILURE)`                                       | Full refund, no penalty                                                    | FORCE_MAJEURE  | Buyer                          |
| Inventory gone at checkout   | No order created                                                | None                                                                       | —              | Alternatives shown             |
| Concurrent reservation       | Loser gets `InsufficientInventory`                              | None                                                                       | —              | "Just sold out" + alternatives |
| Delivery fails, buyer absent | `FAILED(BUYER_UNAVAILABLE)`                                     | **Trip cost booked**; perishables may be resold or written off with reason | BUYER          | Both                           |
| Bad weather / road closed    | `FAILED` or rescheduled                                         | Trip cost booked                                                           | FORCE_MAJEURE  | Both                           |
| Wrong quantity               | Adjust within ±5% tolerance; beyond it needs buyer confirmation | Line recomputed on **actual** weight                                       | —              | Buyer                          |
| Quality dispute              | `DISPUTED`                                                      | Settlement held; refund per fault                                          | Per resolution | Both + ops                     |
| COD mismatch                 | Agent float discrepancy                                         | Aged reconciliation, ops task                                              | —              | Ops                            |
| Settlement failure           | Settlement `FAILED`                                             | Retried; **farmer payout is not blocked by our collection failure**        | PLATFORM       | Ops                            |
| Duplicate order request      | Same idempotency key returns the same order                     | None                                                                       | —              | —                              |

---

## 6. What P2 does not change

Append-only `OrderEvent` remains the source of truth and `orders.status` remains its projection.
Idempotent transitions. Ledger effects inside the same transaction as the state change. Quiet-hours
acceptance windows. Settlement at T+0/T+1 with risk-tiered holds. All unchanged.
