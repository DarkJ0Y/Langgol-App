# 08 — Bangladesh Context

> **Status:** Approved 2026-08-10 (decisions D1–D10)
> **⚠️ Legal disclaimer:** §7 is an engineering-facing register of regulatory areas that **affect architecture**. It is not legal advice, and statutes in Bangladesh have changed repeatedly in recent years. Every item must be confirmed with a qualified Bangladeshi lawyer and tax adviser before launch. The engineering value of this section is that it tells us **what to build hooks for**, not what the law currently says.

---

## 1. Language and literacy

- **Bangla is the default**, not a translation layer added later. Farmer surfaces launch Bangla-first; English is the toggle.
- Bangla text is taller than Latin — line-height, button heights and truncation must be tested in Bangla, not designed in English and "translated". Bangla strings commonly run 20–40% longer.
- **Numerals:** Bangla digits `০১২৩৪৫৬৭৮৯` for `bn`, with a user preference — many users read prices more comfortably in Western digits even when the interface is Bangla. Money formatting must support both; the ledger is unaffected.
- Currency symbol `৳` precedes the amount.
- **Literacy is a spectrum.** Design for a user who reads slowly: icons paired with words, no jargon, no English loanwords where a common Bangla word exists, numbers over prose, voice/SMS confirmation of anything financial.
- Avoid formal *sadhu bhasha*; use plain spoken register.

---

## 2. Geography and addressing

