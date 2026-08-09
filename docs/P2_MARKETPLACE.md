# P2 — Marketplace, Discovery and Fulfilment

> **Status:** Design proposal · **Baseline:** [`04_MARKETPLACE.md`](04_MARKETPLACE.md), unchanged
> except where noted.

---

## 1. Discovery is delivered-cost first

A buyer enters a location and a product. Langgol returns nearby supply ranked by the model in
[`P2_DELIVERED_COST.md`](P2_DELIVERED_COST.md) §5 — **not** by listing price and **not** by
distance. Each result shows delivered price per kg, distance, availability, farm name, farmer
rating and an explainable reason (`CHEAPEST_DELIVERED`, `HARVESTED_TODAY`, `NEARBY`).

Candidate generation: published · within the availability window · sufficient quantity · inside the
role's radius cap · seller active · at least one fulfilment mode feasible for this buyer.

**Retailers see wholesale-referenced comparisons; consumers see retail-referenced.** Comparing a
retailer's price to retail would flatter Langgol by roughly a third.

---

## 2. Fulfilment modes and who bears what

| Mode                              | Who performs                           | Who pays                                          | Cost to Langgol | Failure cost                                           |
| --------------------------------- | -------------------------------------- | ------------------------------------------------- | --------------- | ------------------------------------------------------ |
| **Pickup**                        | Buyer collects at farm or pickup point | Buyer's own time                                  | ≈ ৳0            | Uncollected → `FAILED(NOT_COLLECTED)`, produce at risk |
| **Seller delivery**               | Farmer                                 | Buyer, or farmer opts to absorb (`SELLER_FUNDED`) | ৳0 direct       | Farmer's, plus reliability impact                      |
| **Ops-coordinated, dedicated**    | Langgol-arranged vehicle               | Buyer at cost-recovering tariff                   | Full trip       | **Full trip, earning nothing**                         |
| **Ops-coordinated, pooled route** | One vehicle, many drops                | Buyer pays allocated share                        | Trip ÷ drops    | Full trip, spread across the route's successful drops  |

Delivery subsidy is never hidden:

```text
buyerDeliveryCharge + sellerFunded + retailerFunded + promotionalSubsidy = tariff
tariffShortfall = max(0, actualTripCost − tariff)      -- derived, reported daily
```

---

## 3. Pooled routes and pickup points — the economic mechanism

These are not conveniences. They are the only reason household orders can work
([`P2_ECONOMICS.md`](P2_ECONOMICS.md) §5).

**`DeliveryRoute`** — a district, a service day, a vehicle class and a capacity. Ops assembles
orders into a route; each becomes a `TripStop`. Cost is recorded once on the `DeliveryTrip` and
allocated by weight share.

**Target: ≥6 drops per household route.** Below six, a household route either loses money or
prices above the bazar. This is a **geographic clustering** target and is the reason P2 launches in
a few dense wards rather than across a district.

**`PickupPoint`** — a named collection location, `AdminArea`-anchored, with a geography column and
opening hours. **It holds no stock and takes no custody**: a pickup point that stores produce is a
warehouse, which carries food-safety and custody obligations we have not cleared (ADR-25).

**Route days** let a farmer or ops serve an area on fixed days, which is how `allocationShare`
genuinely falls below 1.0 — never on optimism, only on observed pooling.

---

## 4. Inventory and reservations

Reservation is created **at order placement**, not at cart (ADR-23): an idle browser must not lock a
farmer's crop. The atomic conditional `UPDATE` makes overselling structurally impossible; the loser
of a race sees "just sold out" with alternatives, never an error.

Released on: farmer rejection · acceptance timeout · buyer cancellation before confirmation ·
reservation TTL. Committed on farmer acceptance. Closed on delivery, against **actual** weight.

**Spoilage** is a first-class write-off: `InventoryAdjustment` with a mandatory reason, append-only,
so "what happened to the other 20 kg" always has an answer.

---

## 5. Guardrails

| Risk                 | Control                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absurd price         | Compare to `PriceObservation` median; outside a band → warn the farmer, flag for moderation, **never silently block**                                 |
| Phantom listings     | Verified farmers only may publish; auto-pause after N consecutive rejections or timeouts                                                              |
| Stale availability   | Mandatory window; auto-expiry sweep; prompt to reconfirm old listings                                                                                 |
| Fake reviews         | Only from a `DELIVERED` order, one per order per subject; collusion signals go to **human** review — shared phones in a village are normal, not fraud |
| Ranking manipulation | Weights are server-side config; no client input influences ranking; changes audited                                                                   |
| Long-haul nonsense   | Radius cap by role; quote-only above the top weight band                                                                                              |
| Farmer poaching      | Contact masked until `CONFIRMED`; discovery shows area, never coordinates (ADR-27)                                                                    |

---

## 6. Competitive position — what is actually structural

| Channel                    | Its advantage                                                                                           | What Langgol can do that it cannot easily copy                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| _Foria/bepari/aratdar_     | Instant cash, takes the whole lot including poor grades, pre-harvest credit (_dadon_), decades of trust | **Price transparency and a written record.** A farmer learns what their crop fetched elsewhere this week                                     |
| Local bazar                | Immediate, no coordination, no trust gap                                                                | **Delivered-cost comparison across several farmers**, plus provenance                                                                        |
| Existing agri marketplaces | Capital, brand                                                                                          | **Delivered-cost ranking and measured unit economics.** Most rank by listing price and never measure whether the transaction paid            |
| Direct farmer selling      | No intermediary at all                                                                                  | **Aggregation into routes.** One farmer cannot fill a vehicle; Langgol can                                                                   |
| Facebook/WhatsApp trade    | Zero friction, real reach                                                                               | **Reservation, settlement and dispute resolution.** A WhatsApp group cannot stop two buyers claiming the same crate, and cannot pay reliably |

**The honest reading:** Langgol's defensible advantage is **route density plus measured
economics** — the ability to fill a vehicle across many small farmers and to know, per transaction,
whether it paid. It is _not_ "removing the middleman", which the _bepari_ still does better on
speed, cash and grade tolerance.

The one thing Langgol cannot yet match is **pre-harvest credit**, and that is the honest reason
some farmers will stay with the _bepari_. Credit is Phase 12 and gated on legal and licensing work.

---

## 7. What the engine still does not do in P2

Multi-farmer basket optimisation · dynamic or surge pricing · true road-network routing ·
auctions · forward contracts · demand forecasting · quality prediction from images · cold chain.

The engine must be **correct, explainable and calibrated** before it is made clever. An
unexplainable ranking that farmers do not trust is worse than a simple one they do.
