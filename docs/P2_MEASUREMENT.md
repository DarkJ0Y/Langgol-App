# P2 — Measurement, Baselines and the Pilot Experiment

> **Status:** Design proposal · **Baseline:** [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md),
> which remains authoritative. This document states what P2 adds and how the experiment runs.

---

## 1. The experiment

> Can Langgol increase farmer net realisation **while** holding or reducing buyer delivered price,
> **and** cover its own variable cost?

Per product, per buyer segment, we measure:

```text
Baseline farm-gate price       (what a bepari pays)
Baseline bazar retail price    (consumer comparator)
Baseline wholesale price       (retailer comparator)
Langgol farmer realisation     (net of commission and every deduction)
Langgol buyer delivered price
Langgol logistics cost         (actual, from the trip)
Langgol contribution margin
```

**Baseline period: 30 days before the first order**, continuing throughout — a pre-period alone
cannot separate Langgol's effect from the season.

**Method:** `IN_PERSON_SURVEY` at the same markets, on a fixed weekly cadence, by the same agents,
recorded with source, method, confidence and verification status. Farmer-reported prices are
`LOW` confidence and never sufficient alone. Langgol's own prices are **never** a baseline for
Langgol's performance.

**Sample:** TBD — pilot measurement required. The gate in
[`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §10 uses ≥100 completed orders overall
and ≥30 per segment before a segment-level claim is made.

**Comparison:** matched on product, variety where known, grade, market level, geography and
**season** — a cross-season match is rejected, not degraded. Reported per segment as well as in
aggregate; an aggregate pass hiding a failing segment is a fail.

---

## 2. Confounders we must name before the data arrives

| Confounder          | Why it distorts                                                           | Mitigation                                                                 |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Seasonality**     | Rabi glut vs monsoon scarcity swings prices more than any platform effect | Season-matched baselines only; run across ≥1 season boundary if possible   |
| **Quality mix**     | Langgol may attract better grades; the _bepari_ takes everything          | Record grade on every listing and every observation; compare like grades   |
| **Selection**       | Early adopters differ from typical farmers                                | Report farmer characteristics; do not generalise from 30 volunteers        |
| **Subsidy**         | A subsidised delivery makes the buyer look better off                     | `promotionalSubsidy` recorded separately; margin computed on actual cost   |
| **Partial selling** | A farmer selling 40% to a _bepari_ at a worse price may be no better off  | **Measure uplift per farmer per season**, not only per transaction (D2-10) |
| **Novelty**         | First-order enthusiasm is not retention                                   | 30-day repeat rate is a gate, not a vanity metric                          |
| **Agent effect**    | An agent's presence may drive the price, not the platform                 | Record `createdByUserId`; compare agent-assisted against self-serve        |

---

## 3. Metrics

**Farmer** — realisation ৳/kg net of everything · uplift vs baseline (৳ and %) · **per-farmer
per-season realisation** · time to sell · sell-through · fulfilment rate · repeat seller rate ·
retention.

**Buyer** — delivered price ৳/kg · vs the _correct_ comparator (retail for consumers, wholesale for
retailers) · freshness hours · distance · repeat rate · cancellation rate · satisfaction.

**Platform** — revenue · **contribution margin ৳/order and ৳/kg** · promotional subsidy ·
tariff shortfall · CAC by channel · payback against measured repeat behaviour.

**Logistics** — trip cost · **cost per order** · **cost per kg** · drops per route · utilisation ·
pickup vs delivery vs pooled share · **failed-delivery cost** (D2-12).

**Supply chain** — average supply distance · quantity aggregated · time to sale · spoilage ·
_estimated_ intermediary hops removed and transport avoided — both **modelled**, both
confidence-labelled, never headline figures.

---

## 4. New in P2

| Addition                                      | Why                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| **Per-farmer per-season realisation**         | The per-transaction figure can be true and misleading (D2-10)                |
| **Drops per route**                           | The gating variable for household viability; target ≥6                       |
| **Failed-delivery cost per successful order** | At 5% failure on ৳400 trips it erases the household pooled margin twice over |
| **Pickup share**                              | The cheapest fulfilment; its adoption rate decides household economics       |
| **Spoilage write-offs**                       | Now a tracked inventory state, so waste is measured rather than inferred     |
| **Agent-assisted vs self-serve split**        | Separates platform effect from agent effect                                  |

---

## 5. Go / no-go gates

Evaluated on ≥100 completed orders, reported per segment. Values marked **TBD** need pilot data to
set honestly; inventing them now would be exactly the fabrication this project has avoided.

| Group       | Gate                                                   | Threshold                                                                     |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Supply      | Verified farmers · active listings · listing fill rate | TBD                                                                           |
| Supply      | Farmer fulfilment rate                                 | ≥ 90%                                                                         |
| Supply      | Repeat seller rate                                     | ≥ 40%                                                                         |
| Demand      | Buyer 30-day repeat                                    | ≥ 25%                                                                         |
| Demand      | Retailer repeat                                        | ≥ 60%                                                                         |
| Marketplace | Quote → order conversion · reservation failure rate    | TBD                                                                           |
| Marketplace | Buyer-attributable cancellation                        | ≤ 10%                                                                         |
| Logistics   | Drops per household route                              | **≥ 6**                                                                       |
| Logistics   | Cost per kg                                            | Declining trend; ≤ delivery revenue per kg in ≥1 model                        |
| Logistics   | Delivery failure rate                                  | TBD, but costed either way                                                    |
| Economics   | Farmer realisation uplift, net of commission           | Median > 0 on ≥2 independent baselines at ≥MEDIUM confidence                  |
| Economics   | Buyer delivered price                                  | Median ≤ correct comparator **in ≥1 identified viable segment**               |
| Economics   | Contribution margin                                    | Positive in ≥1 segment, **or** a written model showing positive at 3× density |
| Quality     | Dispute rate · refund rate · spoilage                  | TBD                                                                           |

### The thesis gate

**Pass** requires a written characterisation of _which_ transactions work — basket band, delivery
model, distance, product, segment, season — covering **≥25% of completed orders** in a segment that
is reachable and repeatable.

**The most likely outcome on the arithmetic in [`P2_ECONOMICS.md`](P2_ECONOMICS.md) is a narrowed
pass: retailers and pooled/pickup households work, dedicated household delivery does not.** That is
an acceptable business. What is not acceptable is continuing to market a consumer product that
loses money on every order, so if that is the result we say it plainly and change the product.

**Fail** requires a written diagnosis of what must change — density, basket size, delivery cost
structure, crop mix, commission, or the thesis itself. Proceeding on hope is not permitted.

---

## 6. Rules that do not change

No claim without a stored baseline, a stated methodology version, a sample size and a confidence
label. No causation claimed from observational strata. No spoilage-reduction figure before
spoilage rates are actually measured. No farmer benefit reported gross of commission. No threshold
asserted that was not measured. Economics are computed once at completion and frozen; history is
never recomputed against today's baselines.
