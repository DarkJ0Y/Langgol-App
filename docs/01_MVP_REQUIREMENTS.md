# 01 — MVP Requirements

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Depends on:** [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md)

---

## 1. What the MVP is for

The MVP exists to answer one question with evidence:

> Can a real farmer sell real produce to a real nearby buyer through Langgol, with transparent pricing, reliable fulfilment, and **measurable** economic benefit to both sides?

Everything that does not serve that question is out of scope, including things that are obviously good ideas.

---

## 2. Pilot scoping

**Approved: one district, two to three upazilas, five to eight crops, 90 days.**

| Parameter  | Decision                                                                                                         | Rationale                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Geography  | **Rajshahi is the default candidate — not hard-locked.** Confirmed or replaced by the validation process in §2.1 | Density is the only way logistics economics work. See [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) §6 |
| Crops      | 5–8 SKUs, mixed perishability (e.g. tomato, potato, brinjal, pumpkin, green chilli, papaya)                      | Enough variety to test the ranking engine; few enough to write real quality specs                       |
| Buyer side | **Consumers and retailers, both** ([§3](#3-roles-in-the-mvp))                                                    | Retailers give volume; consumers give repeat frequency. Volume is what makes delivery pay               |
| Farmers    | 30–80 verified farmers                                                                                           | Enough for supply competition on at least 3 SKUs                                                        |
| Duration   | 90 days of live transactions after launch                                                                        | Covers repeat-purchase behaviour and at least one harvest turn                                          |

**Why not nationwide:** a nationally-thin marketplace has no route density, no price signal, no comparable listings, and therefore cannot test the thesis. It only tests whether we can build a website.

### 2.1 Geography validation process (P0 deliverable, blocking)

Rajshahi is the **default candidate**, displaced only if validation shows another district is _materially_ better. Rajshahi is a well-established agricultural region of north-west Bangladesh with a city of meaningful size inside the same district — the co-location of production and urban demand that the thesis needs. That is a qualitative reason to start looking there; it is not evidence, and it is not a decision.

**No figures are to be invented.** Every cell below is filled from field observation, partner data, or publicly available data whose legal usability has been confirmed. A cell that cannot be filled is recorded as _unknown_ and lowers the candidate's confidence — it is never estimated to make a table look complete.

| #   | Criterion                    | How it is obtained                                                                                    | Unit                                                |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Farmer density               | Field survey + local agricultural office contact + agent reconnaissance                               | Farmers per upazila growing the target SKUs         |
| 2   | Crop concentration           | Same                                                                                                  | Share of surveyed farmers growing the top 3 SKUs    |
| 3   | Urban consumer demand        | Population and household count of the urban centre; observed retail footfall                          | Households within the serviceable radius            |
| 4   | Retailer demand              | Direct survey of grocers, restaurants, institutions                                                   | Count willing to trial + their weekly volume by SKU |
| 5   | Farm-gate price              | `PriceObservation`, `IN_PERSON_SURVEY`                                                                | ৳/kg by SKU                                         |
| 6   | Local retail price           | `PriceObservation`, `IN_PERSON_SURVEY`                                                                | ৳/kg by SKU                                         |
| 7   | Expected price spread        | (6) − (5), seasonally matched                                                                         | ৳/kg and %                                          |
| 8   | Average delivery distance    | Measured farm cluster → demand cluster                                                                | km                                                  |
| 9   | Expected delivery cost       | Local vehicle hire quotes × (8), by vehicle class                                                     | ৳/trip, ৳/kg                                        |
| 10  | Expected order density       | (3) + (4) × observed purchase frequency                                                               | Orders/day within the radius                        |
| 11  | Expected contribution margin | Modelled from 5–10 using the [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §5.3 formulas | ৳/order, by basket band                             |

**Output:** a `GeographyCandidateAssessment` record per candidate district, each criterion carrying its source, date, sample size and confidence, plus a written recommendation. Criterion 7 is the headline — a district where the farm-gate-to-retail spread does not exceed the delivery cost of (9) cannot pass, however attractive it looks otherwise.

**Decision rule:** Rajshahi proceeds unless another assessed district shows a materially better combination of (7), (10) and (11) at comparable or better confidence. "Materially better" and the comparison are written down and signed off before the pilot begins.

---

## 3. Roles in the MVP

| Role                                      | In MVP     | Notes                                                                                                                                                                        |
| ----------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FARMER`                                  | ✅         | Lists produce, fulfils orders, receives settlement                                                                                                                           |
| `CONSUMER`                                | ✅         | Discovers, orders, receives                                                                                                                                                  |
| `RETAILER`                                | ✅ Limited | Profile, bulk quantities, discovery, ordering, delivery, transaction history. **No RFQ, negotiation, contracts, invoicing terms or supplier scorecards** — those are Phase 9 |
| `ADMIN`                                   | ✅         | Verification, moderation, dispute, settlement, analytics                                                                                                                     |
| `OPS_AGENT`                               | ✅         | Internal field/ops staff: assisted onboarding, assisted listing, delivery coordination                                                                                       |
| `LOGISTICS_PROVIDER`                      | ❌         | Phase 5. MVP delivery is manual/ops-coordinated                                                                                                                              |
| `SUPPLIER`, `BUSINESS_BUYER`, `WAREHOUSE` | ❌         | Phase 7–8                                                                                                                                                                    |

`OPS_AGENT` is not decoration. In a rural pilot, a meaningful share of farmers will be onboarded and will list produce **with a field agent's help, on the agent's phone**. If the data model cannot represent "listing created by agent X on behalf of farmer Y", we will silently corrupt our own attribution data. This is designed in from day one.

---

## 4. Scope

### 4.1 In scope

**Authentication & identity**

- Phone-number signup/login via OTP (primary), email optional
- Role selection at signup; a user may hold multiple roles over time
- Profile with name, phone, preferred language (bn/en), address(es)
- Farmer verification workflow (documents + admin review)

**Farmer**

- Farmer profile (verification status, reputation, payout method)
- Farm: name, location (lat/lng + admin hierarchy), size
- Produce listing: product, variety, grade, quantity, unit, price/unit, availability window, harvest date or expected harvest date, photos, packaging/min-order
- Inventory: available vs reserved vs sold, with reservation expiry
- Order inbox: accept / reject with reason / mark ready / mark handed over
- Earnings: gross, deductions, net, settlement status
- Bangla-first UI

**Consumer**

- Profile + delivery address(es) with map pin and admin-hierarchy fallback
- Discovery: nearby listings ranked by **delivered cost and suitability**, not distance alone
- Search + filters: product, price, distance, availability date, grade, farmer rating
- Product/listing detail with farm origin, harvest date, farmer rating, full delivered-price breakdown
- Cart (multi-item; **single-seller per order** in MVP — see §5)
- Checkout: address, fulfilment mode, quote review, place order
- Order tracking + history
- Post-delivery rating of product and seller

**Retailer (intentionally limited)**

- Retailer profile: business name, type, trade licence / BIN where held, verification
- Bulk quantity ordering with retailer-appropriate minimums and radius cap
- Marketplace discovery ranked against **wholesale** reference prices, not retail
- Order placement, delivery, transaction history
- _Not in MVP:_ RFQ, quotations, negotiation, recurring supply contracts, credit terms, multi-farmer aggregation into one order, supplier performance scorecards, invoicing workflows

**Marketplace engine**

- Delivered-cost computation with itemised breakdown
- Supplier ranking with explainable factors
- Server-authoritative quote with TTL, re-validated at order creation
- Inventory reservation with expiry to prevent overselling

**Orders**

- Explicit state machine (see [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md))
- Farmer acceptance window with automatic expiry
- Cancellation with policy-driven fees
- Append-only order event log
- Dispute raise + admin resolution

**Delivery**

- Three fulfilment modes: `BUYER_PICKUP`, `SELLER_DELIVERY`, `LANGGOL_DELIVERY` (ops-coordinated, manually dispatched)
- Four measurable delivery models: `INDIVIDUAL`, `AGGREGATED_ROUTE`, `RETAILER_BULK`, `PICKUP`
- Six delivery funding models: cost-recovering (default), promotional subsidy, free delivery, retailer-funded, seller-funded, shared
- Trip records with **actual cost** capture and cost allocation to orders
- Distance computation and delivery pricing
- Delivery status updates + proof of delivery (photo + OTP confirmation)

**Payments**

- Provider abstraction; **cash on delivery is the only live collection method at launch**
- Mock provider for development and tests
- Prepaid support built to the interface but **not enabled** until the custody/escrow review in [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.1–7.2 is complete
- Double-entry ledger, settlement runs (T+0/T+1 target, configurable rail), refunds

**Admin**

- Users, farmer/seller verification queue, listing moderation
- Orders, disputes, refunds, manual settlement approval
- Analytics: GMV, orders, fulfilment/cancellation rate, average delivery distance and cost, farmer realisation vs baseline, consumer delivered price vs baseline
- Audit log viewer
- Platform configuration (fee rates, delivery tariff, radius caps) — **configuration, not code**

**Economic measurement (core capability, not analytics)**

- `PriceObservation` capture with source, method, confidence and verification status
- Baseline resolution and immutable `BaselineSnapshot` per order
- Immutable `OrderEconomics` record per completed order: farmer, consumer, platform and logistics blocks
- Trip economics with actual cost, utilisation, cost per kg and per order
- Basket-band and delivery-model experiment strata
- Pilot loss budget with enforced thresholds and a controlled subsidy-reason vocabulary
- Gate scorecard reporting

Full specification: [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md).

### 4.2 Explicitly out of scope for MVP

Credit · machinery/labour/storage marketplaces · agricultural input sales · crop cycle management · weather and disease alerts · AI assistant, forecasting, disease detection · logistics provider self-service · multi-seller split orders · subscriptions/recurring supply · contract farming and RFQ negotiation · export · native mobile apps · warehouse management · insurance · government integrations · real-time chat.

Each of these has a home in [`09_ROADMAP.md`](09_ROADMAP.md). None of them belong in the thing that tests the thesis.

---

## 5. Deliberate MVP simplifications (and their exit criteria)

| Simplification                                                                                | Why                                                                                                                                       | Exit criterion                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **One seller per order.** A cart with two farmers becomes two orders.                         | Multi-seller consolidation is a routing and settlement problem, not a marketplace problem. Solving it now would consume the whole build.  | When ≥20% of carts contain multiple sellers _and_ route density supports consolidation |
| **Ops-coordinated delivery**, no driver app                                                   | We must learn the true cost of delivery before automating it. Automating an unknown cost structure is how marketplaces die.               | Phase 5, once ≥200 deliveries of cost data exist                                       |
| **COD only at launch**                                                                        | It is the dominant Bangladeshi consumer payment behaviour, and prepaid triggers custody/escrow obligations we will not take on unreviewed | Prepaid enabled after legal clearance; COD itself never retired                        |
| **No in-app negotiation, no RFQ**                                                             | Ask/bid negotiation is a Phase 9 B2B feature; consumer and retailer flows must stay one-tap                                               | Phase 9                                                                                |
| **Radius cap on discovery** (configurable, default ~40 km for consumer, ~100 km for retailer) | Prevents nonsense long-haul matches from appearing before we can price them properly                                                      | When long-haul unit economics are measured                                             |
| **Single currency, BDT**                                                                      | No FX in scope                                                                                                                            | Export phase                                                                           |

---

## 6. User stories with acceptance criteria

Format: _As a … I want … so that …_ Acceptance criteria are testable statements; each becomes an automated test (see [`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §10).

### F — Farmer

**F1 · Register and verify**

> As a farmer I want to register with my phone number and get verified so buyers trust me.

- Given a valid Bangladeshi mobile number, when I request an OTP, then an OTP is sent via the SMS provider abstraction and is valid for 5 minutes
- OTP requests are rate-limited per phone and per IP (§ [`07_SECURITY.md`](07_SECURITY.md) §6)
- After OTP verification a `User` exists with role `FARMER` and `verificationStatus = UNVERIFIED`
- An unverified farmer may create a farm and draft listings but **cannot publish** a listing
- Uploading required documents moves status to `PENDING`; admin approval moves it to `VERIFIED`; rejection records a reason visible to the farmer
- All state changes are written to `AuditLog`

**F2 · Create a farm**

> As a farmer I want to register my farm and its location so buyers near me can find me.

- Location may be set by map pin **or** by Division→District→Upazila→Union selection with village text; if only the hierarchy is given, the union centroid is used and the record is flagged `locationPrecision = APPROXIMATE`
- A farm requires at minimum: name, district, upazila, coordinates
- The farm belongs to exactly one farmer; ownership is enforced server-side on every mutation

**F3 · List produce**

> As a farmer I want to list produce with quantity and price so I can sell it.

- Required: product, quantity, unit, price per unit, availability window
- Optional: variety, grade, harvest date / expected harvest date, photos (≤5), min order quantity, packaging
- Price is entered in BDT and stored as integer poisha (§ [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §2)
- Quantity is stored in integer base units (grams / millilitres / pieces)
- A listing cannot be published if: farmer unverified · quantity ≤ 0 · price ≤ 0 · availability window ends in the past
- Price entered outside a configurable sanity band around the current reference price triggers a soft warning to the farmer and a moderation flag for admin — it does **not** silently block
- The listing's effective location defaults to the farm's, and may be overridden (e.g. produce already at a collection point)
- Listings can be created by an `OPS_AGENT` on behalf of a farmer; `createdByUserId` and `onBehalfOf` are both recorded

**F4 · Receive and fulfil an order**

- New order appears with status `PENDING`, an acceptance deadline, and an SMS notification
- Farmer may `ACCEPT` or `REJECT` (reason required) before the deadline
- No action by the deadline → automatic `CANCELLED` with reason `SELLER_TIMEOUT`, reserved inventory released, buyer refunded if prepaid, farmer reliability score affected
- On acceptance, reserved quantity is committed and the buyer is notified
- Farmer marks `READY_FOR_PICKUP`, then hand-over is confirmed by pickup OTP or proof photo

**F5 · See earnings**

- Farmer sees per-order: gross, commission, delivery deduction (if applicable), net payable, settlement status
- Farmer sees lifetime: total sold, total settled, pending settlement
- Every figure traces to ledger entries; the UI must not recompute money independently

### C — Consumer / retailer

**C1 · Discover nearby produce**

> As a buyer I want to see what is available near me at the true delivered price.

- Setting a delivery location returns listings within the configured radius, ranked by the model in [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §5
- Each result shows: delivered price per unit, distance, availability/harvest date, farmer rating, farm name
- Results are never ranked by distance alone; the ranking rationale is exposed in the UI ("cheaper delivered", "closer", "harvested today")
- Empty state, loading state, error state and "no delivery to your area yet" state all exist and are distinct

**C2 · Understand the price**

- The listing page shows the full breakdown: product cost + delivery + handling + platform fee = delivered total
- Where a farther farmer is cheaper at farm gate but dearer delivered, the UI may show the comparison
- No claim of "you saved ৳X" is displayed unless a stored baseline supports it (§7)

**C3 · Order**

- Add to cart → quantity respects `minOrderQuantity` and available inventory
- Checkout requires: delivery address, fulfilment mode, payment method
- A server-generated `OrderQuote` is created, persisted, and shown; it has a TTL (default 15 min)
- Order creation re-validates the quote server-side; a stale or tampered quote is rejected with a clear message and a fresh quote
- **No price, seller id, fee, or total submitted by the client is ever trusted** (§ [`07_SECURITY.md`](07_SECURITY.md) §5)
- Placing an order creates an inventory reservation atomically; concurrent orders cannot oversell
- Duplicate submission with the same idempotency key returns the same order, never a second one

**C4 · Track and receive**

- Buyer sees the current state, timestamps, and expected delivery window
- Delivery confirmation requires proof: delivery OTP entered by buyer, or photo proof plus ops confirmation
- COD collection is recorded at delivery and posted to the ledger

**C5 · Rate**

- After `DELIVERED`, buyer may rate product quality and seller (1–5) with optional text, once per order item
- Ratings affect the seller reliability score used in ranking

### A — Admin

- **A1** Verification queue: review documents, approve/reject with reason, full audit trail
- **A2** Listing moderation: flagged listings queue, unpublish with reason
- **A3** Order operations: view any order, force-cancel with reason, issue refund (with approval + ledger entry)
- **A4** Dispute resolution: view evidence, decide, trigger refund/partial refund/rejection
- **A5** Settlement: review settlement batch, approve, mark paid, attach payment reference
- **A6** Analytics dashboard (§7)
- **A7** Configuration: fee rates, delivery tariff parameters, radius caps, acceptance-window duration, quote TTL — versioned and audited, never hard-coded
- **A8** Audit log search by actor, entity, action, date

---

## 7. Success metrics and how they are measured

A metric without a measurement mechanism is a wish. Measurement is a **core product capability**, not a reporting layer — it is specified in full in [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) and summarised here.

### 7.1 The measurement backbone

Every completed order produces an **immutable `OrderEconomics` record** carrying four blocks — farmer, consumer, platform, logistics — each computed by pure, versioned formulas and stamped with `methodologyVersion`. Baselines are resolved at completion and frozen into a `BaselineSnapshot`, so any historical figure is reproducible.

To claim "the farmer earned more" we need a counterfactual. Baselines come from `PriceObservation`, each carrying source, collection method, location, timestamp, unit, quality context, confidence and verification status. Confidence ranks: in-person survey and receipt evidence highest; farmer self-report lowest and never sufficient alone. Langgol's own prices are **never** a baseline for Langgol's own performance.

Where no baseline survives the matching rules, **no uplift or saving is computed for that order** — it counts toward a visible baseline-coverage metric instead of being quietly estimated.

### 7.2 What is measured

| Block                   | Headline measures                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Farmer**              | Langgol selling price · commission · delivery deductions · **net realisation** · baseline farm-gate price · uplift ৳/kg and % · time to sell · sell-through · fulfilment rate · repeat seller rate     |
| **Consumer / retailer** | Product cost · delivery charged · **total delivered cost** · reference market price (retail for consumers, **wholesale for retailers**) · saving ৳/kg and % · freshness · distance · repeat rate       |
| **Langgol**             | Gross revenue · commission · delivery revenue · **delivery subsidy** · payment costs · ops variable costs · spoilage · **contribution margin** ৳/order and ৳/kg                                        |
| **Logistics**           | Pickup, delivery and route distance · trip cost · quantity carried · **cost per kg** · **cost per order** · orders per trip · utilisation                                                              |
| **Ecosystem**           | Average supply and delivery distance · quantity aggregated · _estimated_ transportation avoided · _estimated_ spoilage avoided — both explicitly modelled, confidence-labelled, never headline figures |

### 7.3 Experiments

The MVP measures, rather than assumes, where the economics work:

- **Basket bands** — 0–5, 5–10, 10–25, 25–50, 50–100, 100–250, 250–500, 500+ kg. No threshold is hard-coded anywhere; the viable band is discovered from data.
- **Delivery models** — `INDIVIDUAL`, `AGGREGATED_ROUTE`, `RETAILER_BULK`, `PICKUP`, each costed separately.
- Crossed with distance band, district, product and buyer segment.

Most comparisons are observational strata rather than randomised trials, and every report says which it is.

### 7.4 Loss budget

Negative contribution margin is permitted only as a deliberate, budgeted expense. Every negative-margin order must record actual cost, actual revenue, subsidy, a **subsidy reason from a controlled vocabulary**, basket band, delivery model, trip, and buyer/farmer segment. Budget thresholds at 50/75/90% escalate; at 100% subsidised funding models are disabled in the pricing path.

### 7.5 Go / no-go gate

The full gate set — farmer, consumer, retailer, logistics, platform and the thesis gate itself — is in [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §10. Gates are evaluated per segment as well as in aggregate; an aggregate pass concealing a failing segment is a fail.

The thesis gate: _can Langgol simultaneously improve farmer realisation and deliver a competitive price for a meaningful subset (≥25%) of transactions?_ A "yes" must be accompanied by a written characterisation of which transactions work. A "no" must be accompanied by a written diagnosis of what has to change. Neither answer permits proceeding on hope.

## 8. Non-functional requirements

| Area              | Requirement                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance       | Marketplace listing page interactive < 3 s on simulated 3G, mid-tier Android; initial JS payload target ≤ 150 KB gzip on buyer-facing pages |
| Availability      | 99.5% MVP target; degraded read-only mode preferred over hard failure                                                                       |
| Data              | Nothing financial is ever hard-deleted; soft delete + audit                                                                                 |
| Accessibility     | WCAG 2.2 AA on buyer and farmer flows; ≥44 px touch targets; contrast ≥ 4.5:1                                                               |
| Localisation      | Full bn/en parity on all farmer and buyer surfaces at launch. Admin may be en-only                                                          |
| Offline tolerance | Forms preserve input across connection loss; no destructive action lost to a dropped request (idempotency)                                  |
| Observability     | Every order state transition, payment and settlement emits a structured event                                                               |
| Every feature     | Has loading, error, empty and success states, validation, authorization, and a responsive layout — no exceptions                            |

---

## 9. Product decisions

### 9.1 Resolved (approved 2026-08-10)

| #   | Decision                                                                                                                                                                                                              | Where it lands                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D1  | **Pilot geography:** Rajshahi is the default candidate, not hard-locked. A validation process against 11 criteria confirms or displaces it                                                                            | §2.1; [`09_ROADMAP.md`](09_ROADMAP.md) P0                                                                      |
| D2  | **Commission: 3%, seller-side**, configurable in `PlatformConfig`, never hard-coded. No buyer-side marketplace fee at MVP                                                                                             | [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §4                                              |
| D3  | **Delivery pricing: cost-recovering by default**, with six funding models supported and every subsidy recorded separately from actual cost                                                                            | [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §3; [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §6 |
| D4  | **Payments: COD-first.** Prepaid built to the provider interface but not enabled until custody/escrow review completes                                                                                                | [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.1–7.2                                                |
| D5  | **Settlement: T+0/T+1 after successful delivery**, subject to reconciliation and fraud controls; rail is configurable (MFS / bank / regulated provider / agent cash). Agent cash is a bootstrap, not the architecture | [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §8                                              |
| D6  | **Buyer segments: consumers _and_ retailers**, retailer functionality intentionally limited                                                                                                                           | §3, §4.1                                                                                                       |
| D7  | **Cancellation compensation: buyer-attributable fees default to farmer compensation**, not Langgol revenue. Fault attribution is explicit in the domain model                                                         | [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §5                                                                  |
| D8  | **No IVR/USSD in MVP.** Mobile web + Bangla + SMS + field agents; notification and farmer-interaction layers designed so IVR/USSD can be added without redesign                                                       | [`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §8.1                                                                |
| D9  | **Economic measurement is a core system**, not analytics                                                                                                                                                              | [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md)                                                     |
| D10 | **No credit in MVP.** Phase 12, behind hard entry gates                                                                                                                                                               | [`09_ROADMAP.md`](09_ROADMAP.md) §14                                                                           |

### 9.2 Still open

| #   | Question                                                                                                                                                      | Needed by                         | Consequence of delay                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Q1  | **Pilot loss budget: the number.** What total subsidy is authorised for the 90-day pilot, split by category?                                                  | End of P0                         | The 50/75/90/100% controls in [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §9 have no threshold to enforce |
| Q2  | **Settlement risk tiers.** How long is the hold for a brand-new farmer versus an established one, given T+0/T+1 is the target and the dispute window is 72 h? | Before P4 completes               | Determines clawback exposure; see [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §8.3                    |
| Q3  | **Cancellation fee schedule** and the size of the documented operational-cost component Langgol may retain                                                    | Before P4 completes               | Blocks the cancellation journal in [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §5.8                   |
| Q4  | **Settlement rail for launch** — MFS disbursement, bank, or agent cash as the bootstrap? Depends on partner onboarding lead times                             | P0 (start now, long lead time)    | Payout is the one flow farmers judge us on                                                                               |
| Q5  | **Field-agent employment model** (staff vs contractor) and its cost, which feeds `opsVariableCost`                                                            | Before pilot                      | Contribution margin is understated without it                                                                            |
| Q6  | **Retailer minimum order quantity** per SKU                                                                                                                   | Before P3 completes               | Affects whether retailer economics can be tested at all                                                                  |
| Q7  | **Public market-price data: legal usability.** Which sources may we ingest, under what basis?                                                                 | Before baseline collection scales | Baseline breadth depends on it; field survey alone is slower but sufficient                                              |
