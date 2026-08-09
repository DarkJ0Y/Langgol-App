# 10 — Economic Measurement & Experimentation

> **Status:** Approved 2026-08-10 · specification · **Classification: core product capability, not analytics**
> **Governing principle:** Langgol may not claim farmer benefit, consumer saving, or transportation reduction without an explicit, stored, versioned measurement methodology.

---

## 1. Why this is a core system

Langgol's thesis is an economic claim: that connecting supply to nearby demand can raise farmer realisation *and* lower buyer delivered cost at the same time. A claim of that shape is only worth anything if it is falsifiable.

So measurement is not a reporting layer bolted on after launch. It is:

- **A domain module** (`packages/domain/economics`) with pure, versioned, unit-tested formulas
- **A write path** — every order produces an immutable `OrderEconomics` record at completion, not a query run later over mutable tables
- **A governance mechanism** — the pilot loss budget is enforced from these numbers
- **The go/no-go instrument** for the entire programme

If the measurement system is wrong, every strategic decision downstream is wrong, and we will not know.

---

## 2. Principles

1. **Measured beats modelled.** Where a number can be observed (actual trip cost, actual delivered weight), observe it. Where it must be modelled (transport avoided, spoilage avoided), label it as an estimate and carry its confidence.
2. **Every claim carries its method.** `methodologyVersion`, baseline source, sample size, date window, and confidence travel with the number, always.
3. **Snapshots are immutable.** Economics are computed once at order completion and frozen. Recomputing history against today's baselines is how organisations accidentally lie to themselves.
4. **Net of everything.** Farmer uplift is measured net of commission and every deduction. A 3% commission against a 2% uplift means the farmer is worse off, and the system must say so.
5. **Observational is not causal.** Most pilot comparisons are strata, not randomised trials. Reports must say so rather than implying causation.
6. **Never present an unverified observation as a definitive market price.** Confidence is displayed wherever a baseline is displayed.
7. **Negative results are results.** A finding that household delivery is uneconomic at 5 kg is worth more than a dashboard that hides it.

---

## 3. Architecture

```text
packages/domain/economics/
  formulas/          pure functions — farmer, consumer, platform, logistics, ecosystem
  baseline/          matching rules, confidence scoring, seasonal alignment
  allocation/        trip-cost → order-cost allocation methods
  experiments/       stratum derivation, variant assignment, analysis helpers
  methodology.ts     METHODOLOGY_VERSION + a changelog of what each version changed
```

**Write path**

```text
Order reaches DELIVERED
  → trip costed by ops (DeliveryTrip.actualCostPoisha recorded)
  → job: economics:compute
      resolve baselines (BaselineSnapshot)
      allocate trip cost to order
      compute farmer / consumer / platform / logistics blocks
      write OrderEconomics (immutable, methodologyVersion stamped)
  → job: economics:rollup (daily)
      aggregate by day × district × product × basketBand × deliveryModel × buyerSegment
```

**Read path** — admin dashboards, pilot reports and gate evaluation read `OrderEconomics` and the rollups. They never recompute from live tables.

**Recomputation policy.** If a methodology defect is found, a new `methodologyVersion` is issued and a **parallel** set of records is written (`supersededById`). The original is never edited. Reports state which version they use.

---

## 4. Baseline price system

### 4.1 What a `PriceObservation` must carry

Every observation stores: product (+ variety where known) · unit (normalised to poisha per kg) · location (`AdminArea`, plus market name where applicable) · market level (`FARM_GATE` / `WHOLESALE` / `RETAIL`) · source · collection method · observer · quality/grade context · timestamp and observation date · confidence · verification status · notes. Public-data observations additionally record the usage basis under which we are permitted to use them.

### 4.2 Collection methods and their confidence

