# 04 — Marketplace & Delivered-Cost Engine

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Implements:** [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) §2 · **Data:** [`02_DATABASE.md`](02_DATABASE.md) §6–7

This is the document that describes what makes Langgol different from a listings board.

---

## 1. The problem statement

A buyer does not want the cheapest farm-gate price. They want the lowest **delivered cost** for produce that is acceptable in quality, arrives when needed, and actually shows up. A farmer does not want the nearest buyer. They want the highest **net realisation** for the quantity they hold, sold before it spoils.

The engine's job is to compute both, transparently, and rank accordingly.

```text
Effective Delivered Cost
  = Product Cost
  + Transportation
  + Handling
  + Platform Fees
  + Other Applicable Charges
```

---

## 2. Three costs, deliberately kept separate

Conflating these is the most common way agricultural marketplaces lie to themselves.

| #                                         | Cost               | Who sees it                                                   | Purpose                                               |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| **1. Tariff** — the cost-recovering price | Buyer              | Published, slab-based, in `PlatformConfig`                    | What delivery _should_ cost the buyer                 |
| **2. Expected platform cost**             | Internal           | Modelled transport + payment + fulfilment + expected spoilage | Ranking, feasibility filtering, margin forecasting    |
| **3. Actual cost**                        | Internal, post-hoc | Recorded on the **trip** by ops, then allocated to orders     | Truth. Calibrates (2), proves or disproves the thesis |

Between the tariff and what the buyer is actually charged sits the **funding model** (§3.1). Any difference is a subsidy, and subsidies are never hidden inside product economics:

- A deliberate discount below tariff → `promotionalSubsidy`, posted explicitly to the subsidy expense account with a **mandatory reason** from a controlled vocabulary
- A tariff that simply fails to cover actual cost → `tariffShortfall`, derived and reported
- Both roll into `platformDeliveryGap`, which is what the pilot loss budget consumes

See [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §6 and [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §5.3.

---

## 3. The tariff — cost-recovering by default

**Approved: cost-recovering delivery is the default economic model.** The tariff is set to recover measured cost, and it is recalibrated against `DeliveryTrip.actualCostPoisha` throughout the pilot. Any departure from cost recovery is an explicit funding-model decision (§3.1), never a quietly under-priced tariff.

Slab by chargeable weight and distance beyond an included radius. All values live in `PlatformConfig`, versioned; **none of these numbers are hard-coded**. The table below is illustrative structure, not calibrated values — the pilot's first job is to replace it with measured ones.

| Chargeable weight | Base fee         | Included distance | Per additional km |
| ----------------- | ---------------- | ----------------- | ----------------- |
| ≤ 5 kg            | ৳40              | 5 km              | ৳8                |
| 5–20 kg           | ৳70              | 5 km              | ৳10               |
| 20–100 kg         | ৳150             | 5 km              | ৳14               |
| 100–500 kg        | ৳450             | 10 km             | ৳22               |
| > 500 kg          | quote-only (ops) | —                 | —                 |

```text
deliveryFee = baseFee(weightBand) + perKm(weightBand) × max(0, distanceKm − includedKm)
chargeableWeight = max(actualWeight, volumetricWeight)     // pumpkins are light and huge
```

Distance at MVP is **haversine × a road-circuity factor** (default 1.30, configurable per district) because road distance APIs cost money per call and rural road networks are poorly mapped. `OrderQuote.distanceSource` records which was used, so we can measure the factor's error and tighten it.

### 3.1 Delivery funding models

Who actually pays for delivery is an explicit, recorded decision per order.

| Model                           | Buyer pays                                    | Others pay                         | When it is used                                                         |
| ------------------------------- | --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| **`COST_RECOVERING`** (default) | Full tariff                                   | —                                  | Normal operation                                                        |
| `PROMOTIONAL_SUBSIDY`           | Tariff − subsidy                              | Platform absorbs the subsidy       | Market seeding, experiments — **requires a reason and budget headroom** |
| `FREE_DELIVERY`                 | Zero                                          | Platform absorbs all               | Acquisition offers — **requires a reason and budget headroom**          |
| `RETAILER_FUNDED`               | Retailer pays directly, possibly above tariff | —                                  | Retailer wants priority or a specific window                            |
| `SELLER_FUNDED`                 | Zero or reduced                               | Farmer absorbs it from `sellerNet` | Farmer chooses to offer delivered pricing as a selling advantage        |
| `SHARED`                        | Explicit ratio                                | Explicit ratio                     | Negotiated splits, mainly B2B                                           |

```text
split = applyFunding(tariff, model, context)
// → { chargedToBuyer, fundedBySeller, fundedByRetailer, promotionalSubsidy, subsidyReason }

invariant: chargedToBuyer + fundedBySeller + fundedByRetailer + promotionalSubsidy == tariff
```

Enforcement rules, all non-negotiable:

1. A subsidising model **cannot be selected without a `subsidyReason`** from the controlled vocabulary ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §9.3) — enforced by a database `CHECK` as well as by the domain
2. Subsidising models are **refused in the quoting path when the pilot loss budget is exhausted**. Cost-recovering, pickup, seller-funded and retailer-funded remain available, so the marketplace keeps working — it just stops paying for itself to be used
3. `SELLER_FUNDED` requires the farmer's explicit opt-in on the listing. Langgol never assigns a cost to a farmer on their behalf
4. The buyer always sees what they are charged, never a fictional "was ৳X, now free" — the tariff and the funding model are internal accounting, and the buyer-facing breakdown shows real amounts

---

## 4. Internal cost model

```text
expectedTransportCost = tripCost(vehicleClass, distanceKm) × allocationShare
tripCost              = vehicleBase + perKmRate × distanceKm × roundTripFactor + loadingFee + stopFee × stops
allocationShare       = thisOrderChargeableWeight / expectedLoadedWeightOnTrip
```

`allocationShare = 1.0` for a solo dispatch. It falls only when real pooling is **observed** in `DeliveryTrip` history for that corridor — never on optimism. After delivery, this modelled figure is replaced by the actual allocated share of the real trip cost ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §6.3), and the gap between model and reality is itself a tracked metric.

