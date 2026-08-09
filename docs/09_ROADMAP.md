# 09 — Development Roadmap

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Rule:** each phase has an entry gate, an exit gate, and a defined way to fail. A phase that cannot fail is not a phase, it is a wish.

Durations assume a small focused team (2–3 engineers, 1 designer, 1 product/ops lead, plus field ops from Phase 3). They are estimates for sequencing, not commitments.

---

## 1. Build order at a glance

```text
P0  Foundations & decisions        2–3 wks   ── approval gate ──
P1  Platform skeleton              3–4 wks
P2  Farmer supply side             3–4 wks
P3  Buyer demand side + engine     4–5 wks
P4  Order engine & money           4–5 wks
P5  Admin, ops & measurement       3–4 wks
──────────────────────────────────────────────  MVP LAUNCH (~19–25 wks)
P6  Pilot operation & calibration  12 wks    ── GO/NO-GO on the thesis ──
P7  Logistics productisation
P8  Economic intelligence
P9  Business marketplace (B2B)
P10 Langgol Supply
P11 Langgol Farm
P12 Langgol Credit
P13 Langgol Intelligence
P14 Infrastructure scale
```

The brief's twelve-phase plan is preserved in substance; it is resequenced so that **admin/ops and measurement ship before launch** (you cannot operate a pilot without them) and **logistics is productised only after its real cost is known**.

---

## 2. Phase 0 — Foundations and decisions (2–3 weeks)

Runs partly in parallel with P1. No code depends on it finishing, but launch does.

| Workstream                  | Deliverable                                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product decisions           | The seven remaining questions in [`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §9.2, answered                                                                                                                                                                                        |
| **Geography validation**    | `GeographyCandidateAssessment` completed for **Rajshahi** and at least one comparator, against all 11 criteria in [`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md) §2.1. Every cell sourced, dated, confidence-rated; unknowns recorded as unknown. Written recommendation and sign-off |
| Farmer pipeline             | 30–80 candidate farmers identified in the selected district                                                                                                                                                                                                                               |
| Legal                       | Written opinion on §7.1, §7.2, §7.4, §7.5 of [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md); entity, trade licence, TIN/BIN in progress                                                                                                                                           |
| **Payout rail**             | MFS/bank/provider onboarding **started** — long lead times, and T+0/T+1 settlement depends on it                                                                                                                                                                                          |
| Payments                    | Prepaid provider selection deferred until the custody review; COD operating procedure written                                                                                                                                                                                             |
| Baseline data               | `PriceObservation` collection **started** at `IN_PERSON_SURVEY` confidence — 30 days of baseline before the first order is a launch blocker                                                                                                                                               |
| **Pilot loss budget**       | Cap per category and period approved and recorded as `PilotBudget` (open decision Q1)                                                                                                                                                                                                     |
| **Measurement methodology** | `METHODOLOGY_VERSION` v1 written down: formulas, baseline matching rules, allocation method, counterfactual chain survey design                                                                                                                                                           |
| Design                      | Design system: tokens, typography (Bangla + Latin), components, farmer-app patterns tested with 3–5 real farmers                                                                                                                                                                          |
| Catalogue                   | 5–8 pilot SKUs with Bangla names, base units, perishability, shelf life, grade descriptors                                                                                                                                                                                                |

**Exit gate:** decisions recorded, geography assessed and selected, legal opinion received, baseline collection running, loss budget approved, methodology v1 signed off, design system approved.

---

## 3. Phase 1 — Platform skeleton (3–4 weeks)

