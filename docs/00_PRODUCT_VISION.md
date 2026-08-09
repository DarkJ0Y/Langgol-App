# 00 — Product Vision

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Owner:** Product/Architecture · **Last updated:** 2026-08-10

---

## 1. Mission

> **Farmers should earn more. Consumers should pay less. Agriculture should become more transparent, efficient, accessible and sustainable.**

Langgol is a digital operating system for the agricultural ecosystem of Bangladesh. Internally the architecture is referred to as **Langgol AgriOS**; the customer-facing brand is only ever **LANGGOL**.

---

## 2. The core economic thesis

Langgol is not "an online grocery marketplace." The hypothesis under test is narrower and harder:

> **Can Langgol connect agricultural supply with nearby demand such that the farmer's realized price rises *and* the buyer's delivered cost falls, at the same time, on the same transaction — and can we measure it?**

Both sides can only improve simultaneously if the margin Langgol removes from the existing chain exceeds the cost Langgol adds back (logistics, handling, payments, platform). That is an empirical question, not a slogan. See [`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §7 for how we measure it and [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §6 for the existing chain we are competing with.

### 2.1 Optimize the transaction, not the price

For every candidate match the platform must eventually reason over:

| Input | Why it matters |
|---|---|
| Farm-gate price | Farmer's ask |
| Quantity | Determines per-unit logistics amortization |
| Distance & route | Dominates delivered cost at small basket sizes |
| Transport cost | Vehicle class, fuel, load factor, backhaul |
| Handling / packing | Crates, loading, grading, wastage |
| Delivery time | Freshness decay, buyer patience |
| Spoilage risk | Perishability × time × handling × temperature |
| Quality / grade | Two "tomatoes" are not the same good |
| Seller reliability | Fulfilment probability, cancellation history |
| Platform fees | Commission, payment cost |

**The cheapest farm-gate price is not the cheapest delivered price. The nearest farmer is not always the best supplier.** Ranking by distance alone, or by price alone, is a product failure. The mechanism is specified in [`04_MARKETPLACE.md`](04_MARKETPLACE.md).

### 2.2 Worked illustration

Illustrative figures only — real coefficients come from the pilot.

- **Farmer A** — Bogura Sadar, tomato, ৳30/kg, harvest tomorrow, 200 kg available
- **Farmer B** — 120 km away, tomato, ৳25/kg, 200 kg available
- **Consumer C** — Bogura town, wants **5 kg**

Farmer B is ৳5/kg cheaper at the farm gate. But 5 kg cannot amortize a 240 km round trip. Once transport, handling and spoilage are attributed, Farmer A is decisively cheaper delivered. At **500 kg**, on a shared route, with a return load, the answer may invert.

The product's job is to compute that, show the breakdown, and let the buyer see *why*. This is the difference between Langgol and a listings site.

---

## 3. What Langgol is — and is not

**Is:**
- A matching and coordination layer for agricultural supply and demand
- A transaction system of record with real financial rigour
- A measurement instrument for agricultural economics in Bangladesh

**Is not (yet, and not by accident):**
- A lender, bank, or holder of customer funds
- A cryptocurrency or an open-value wallet
- A logistics fleet owner
- An "AI agriculture super-app"
- A middleman-elimination crusade — see §7

---

## 4. The ecosystem (long-term)

```text
LANGGOL
│
├── Langgol Market         marketplace: farmer → consumer / retailer / restaurant / institution
├── Langgol Farm           farm, plot, crop cycle, expense/income, advisory
├── Langgol Credit         input-purchase credit inside the ecosystem, via licensed partners
├── Langgol Logistics      pickup, delivery, routing, tracking, cold chain
├── Langgol Supply         seeds, fertilizer, tools, machinery, services
└── Langgol Intelligence   prices, demand/supply forecasts, agronomy, fraud, analytics
```

"AgriOS" is an internal architectural concept and must not appear in consumer-facing surfaces.

---

## 5. The sequencing logic

Credit is the most commercially attractive product and the **last** one we are allowed to build.

```text
Farmers → Supply → Buyers → Transactions → Transaction history
   → Trust / reputation → Financial data → Credit eligibility
   → Agricultural purchasing credit → More input purchases
   → Higher production → More supply
```

Lending without transaction history is not fintech, it is charity with extra steps and a regulatory violation. The marketplace *is* the underwriting data-collection programme. See [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.4 on why unlicensed lending is not an option in Bangladesh regardless of product appetite.

---

## 6. The flywheel

```text
More farmers → More supply → More buyers → More transactions → More data
   → Better prices & forecasts → Better logistics → Lower costs
   → Better farmer economics → More farmers
```

The flywheel only spins with **density**. Ten farmers spread across eight districts produce no logistics efficiency and no price signal. This is why the MVP is geographically concentrated ([`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §2), not nationally thin.