```text
expectedSpoilageCost  = productCost × spoilageRate(perishabilityClass, transitHours, hasColdChain)
paymentCost           = COD:  codHandlingRate × buyerTotal
                        MFS:  mfsRate × buyerTotal + fixedFee
fulfilmentCost        = packagingPerOrder + agentTimeCost

langgolCostForOrder   = expectedTransportCost + expectedSpoilageCost + paymentCost + fulfilmentCost
contributionMargin    = commission + platformFee + deliveryRecovered − langgolCostForOrder
```

`contributionMargin` is computed and stored on every quote. If it is negative, the option is still allowed to appear (subsidy may be a deliberate growth choice) but it is **flagged**, counted, and reported daily. A marketplace that cannot see its per-order margin cannot know whether it is working.

---

## 5. Ranking

Ranking is **not** by distance, and **not** by price alone.

### 5.1 Candidate generation

1. `status = PUBLISHED`, within the availability window, `quantityAvailableBase ≥ requestedQuantity` (or ≥ `minOrderBase` for partial fills where allowed)
2. Within the configured radius cap for the buyer's role
3. Seller not suspended; listing not under moderation hold
4. At least one fulfilment mode is feasible for this buyer (pickup possible, or delivery serviceable to their area)

### 5.2 Per-candidate factors

| Factor             | Definition                                                                                                        | Range      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| `priceScore`       | `minDeliveredUnitPrice / thisDeliveredUnitPrice`                                                                  | (0, 1]     |
| `reliabilityScore` | Laplace-smoothed completion: `(completed + k·prior) / (accepted + k)`, `k = 5`, `prior = 0.70`                    | (0, 1]     |
| `freshnessScore`   | Fraction of shelf life remaining at expected delivery: `max(0, 1 − hoursSinceHarvestAtDelivery / shelfLifeHours)` | [0, 1]     |
| `speedScore`       | `1 / (1 + hoursUntilDelivery / 24)`                                                                               | (0, 1]     |
| `quantityFitScore` | `1.0` if the listing fully covers the request; `0.7` if only a partial fill                                       | {0.7, 1.0} |
| `ratingScore`      | Bayesian-smoothed star rating normalised to [0,1]                                                                 | [0, 1]     |

