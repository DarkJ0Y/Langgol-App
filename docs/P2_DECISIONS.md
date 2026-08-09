# P2 — Decisions, ADR Candidates and Open Questions

> **Status:** Awaiting approval. Nothing here is implemented.

---

## 1. Decisions this specification proposes

| #         | Decision                                                                                                                              | Rationale                                                                                                                                                                            | Changes P1?                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **D2-1**  | **Retailers are the anchor segment.** Households are served through pooled routes and pickup points built on retailer-created density | A retailer order moves the same produce at ~1/9 the delivery cost per kg. Household dedicated delivery is uneconomic at any honest price ([`P2_ECONOMICS.md`](P2_ECONOMICS.md) §5–6) | **Yes — emphasis change.** P1 treated the two as co-equal          |
| **D2-2**  | **Pooled delivery and pickup points are in P2 scope**, not deferred to Phase 7                                                        | They are the mechanism that makes households viable, not an optimisation of one that already works                                                                                   | **Yes** — P1 roadmap put pooling in Phase 7                        |
| **D2-3**  | **No `Plot` entity.** `Farmer → Farm → Listing`, with crop and harvest as attributes of the listing                                   | Nothing in supply, discovery, pricing or measurement needs plot-level resolution. A plot table is agronomic modelling that earns nothing in P2                                       | No                                                                 |
| **D2-4**  | **No `CropCycle` entity in P2.** An `expectedHarvestAt` on the listing carries the forward-supply case                                | Crop cycles serve Langgol Farm (Phase 11), not the marketplace                                                                                                                       | No                                                                 |
| **D2-5**  | **Inventory lives on the listing**, not in a separate ledger, with reservations as the concurrency mechanism                          | Reuses the approved `ListingReservation` design and the atomic conditional `UPDATE`                                                                                                  | No — reuses P1                                                     |
| **D2-6**  | **Single-seller orders only.** A multi-farmer basket becomes multiple orders                                                          | Consolidation is a routing and settlement problem; solving it now would consume P2                                                                                                   | No — P1 §5 already says this                                       |
| **D2-7**  | **Delivery is cost-recovering by default**, with the six funding models and explicit subsidy                                          | The P1 tariff under-prices badly at scale ([`P2_ECONOMICS.md`](P2_ECONOMICS.md) §3); recovery is the honest default                                                                  | No — P1 decision D3                                                |
| **D2-8**  | **COD only.** Prepaid stays config-gated                                                                                              | Unchanged; the custody review has not happened                                                                                                                                       | No                                                                 |
| **D2-9**  | **Commission stays at 300 bps.** It is not the margin lever                                                                           | Commission is ~1% of household delivery cost per kg. Raising it takes from the farmer to subsidise a trip that should not have been made                                             | No                                                                 |
| **D2-10** | **Farmer uplift is measured per farmer per season**, not only per transaction                                                         | A farmer selling 60% via Langgol and 40% to a _bepari_ at a worse price may be no better off. Per-transaction uplift would be true and misleading                                    | Extends [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) |
| **D2-11** | **Launch dense, not wide** — a few clustered wards, targeting ≥6 drops per household route                                            | Density is the gating variable; a district-wide thin launch cannot reach it                                                                                                          | Narrows P1 §2                                                      |
| **D2-12** | **Failed-delivery cost is a first-order metric**, not a quality statistic                                                             | At 5% failure on ৳400 trips it erases the household pooled margin twice over                                                                                                         | Extends measurement                                                |

---

## 2. ADR candidates — genuinely new architectural decisions

Each needs approval before implementation.

### ADR-23 (candidate) — Reservations hold inventory at order placement, not at cart

**Context.** P2 introduces real contention: several buyers, one crate of tomatoes.
**Decision.** Keep the P1 design — no reservation on add-to-cart; a `HELD` reservation is created
atomically at order placement and expires with the farmer's acceptance window.
**Why not reserve earlier.** An idle browser would lock a farmer's crop for hours. The farmer's
inventory is a real asset; a shopping cart is not a commitment.
**Consequence.** A buyer can lose the last crate at checkout. That must be a clear, kind message
with alternatives, not an error.

### ADR-24 (candidate) — Trip is the unit of delivery cost; routes are first-class in P2

**Context.** Pooling is now the economic mechanism, not a Phase-7 optimisation.
**Decision.** `DeliveryTrip` (already designed in P1 §8.1) becomes an actively-used P2 entity with
ops-facing route assembly. Cost is recorded once per trip and allocated by a recorded method.
**Consequence.** Ops must cost every trip. `economics:compute` blocks without it — deliberately.

### ADR-25 (candidate) — Pickup points are a location type, not a new entity family

**Context.** Pickup points are needed for household viability.
**Decision.** Model as `AdminArea`-anchored `PickupPoint` rows with a geography column, reusing the
existing PostGIS pattern. Not a warehouse, not inventory-bearing, no custody of goods.
**Why.** A pickup point that holds stock is a warehouse, which is Phase 12 and carries food-safety
and custody obligations we have not cleared.