**Hierarchy:** Division (8) → District/*zila* (64) → Upazila (~495) → Union (~4,500) → Ward/Village. City areas use City Corporation → Ward → Mahalla instead.

Architectural consequences:

- The `AdminArea` tree is **primary**; the map pin is an enhancement, not a requirement ([`02_DATABASE.md`](02_DATABASE.md) §4)
- Many rural locations have no street address and no reliable postcode. "Village, union, upazila, near the X school" is a complete, usable address in practice — the schema supports `villageOrArea` + `landmark` as first-class fields
- `LocationPrecision` (`EXACT` / `APPROXIMATE` / `AREA_CENTROID`) records what we actually know, so distance-based pricing can widen its error bars honestly instead of implying metre accuracy from a union centroid
- Map literacy varies. "Drop a pin" is not universally intuitive; the hierarchical picker must be a complete alternative path, never a fallback that loses features
- Union-level centroids must be seeded for the pilot district before launch, or every distance calculation is guesswork

**Roads.** Haversine distance underestimates real travel meaningfully in the delta: rivers, ferry crossings, and roads that follow embankments. A district-configurable circuity factor (default 1.30) is applied and its error is measured against actual trips ([`04_MARKETPLACE.md`](04_MARKETPLACE.md) §3). During monsoon, some routes disappear entirely — route feasibility is seasonal, and the delivery module must be able to mark corridors unserviceable.

---

## 3. Devices, connectivity, cost

Target device: a low-cost Android phone (2–3 GB RAM, modest CPU, small storage) on 3G/4G that is often congested and frequently drops to 2G in rural areas. Data is bought in small bundles and is genuinely expensive relative to income.

Engineering consequences, all enforced in CI ([`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §9):

- Server-rendered first; JS budget ≤150 KB gzip on buyer/farmer pages
- Images aggressively resized at upload; a 48 MP farmer photo must never be served raw
- Every network call must be safe to retry — **assume the connection drops mid-request** (this is the practical reason idempotency is not optional)
- Forms preserve state across a failed submit
- Storage-light: no large client caches, no heavy offline database at MVP
- **SMS is the reliable channel.** It works with no data balance, on any handset, and is what users actually check. Push and in-app are secondary
- Prefer few, large, decisive screens over many small ones — each navigation is a round trip on a slow link

---

## 4. Phone numbers, SMS, identity

- National format: 11 digits beginning `01`; E.164 `+8801XXXXXXXXX`. Validate operator prefixes and normalise on input; users will type `01712-345678`, `+88 01712 345678`, and `1712345678`
- Multiple operators, and SIM-swapping between them is routine. Phone number ≠ stable identity: a user may lose a number, and account recovery must be designed for that reality with human-assisted verification, not an automated dead end
- **Shared phones are common** in rural households. One number may serve several people. Consequences: collusion detection must not auto-ban on shared-device signals ([`07_SECURITY.md`](07_SECURITY.md) §8.2), and financial confirmations should name the person and the amount, not assume the reader is the account holder
- SMS delivery is routed via local aggregators; delivery rates and latency vary by operator and time of day. Monitor delivery success **per operator** — a silent failure on one carrier looks like "farmers are ignoring orders"
- Bangla SMS uses Unicode and costs more per message (fewer characters per segment). Templates must be length-audited in Bangla, and an English-transliteration fallback should be available per user preference
- **National ID (NID)** is the standard identity document. Electronic verification against the national database requires a formal agreement; until then, verification is document + human review. NID data is highly sensitive ([`07_SECURITY.md`](07_SECURITY.md) §9)

---

## 5. Units and measures

| Unit | Approx. metric | Notes |
|---|---|---|
| **Seer** | ≈ 0.933 kg | Still used conversationally |
| **Mon / maund** | ≈ 37.32 kg (40 seer) | The default unit for wholesale produce trade |
| **Kg / quintal / tonne** | metric | Legal and official standard |
| **Decimal / shotangsho** | 1/100 acre ≈ 40.5 m² | Standard land unit |
| **Katha** | varies regionally | ~1.65 decimal in many areas |
| **Bigha** | **varies regionally**, commonly ~33 decimal | Never assume a single conversion — store land in decimals and let the UI convert with a region-aware, clearly-labelled factor |

Design consequences:

- **Store everything in metric base units**; offer local units as *input and display conveniences* with an explicit, visible conversion ([`02_DATABASE.md`](02_DATABASE.md) §6)
- Weights-and-measures law requires metric for trade, so invoices, statements and the authoritative order record are metric. Showing "1 mon (37.32 kg)" is a UI affordance layered on a metric record
- Bigha ambiguity is a genuine data-quality trap: a farmer entering "2 bigha" means different areas in different districts. Prompt for decimals, or capture the district-specific factor and store what was used

---

## 6. Agricultural market structure — what we are actually competing with

A typical vegetable chain:

```text
Farmer → Foria (village collector) → Bepari (trader) → Aratdar (commission agent
       at the wholesale market) → Paikar (wholesaler) → Retailer → Consumer
```

Each hop adds transport, handling, commission and loss. Farmer share of the final consumer price for vegetables is **commonly reported in the range of roughly 40–60%**, varying widely by crop, season, distance and perishability.

> **Treat that range as a hypothesis to be re-measured in the pilot district, not as a fact to build a business plan on.** It is precisely what `PriceObservation` exists to establish ([`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §7.1).

**What the existing chain does well, and what Langgol must therefore replicate or replace:**

| Function | Why farmers use it | Langgol's answer at MVP |
|---|---|---|
| Immediate cash at the farm gate | No waiting, no paperwork | Settlement speed matters more than settlement elegance. T+0/T+1 beats a better price paid in a week |
| Takes the whole lot, including poor grades | No sorting burden, no leftovers | Grading and partial-lot risk sit with the farmer on Langgol — a real friction to design for |
| Pre-harvest advances (*dadon*) | Working capital when nothing else exists | Nothing at MVP. This is the gap Langgol Credit eventually fills, and the honest reason some farmers will stay with the *bepari* |
| Transport arranged | Farmer doesn't move the goods | Pickup and ops-coordinated delivery |
| Trust through long relationships | Enforcement without contracts | Ratings, verification, dispute resolution, and — crucially — **paying on time, every time** |

**Strategic reading:** Langgol's realistic early wedge is not "replace the *bepari*". It is **transparency plus a better price for the portion of the harvest a farmer can afford to sell on a slightly slower cycle** — and reliability so consistent that the share grows. Attacking the *dadon* relationship without a credit product is attacking the one service we cannot yet provide. This is the operational meaning of §7 of [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md).

---

## 7. Regulatory register (verify each with counsel)

Columns: what it governs · why it matters to Langgol · what we build now.

### 7.1 Payments and settlement
**Area:** Payment systems legislation and Bangladesh Bank Payment Systems Department circulars, including the licensing regime for payment system operators and payment service providers.
**Why it matters:** collecting buyers' money and passing it to sellers is payment aggregation. Doing that for third parties typically requires a licence or the use of a licensed partner.
**Build now:** the three custody models in [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §11, selectable by configuration; launch COD-first; never hold prepaid funds outside a licensed partner's rails without written legal clearance.

### 7.2 Digital commerce rules
**Area:** the Ministry of Commerce digital-commerce operation guidelines and subsequent amendments.
**Why it matters:** these have imposed obligations on marketplaces around **escrow of advance payments until delivery**, maximum delivery timelines, refund timelines, mandatory seller disclosure, and complaint handling. They are directly binding on a marketplace of this shape.
**Build now:** delivery-confirmation-gated fund release (already the ledger design), configurable delivery and refund SLA timers, seller identity displayed on listings, an in-product complaint path with recorded timestamps, and exportable evidence of compliance.

### 7.3 Consumer protection
**Area:** consumer rights protection law and the national consumer rights directorate.
**Why it matters:** misdescription, short weight, and false claims carry penalties. Weight accuracy in fresh produce is a live risk for us.
**Build now:** truthful quantity/quality descriptors, delivered-vs-ordered weight recorded on every order, a dispute system with evidence, and the §11 honesty constraint of [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) enforced in the data model.

### 7.4 Lending and financial services
**Area:** banking, non-bank financial institution, and microcredit regulatory law.
**Why it matters:** lending money or providing credit to farmers without the applicable licence is prohibited. This is the single hardest constraint on Langgol Credit, and no amount of product framing changes it.
**Build now:** nothing that constitutes credit. The ledger primitives in [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §12, and underwriting data accumulation. **Phase 12** begins with a written legal opinion and a regulated partner, or it does not begin.

### 7.5 Tax and VAT
**Area:** VAT and supplementary duty law, income tax law, National Board of Revenue rules on e-commerce and marketplaces.
**Why it matters:** VAT arises on Langgol's commission/service fee under the agency model; unprocessed agricultural produce is generally treated favourably but **the platform's service is not automatically so**. Withholding obligations may apply to payments made to sellers. BIN/VAT registration and record retention are required.
**Build now:** accounts `2030` and `2040`, per-settlement deduction fields, BIN/TIN capture on business profiles, immutable invoices and settlement statements, exportable tax reports. Rates are configuration, set by an adviser.

### 7.6 Data protection and cyber law
**Area:** the cyber security statute currently in force (this area has been amended repeatedly — its current form must be confirmed), and Bangladesh's personal data protection framework, which has been in draft for several years.
**Why it matters:** we hold NID images, phone numbers, precise locations and financial history for a vulnerable population. A future data-protection regime is likely to impose consent, minimisation, breach notification and possibly **data localisation**.
**Build now:** the classification and controls in [`07_SECURITY.md`](07_SECURITY.md) §9; Bangla consent text; data export and deletion; and a **hosting decision that keeps in-country or regional data residency achievable** rather than assuming it will never be required.

### 7.7 Agricultural marketing
**Area:** agricultural marketing legislation administered by the Department of Agricultural Marketing, which provides for licensing and regulation of agricultural market intermediaries.
**Why it matters:** Langgol is, functionally, an agricultural market intermediary. Licensing, price reporting or record-keeping obligations may apply.
**Build now:** clean, exportable transaction records by product, area and period; the `PriceObservation` dataset (which is also a cooperation asset with DAM); and a business-entity setup discussion with counsel **before** the pilot, not after.

### 7.8 Food safety and quality
**Area:** food safety law and the national food safety authority; BSTI standards.
**Why it matters:** handling, storage and any quality or "organic" claim carry obligations. Cold chain, once introduced, raises the bar further.
**Build now:** grade descriptors that are descriptive rather than certified; **no organic/pesticide-free claim without a verifiable basis** — a badge we cannot substantiate is both a legal and a trust liability; traceability from listing to order, which we get for free from the schema.

### 7.9 Weights and measures
**Area:** standards of weights and measures law; BSTI.
**Why it matters:** trade must use metric units; measuring instruments used for trade are subject to verification.
**Build now:** metric authoritative records (§5); local units as display only; weighing at delivery recorded; scale accuracy an ops procedure with a documented calibration routine.

### 7.10 Agricultural inputs (Phase 10 — Langgol Supply)
**Area:** seed, fertilizer and pesticide legislation and the associated dealer licensing administered through agricultural authorities.
**Why it matters:** selling fertilizer, seed or crop-protection products requires dealer licences and product registration. This is not a matter of adding a product category to the catalogue.
**Build now:** nothing. Design the catalogue so a product can carry `requiresLicence`, `licenceType` and seller-licence verification when the time comes.

### 7.11 Corporate and operating
Company registration, trade licence, TIN, VAT/BIN registration, and any e-commerce-specific business identity registration. Employment and contractor status for field agents and couriers. Insurance for goods in transit. All are launch prerequisites for the operating entity, not for the codebase — but the codebase must be able to print what an auditor asks for.

---

## 8. Payments landscape

- **Cash on delivery dominates** consumer e-commerce. It is not a legacy fallback; it is the default expectation, and it is why COD is a first-class citizen in the ledger ([`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §5.1)
- **Mobile financial services** (bKash, Nagad, Rocket and others, regulated by Bangladesh Bank) have very wide reach, including rural. Agent-assisted cash-in/cash-out is the norm. Per-transaction and per-month limits apply and vary — the payout module must handle a farmer's monthly receiving limit being reached
- **Payment gateways** (SSLCommerz, aamarPay, ShurjoPay and others) aggregate cards, MFS and internet banking behind one integration — usually the fastest route to prepaid support without direct MFS merchant onboarding
- **Farmer payouts** are the harder half, and the approved target is **T+0/T+1 after successful delivery** (decision D5). Rail options, all behind one `PayoutProvider` interface:

| Rail | Speed | Cost | Constraints |
|---|---|---|---|
| **MFS disbursement** | Minutes | Per-transaction fee | Per-transaction and monthly **receiving limits** — a productive farmer can hit them mid-season; the adapter must detect and route around this |
| **Bank transfer** | Hours to a day | Cheap at volume | Many smallholders have no account; name-mismatch failures are common |
| **Regulated payment provider** | Varies | Contracted | Requires partner onboarding; the likely destination rail |
| **Agent cash** | Immediate | High ops cost | What farmers trust on day one. A **bootstrap, not the architecture** — it creates float risk and does not scale |

- **Launch posture:** COD collection; payout rail per farmer, agent cash accepted where it is what the farmer wants, with MFS onboarding pursued from P0 because lead times are long. Prepaid collection stays disabled until §7.1–7.2 are cleared (decision D4).
- **Design consequence:** the payout adapter must handle partial batch failure, receiving-limit rejection, and name mismatch as *expected* outcomes with a retry and an ops queue — not as exceptions. A farmer whose payout silently failed is a farmer who tells the village that Langgol does not pay.

---

## 9. Seasonality and the agricultural calendar

| Season | Months | Relevance |
|---|---|---|
| **Rabi** | Nov–Mar | Winter vegetables — peak volume, lowest prices, highest surplus and highest waste. The best window to prove farmer uplift |
| **Kharif-1 (pre-monsoon)** | Mar–Jun | Transition; heat stress; short shelf life |
| **Kharif-2 (monsoon)** | Jul–Oct | Low vegetable supply, high prices, **worst logistics** — flooding, impassable roads, ferry delays |

**Seasonal matching is mandatory in measurement.** A baseline observation from a different season is not a degraded match, it is a rejected one ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §4.4) — comparing a Rabi glut price to a monsoon scarcity price produces an uplift figure that means nothing.

Other cycles the product must respect: rice seasons (Aus, Aman, Boro) driving farm cash-flow and labour availability; **Ramadan** producing a sharp, predictable demand spike in specific commodities; Eid and other festivals shifting both demand and labour availability; cyclone and flood seasons causing genuine supply shocks.

Consequences: pilot timing materially affects results (launching in monsoon tests logistics at its worst); price-baseline comparisons must be **seasonally matched** or they are meaningless; forecasting features (Phase 11) need at least one full annual cycle of data before they can say anything honest.

---

## 10. Operational and cultural design notes

- **Trust is built by paying on time.** Every promise about settlement must be conservative and then kept. One late payment travels through a village faster than any marketing
- **Field agents are the product** in the early phase. Rural onboarding at scale is human work; the software's job is to make agents fast and their actions auditable ([`07_SECURITY.md`](07_SECURITY.md) §8.4)
- **Prayer times, market days and harvest hours** shape when farmers can respond. The quiet-hours rule on acceptance windows ([`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §4) is one instance of a general principle: never penalise a user for a schedule the product should have anticipated
- **Women's participation** in agriculture is significant and often invisible in registration data. Registration and verification must not implicitly assume the male household head; consider household-linked accounts and permit a female farmer's own payout destination
- **Photographs matter more than text** for low-literacy users, both for trust and for produce quality. Fast, forgiving photo capture with automatic compression is a core farmer-app feature, not a nice-to-have
- **Voice/IVR and USSD are deliberately out of MVP scope** (decision D8). The notification and farmer-interaction layers are built channel-agnostic so they can be added as adapters later ([`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §8.1). Reach data from the pilot decides whether they are worth building at all

---

## 11. Rajshahi as the default pilot candidate

Rajshahi is the **default candidate**, not a locked decision ([`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §2.1). What follows is qualitative context for why it is a sensible place to *start looking* — none of it substitutes for the assessment, and no figure below is asserted.

**Qualitative reasons to look here first**

- Rajshahi is an established agricultural region of north-west Bangladesh, and **Rajshahi City sits inside the same district as its surrounding farmland** — exactly the co-location of production and urban demand that short-haul economics require
- The region has a distinct agro-ecology (the Barind tract), so crop mix, irrigation and seasonality differ from the delta districts. That is useful: what works here will not automatically transfer, and knowing that early is better than discovering it at expansion
- Winter (Rabi) vegetable production in the north-west is significant, and Rabi is the season with the largest surplus and the highest waste — the best conditions in which to demonstrate farmer uplift

**What must be established by the assessment, not assumed**

Farmer density and crop concentration by upazila · urban household count within a serviceable radius · retailer and restaurant demand · farm-gate and retail prices by SKU with confidence · realistic vehicle hire rates · road conditions and river/ferry constraints on candidate corridors · order density · modelled contribution margin by basket band.

**Local factors that could change the answer**

- **Distance to the very large Dhaka demand pool.** Rajshahi's local demand must stand on its own; long-haul to Dhaka is a different business with different economics, and the pilot is not testing it
- **River and ferry crossings** on some corridors materially inflate real distance and time versus haversine — the district circuity factor must be measured, not inherited
- **Seasonal water availability** in the Barind affects which vegetables are viable in which months, which affects whether five to eight SKUs can sustain 90 days of continuous supply
- **Existing trader networks** in an established agricultural region are strong and long-standing. That is a competitive fact, not a market failure ([§6](#6-agricultural-market-structure--what-we-are-actually-competing-with)) — the pilot competes on transparency, reliability and prompt payment, not on displacing relationships

If the assessment shows another district with a materially better combination of spread, order density and modelled margin at comparable confidence, we go there instead. The default exists to stop the search from being open-ended, not to pre-empt the data.