```text
score = 0.45·priceScore + 0.18·reliabilityScore + 0.14·freshnessScore
      + 0.08·speedScore + 0.08·quantityFitScore + 0.07·ratingScore
```

Weights live in `PlatformConfig`, are versioned, and every quote stores the `pricingVersion` that produced it. Changing weights is a product decision with an audit trail, not a code tweak.

### 5.3 A hard rule about self-interest

**Platform contribution margin is not a ranking factor.** It is used in exactly two ways:

1. As a **feasibility filter**: options whose modelled margin is worse than a configured floor are excluded from default results (they can still be reached by explicit search)
2. As a **tiebreak** between candidates whose scores are within 1%

Ranking sellers by how much Langgol earns from them is how marketplaces lose farmer trust, and farmer trust is the entire asset. If we ever relax this, it must be disclosed in the UI.

### 5.4 Cold start

With few listings and no completion history:

- `reliabilityScore` falls back to the prior (0.70) for new farmers, so they are neither privileged nor buried
- New verified farmers receive a small, time-limited exposure boost (configurable, decaying over the first 5 orders) to break the no-orders → no-reputation → no-orders loop
- This boost is logged and reported; it is a deliberate market-making intervention, not a secret

---

## 6. Explainability

Every ranked result carries a machine-readable rationale rendered as a short human label:

```json
{
  "listingId": "…",
  "deliveredUnitPricePoisha": "5120",
  "rank": 1,
  "reasons": [
    { "code": "CHEAPEST_DELIVERED", "detail": { "vsNextPoisha": "340" } },
    { "code": "HARVESTED_TODAY" },
    { "code": "NEARBY", "detail": { "distanceKm": 12 } }
  ]
}
```

And the buyer always sees the full breakdown on the listing page:

```text
Tomato · Grade A · Rahim's Farm, Shibganj        5 kg
──────────────────────────────────────────────────────
Product            ৳30.00/kg × 5 kg          ৳150.00
Delivery           12 km · van                 ৳96.00
Handling                                       ৳10.00
Platform fee                                    ৳0.00
──────────────────────────────────────────────────────
Delivered total                               ৳256.00
Delivered price per kg                         ৳51.20
```