| Collection method | Typical confidence | Notes |
|---|---|---|
| `IN_PERSON_SURVEY` (agent at market, recorded on site) | **HIGH** | The backbone of the pilot baseline |
| `RECEIPT_PHOTO` (buyer/retailer receipt captured) | **HIGH** | Verifiable evidence attached |
| `RETAILER_REPORTED` (partner retailer's own buying price) | MEDIUM | Corroborate against surveys |
| `PHONE_SURVEY` | MEDIUM | Recall error, no site verification |
| `PUBLISHED_BULLETIN` (publicly available market data, where legally usable) | MEDIUM | Wide coverage, coarse geography, lagging. **Legal usability confirmed before ingestion** |
| `FARMER_REPORTED` ("what would the *bepari* pay you today?") | **LOW** | Self-reported, incentive-affected. Never used alone for a headline claim |
| `PLATFORM_TRANSACTION` | — | Langgol's own prices. **Never used as a baseline for Langgol's own performance** — that is circular |

### 4.3 Verification status

`UNVERIFIED` → `CORROBORATED` (≥2 independent sources within tolerance) → `VERIFIED` (evidence attached and reviewed) → `DISPUTED` (sources conflict beyond tolerance).

A `DISPUTED` baseline does not silently pick a winner. It degrades the confidence of every claim that depends on it, and it appears in the report as a conflict.

### 4.4 Baseline matching rules (normative)

To attach a baseline to an order, in strict priority order:

| Step | Rule | Confidence effect |
|---|---|---|
| Product | Exact product match required | Mandatory |
| Variety | Exact variety preferred | Mismatch → one step down |
| Grade | Same grade preferred | Mismatch → one step down |
| Market level | `FARM_GATE` for farmer uplift; `RETAIL` for consumer buyers; **`WHOLESALE` for retailer buyers** | Mandatory |
| Geography | Same upazila → same district → same division | Each widening → one step down |
| Time | Within ±3 days → ±7 days → ±14 days | Each widening → one step down |
| Season | Must fall in the same agricultural season band ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §9) | Cross-season match is **rejected**, not degraded |
| Sample | Median of ≥3 observations preferred; 1–2 observations → LOW | — |

If no match survives, `OrderEconomics.baselineStatus = UNAVAILABLE` and **no uplift or saving is computed for that order**. It still counts in the denominator of coverage reporting, so a low baseline-coverage rate is visible rather than silently flattering.

Every resolved baseline is frozen into a `BaselineSnapshot` row referenced by the order's economics record, so any historical figure is reproducible years later.

---

## 5. Transaction-level measurement

All amounts in poisha; all weights in base units, expressed per kg in ratios. `deliveredKg` uses **actual delivered quantity**, not ordered quantity.

### 5.1 Farmer economics

```text
langgolSellingPrice      = Σ orderItem.lineTotal (at delivered quantity)
commission               = langgolSellingPrice × commissionBps / 10000        [3% default, config]
deliveryDeduction        = delivery cost borne by the seller (SELLER_FUNDED / SHARED)
otherDeductions          = adjustments, refund clawbacks attributed to the seller
farmerNetRealization     = langgolSellingPrice − commission − deliveryDeduction − otherDeductions
farmerNetRealizationPerKg= farmerNetRealization / deliveredKg

baselineFarmGatePerKg    = resolved FARM_GATE baseline (§4.4)
farmerUpliftPerKg        = farmerNetRealizationPerKg − baselineFarmGatePerKg
farmerUpliftPct          = farmerUpliftPerKg / baselineFarmGatePerKg
```

Also captured per order: time-to-sell (`publishedAt` → order accepted), sell-through for the listing, and whether the farmer was a repeat seller.

### 5.2 Consumer / retailer economics

```text
productCost              = Σ line totals (delivered quantity)
deliveryChargedToBuyer   = what the buyer actually paid for delivery
otherCharges             = handling + platform fee (platform fee = 0 at MVP)
buyerTotal               = productCost + deliveryChargedToBuyer + otherCharges
deliveredPricePerKg      = buyerTotal / deliveredKg

referenceMarketLevel     = RETAIL for consumers · WHOLESALE for retailers
referencePricePerKg      = resolved baseline at that level (§4.4)
buyerSavingPerKg         = referencePricePerKg − deliveredPricePerKg
buyerSavingPct           = buyerSavingPerKg / referencePricePerKg
```

`buyerSavingPerKg` is frequently **negative** at small baskets. That is a finding, and it is reported as prominently as a positive one.

Also captured: freshness (harvest → delivery hours), delivery distance, whether the buyer was a repeat buyer.

### 5.3 Langgol economics

