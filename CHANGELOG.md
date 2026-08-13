# Changelog

All notable changes to Langgol are recorded here. Dates are ISO-8601.

## [Unreleased] — `feature/mvp-marketplace-engine`

Phase 2 marketplace core: a buyer can request a server-computed quote for produce
at an address and turn that quote into an order with inventory reserved.

### Added

**Delivered-cost engine** (`packages/domain`)

- `geo/distance` — haversine × a configurable road-circuity factor, recorded per quote so
  the factor can be calibrated against measured trips rather than trusted
  (`docs/04_MARKETPLACE.md` §3, `docs/P2_DELIVERED_COST.md` §6).
- `pricing/tariff` — slab tariff by chargeable weight and distance, volumetric weight, and
  `OPS_QUOTE_ONLY` above the top published band.
- `pricing/funding` — the six delivery funding models, enforcing
  `chargedToBuyer + fundedBySeller + fundedByRetailer + promotionalSubsidy == tariff`.
- `pricing/internal-cost` — modelled trip cost, allocation share, spoilage, payment cost and
  contribution margin (`docs/06_FINANCIAL_ARCHITECTURE.md` §6).
- `pricing/breakdown` — the buyer side and the seller side computed separately and stored
  independently, so the platform can never tell itself a farmer gained because a buyer paid more.
- `marketplace/rank` — six-factor ranking with a machine-readable rationale per candidate.

**Quote and checkout** (`packages/application`, `packages/infrastructure`)

- `createQuote` and `checkout` use cases, with ports in `ports/marketplace.ts`.
- Prisma adapters, including a single atomic `orderPlacement` that reserves inventory, creates the
  order and consumes the quote in one transaction.

**Schema** (`packages/db`)

- Profiles, curated catalogue, listings with reservable inventory, `OrderQuote`, `Order`,
  `OrderItem`, `OrderEvent`, `ListingReservation`, plus 39 CHECK constraints, the append-only rule
  on `order_events`, and PostGIS geography columns with GIST indexes.

**Web** (`apps/web`) — `/market`, `/market/[listingId]`, `/orders/[orderId]`, Bangla first.

### Invariants now enforced, not merely documented

- Money is integer poisha end to end. Ranking scores are integer parts-per-million so a ranking is
  exactly reproducible from its stored `pricingVersion`.
- Every rate, tariff, weight and threshold is read from `PlatformConfig`. Tests assert the engine
  **refuses to price** when a rate is an open product decision rather than substituting a default.
- A subsidising funding model without a controlled-vocabulary reason is rejected by the domain
  **and** by a database CHECK; subsidy is refused outright once the pilot loss budget is exhausted,
  while every non-subsidising model keeps working.
- Contribution margin is never a ranking factor — only a feasibility filter and a 1% tiebreak.
- Quotes are single-use, owner-scoped, time-limited, and order money is copied from them.
- Two buyers racing for the last of a crop produce exactly one order (proved against real
  PostgreSQL, not only against a fake).

### Assumptions a stakeholder must confirm

These were chosen so the code paths run end to end. They are labelled `PROVISIONAL` in the seed and
must be replaced with measured or decided values.

| Area                      | Assumption                                                                                                                                                             | Who decides               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Handling fee              | ৳8 per order + ৳0.40/kg for highly perishable, chosen to reproduce the ৳10.00 in `docs/04` §7.1                                                                        | Product + ops             |
| Internal vehicle costs    | Six vehicle classes with base, per-km, loading and stop components                                                                                                     | Ops, from real hire rates |
| Round-trip factor         | 13000 bps (1.30) applied to the distance component only                                                                                                                | Ops, from measured trips  |
| Spoilage                  | Flat per-hour rate by perishability class, capped at 3000 bps                                                                                                          | Agronomy                  |
| Payment cost              | COD 1% handling; MFS 1.5% + ৳5                                                                                                                                         | Finance                   |
| Margin floor              | −৳200, the feasibility filter for ranking                                                                                                                              | Product + finance         |
| Cold-start boost          | 500 bps decaying over 5 orders                                                                                                                                         | Product                   |
| Shelf life                | Per catalogue product, provisional                                                                                                                                     | Agronomy                  |
| Partial-km charging       | Charged pro-rata on exact metres rather than rounded up to a whole km, so no rounding policy is invented outside config                                                | Product                   |
| `SHARED` funding rounding | The seller pays exactly their agreed basis points; the buyer covers the residual poisha, so a rounding remainder is never assigned to a farmer (`docs/04` §3.1 rule 3) | Product                   |