Monorepo, Next.js app, Prisma schema and migrations, PostGIS and the generated geography column, seeded `AdminArea` tree and product catalogue, Auth.js phone-OTP with the SMS provider abstraction, session and role model, policy layer, i18n with bn/en catalogues, design system in code, CI (types, lint, unit, migration check, Lighthouse budgets), staging environment, structured logging and error tracking, the `Money` and `Quantity` domain packages **with full test coverage**, and the **channel-agnostic notification/intent abstraction** ([`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §8.1).

Also in P1: `PlatformConfig` with versioning, seeded with `commission.bps = 300` and the delivery tariff structure — so no rate is ever a literal, from the first commit.

**Exit gate:** a user can sign up by phone, pick a role, set an address from the hierarchy, and switch language. Money arithmetic is 100% covered. No business rate appears as a literal anywhere in the codebase. CI is green and enforcing budgets.

**Why money first:** every later phase depends on it, and it is the cheapest thing to get right early and the most expensive to fix late.

---

## 4. Phase 2 — Farmer supply side (3–4 weeks)

Farmer profile and verification workflow with document upload; farm creation with map pin **and** hierarchical fallback; listing creation, edit, publish, pause; image upload with resize and EXIF stripping; inventory model with reservations; listing lifecycle sweeps; farmer dashboard; ops-agent assisted creation with attribution; Bangla-first farmer UI.

**Exit gate:** a real farmer, with a field agent present, completes signup → verification → farm → published listing **on their own phone in under 10 minutes**, in Bangla, on a 3G connection. Tested with at least five real farmers, not with the team.

That last sentence is the actual gate. Internal demos prove nothing about this audience.

---

## 5. Phase 3 — Buyer side and the delivered-cost engine (4–5 weeks)

Consumer **and retailer** profiles and addresses; radius discovery on the GIST index; the delivered-cost engine and ranking ([`04_MARKETPLACE.md`](04_MARKETPLACE.md) §4–5); the tariff and the **six delivery funding models** in `PlatformConfig`; explainable results; listing detail with the full price breakdown (product + delivery + applicable charges, no marketplace fee line); search and filters with bilingual/transliteration tolerance; cart; quote generation and TTL; retailer bulk quantities and wholesale-referenced comparison; checkout up to (not including) order creation.

**Exit gate:** the §7 worked example of [`04_MARKETPLACE.md`](04_MARKETPLACE.md) is reproduced by the engine — including the ranking inversion at the arithmetic break-even — as an automated test, with the break-even derived from configured values rather than asserted as a constant. All six funding models produce splits that sum to the tariff. Discovery meets the performance budget on a mid-tier Android device.

---

## 6. Phase 4 — Order engine and money (4–5 weeks)

The order state machine and every transition in [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §3; **fault attribution** on every terminal non-happy state; atomic reservation; idempotency at both layers; the double-entry ledger with the balance trigger; **COD provider live, mock provider for dev/test, prepaid built to the interface and hard-disabled by config**; refunds with fault-based cost bearing; **cancellation fee allocation defaulting to farmer compensation**; **`DeliveryTrip` with ops cost capture and allocation**; **settlement build at T+0/T+1 with risk tiers and the `PayoutProvider` rail abstraction**; delivery records with proof and OTP; the outbox and SMS notifications; timer sweeps; the dispute flow.

**Exit gate:** the full E2E journey passes — list → discover → quote → order → accept → prepare → deliver → **trip costed** → complete → settle — with the ledger balanced, idempotency proven under replay, and the two-buyers-one-crate concurrency test green. Every funding model, every fault party and every cancellation path posts the correct journal. The mock provider is proven unregistrable in production and prepaid is proven unreachable while disabled. Ledger reconciliation controls run and pass on synthetic data.

---

## 7. Phase 5 — Admin, ops and economic measurement (3–4 weeks)

**Admin/ops:** verification queue; listing moderation; order operations and force-cancel with mandatory fault and reason; dispute resolution with fault attribution; settlement approval with segregation of duties; refund approval; `PlatformConfig` editing with versioning; audit log search; per-agent COD float reconciliation; daily reconciliation reports and alerting.

**Economic measurement ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md)) — core capability, not a dashboard:**

- `PriceObservation` capture tooling for field agents: fast mobile entry, evidence photo, offline-tolerant, confidence and collection method required
- Baseline resolution engine with the matching and degradation rules, writing frozen `BaselineSnapshot` rows
- `OrderEconomics` computation job, immutable, methodology-versioned
- Trip costing UI for ops, with the uncosted-trip queue
- Segment matrix reporting: basket band × delivery model × distance band × district × buyer segment
- Experiment registry and stratum tagging
- Loss-budget monitor with the 50/75/90/100% controls, and the **budget guard wired into the quoting path**
- Daily ops report: negative-margin orders, missing subsidy reasons, baseline coverage, uncosted trips
- Gate scorecard against §10 of `10_ECONOMIC_MEASUREMENT.md`

**Exit gate:** ops can run a full day of business — verify a farmer, moderate a listing, resolve a dispute, approve a settlement, reconcile agent float, cost a trip, record baseline prices — without an engineer. An `OrderEconomics` record is produced end-to-end for a synthetic order and reconciles to the ledger to the poisha. The budget guard is proven to refuse a subsidised quote at 100% consumption. The security checklist in [`07_SECURITY.md`](07_SECURITY.md) §13 is complete. Backup restore has been rehearsed.

This phase is a week longer than originally scoped, because measurement moved from "analytics we add later" to "the instrument the pilot depends on".

**→ MVP LAUNCH**

---

## 8. Phase 6 — Pilot operation and calibration (12 weeks, mostly not engineering)

Onboard farmers, consumers and retailers; run real transactions; record **actual** cost on every trip; collect baseline prices continuously; weekly calibration of the circuity factor, tariff, spoilage rates and ranking weights; weekly farmer and buyer interviews; fix what breaks.

Engineering during this phase is deliberately small: bug fixes, ops tooling, calibration. **Resist building features.** The pilot's product is _evidence_.

### 8.1 The experiments that run during the pilot

| Experiment         | Design                                                                                                                                                                | What it answers                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Basket size**    | Observational strata across 8 bands, 0–5 kg to 500+ kg, crossed with delivery model and distance                                                                      | At what basket size do Langgol's delivered economics become competitive? **The threshold is measured, never assumed** |
| **Delivery model** | `INDIVIDUAL` · `AGGREGATED_ROUTE` · `RETAILER_BULK` · `PICKUP`, costed separately; randomised between individual and aggregated where both are operationally eligible | Does aggregation actually cut cost per order, and at what order density does it start to?                             |
| **Buyer segment**  | Consumer vs retailer, on identical metrics with segment-appropriate baselines                                                                                         | Which segment carries the delivery economics?                                                                         |
| **Funding model**  | Cost-recovering vs subsidised vs pickup, within the loss budget                                                                                                       | What does demand actually respond to, and at what cost per incremental order?                                         |

Guardrail metrics — completion rate, dispute rate, farmer uplift — halt any experiment that improves margin by degrading the thing we exist to improve.

### 8.2 Exit gate — the go/no-go on the entire thesis

Full gate set in [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §10, evaluated on ≥100 completed orders, **reported per segment as well as in aggregate**. Headlines:

| Group      | Gate                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Farmer     | Median uplift > 0 net of commission on ≥2 independent baselines · fulfilment ≥90% · repeat seller ≥40% · retention ≥50%                      |
| Consumer   | Delivered price ≤ reference retail in ≥1 viable segment · 30-day repeat ≥25% · buyer-attributable cancellations ≤10% · median rating ≥4.0    |
| Retailer   | Repeat ≥60% · basket size stable or growing · supplier retention ≥30%                                                                        |
| Logistics  | Cost per order and per kg declining · utilisation ≥50% on aggregated routes                                                                  |
| Platform   | Positive contribution margin in ≥1 segment, or a written model at 3× density · loss budget respected · every negative-margin order explained |
| **Thesis** | Farmer realisation **and** competitive delivered price simultaneously, on **≥25% of completed orders** in a repeatable, reachable segment    |

**If the thesis gate passes:** the deliverable is a written characterisation of _which_ transactions work — basket band, delivery model, distance, product, segment, season — with the numbers. That becomes the expansion strategy.

**If it fails:** the deliverable is a written diagnosis of _what must change_ — density, basket size, delivery cost structure, crop mix, commission, or the thesis. Do not proceed to Phase 7. Re-run with one variable changed. Adding features to a marketplace that does not create value makes a bigger marketplace that does not create value.

---

## 9. Phase 7 — Logistics productisation

_Entry gate: Phase 6 passed, ≥200 deliveries of real cost data._

Logistics provider role and onboarding; vehicle and capacity registration; job offer/accept; driver-facing delivery flow; route grouping and pooled dispatch; delivery pricing calibrated to measured cost; live tracking; pickup points and route days; cold-chain flags for high-perishability produce.

**Exit gate:** delivery cost per kg falls measurably versus the pilot baseline, and `allocationShare` < 1.0 is justified by observed pooling rather than assumed.

This is where the 5 kg consumer economics of [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §7.1 either become viable or are honestly retired in favour of retailer-led volume.

---

## 10. Phase 8 — Economic intelligence

Farmer earnings analytics and price history; buyer price comparison and savings evidence; regional supply/demand views; a public agricultural price index built from `PriceObservation` plus platform transactions; ecosystem impact reporting with stated methodology and uncertainty.

**Exit gate:** every published economic claim traces to stored data with a documented method. Nothing is published that cannot survive being audited.

---

## 11. Phase 9 — Business marketplace (B2B)

Retailer, restaurant and institutional buyer profiles; bulk order flows; RFQ and quotation; negotiation; recurring supply arrangements and contracts; multi-farmer aggregation into one delivery; invoicing, credit terms (commercial, not financial-credit), and supplier performance scorecards.

**Exit gate:** repeat institutional buyers generate a majority of GMV — the volume that makes logistics economics work.

---

## 12. Phase 10 — Langgol Supply

_Entry gate: dealer-licensing analysis complete ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.10)._

Input supplier role with licence verification; catalogue with `requiresLicence` handling; regulated-product gating by category and by seller licence; equipment rental and labour marketplace; storage/warehouse booking.

**Exit gate:** no regulated product is purchasable from an unverified, unlicensed seller — proven by test, not by policy.

---

## 13. Phase 11 — Langgol Farm

Farm plots; crop cycles with planting and harvest records; expense and income tracking; expected-harvest listings created from crop cycles; weather integration; simple advisory content.

**Exit gate:** farmers voluntarily maintain crop records — which is a high bar, and the honest test of whether this product earns its place. If they don't, the data it would produce isn't real anyway.

---

## 14. Phase 12 — Langgol Credit

_Entry gates, all mandatory:_

1. Written legal opinion on structure and licensing ([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.4)
2. A regulated financial partner under contract, **or** the appropriate licence held
3. ≥12 months of transaction history for the target cohort
4. A validated risk model, back-tested on real repayment behaviour

Credit account, limit, drawdown, repayment; restricted-purpose spending inside Langgol Supply only; automatic repayment netted against settlement; delinquency handling designed with an explicit ethical policy for smallholder hardship; partner reporting and reconciliation.

**Non-negotiable:** not a cryptocurrency, not a general wallet, not cash-out-able, no unlicensed lending. Any of these being violated is a stop-work condition, regardless of commercial pressure.

---

## 15. Phase 13 — Langgol Intelligence

Price and demand forecasting (requires ≥1 full annual cycle); crop recommendation; yield prediction; disease detection from images; a farmer AI assistant; logistics optimisation; fraud detection.

**Standing rules:** every model output carries an explicit uncertainty statement; no probabilistic output is presented as guaranteed agronomic advice; a farmer must always be able to see why a recommendation was made; models are evaluated on farmer outcomes, not on offline accuracy metrics.

---

## 16. Phase 14 — National infrastructure

Government and NGO partnerships; research collaboration; insurance partnerships; warehouse network; export facilitation; open agricultural data products.

---

## 17. Risk register

| #   | Risk                                                                                 | Likelihood        | Impact        | Mitigation                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | ----------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Delivery cost exceeds the margin available** — the classic agri-marketplace killer | High              | Fatal         | Measure actual cost from day one; retailers first; pickup points; route days; honest go/no-go gate                                              |
| R2  | Farmers list but do not respond to orders                                            | High              | Severe        | Quiet-hours-aware windows; SMS-first; agent support; reliability scoring; onboard farmers who want this, not everyone                           |
| R3  | Insufficient density → no liquidity                                                  | Medium            | Severe        | One district, few SKUs, deliberate concentration                                                                                                |
| R4  | Buyers try once and do not return                                                    | Medium            | Severe        | Quality consistency; reliable delivery; repeat rate as a gate metric, not a vanity metric                                                       |
| R5  | Quality disputes at scale                                                            | Medium            | High          | Grade descriptors; photos; tolerance bands; fast fair resolution; fault attribution                                                             |
| R6  | Regulatory blocker on payments or fund custody                                       | Medium            | High          | COD-first launch; licensed partner for prepaid; legal opinion in Phase 0                                                                        |
| R7  | Payment provider onboarding delay                                                    | High              | Medium        | Start in Phase 0; COD covers launch                                                                                                             |
| R8  | SMS deliverability or cost                                                           | Medium            | Medium        | Multi-aggregator abstraction; per-operator monitoring; budget circuit breaker                                                                   |
| R9  | Fraud (fake farmers, collusion, payout redirection)                                  | Medium            | High          | Verification; payout-change protections; settlement holds; audit                                                                                |
| R10 | Field-agent capacity limits growth                                                   | High              | Medium        | Agent tooling as a first-class product; measure agent throughput per farmer onboarded                                                           |
| R11 | Monsoon disruption                                                                   | Certain, seasonal | Medium        | Serviceability flags per corridor; seasonal expectations in the plan; do not mistake a flood for a product failure                              |
| R12 | Price volatility making baselines noisy                                              | High              | Medium        | Continuous baseline collection; seasonally matched comparisons; state uncertainty                                                               |
| R13 | Team builds features instead of measuring                                            | **High**          | **Severe**    | Phase 6 is explicitly a non-building phase; gates are quantitative                                                                              |
| R14 | Pressure to launch credit early                                                      | Medium            | Fatal (legal) | Hard entry gates in §14; stop-work condition                                                                                                    |
| R15 | **Ops does not cost trips**, so economics are never computed                         | High              | Severe        | Uncosted-trip queue in the daily report; costing blocks measurement rather than being replaced by an estimate; ops accountability from day one  |
| R16 | **Baseline coverage is too thin** to support any claim                               | Medium            | Severe        | 30 days of pre-launch collection; coverage reported weekly as a first-class metric; unmatched orders excluded from claims rather than estimated |
| R17 | Loss budget consumed early, subsidies disabled, volume collapses                     | Medium            | Medium        | Budget guard is a control, not a surprise; thresholds escalate at 50/75/90%; pickup and retailer volume remain unsubsidised paths               |
| R18 | T+0/T+1 settlement creates clawback exposure                                         | Medium            | Medium        | Risk tiers; hard holds; COD reconciliation gate; clawback ceiling with human escalation                                                         |
| R19 | Payout rail onboarding (MFS/bank) slips past launch                                  | Medium            | High          | Started in P0; agent cash is the accepted bootstrap; per-farmer rail so a partial rollout still works                                           |
| R20 | Rajshahi assessment is completed to justify a decision already made                  | Medium            | High          | Assessment requires a comparator district, sourced cells, recorded unknowns, and sign-off before the pilot begins                               |

R13 is the one that most often goes unmanaged, and it is the one most within our control. R15 is its operational twin: a pilot whose central instrument quietly stops being fed produces confident conclusions from partial data, which is worse than no conclusions.

---

## 18. What "done" means for the MVP

Not "the site is live". Done is:

> A real farmer in the pilot district listed real produce, a real nearby buyer purchased it, Langgol computed the transaction correctly, the goods were delivered, the trip's real cost was recorded, the money reconciled to the poisha, the farmer was paid at T+0/T+1 — and we can show, **from stored data with a stated methodology, a named baseline, a sample size and a confidence level**, whether both sides were better off, and on which kinds of transaction.

Everything in [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) §4 grows from that, or does not deserve to.

**The Langgol test for any feature, at any phase:** _does this make agriculture work better for the farmer, the buyer, or both — and can we show it?_ If the answer is no, or unmeasurable, it does not belong in the MVP.