```text
grossRevenue        = commission + deliveryChargedToBuyer + handlingFee + platformFee
                      + deliveryFundedBySeller + deliveryFundedByRetailer

deliveryCostActual  = allocated share of the trip's actual cost (§6.3)
paymentCost         = COD handling or provider fees actually incurred
opsVariableCost     = packaging + attributable agent time
spoilageLoss        = value of goods lost/rejected on this order

contributionMargin  = grossRevenue − (deliveryCostActual + paymentCost + opsVariableCost + spoilageLoss)
contributionMarginPerKg = contributionMargin / deliveredKg
```

**Subsidy attribution (reporting, not an extra cost — no double counting):**

```text
deliveryTariff        = what cost-recovering pricing would have charged (04 §3)
deliveryRecovered     = deliveryChargedToBuyer + deliveryFundedBySeller + deliveryFundedByRetailer
promotionalSubsidy    = max(0, deliveryTariff − deliveryRecovered)      -- deliberate discount vs tariff
tariffShortfall       = max(0, deliveryCostActual − deliveryTariff)     -- tariff itself under-priced
platformDeliveryGap   = max(0, deliveryCostActual − deliveryRecovered)  -- total unrecovered
```

`promotionalSubsidy` is posted explicitly to ledger account `5020`. `tariffShortfall` is derived and reported. Neither is added again into cost — `contributionMargin` already uses actual cost and actual revenue.

### 5.4 Mandatory fields on every negative-margin order

Per the approved decision, an order with `contributionMargin < 0` **must** carry: actual cost, actual revenue, subsidy amount, **`subsidyReason`**, basket band, delivery model, trip reference, buyer segment, farmer segment, district.

A negative-margin order with a null `subsidyReason` is a **data-quality defect**, surfaced daily in the ops report and blocking at the weekly review. Unexplained losses are how a pilot loss budget quietly becomes a burn rate.

---

## 6. Logistics economics

### 6.1 The trip is the unit of truth

Delivery cost is incurred per **trip**, not per order. `DeliveryTrip` records: vehicle type and capacity, ops owner, planned and actual route, pickup legs and delivery legs, total distance, total weight carried, orders on the trip, and **`actualCostPoisha`** (fuel + hire + driver + tolls + ferry + loading), entered by ops with a receipt or a documented standard rate.

### 6.2 Trip metrics

```text
ordersPerTrip        = count(orders on trip)
tripWeightKg         = Σ delivered weight
costPerOrder         = tripCostActual / ordersPerTrip
costPerKg            = tripCostActual / tripWeightKg
utilization          = tripWeightKg / vehicleCapacityKg
avgDistancePerOrder  = tripDistanceM / ordersPerTrip
pickupDistanceM      = Σ legs farm → consolidation/first drop
deliveryDistanceM    = Σ legs to buyers
routeDistanceM       = total trip distance including return where the return is unavoidable
```

### 6.3 Allocating trip cost to an order

Default method **`WEIGHT_SHARE`**:

```text
allocatedCost = tripCostActual × (orderDeliveredKg / tripWeightKg)
```

Alternatives supported and recorded on the record: `EQUAL_SHARE` (per order), `DISTANCE_WEIGHTED` (weight × leg distance), `STANDALONE` (single-order trip — allocation = full trip cost).

`OrderEconomics.allocationMethod` is stored, because comparing margins computed under different allocation rules is meaningless and someone will eventually try.

### 6.4 Delivery model comparison

Every trip is tagged with a `deliveryModel`, and all of the above is reported per model:

| Model | Definition |
|---|---|
| `INDIVIDUAL` | One order → one dedicated delivery |
| `AGGREGATED_ROUTE` | Multiple nearby orders → one route |
| `RETAILER_BULK` | Farmer → retailer, typically one large drop |
| `PICKUP` | Buyer collects from the farm or a designated pickup point (trip cost ≈ 0 to Langgol) |

---

## 7. Ecosystem economics — and its honest limits

| Metric | Method | Confidence |
|---|---|---|
| Average supply distance | Measured: farm → buyer | **HIGH** |
| Average delivery distance per order | Measured from trips | **HIGH** |
| Quantity aggregated | Measured: Σ delivered weight per trip | **HIGH** |
| **Estimated transportation avoided** | Counterfactual chain distance (farm → *arat* → wholesale market → retailer → buyer) **from a field survey of the actual local chain**, minus platform tonne-km | **LOW–MEDIUM**, modelled |
| **Estimated spoilage avoided** | (baseline chain hours − platform hours) × measured spoilage rate per hour per product × weight | **LOW**, modelled |