### Documentation errata found while implementing

- **`docs/04_MARKETPLACE.md` §7.2** prints ৳2,870.00 for the distant farmer at 100 kg. That is the
  §7.3 figure for 500 kg repeated. At 100 kg the load sits in the 20–100 kg band, so the correct
  figure is `150 + 115×14 = ৳1,760.00`. The engine is self-consistent with §7.1, §7.2 Farmer A and
  §7.3; asserted in `packages/domain/src/pricing/tariff.test.ts`.
- §7.2 also prints a delivered ৳32.98/kg using an illustrative ৳50 handling fee. With the seeded
  provisional handling schedule the figure is ৳32.96. The finding — that delivered economics
  approach farm-gate price as the basket grows — is unchanged.

### Traps for the next engineer

- **`prisma migrate dev` will try to drop the spatial indexes.** Prisma cannot represent a GIST
  index on an `Unsupported("geography(...)")` column, so it reads the hand-authored indexes as
  drift and emits `DROP INDEX` for them. The `20260812204242_p2_marketplace_core` migration had
  exactly this and the statements were removed by hand. **Check every generated migration for
  `DROP INDEX ..._geo_gix` and delete it.** Dropping them turns every radius search into a full
  table scan, silently.
- The `Catalogue` type is derived two levels deep from the Bangla catalogue, so message keys must
  be `section.key`. A third level collapses to `string` and the compile-time key check stops
  protecting you.

### Added — payments, delivery trips, reconciliation and the ledger

Delivered after the quote → checkout → order loop was proved, in the order the backlog sets.

**Payment adapters** (`packages/application/src/ports/payments.ts`, `packages/infrastructure/src/payments`)

- A `PaymentAdapter` port, a COD adapter, and a **mock MFS** adapter shaped like bKash/Nagad.
- `createPaymentRegistry` is the single place every gate is enforced, because a gate that must be
  remembered is a gate that will eventually be forgotten:
  - the configured `payments.methods.enabled` list;
  - `payments.prepaidEnabled`, the **hard gate** from decision D4 — a prepaid adapter is refused
    while it is false even if the method is in the enabled list;
  - mock adapters, refused in production and staging (docs/06 §13.8).

**Delivery trips and reconciliation** (`packages/domain/src/pricing/reconciliation.ts`,
`packages/infrastructure/src/jobs/reconcile-delivery-trips.ts`)

- `Delivery`, `DeliveryTrip`, `TripStop` and `TripCostItem`. Cost is recorded on the **trip**,
  because delivery cost is incurred per trip and modelling it per order makes "did aggregating
  four orders reduce cost per order?" unanswerable.
- `reconcileTripCost` allocates a trip's real cost across its orders by chargeable weight using
  `Money.allocate`, so the shares sum to the trip cost **exactly** for any weights, and records
  `actual − expected` as the calibration gap.
- `reconcileTrip` / `reconcilePendingTrips` write the allocated cost onto each `Delivery` and post
  the trip cost to the ledger once, keyed on the trip.

**Ledger and settlement** (`packages/domain/src/ledger`, `packages/infrastructure/src/repositories/ledger.ts`)

- The full chart of accounts from docs/06 §3, and pure journal builders for every event in §5:
  order placed, goods delivered, trip cost, agent remittance, settlement, payment cost.
- `postJournal` writes a transaction and its entries atomically, creates owner accounts lazily,
  and is idempotent by construction on the journal's deterministic key.
- Balances are **always derived** — `accountBalance` is a query every time. No balance is stored.

Database guarantees added with them: `ledger_amount_positive`; a **deferred constraint trigger**
that refuses any unbalanced transaction at COMMIT; `DO INSTEAD NOTHING` rules making ledger
entries immutable; an owner-consistency CHECK so a farmer payable cannot have a NULL owner and
silently pool every farmer's money; `trips_completed_costed` so a completed trip cannot be
measured before it is costed; and an allocation-share CHECK preventing a zero denominator.

Verified end to end by `pnpm e2e:marketplace`, which now runs listing → quote → checkout → order
→ trip → reconciliation → ledger and asserts fourteen invariants, including that posting the same
journal twice does not double the books.

### Still not in this change

Farmer settlement batching and payout rails, refunds and clawbacks, the dispute flow, cancellation
fees, and the buyer-side order-status UI beyond confirmation. `settlement.holdHours`,
`cancellation.feeSchedule` and `pilot.lossBudget` remain open product decisions, and the code
paths that need them refuse rather than assume.
