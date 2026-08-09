# P2 — Delivered-Cost Engine

> **Status:** Design proposal · **Baseline:** [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §2–5

The most important domain component in P2. It decides what a buyer pays, what a farmer receives,
and whether Langgol can afford the transaction — and it must explain all three.

---

## 1. Two economies, never mixed

```text
BUYER SIDE
deliveredCost = productPrice + buyerDeliveryCharge + handling + applicableFees

SELLER SIDE
farmerRealization = productValue − commission − sellerFundedDelivery − adjustments − clawbacks
```

These are **separate calculations over the same transaction**. Mixing them is how a platform
convinces itself that a farmer gained because a buyer paid more. Every quote stores both blocks
independently.

---

## 2. The explainable breakdown

Every quote produces this, and the buyer sees it:

```text
Tomato · Grade A · Rahim's Farm, Godagari          25 kg
──────────────────────────────────────────────────────────
Product              ৳30.00/kg × 25 kg          ৳750.00
Delivery             12 km · pooled route       ৳250.00
Handling                                         ৳25.00
──────────────────────────────────────────────────────────
You pay                                       ৳1,025.00
Delivered price per kg                           ৳41.00
```

And the farmer sees their own side, never the buyer's:

```text
Your price           ৳30.00/kg × 25 kg          ৳750.00
Langgol commission   3%                         −৳22.50
──────────────────────────────────────────────────────────
You receive                                     ৳727.50
Per kg                                           ৳29.10
```

Neither party sees the other's economics. The farmer does not need to know the buyer's delivery
charge, and showing it invites the conclusion that Langgol is taking it.

---

## 3. Components

| Component              | Source                                                         | Notes                                   |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------- |
| `productPrice`         | Listing unit price × delivered quantity, rounded once per line | [`02_DATABASE.md`](02_DATABASE.md) §1.1 |
| `buyerDeliveryCharge`  | `applyFunding(tariff, model)`                                  | Six funding models, decision D3         |
| `handling`             | Per-order flat + per-kg by product class                       | Packing, crates, loading                |
| `applicableFees`       | Zero at MVP                                                    | No buyer-side marketplace fee           |
| `commission`           | `percentBps(productValue, config.commission.bps)`              | 300 bps, seller-side                    |
| `sellerFundedDelivery` | Only under `SELLER_FUNDED`/`SHARED`                            | Farmer opt-in only                      |

**Internal, not shown to either party:**

| Component                    | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `expectedTripCost`           | Ranking and feasibility                        |
| `allocationShare`            | Order's share of a pooled trip                 |
| `expectedSpoilage`           | Perishability × transit hours                  |
| `paymentCost`                | COD handling                                   |
| `expectedContributionMargin` | Stored on every quote; drives the budget guard |

---

## 4. Tariff and funding

```text
tariff        = baseFee(weightBand) + perKm(weightBand) × max(0, distanceKm − includedKm)
split         = applyFunding(tariff, fundingModel, context)
invariant     chargedToBuyer + fundedBySeller + fundedByRetailer + promotionalSubsidy == tariff
```

**Cost-recovering is the default** (D3). The P1 illustrative bands under-price badly at scale —
৳494 recovered against a ৳1,400 trip at 500 kg — and P2 recalibrates them from measured
`DeliveryTrip.actualCostPoisha` ([`P2_ECONOMICS.md`](P2_ECONOMICS.md) §3).

**Pooled routes change the tariff input, not the tariff.** A pooled order's `allocationShare` is
its share of one trip serving many drops, so the same cost-recovering rule yields ~৳40 instead of
~৳180. That is why pooling is the economic mechanism rather than a discount.

Subsidising models require a `subsidyReason` from the controlled vocabulary and are **refused in
the quoting path** when the pilot loss budget is exhausted.

---

## 5. Ranking

Unchanged from [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §5 and reaffirmed here because P2 is where
it first runs for real:

```text
score = 0.45·priceScore + 0.18·reliabilityScore + 0.14·freshnessScore
      + 0.08·speedScore + 0.08·quantityFitScore + 0.07·ratingScore
```

`priceScore` uses **delivered** price per kg, not the listing price. Ranking by listing price would
recommend the farmer whose produce costs most to move.

**Platform margin is not a ranking factor.** It is a feasibility filter and a ≤1% tiebreak only.
Ranking farmers by what Langgol earns from them is how a marketplace loses the asset it actually
owns, which is farmer trust.

---

## 6. Distance

`haversine × circuityFactor`, default 1.30, configurable per district — and treated as a
**hypothesis to be calibrated**, never a fact. Every quote records `distanceSource`, and the pilot
compares predicted against actual trip distance to tighten the factor per corridor.

Rivers, ferries and embankment roads make this materially wrong in places; monsoon can make a
corridor unserviceable entirely. `DeliveryRoute` therefore carries a serviceability flag by season.

---

## 7. Quote lifecycle

```text
DRAFT → CALCULATED → (ACCEPTED | EXPIRED | SUPERSEDED | REJECTED)
```

The client receives a **quote id**, never numbers. At checkout it submits the id; the server
reloads the quote, verifies ownership, expiry and single use, re-reads the listings, confirms price
and availability have not drifted, reserves atomically, and copies the money onto the order.

**There is no code path that reads a price, fee, commission, discount or total from a request
body.** Price drift never silently reprices — the buyer is told and re-consents.

---

## 8. What the engine must record for measurement

Every quote stores `pricingVersion`, `configVersions`, `distanceMeters`, `distanceSource`, the full
breakdown, and the expected contribution margin. Every completed order stores the _actual_
allocated trip cost. The gap between the two is how the tariff gets calibrated, and it is the only
honest source of the delivery numbers in [`P2_ECONOMICS.md`](P2_ECONOMICS.md).
