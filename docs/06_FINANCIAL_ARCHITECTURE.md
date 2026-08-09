# 06 — Financial Architecture

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Data:** [`02_DATABASE.md`](02_DATABASE.md) §9 · **Regulatory:** [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7

Langgol handles other people's money from day one — farmers' sale proceeds and buyers' payments. The financial layer is built to accounting standards, not to "e-commerce app" standards, because retrofitting a ledger after launch means reconstructing history that no longer exists.

---

## 1. Principal vs agent — the decision that shapes everything

**Langgol acts as an agent, not a principal.** It does not buy produce and resell it; it facilitates a sale between farmer and buyer and earns a commission.

Consequences, all deliberate:

- **Revenue is commission + service fees, not GMV.** ৳15,000 of tomatoes transacted at 3% is ৳450 of revenue, and nothing in the product or the reporting is allowed to blur that.
- The farmer's gross remains **the farmer's money**, carried as a liability (`2000 Payable to farmers`) until settled.
- Tax treatment follows the agency model: VAT arises on Langgol's **service fee**, not on the value of the produce ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.5 — confirm with a Bangladeshi tax adviser).
- Holding buyer funds pending delivery creates a **custody obligation**, which is a licensing question, not an engineering preference (§11).

If Langgol later takes title to goods (buying at harvest and reselling), that is a different business with a different balance sheet and different regulation. The ledger supports it; the MVP does not do it.

---

## 2. Money representation

| Rule       | Detail                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit       | Integer **poisha**. ৳100.50 = `10050`                                                                                                                  |
| Type       | `BigInt`, branded as `Poisha` in TypeScript                                                                                                            |
| Never      | `float`, `double`, `number` for money — anywhere, including analytics queries                                                                          |
| Input      | Parsed from strings (`"100.50"`), never from a JS `number` literal                                                                                     |
| Transport  | Serialised as a **string** in JSON. `BigInt` is not JSON-representable and `Number()` loses precision above 2^53                                       |
| Storage    | `BIGINT` columns, suffix `Poisha`                                                                                                                      |
| Display    | Formatted per locale: `৳1,234.50` (en) / `৳১,২৩৪.৫০` (bn)                                                                                              |
| Rounding   | Half-up, once per line ([`02_DATABASE.md`](02_DATABASE.md) §1.1)                                                                                       |
| Allocation | `Money.allocate()` distributes a total across weights with no lost poisha; **the remainder always goes to the platform**, never to the farmer or buyer |

A lint rule forbids arithmetic operators on `*Poisha` identifiers outside `packages/domain/money`, and forbids `Number(x)` where `x` is money-typed. This has caught more bugs in more codebases than any amount of care.

---

## 3. Chart of accounts (MVP)

Per-farmer and per-agent accounts are created lazily with `ownerType`/`ownerId`.

| Code   | Name                                    | Type      | Owner                  |
| ------ | --------------------------------------- | --------- | ---------------------- |
| `1000` | Cash — bank                             | ASSET     | PLATFORM               |
| `1010` | Cash — MFS merchant wallet              | ASSET     | PLATFORM               |
| `1020` | Cash in transit — COD float             | ASSET     | PLATFORM per **agent** |
| `1030` | Receivable from payment provider        | ASSET     | PLATFORM per provider  |
| `2000` | Payable to farmers                      | LIABILITY | per **farmer**         |
| `2010` | Buyer prepayments held                  | LIABILITY | per **buyer**          |
| `2020` | Refunds payable                         | LIABILITY | PLATFORM               |
| `2030` | VAT payable                             | LIABILITY | PLATFORM               |
| `2040` | Withholding tax payable                 | LIABILITY | PLATFORM               |
| `4000` | Commission revenue                      | REVENUE   | PLATFORM               |
| `4010` | Delivery fee revenue                    | REVENUE   | PLATFORM               |
| `4020` | Handling fee revenue                    | REVENUE   | PLATFORM               |
| `4030` | Cancellation ops-cost recovery          | REVENUE   | PLATFORM               |
| `5000` | Logistics cost                          | EXPENSE   | PLATFORM               |
| `5010` | Payment processing cost                 | EXPENSE   | PLATFORM               |
| `5020` | Promotional discount / delivery subsidy | EXPENSE   | PLATFORM               |
| `5030` | Spoilage and loss                       | EXPENSE   | PLATFORM               |
| `5040` | Packaging and handling materials        | EXPENSE   | PLATFORM               |
| `5050` | Field-agent variable cost               | EXPENSE   | PLATFORM               |

**No balance is ever stored.** A farmer's payable is `SUM(credits) − SUM(debits)` over account `2000/<farmerId>`. Cached balances are materialised views with a scheduled integrity check, never the source of truth.

---

## 4. Fee model (approved)

**Commission: 3% (300 bps), seller-side. No buyer-side marketplace fee at MVP.** The rate lives in `PlatformConfig` as `commission.bps` and is **never a literal in business logic** — a lint rule and a code-review check both enforce this, because a hard-coded rate is a rate that cannot be changed without a deploy, and it silently invalidates every historical figure when it is changed.

```text
sellerGross   = Σ lineTotals                                  (the farmer's produce value)
commission    = roundHalfUp(sellerGross × config.commission.bps / 10000)     // 300 bps
sellerNet     = sellerGross − commission − sellerFundedDelivery

deliveryCharged = applyFunding(tariff(chargeableWeight, distance), fundingModel).chargedToBuyer
handlingFee   = flat or per-kg by product class
platformFee   = 0 at MVP

buyerTotal    = sellerGross + deliveryCharged + handlingFee + platformFee
```

The buyer's breakdown shows exactly three things: **product price + delivery + applicable charges**. No marketplace fee line, because there is no marketplace fee.

Rationale for seller-side incidence: a buyer-side fee directly worsens the delivered-price metric the pilot exists to test, and a farmer who sees ৳30/kg become ৳29.10/kg understands a commission far more readily than a buyer understands a service charge on vegetables.

Every order stores `commissionBps` as applied, so a later rate change never retroactively alters historical economics.

**The honesty constraint that follows from taking 3%:** commission reduces measured farmer realisation. If we take 3% and claim a 2% uplift, the farmer is worse off. Realisation is always measured **net of commission and every deduction** — [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §5.1.

---

## 5. Journal entries

Worked on the §7.1 example of [`04_MARKETPLACE.md`](04_MARKETPLACE.md): produce ৳150.00, delivery ৳96.00, handling ৳10.00, buyer total ৳256.00, **commission 3% = ৳4.50**, farmer net ৳145.50. Funding model `COST_RECOVERING`.

### 5.1 Cash on delivery

**Order placed** — economically nothing has happened. No entries. (`journalForOrderPlaced` returns an empty journal for COD; the commitment lives in the order record, not the ledger.)

**Goods delivered, cash collected by agent** — `key: ORDER:<id>:GOODS_DELIVERED`

| Account                              | DR      | CR      |
| ------------------------------------ | ------- | ------- |
| `1020` Cash in transit — Agent Karim | ৳256.00 |         |
| `2000` Payable to farmer Rahim       |         | ৳145.50 |
| `4000` Commission revenue            |         | ৳4.50   |
| `4010` Delivery fee revenue          |         | ৳96.00  |
| `4020` Handling fee revenue          |         | ৳10.00  |

**Agent remits to bank** — `key: REMITTANCE:<id>`

| Account                              | DR      | CR      |
| ------------------------------------ | ------- | ------- |
| `1000` Cash — bank                   | ৳256.00 |         |
| `1020` Cash in transit — Agent Karim |         | ৳256.00 |

**Actual delivery cost paid (৳180)** — `key: DELIVERY:<id>:COST`

| Account               | DR      | CR      |
| --------------------- | ------- | ------- |
| `5000` Logistics cost | ৳180.00 |         |
| `1000` Cash — bank    |         | ৳180.00 |

Delivery revenue ৳96 against a ৳180 cost is an ৳84 loss on this leg, and the reporting layer surfaces it as such. That is the number the pilot exists to move.

**Settlement to farmer** — `key: SETTLEMENT:<id>:PAY`

| Account                        | DR      | CR      |
| ------------------------------ | ------- | ------- |
| `2000` Payable to farmer Rahim | ৳145.50 |         |
| `1000` Cash — bank             |         | ৳145.50 |

### 5.2 Prepaid (MFS / gateway) — _built to the interface, disabled at launch (D4)_

Provider fee 1.5% = ৳3.84. These entries are specified and tested now so that enabling prepaid later is a configuration change with a known ledger shape, not a new financial design under time pressure.

**Payment captured** — `key: PAYMENT:<providerRef>`

| Account                         | DR      | CR      |
| ------------------------------- | ------- | ------- |
| `1030` Receivable from provider | ৳252.16 |         |
| `5010` Payment processing cost  | ৳3.84   |         |
| `2010` Buyer prepayments held   |         | ৳256.00 |

The buyer's money is a **liability**, not revenue, until delivery. This is the accounting expression of escrow.

**Goods delivered** — `key: ORDER:<id>:GOODS_DELIVERED`

| Account                        | DR      | CR      |
| ------------------------------ | ------- | ------- |
| `2010` Buyer prepayments held  | ৳256.00 |         |
| `2000` Payable to farmer Rahim |         | ৳145.50 |
| `4000` Commission revenue      |         | ৳4.50   |
| `4010` Delivery fee revenue    |         | ৳96.00  |
| `4020` Handling fee revenue    |         | ৳10.00  |

**Provider settles to bank** — `key: PROVIDER_SETTLEMENT:<batchRef>`

| Account                         | DR      | CR      |
| ------------------------------- | ------- | ------- |
| `1000` Cash — bank              | ৳252.16 |         |
| `1030` Receivable from provider |         | ৳252.16 |

### 5.3 Full refund before delivery (prepaid)

| Account                       | DR      | CR      |
| ----------------------------- | ------- | ------- |
| `2010` Buyer prepayments held | ৳256.00 |         |
| `2020` Refunds payable        |         | ৳256.00 |

then on payout: DR `2020` ৳256.00 / CR `1000` ৳256.00.

The ৳3.84 provider fee is generally **not** returned by the provider. It stays in `5010` — a real cost of a cancelled order, and a reason cancellations must be tracked by cause.

### 5.4 Partial refund after delivery (dispute, ৳50 allowed)

Which journal applies is decided by the dispute's **`faultParty`** ([`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §5.1) — an explicit, required field, not an implicit consequence of which button an admin pressed.

_`faultParty = SELLER` — quality issue, the seller bears it_ (commission reversed pro-rata, 3% of ৳50 = ৳1.50):

| Account                        | DR     | CR     |
| ------------------------------ | ------ | ------ |
| `2000` Payable to farmer Rahim | ৳48.50 |        |
| `4000` Commission revenue      | ৳1.50  |        |
| `2020` Refunds payable         |        | ৳50.00 |

_`faultParty = LOGISTICS` or `PLATFORM` — damage in our transit, we bear it:_

| Account                  | DR     | CR     |
| ------------------------ | ------ | ------ |
| `5030` Spoilage and loss | ৳50.00 |        |
| `2020` Refunds payable   |        | ৳50.00 |

_`faultParty = FORCE_MAJEURE` or `UNDETERMINED` — the platform absorbs it._ The farmer is not charged for a flood, and is not charged for our inability to establish what happened.

### 5.5 Weight adjustment at delivery (4.8 kg delivered instead of 5 kg)

Line total falls ৳6.00; commission falls ৳0.18 (3%). Booked as a reduced `GOODS_DELIVERED` journal computed from **actual** delivered quantity — never as a correcting entry after the fact. The order stores both ordered and delivered quantities, so the variance is analysable, and `OrderEconomics` uses the delivered figure throughout.

### 5.6 Clawback after settlement

If a dispute is upheld after the farmer has been paid, a `SettlementItem` of type `REFUND_CLAWBACK` is netted against the farmer's **next** settlement. A farmer's payable account may go temporarily negative; it must never trigger an automatic demand for cash, and any balance unrecovered after N cycles goes to ops for a human conversation. Automated debt collection from a smallholder farmer over a ৳50 tomato dispute is a reputational and ethical failure, not a feature.

### 5.7 Delivery funding models

Tariff ৳96.00 in every case below. Only the delivery portion of the `GOODS_DELIVERED` journal changes.

**`COST_RECOVERING`** — buyer charged ৳96.00 → `CR 4010` ৳96.00. (The base case above.)

**`PROMOTIONAL_SUBSIDY`** — buyer charged ৳50.00, subsidy ৳46.00, `subsidyReason = MARKET_SEEDING`:

| Account                                             | DR     | CR     |
| --------------------------------------------------- | ------ | ------ |
| `1020` Cash in transit (buyer pays ৳50 of delivery) | ৳50.00 |        |
| `5020` Promotional discount / delivery subsidy      | ৳46.00 |        |
| `4010` Delivery fee revenue                         |        | ৳96.00 |

Revenue is recognised at the full tariff and the discount is an explicit expense. This is what makes "how much are we paying for this order?" answerable in one query rather than inferable from a gap.

**`FREE_DELIVERY`** — identical with `5020` ৳96.00 and no buyer cash for delivery.

**`SELLER_FUNDED`** — the farmer absorbs ৳96.00; buyer pays product only:

| Account                        | DR     | CR     |
| ------------------------------ | ------ | ------ |
| `2000` Payable to farmer Rahim | ৳96.00 |        |
| `4010` Delivery fee revenue    |        | ৳96.00 |

The farmer's payable is reduced, `sellerNet` reflects it, and `OrderEconomics.deliveryDeductionPoisha` carries it into the uplift calculation — so a farmer who funds delivery does **not** show a spurious realisation gain.

**`RETAILER_FUNDED`** — retailer pays delivery directly, possibly above tariff; the excess is delivery revenue, not commission.

**`SHARED`** — the split ratio is stored on the order; entries follow the same pattern in proportion.

**Invariant, tested:** across every model, `chargedToBuyer + fundedBySeller + fundedByRetailer + promotionalSubsidy == tariff`, and `4010` is always credited the full tariff.

### 5.8 Cancellation fee (buyer-attributable)

Fee ৳40.00, of which a documented ৳10.00 operational component (a dispatched trip already under way):

| Account                                     | DR     | CR     |
| ------------------------------------------- | ------ | ------ |
| `1020` / `2010` Cash or prepayment retained | ৳40.00 |        |
| `2000` Payable to farmer Rahim              |        | ৳30.00 |
| `4030` Cancellation ops-cost recovery       |        | ৳10.00 |

The farmer's share is a **credit to their payable** and settles like any other earning. Langgol's share is capped at documented operational cost and reported separately from commission, so it can never quietly become a revenue line. Under `FORCE_MAJEURE`, `PLATFORM`, `LOGISTICS` or `UNDETERMINED` fault, no fee is charged and no entry is made.

---

## 6. Contribution margin

```text
orderRevenue        = commission + deliveryChargedToBuyer + handlingFee + platformFee
                      + deliveryFundedBySeller + deliveryFundedByRetailer
orderVariableCost   = logisticsActual(allocated from the trip) + paymentProcessing
                      + packaging + agentVariableCost + spoilage + promotionalSubsidy
contributionMargin  = orderRevenue − orderVariableCost
```

The ৳256 COD example at 3% commission: revenue ৳110.50 (৳4.50 + ৳96.00 + ৳10.00), costs ৳180 logistics + ~৳2 packaging = ৳182 → **contribution margin −৳71.50**.

That number is the MVP's central finding, and the system is built so it cannot be hidden. It improves through route density, larger baskets, pickup points, retailer volume and pooled dispatch — every one of which is a product lever we can pull and then measure ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §8).

**Reporting rules**

- A deliberate discount below tariff is posted to `5020` with a mandatory reason and appears as a cost above
- A tariff that under-recovers actual cost is a **derived** shortfall (`5000 − 4010`), reported daily, not double-counted as an expense
- The two together are `platformDeliveryGap`, which is what consumes the pilot loss budget
- Neither is ever netted quietly into another line

### 6.1 Pilot loss budget enforcement

`PilotBudget` sets a cap per category and period; spend is **derived from the ledger**, never self-reported. Controls at 50% (notice), 75% (alert), 90% (per-order approval for subsidising models) and 100% (**subsidising funding models refused in the quoting path**). Cost-recovering, pickup, seller-funded and retailer-funded remain available at all times, so the marketplace keeps operating — it simply stops paying for its own usage. Raising a cap is an explicit, audited decision. Full specification: [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §9.

---

## 7. Idempotency

Financial operations that run twice are the single most expensive class of bug in a marketplace.

**Two layers:**

1. **Request-level** — every state-changing command carries an `Idempotency-Key`. `IdempotencyRecord(scope, key)` is unique; a replay returns the stored response instead of re-executing. Concurrent replays are serialised by `lockedAt` with a short lease.
2. **Ledger-level** — every `LedgerTransaction` carries a deterministic `idempotencyKey` derived from the business event (`ORDER:<id>:GOODS_DELIVERED`). The unique constraint makes a duplicate posting impossible even if the application layer is wrong.

Layer 2 is what actually protects the books. Layer 1 is what makes the API pleasant.

**Additional guarantees**

- `Payment(provider, providerRef)` is unique — a webhook delivered five times posts once
- Webhook handlers verify signatures, are idempotent, and tolerate out-of-order delivery by reading provider state rather than assuming sequence
- Settlement batches are unique per `(batchRef, farmerProfileId)` — a rerun cannot double-pay
- Refunds carry their own idempotency key; a double-click never refunds twice

---

## 8. Settlement (approved: T+0/T+1)

**Target: farmers are paid on the day of successful delivery or the next day.** This is the commitment farmers judge us on, and it is the one place where operational convenience is explicitly subordinated to trust ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §6).

### 8.1 The rail is configurable

`SettlementRail` ∈ `AGENT_CASH` · `MFS` · `BANK` · `REGULATED_PROVIDER`, set per farmer with a platform default. **Agent cash is a bootstrap for the pilot, not the settlement architecture.** It is operationally heavy, creates float risk, and does not scale — it exists because it is what some farmers trust on day one, and it is expected to shrink as MFS payout is onboarded.

Each rail is an adapter behind `PayoutProvider` ([`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §2.1). Adding a regulated provider later is an adapter plus configuration, not a redesign. Practical constraints the adapter must handle: MFS per-transaction and monthly receiving limits, bank account absence, name-mismatch failures, and partial batch failure.

### 8.2 Eligibility

An order becomes settleable when **all** hold:

1. Status is `DELIVERED` or `COMPLETED`
2. The risk-tier hold has elapsed (§8.3)
3. No open dispute
4. For COD: the collecting agent's cash is **reconciled** — we do not pay out against cash we cannot confirm
5. No fraud flag; no payout-account change inside its cooling period
6. Delivered quantities and any adjustment are final

`settlement:build` runs every 15 minutes rather than nightly, precisely so that T+0 is achievable.

### 8.3 Risk tiers and the dispute-window tension

Paying at T+0/T+1 means most farmers are paid **before** the 72-hour dispute window closes. That exposure is accepted deliberately — delaying 100 farmers to guard against 2 disputes is a bad trade — and managed with tiers:

| Tier       | Hold after delivery           | Who                                               |
| ---------- | ----------------------------- | ------------------------------------------------- |
| `TRUSTED`  | T+0                           | Established fulfilment record, no recent disputes |
| `STANDARD` | T+1                           | Normal                                            |
| `NEW`      | Longer, until a record exists | First orders, or after a payout-account change    |

_Exact hold hours are open decision Q2._ Disputes upheld after payout become clawbacks (§5.6), capped and escalated to a human rather than pursued automatically.

### 8.4 Controls

Settlement approval and settlement payment are **separate permissions** ([`07_SECURITY.md`](07_SECURITY.md) §10). Batches are unique per `(batchRef, farmerProfileId)` so a rerun cannot double-pay. Every settlement carries an idempotency key, a payout reference, and a farmer-facing statement showing gross, commission, any delivery deduction, adjustments and net.

---

## 9. Reconciliation and controls

**Automated, daily:**

| Control                 | Assertion                                                                                              | On failure       |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Ledger balance          | Every transaction: `Σ debits = Σ credits`                                                              | Page immediately |
| Accounting identity     | `Σ assets = Σ liabilities + equity + revenue − expenses`                                               | Page             |
| Order↔ledger            | Every `DELIVERED`/`COMPLETED` order has exactly one `GOODS_DELIVERED` transaction with matching totals | Alert            |
| Payable↔settlement      | `Σ payable to farmers` = `Σ unsettled sellerNet`                                                       | Alert            |
| Agent float             | Per-agent `1020` balance = cash physically held; aged > 48 h escalates                                 | Ops task         |
| Provider reconciliation | Provider settlement report vs `1030` receivable, line by line                                          | Ops task         |
| Refund integrity        | No refund exceeds the amount paid on that order                                                        | Block + alert    |
| Orphan money            | No ledger entry without a resolvable business reference                                                | Alert            |

**Manual:** monthly close, with a checklist, before any external financial reporting.

**Segregation of duties:** the admin who approves a refund cannot be the one who requested it (above a configurable threshold); settlement approval and settlement payment are separate permissions. Both enforced in the policy layer and audited.

---

## 10. Tax touchpoints (architecture only — requires professional advice)

The system carries the accounts and fields; the rates and the treatment must be set by a Bangladeshi tax adviser. See [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.5.

- **VAT on Langgol's service fee.** Under the agency model, output VAT arises on commission and service fees, not on the produce. Unprocessed agricultural produce is generally treated favourably; the platform's service is not automatically so. `2030` exists; the rate is configuration.
- **Withholding / source tax on supplier payments.** Where an obligation applies to payments made to sellers, `2040` and per-settlement deduction fields exist. Most smallholder farmers are below relevant thresholds, but the mechanism must exist before the first large supplier.
- **Records.** Invoices/statements for buyers and settlement statements for farmers, retained per statutory retention periods, immutable, exportable.
- **BIN/TIN capture** on retailer and supplier profiles for those who have them.

Building these hooks now costs days. Retrofitting them after an audit costs months.

---

## 11. Custody of funds — the constraint that shapes the payment design

If Langgol collects a buyer's money and holds it before passing it to the farmer, Langgol is holding third-party funds. In Bangladesh this touches payment-services regulation and the digital-commerce rules on advance payment and escrow ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.1–7.2).

**Architectural response — three supported models, chosen by configuration:**

| Model                                      | How money flows                                                                                                                           | Custody exposure                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A · COD-first (recommended for launch)** | Cash collected at delivery by the agent; Langgol remits the farmer's share                                                                | Low — but agent float is still third-party money and is ledgered as such |
| **B · Licensed-PSP escrow**                | Buyer pays a licensed gateway/MFS; funds are released to the farmer on delivery confirmation, with the licensed partner holding the funds | Held by the licensed partner, not by Langgol                             |
| **C · Direct settlement**                  | Buyer pays the farmer's account directly; Langgol invoices commission separately                                                          | Minimal, but reconciliation and non-payment risk rise sharply            |

The ledger supports all three. The choice is a legal and commercial decision, not a technical one, and it must be made **before** prepaid payments are enabled. Until then, launching COD-first (Model A) is both the lowest-regulatory-friction path and the one that matches actual Bangladeshi buyer behaviour.

---

## 12. Designed-in path to Langgol Credit (Phase 12)

Credit is not a new money system. On this foundation it is:

- New `LedgerAccount` types: `1200 Credit receivable (per farmer)`, `2100 Credit facility payable to partner`
- A `CreditAccount` aggregate: limit, available, used, status, risk score
- `CreditTransaction` as **restricted-purpose** entries — drawable only against `SUPPLIER` merchant accounts inside Langgol Supply, never as cash out
- Repayment netted automatically against `2000 Payable to farmers` at settlement — the reason marketplace-first sequencing works: we can repay from sale proceeds we already control
- Underwriting inputs already accumulating: completed orders, fulfilment rate, cancellation rate, realised revenue, seasonality, dispute history

**Hard constraints carried forward from day one:**

- Langgol Credit is **not** a cryptocurrency, **not** a general wallet, **not** cash-out-able
- Langgol does not lend its own money without the applicable licence; the capital comes from a regulated partner and Langgol is a technology and distribution layer, or a licensed entity is acquired/partnered
- No credit product ships without written legal analysis under Bangladeshi law ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.4)

---

## 13. Non-negotiables

1. No floating point for money, ever
2. No money movement outside the ledger
3. No unbalanced transaction — enforced by a database trigger, not by hope
4. No mutable or deletable ledger entries
5. No client-supplied prices or totals
6. No duplicate orders, payments, refunds or settlements — enforced by unique constraints
7. No stored balance treated as authoritative
8. No mock payment provider registrable in production
9. No refund without an authorised actor and a reason
10. No claimed saving without a stored baseline