---

## 7. Product principle: do not destroy every intermediary

The Bangladeshi chain — *foria* (village collector), *bepari* (trader), *aratdar* (commission agent at the wholesale market), *paikar* (wholesaler), retailer — is often described as pure rent extraction. It is not. Those actors supply real services:

aggregation · pre-harvest financing · transport · storage · grading · market access · price risk absorption · trust enforcement

Langgol's objective:

> **Remove unnecessary cost and opacity — not useful economic activity.**

Where an aggregator genuinely adds value, Langgol should onboard and coordinate them as a first-class role rather than route around them. The competitive attack surface is *opacity and unnecessary hops*, not intermediation itself.

---

## 8. Bangladesh-first, by design

Bangla and English. BDT. Division → District → Upazila → Union → Village addressing. Bangladeshi phone number formats. Mobile-first on low-cost Android over intermittent 3G.

Design constraint, stated bluntly: **the farmer application must work for a user with a ৳9,000 Android phone, limited literacy in English, patchy data, and no prior experience of e-commerce.** Every screen in the farmer app is judged against that user, not against us. Details in [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md).

---

## 9. Brand and design posture

Langgol should feel **trustworthy · modern · agricultural · human · premium · accessible · practical**.

Deliberately avoided: generic green e-commerce templates, gradient soup, cartoon farmer illustrations, decorative animation, fake-futuristic "AI" chrome, dense dashboards.

Used instead: strong typography, generous spacing, restrained agricultural visual language, high contrast, excellent mobile ergonomics, clear information hierarchy.

The brand must communicate: **Trust + Agriculture + Technology + Economic Fairness.**

---

## 10. Revenue posture

Eventual lines: marketplace commission · logistics margin · supplier commission · subscriptions · B2B procurement services · warehouse fees · equipment-rental commission · financial and insurance partnership revenue · premium analytics · advertising · export facilitation · enterprise agricultural intelligence.

**Rule: do not optimize revenue before proving user value.** The MVP charges a commission primarily so that the accounting, tax and settlement machinery is exercised and measurable — not to maximise near-term take. See [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §4.

---

## 11. Honesty constraint (non-negotiable)

Langgol must never claim savings it has not measured.

Any farmer-income or consumer-price claim must trace to a stored `PriceObservation` baseline, a stated methodology version, a sample size, and a stated confidence. Any AI output must communicate uncertainty and must never be presented as guaranteed agronomic advice.

This is not a marketing-review policy. It is **enforced in the data model and in the write path**: baselines are frozen per order, economics are immutable and methodology-stamped, orders without a usable baseline produce no claim at all, and modelled figures (transport avoided, spoilage avoided) carry a confidence label that follows them into every report. See [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md).

---

## 12. The one thing the first product must prove

> **A real farmer can sell real produce to a real nearby buyer through Langgol, with transparent pricing, reliable fulfilment, and measurable economic benefit to both sides.**

If that holds, everything in §4 can grow around it. If it does not, no amount of additional modules will rescue it.

---

## Related documents

| Doc | Contents |
|---|---|
| [`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) | Pilot scope, user stories, acceptance criteria, metrics |
| [`02_DATABASE.md`](02_DATABASE.md) | Schema, constraints, indexes, migrations |
| [`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) | Stack, layering, provider abstractions, ADRs |
| [`04_MARKETPLACE.md`](04_MARKETPLACE.md) | Delivered-cost engine, ranking, quotes, inventory |
| [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) | Order state machine, fulfilment, cancellation, disputes |
| [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) | Money, ledger, settlement, idempotency, tax |
| [`07_SECURITY.md`](07_SECURITY.md) | Threat model, authn/authz, audit, abuse |
| [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) | Geography, language, payments, market structure, regulation |
| [`09_ROADMAP.md`](09_ROADMAP.md) | Phases, gates, risks, kill criteria |
| [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) | Metrics, formulas, baselines, experiments, loss budget, go/no-go gates |
