# P2 — Economics and the Critical Review of the Thesis

> **Status:** Design proposal, awaiting approval · **Depends on:** [`04_MARKETPLACE.md`](04_MARKETPLACE.md), [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md), [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md)
>
> **Every number in this document is HYPOTHETICAL.** Baselines, vehicle hire rates and spoilage
> are stated as assumptions so the _structure_ of the argument can be checked. They are not
> measurements and must not be quoted as such. The pilot exists to replace them.

---

## 1. The question, stated so it can fail

> Can Langgol raise farmer realisation **and** hold or lower the buyer's delivered price, on the
> same transaction, while covering its own variable cost?

Three constraints, not two. A model satisfying any two is easy; satisfying all three is the
business. This document works the arithmetic and reports where it breaks.

**The headline finding, stated before the detail: it does not work for small household orders on
dedicated delivery, at any honest price. It works for retailers, and it works for households only
under pooled delivery or pickup. Route density — not price — is the gating variable.**

---

## 2. Assumptions (all hypothetical, all to be measured)

| Assumption                                | Value                | Basis                                                                                                  | How the pilot replaces it                           |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Baseline farm-gate (what a _bepari_ pays) | ৳22/kg               | Mid-range of the 40–60% farmer-share band in [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §6 | `PriceObservation`, `FARM_GATE`, `IN_PERSON_SURVEY` |
| Baseline local bazar retail               | ৳45/kg               | Consumer-facing comparator                                                                             | `PriceObservation`, `RETAIL`                        |
| Baseline wholesale (_paikar_ → shop)      | ৳33/kg               | Retailer's comparator — **not** the retail price                                                       | `PriceObservation`, `WHOLESALE`                     |
| Distance farm → buyer                     | 12 km                | Intra-district pilot                                                                                   | Measured per trip                                   |
| Solo trip cost, ≤25 kg (motorcycle/CNG)   | ৳180–250             | Local hire                                                                                             | `TripCostItem` receipts                             |
| Solo trip cost, 100 kg (CNG/pickup)       | ৳400                 | Local hire                                                                                             | Same                                                |
| Solo trip cost, 500 kg (pickup)           | ৳1,400               | Local hire                                                                                             | Same                                                |
| Pooled route, ~10 household drops         | ৳400/trip            | Hypothesis                                                                                             | Measured once pooling runs                          |
| COD handling                              | 1% of collected      | Agent time and float risk                                                                              | Measured                                            |
| Packaging                                 | ~৳0.4/kg, floor ৳2   | Crates, bags                                                                                           | Measured                                            |
| Commission                                | 300 bps, seller-side | Config `commission.bps`                                                                                | Product decision, not measurement                   |
| Langgol listing price, household          | ৳30/kg               | Between farm-gate and bazar                                                                            | Farmer sets it; this is a modelling mid-point       |
| Langgol listing price, retailer           | ৳28/kg               | Volume                                                                                                 | As above                                            |
| Langgol listing price, 500 kg             | ৳27/kg               | Volume                                                                                                 | As above                                            |

**The comparator differs by buyer.** A household compares to the **bazar** (৳45); a retailer
compares to **wholesale** (৳33). Comparing a retailer's price to retail would flatter Langgol by
about 36% and is the single easiest way to fake a good result. It is forbidden in
[`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §4.4 and remains forbidden here.

---

## 3. Scenario analysis under the P1 illustrative tariff

Tariff from `delivery.tariff` config: ≤5 kg ৳40 + ৳8/km beyond 5 km · 5–20 kg ৳70 + ৳10/km ·
20–100 kg ৳150 + ৳14/km · 100–500 kg ৳450 + ৳22/km (10 km included). At 12 km.

| Scenario                       | Buyer pays /kg | vs baseline    | Farmer /kg | vs ৳22 | Langgol CM |
| ------------------------------ | -------------- | -------------- | ---------- | ------ | ---------- |
| **5 kg household**             | ৳51.20         | **+14% worse** | ৳29.10     | +32%   | **−৳74**   |
| **10 kg household**            | ৳45.50         | ≈ parity       | ৳29.10     | +32%   | **−৳24**   |
| **25 kg household/small shop** | ৳40.92         | −9% ✓          | ৳29.10     | +32%   | **+৳27**   |
| **50 kg retailer**             | ৳33.76         | +2% worse      | ৳27.16     | +23%   | **−৳2**    |
| **100 kg retailer**            | ৳31.08         | −6% ✓          | ৳27.16     | +23%   | **−৳64**   |
| **500 kg consolidated**        | ৳28.29         | −14% ✓         | ৳26.19     | +19%   | **−৳592**  |

**Two separate failures, and they are not the same failure.**

1. **Small orders fail the buyer.** At 5 kg a dedicated 24 km round trip costs more than the
   produce. No pricing arrangement fixes that; the trip is the cost.
2. **Large orders fail Langgol.** The tariff _under-prices_ delivery badly at scale — at 500 kg it
   recovers ৳494 against a ৳1,400 trip. The P1 tariff was illustrative structure, and this is
   exactly the calibration error [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §3 warned it would be.

---

## 4. The same scenarios under a cost-recovering tariff

Charging the measured trip cost, per the approved default (decision D3).

| Scenario                | Delivery charged | Buyer /kg | vs baseline    | Farmer /kg | Langgol CM |
| ----------------------- | ---------------- | --------- | -------------- | ---------- | ---------- |
| **5 kg, dedicated**     | ৳180             | ৳68.00    | **+51% worse** | ৳29.10     | +৳6        |
| **10 kg, dedicated**    | ৳180             | ৳49.50    | +10% worse     | ৳29.10     | +৳12       |
| **25 kg, dedicated**    | ৳250             | ৳41.40    | −8% ✓          | ৳29.10     | +৳28       |
| **50 kg retailer**      | ৳300             | ৳34.80    | +5% worse      | ৳27.16     | +৳25       |
| **100 kg retailer**     | ৳400             | ৳32.60    | −1% ✓          | ৳27.16     | **+৳88**   |
| **500 kg consolidated** | ৳1,400           | ৳30.10    | −9% ✓          | ৳26.19     | **+৳314**  |

Cost recovery fixes Langgol's margin everywhere and **transfers the problem onto the small
buyer**, where it becomes unpayable. That is the honest shape of the trade.

**Where all three constraints hold simultaneously: from roughly 25 kg upward on dedicated
delivery, and clearly from 100 kg.** Below that, dedicated delivery cannot work.

---

## 5. The structural fix for households: pooling and pickup

The household problem is not the price of tomatoes. It is that one trip serves one buyer.

**Pooled route — 10 household drops on one ৳400 trip = ৳40 per order:**

| Scenario         | Delivery charged | Buyer /kg | vs ৳45 bazar | Farmer /kg | Langgol CM  |
| ---------------- | ---------------- | --------- | ------------ | ---------- | ----------- |
| **5 kg pooled**  | ৳40              | ৳40.00    | **−11% ✓**   | ৳29.10     | **+৳10.50** |
| **10 kg pooled** | ৳40              | ৳34.50    | −23% ✓       | ৳29.10     | **+৳16**    |

**Pickup point — buyer walks the last few hundred metres, delivery ≈ ৳0 to Langgol:**

| Scenario        | Buyer /kg | vs ৳45 | Farmer /kg | Langgol CM    |
| --------------- | --------- | ------ | ---------- | ------------- |
| **5 kg pickup** | ৳32.00    | −29% ✓ | ৳29.10     | +৳2.50 (thin) |

**This is the central finding of the P2 economic review.** The household segment is viable, but
only through **density**, not through pricing. Everything in the P2 design that looks like an
operations feature — route days, pickup points, order pooling, minimum basket — is in fact the
economic mechanism, and should be treated with the seriousness of a pricing decision.

### 5.1 The break-even that actually matters

Not "what basket size works" but **"how many drops per route make a household order work?"**

At ৳400 per route and 5 kg orders, buyer parity with the bazar needs delivery ≤ ~৳75/order, i.e.
**≥ 6 drops per route**. Below six, a household route loses money or prices above the bazar.

`orders per route ≥ 6` is therefore the operational target the pilot must hit, and it is a
**geographic clustering problem**, not a marketing one. It argues for launching in a few dense
wards rather than across a district.

---

## 6. Why retailers matter more than they look

|                      | Household 5 kg  | Retailer 100 kg |
| -------------------- | --------------- | --------------- |
| Trips to move 100 kg | 20              | 1               |
| Delivery cost per kg | ৳36 (dedicated) | ৳4              |
| Langgol CM per kg    | −৳14.8          | +৳0.88          |
| Farmer uplift        | +32%            | +23%            |

A retailer order moves the same produce for about **one ninth** of the delivery cost per kg. The
farmer's percentage uplift is lower (volume pricing) but the _absolute_ uplift per trip is far
larger, and the transaction actually pays for itself.

**Recommendation: retailers are the P2 anchor segment**, with households served through pooled
routes and pickup points built on the density retailers create. Retailer orders make the vehicle
run; household drops ride the same route.

This is a change of emphasis from the P1 documents, which treated consumers and retailers as
co-equal. It is recorded as a decision in [`P2_DECISIONS.md`](P2_DECISIONS.md).

---

## 7. Farmer realisation, honestly

Uplift is **net of commission and every deduction** ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §5.1).

```text
farmerRealization = listingValue − commission − sellerFundedDelivery − adjustments − clawbacks
```

At ৳30/kg with 300 bps: ৳29.10/kg against a ৳22 baseline — **+32%**.

Three cautions the pilot must not paper over:

1. **The baseline is the weakest number here.** ৳22 is an assumption. If the real _bepari_ price
   is ৳26, the uplift is +12%, not +32% — still positive, materially less exciting.
2. **The _bepari_ buys everything, including poor grades, and pays immediately.** Langgol buys
   what a buyer ordered. A farmer selling 60% through Langgol and 40% to the _bepari_ at a worse
   price may be no better off overall. **Uplift must be measured per farmer per season, not per
   transaction**, or we will report a number that is true and misleading.
3. **Uplift is not income.** Volume matters more than price for most smallholders.

---

## 8. Contribution margin — the definition P2 uses

```text
revenue      = commission + deliveryChargedToBuyer + handling + sellerFundedDelivery
variableCost = allocatedTripCost + codHandling + packaging + agentTime
             + spoilageLoss + failedDeliveryCost + refundCost
CM           = revenue − variableCost
```

Failed deliveries deserve emphasis: **a failed delivery costs the full trip and earns nothing.**
At a 5% failure rate on ৳400 trips, that is ~৳20 per successful order — enough to erase the
household pooled margin of ৳10.50 twice over. Failure rate is not a quality metric here; it is a
first-order economic variable.

---

## 9. What would falsify the thesis

State these before the data arrives:

| Finding                                                      | Reading                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Farmer uplift ≤ 0 net of commission against ≥2 baselines     | **Thesis dead as stated.** Langgol is not paying farmers more                   |
| Buyer delivered price > baseline in _every_ segment          | **Thesis dead.** Langgol is a more expensive bazar                              |
| CM negative in every segment at 3× density                   | Not viable without a different cost structure                                   |
| Uplift positive but only where Langgol under-prices delivery | We are buying the result. Not a business                                        |
| Retailers work, households never do                          | **Thesis survives, narrowed.** Langgol is a B2B supply platform. Say so plainly |
| Routes never reach 6 drops                                   | Household segment closes. Pickup points or nothing                              |

The fifth is the most likely outcome on this arithmetic, and it is an acceptable business —
provided we say it rather than continuing to market a consumer product that loses money on every
order.

---

## 10. Commission is a lever, not a constant

At 300 bps on a ৳30/kg listing, commission is ৳0.90/kg — **about 1% of the household delivery
cost per kg at 5 kg**. Raising it to 500 bps would add ৳0.60/kg of revenue and cost the farmer
6 percentage points of uplift.

**Commission cannot fix the delivery problem.** It is not where the money is, and treating it as
the margin lever would take from the farmer to subsidise a trip that should not have been made.
Keep it at 300 bps for the pilot; the lever is route density.

---

## 11. What this means for the P2 design

1. **Retailers first.** Anchor segment; households ride their density.
2. **Pooling and pickup points are economic infrastructure**, not conveniences — they are the only
   thing that makes households work.
3. **Cost-recovering delivery by default**, with any subsidy explicit, reasoned and budgeted.
4. **Trip cost must be captured on every trip.** Without it none of this is measurable.
5. **Launch dense, not wide.** Six drops per route is a clustering target.
6. **Measure uplift per farmer per season**, not only per transaction.
7. **Track failed-delivery cost as a first-order metric.**