**Rules for the two modelled metrics:**

- They are never headline numbers, never in marketing, never in a funding deck without their confidence label and method attached
- The counterfactual chain distances must come from an actual field survey of the pilot district's chain, stored as data with its own provenance — not from an assumption
- Spoilage rates must be measured (sampled loss on real consignments) before any "spoilage avoided" figure is published at all; until then the metric is reported as **not yet measurable**
- Both are reported as ranges, not point estimates

This is the area where agri-platforms most often overclaim. The design deliberately makes it hard.

---

## 8. Experiment framework

### 8.1 Strata vs randomisation — stated plainly

Most MVP comparisons are **observational strata**: basket sizes occur naturally, and delivery models are chosen by ops for operational reasons. Comparing them tells us about *association*, not causation, because the orders differ in more ways than the variable of interest.

Where randomisation is ethical and operationally possible — for example, choosing between `INDIVIDUAL` and `AGGREGATED_ROUTE` among orders eligible for both — the system supports randomised assignment with a recorded seed. Where it is not, the record says `assignmentMethod = OBSERVATIONAL` and every report derived from it is labelled accordingly.

We will not randomise anything that leaves a farmer unpaid or a buyer worse off to produce a cleaner dataset.

### 8.2 Basket-size experiment (approved §11)

Bands are a **derived dimension**, not a hard-coded threshold:

`0–5 · 5–10 · 10–25 · 25–50 · 50–100 · 100–250 · 250–500 · 500+ kg`

Reported per band, crossed with delivery model and distance band:

- contribution margin per order and per kg
- delivered price per kg vs reference
- farmer uplift per kg
- delivery cost per kg
- order count and completion rate

**Threshold discovery** — the lowest band where, on ≥30 completed orders, **both** hold:

```text
median(contributionMargin) ≥ 0
median(deliveredPricePerKg) ≤ referencePricePerKg
```