### ADR-26 (candidate) — Grade is a seller-declared descriptor, never a Langgol certification

**Context.** Quality drives disputes and price.
**Decision.** `QualityGrade` (A/B/C/UNGRADED) is declared by the farmer, shown as declared, and
never presented as verified. No organic or pesticide-free claim without a verifiable basis.
**Why.** A badge we cannot substantiate is both a legal and a trust liability
([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.8).

### ADR-27 (candidate) — Farmer location is disclosed at area resolution until an order is confirmed

**Context.** Discovery needs distance; farmers need privacy.
**Decision.** Discovery returns _distance_ and _union/upazila_, never coordinates. Exact pickup
location and the counterparty's phone are revealed only on `CONFIRMED`.
**Why.** Precise farm coordinates plus a phone number is a poaching and harassment kit, and it is
also our commercial interest to withhold it — but the user-protection reason governs.

---

## 3. P1 decisions this specification does **not** change

Money as integer poisha · quantity in integer base units with milligram mass · `OrderQuote` as sole
pricing authority · append-only `OrderEvent` · double-entry ledger · idempotent financial
operations · server-side authorization with the exhaustive `RULES` record · owner-scoped
repository queries · PostGIS geography · COD-first · `AUTH_MODE` with development fixtures · no
credit · commission incidence on the seller.

---

## 4. Open decisions

Format per §42-J.

### Q2-1 · Pilot geography, narrowed

- **Options:** (a) whole pilot district thinly; (b) 2–3 clustered wards plus their farm hinterland.
- **Recommendation:** (b).
- **Reason:** ≥6 drops per household route is a clustering problem. A thin district launch cannot
  reach it, and would test logistics we have chosen not to build.
- **Data needed:** ward-level household density and retailer counts from the P0 assessment.
- **Deadline:** before P2 implementation begins.

### Q2-2 · Household delivery: pooled routes, pickup points, or both

- **Options:** (a) route days only; (b) pickup points only; (c) both.
- **Recommendation:** (c), with pickup points first — they need no vehicle and have the best margin.
- **Reason:** Pickup is the only household model positive at 5 kg without pooling.
- **Data needed:** willingness of shops to act as pickup points; buyer tolerance for collection.
- **Deadline:** before household onboarding.

### Q2-3 · Minimum order value for delivered household orders

- **Options:** (a) none; (b) a floor below which only pickup is offered.
- **Recommendation:** (b).
- **Reason:** Without a floor we knowingly sell loss-making orders and call it growth.
- **Data needed:** the pilot's actual pooled route cost.
- **Deadline:** before consumer launch.

### Q2-4 · Volume pricing — farmer-set or platform-suggested

- **Options:** (a) farmer sets one price; (b) farmer sets price bands by quantity; (c) platform
  suggests bands from `PriceObservation`.
- **Recommendation:** (b), with (c) as a later assist.
- **Reason:** Retailer economics need a volume price; a suggested price risks becoming a price
  control we did not intend to operate.
- **Deadline:** before retailer launch.

### Q2-5 · Who bears a quality-dispute refund by default

- **Options:** (a) seller unless proven otherwise; (b) platform absorbs below a threshold; (c) split.
- **Recommendation:** (b) below a small threshold, (a) above it, always with explicit fault.
- **Reason:** Absorbing small disputes keeps trust cheap and avoids the failure mode in
  [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §5.6 — automated collection from a
  smallholder over a ৳50 tomato.
- **Data needed:** dispute frequency and value distribution.
- **Deadline:** before order fulfilment ships.

### Q2-6 · Retailer minimum order quantity

- **Options:** (a) none; (b) per-SKU minimum; (c) minimum order value.
- **Recommendation:** (c).
- **Reason:** Value tracks delivery economics better than weight across SKUs of different density.
- **Deadline:** before retailer launch.

### Q2-7 · Does P2 include recurring retailer supply?

- **Options:** (a) no; (b) a simple repeat-last-order action; (c) scheduled recurring orders.
- **Recommendation:** (b).
- **Reason:** Repeat purchase is the retailer behaviour that matters, and (b) captures most of it
  for a fraction of the cost. (c) is a contract system and belongs in Phase 9.
- **Deadline:** with the retailer flow.

### Q2-8 · Carried forward from P1 and still open

Pilot loss budget (Q1) · settlement hold hours by risk tier (Q2) · cancellation fee schedule and
the platform's documented ops-cost component (Q3) · launch settlement rail (Q4) · field-agent
employment model and cost (Q5) · legally usable public price sources (Q7).

**Q1, Q2 and Q3 now block implementation**, not just launch: P2 introduces orders, cancellations
and settlements, and the code paths for all three refuse to proceed without their configuration.