No "you saved ৳X" claim appears unless a stored `PriceObservation` baseline supports it, with the source and date shown ([`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §7.1).

---

## 7. The worked example — and what it actually reveals

Setup, per [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) §2.2. Illustrative tariff from §3.

- **Farmer A** — Shibganj, 12 km from the buyer, tomato ৳30/kg
- **Farmer B** — 120 km away, tomato ৳25/kg
- **Buyer** — Bogura town

### 7.1 Consumer buying 5 kg

|                     | Farmer A (12 km)      | Farmer B (120 km)        |
| ------------------- | --------------------- | ------------------------ |
| Product             | ৳150.00               | ৳125.00                  |
| Delivery            | 40 + 7×8 = **৳96.00** | 40 + 115×8 = **৳960.00** |
| Handling            | ৳10.00                | ৳10.00                   |
| **Delivered total** | **৳256.00**           | **৳1,095.00**            |
| **Per kg**          | **৳51.20**            | **৳219.00**              |

Farmer A wins by more than 4×. The ৳5/kg farm-gate advantage is annihilated by 115 km of road.

**But look harder at Farmer A.** ৳51.20/kg delivered, against a typical in-season Bogura retail tomato price well below that. **At 5 kg, solo, direct-to-household, Langgol is more expensive than the bazar.** That is not a bug in the model — it is the real economics of moving 5 kg of tomatoes 12 km in a dedicated vehicle, and every honest agri-marketplace collides with it.

The product responses — all cheap, all in the MVP design:

1. **Minimum basket value** for delivery; below it, offer pickup or a scheduled route
2. **Pickup points** — a shop or collection point per neighbourhood; the buyer walks the last 500 m and the fee drops to near zero
3. **Route days** — a farmer or ops van serves an area on fixed days; many small orders share one trip and `allocationShare` genuinely falls
4. **Pooled orders** — neighbours' orders on the same route consolidated into one dispatch
5. **Retailers first** — a 100 kg order carries delivery cost far better than twenty 5 kg orders

This is precisely why [`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §2 recommends including retailers in the pilot rather than consumers alone.

### 7.2 Retailer buying 100 kg

|                     | Farmer A                 | Farmer B                     |
| ------------------- | ------------------------ | ---------------------------- |
| Product             | ৳3,000.00                | ৳2,500.00                    |
| Delivery            | 150 + 7×14 = **৳248.00** | 450 + 110×22 = **৳2,870.00** |
| Handling            | ৳50.00                   | ৳50.00                       |
| **Delivered total** | **৳3,298.00**            | **৳5,420.00**                |
| **Per kg**          | **৳32.98**               | **৳54.20**                   |

Farmer A still wins decisively, and now the delivered price is close to the farm-gate price — the economics work.

### 7.3 Institutional buyer taking 500 kg

|                     | Farmer A                 | Farmer B                     |
| ------------------- | ------------------------ | ---------------------------- |
| Product             | ৳15,000.00               | ৳12,500.00                   |
| Delivery            | 450 + 2×22 = **৳494.00** | 450 + 110×22 = **৳2,870.00** |
| **Delivered total** | **৳15,494.00**           | **৳15,370.00**               |
| **Per kg**          | **৳30.99**               | **৳30.74**                   |

**The ranking inverts.** The distant farmer is now marginally cheaper delivered.

Break-even quantity:

```text
extra product cost of A  = ৳5/kg × Q
extra transport cost of B = ৳2,870 − ৳494 = ৳2,376
Q* = 2,376 / 5 ≈ 475 kg
```

Below ~475 kg, buy local. Above it, the long-haul farmer wins. **A distance-ranked marketplace gets this wrong in both directions**, and a price-ranked marketplace gets it wrong in both directions too.

> **This 475 kg figure is an arithmetic consequence of illustrative tariff values. It is not a target, not a default, and not a constant anywhere in the codebase.** The real inversion point — and the real basket size at which Langgol's delivered economics become competitive — is **measured**, per the basket-band experiment in [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §8.2. It will differ by product, district, season and delivery model, which is precisely why it cannot be assumed.

At 500 kg the gap is ৳0.25/kg — 0.8%. At that margin, `reliabilityScore` and `freshnessScore` should decide, and under §5.2's weights they do: a 4-hour-fresher, more reliable local farmer outranks a 0.8% price edge. That is the correct answer, and it falls out of the model rather than being special-cased.

### 7.4 The four delivery models, and how they are compared

Every order is tagged with the model that actually moved the goods, and each is costed separately at trip level:

| Model                      | Shape                                          | What it is testing                                                                      |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| **A · `INDIVIDUAL`**       | One order → one dedicated trip                 | The honest worst case. The §7.1 baseline                                                |
| **B · `AGGREGATED_ROUTE`** | Several nearby orders → one route              | Whether pooling actually reduces cost per order, and at what order density it starts to |
| **C · `RETAILER_BULK`**    | Farmer → retailer, typically one large drop    | Whether volume alone makes the economics work                                           |
| **D · `PICKUP`**           | Buyer collects from the farm or a pickup point | The floor: near-zero logistics cost to Langgol, and the fallback when nothing else pays |

For each model the system records cost per order, cost per kg, orders per trip, utilisation and average distance per order — and crosses them with basket band, distance band, district and product. The ranking engine does **not** consume these results at MVP; it consumes the tariff. Feeding measured model economics back into ranking is a Phase 7 change, made once the numbers are real rather than assumed.

---

## 8. Quote lifecycle

The quote is the pricing authority and the anti-tampering mechanism.

```text
Buyer selects listing + quantity + address + fulfilment mode
        │
        ▼
POST createQuote  ──►  compute breakdown  ──►  persist OrderQuote (TTL 15 min)
        │                                             │
        ▼                                             ▼
Client receives quoteId + rendered breakdown    stores pricingVersion, configVersion,
        │                                       distanceMeters, contributionMargin
        ▼
Checkout submits { quoteId, idempotencyKey, paymentMethod }   ← NO prices, NO seller id, NO totals
        │
        ▼
Server: owns? · not consumed? · not expired? · listing still PUBLISHED at same price? · stock available?
        │
   pass ├──► reserve inventory ► create Order (money copied from quote) ► mark quote consumed
        │
   fail └──► typed error + freshly generated quote, with the difference shown to the buyer
```

**Invariants**

- A quote is single-use (`consumedAt`, `consumedByOrderId`)
- A quote belongs to one buyer; another user's quote id returns _not found_, not _forbidden_ (no existence leak)
- Order money fields are **copied from the quote**, never recomputed at order time
- Price drift between quote and checkout never silently repricess — the buyer is told and re-consents
- Every quote records `pricingVersion` + `configVersion`, so any historical price is reproducible

Client-supplied prices, totals, fees, seller ids and discounts are ignored entirely. There is no code path that reads them. See [`07_SECURITY.md`](07_SECURITY.md) §5.

---

## 9. Inventory and reservations

Fresh produce is finite and perishable; overselling destroys farmer trust faster than any bug.

```text
quantityTotalBase = quantityAvailableBase + quantityReservedBase + (sold, implied)

Add to cart   → no reservation (carts are browsing, not commitment)
Create quote  → no reservation
Place order   → HELD reservation, atomic conditional UPDATE (02 §13), expires with acceptance window
Farmer accepts→ COMMITTED
Farmer rejects / times out / buyer cancels → RELEASED, inventory restored
Delivered     → reservation closed; quantityTotalBase reduced by delivered quantity
```

Reserving at order placement (not at cart) is deliberate: reserving on add-to-cart lets one idle browser lock a farmer's crop for hours.

**Partial fills.** A buyer wanting 50 kg from a listing holding 30 kg may, where the product allows it, be offered a partial fill or a multi-farmer split _suggestion_. In the MVP that becomes **two separate orders** (§5 of `01_MVP_REQUIREMENTS.md`), not one split order.

**Weight variance.** Fresh produce delivered rarely equals fresh produce ordered. `OrderItem.deliveredQuantityBase` and `adjustmentPoisha` capture the difference, within a configurable tolerance band (default ±5%). Beyond tolerance requires buyer confirmation or becomes a dispute. See [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §7.

---

## 10. Discovery: search and filters

**Buyer surfaces**

- Sort: _Best match_ (default, §5), _Cheapest delivered_, _Nearest_, _Freshest_, _Highest rated_
- Filters: category/product · delivered price range · max distance · available date · grade · minimum farmer rating · fulfilment mode · organic/verified badges (Phase 6+)
- Search: Bangla and English, tolerant of transliteration (`tomato` / `টমেটো` / `tometo`) via a normalised search index on catalogue names and synonyms

**Why the curated catalogue matters again:** transliteration-tolerant search over free text in two scripts is a hard problem; over a 60-item curated catalogue with synonym lists it is a solved one.

**Farmer surfaces** — demand-side discovery, deliberately minimal in the MVP:

- "What is selling near you": product, recent delivered prices, unmet demand signals in the district
- Enough to inform listing decisions; not a full RFQ system (Phase 7)

---

## 11. Guardrails

| Risk                                   | Control                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absurd prices (typo: ৳3,000/kg tomato) | Compare against `PriceObservation` median for product+district. Outside a configurable band → soft warning to farmer + `moderationFlag` for admin. Never a silent block |
| Phantom listings                       | Verified farmers only for publish; automatic pause after N consecutive rejections/timeouts                                                                              |
| Stale availability                     | Mandatory availability window; auto-`EXPIRED` sweep; farmers prompted to confirm listings older than N days                                                             |
| Fake reviews                           | Reviews only from a `DELIVERED` order, one per order per subject, rate-limited, ops-reviewable                                                                          |
| Collusive self-dealing                 | Buyer and seller sharing a device/phone/address flagged for review                                                                                                      |
| Long-haul nonsense                     | Radius cap by role; quote-only above the top weight band                                                                                                                |
| Ranking manipulation                   | Weights are server-side config; no client input influences ranking; changes are audited                                                                                 |

---

## 12. What the engine does **not** do in the MVP

Multi-farmer basket optimisation · dynamic/surge pricing · true road-network routing · auctions and bidding · forward contracts · demand forecasting · quality prediction from images · cold-chain modelling beyond a flat spoilage rate.

Each is a Phase 5–11 item ([`09_ROADMAP.md`](09_ROADMAP.md)). The MVP engine must be **correct, explainable and calibrated** before it is made clever. An unexplainable ranking that farmers do not trust is worse than a simple one they do.