reported with sample size and an uncertainty interval. **No threshold is assumed anywhere in code or configuration.** The ~475 kg inversion point in [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §7.3 is an illustration of the *mechanism*, not a target and not a default.

### 8.3 Delivery-model experiment (approved §12)

The four models in §6.4, measured separately on identical metrics, crossed with basket band and district. The question it answers: *does aggregation actually reduce cost per order in practice, and at what order density does it start to?*

### 8.4 Experiment record

`Experiment` (key, hypothesis, primary metric, guardrail metrics, start, end, status, owner) and `ExperimentAssignment` (experiment, subject type `ORDER`/`BUYER`/`AREA`/`TRIP`, subject id, variant, assignment method, seed, timestamp, reason). Guardrail metrics — completion rate, dispute rate, farmer uplift — stop an experiment that is improving margin by degrading the thing we exist to improve.

---

## 9. Pilot loss budget and subsidy governance

Negative contribution margin is permitted during the pilot **only** as a deliberate, budgeted learning and acquisition expense (approved §14).

### 9.1 The budget
`PilotBudget` defines, per period and per category (`DELIVERY_SUBSIDY`, `ACQUISITION`, `OPERATIONAL_LEARNING`): a cap in poisha, an owner, and an approval reference. Spend is **derived from the ledger** (`5020` plus measured `platformDeliveryGap`), never self-reported.

### 9.2 Controls

| Threshold | Action |
|---|---|
| 50% of period cap | Notice in the daily ops report |
| 75% | Alert to product and finance owners |
| 90% | Subsidy-enabling delivery funding models require per-order approval |
| 100% | **Subsidised funding models are disabled by configuration.** Cost-recovering, pickup, seller-funded and retailer-funded remain available. Raising the cap is an explicit, audited decision |

The hard stop is enforced in the pricing path, not in a policy document — a quote requesting a subsidised funding model with an exhausted budget is refused.

### 9.3 Subsidy reasons (controlled vocabulary)
`MARKET_SEEDING` · `BASKET_SIZE_EXPERIMENT` · `DELIVERY_MODEL_EXPERIMENT` · `NEW_BUYER_ACQUISITION` · `NEW_FARMER_ACTIVATION` · `SERVICE_RECOVERY` · `OPS_ERROR` · `ROUTE_DENSITY_BUILD`.

Free-text is not accepted. A vocabulary is what makes "why are we losing money?" answerable in one query.

---

## 10. Go / no-go gates

Evaluated on the pilot period with ≥100 completed orders, and **reported per segment** as well as in aggregate — an aggregate pass hiding a failing consumer segment is a fail.

### 10.1 Farmer
| Gate | Threshold |
|---|---|
| Farmer realisation vs baseline (net of commission) | Median uplift > 0, on ≥2 independent baseline sources at ≥MEDIUM confidence |
| Fulfilment rate (completed ÷ accepted) | ≥ 90% |
| Repeat seller rate (≥2 completed sales) | ≥ 40% of activated farmers |
| Farmer retention (active in the final 30 days) | ≥ 50% of activated farmers |

### 10.2 Consumer
| Gate | Threshold |
|---|---|
| Delivered price vs reference retail | Median ≤ reference **in at least one identified viable segment** |
| Repeat order rate (30-day) | ≥ 25% |
| Cancellation rate (buyer-attributable) | ≤ 10% |
| Satisfaction | Median rating ≥ 4.0 with ≥40% response rate |

### 10.3 Retailer
| Gate | Threshold |
|---|---|
| Repeat order rate | ≥ 60% |
| Average basket size | Stable or growing across the period |
| Supplier retention (retailer reordering from the same farmer) | ≥ 30% |

### 10.4 Logistics
| Gate | Threshold |
|---|---|
| Cost per order | Declining trend across the period |
| Cost per kg | Declining trend, and ≤ delivery revenue per kg in ≥1 delivery model |
| Utilisation | ≥ 50% on `AGGREGATED_ROUTE` trips |
| Average distance per order | Declining or stable as volume grows |

### 10.5 Platform
| Gate | Threshold |
|---|---|
| Contribution margin | Positive in ≥1 identified segment, **or** a written model showing positive at 3× density with stated assumptions |
| Loss budget | Not exceeded; every negative-margin order explained |
| CAC | Measured per channel with a payback period computed against measured repeat behaviour |
| GMV / take rate | Measured and reported (context, not gates) |

### 10.6 The thesis gate

> **Can Langgol simultaneously improve farmer realisation and provide a competitive delivered price for a meaningful subset of transactions?**

- **Yes** → the deliverable is a written characterisation of *which* transactions work: basket band, delivery model, distance band, product, buyer segment, season — with the supporting numbers. That characterisation becomes the expansion strategy.
- **No** → the deliverable is a written diagnosis of *what must change*: density, basket size, delivery cost structure, crop mix, commission, or the thesis itself. Proceeding to Phase 7 is not permitted on hope.

"Meaningful subset" is defined before the pilot ends, not after the data arrives: **≥25% of completed orders**, in a segment that is reachable and repeatable at scale.

---

## 11. Reporting surfaces

| Surface | Audience | Cadence |
|---|---|---|
| Order economics detail | Ops, product | Per order, on demand |
| Daily ops report | Ops | Daily — negative-margin orders, missing subsidy reasons, budget burn, unexplained variances, baseline coverage |
| Trip economics | Logistics ops | Per trip |
| Segment matrix (basket × delivery model × distance × district) | Product, leadership | Weekly |
| Baseline coverage & confidence | Product | Weekly — the share of orders with a usable baseline, by confidence tier |
| Gate scorecard | Leadership | Weekly, against §10 |
| Pilot conclusion report | Leadership, partners | End of pilot |

**Every surface displaying a derived economic figure also displays its methodology version, sample size and confidence.** A number without those three is not shown.

---

## 12. What we will not claim

- Any saving, uplift or avoided-transport figure without a stored baseline, a stated method, a sample size and a confidence label
- Causation from observational strata
- Spoilage reduction before spoilage rates are actually measured
- Farmer benefit gross of commission
- Aggregate success that conceals a failing segment
- A threshold basket size that was assumed rather than measured
- Anything derived from Langgol's own prices used as a baseline for Langgol's own performance
