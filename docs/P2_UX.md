# P2 — UX and Information Architecture

> **Status:** Design proposal · **Baseline:** [`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) §9,
> [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md), and the P1 design system.

---

## 1. Navigation

**Farmer** (Bangla default) — Home · আমার খামার · আমার ফসল · আমার বিজ্ঞাপন · অর্ডার · আয় · প্রোফাইল · সাহায্য

**Consumer** — Home · ফসল খুঁজুন · অর্ডার · পছন্দ · প্রোফাইল · সাহায্য

**Retailer** — Home · কিনুন · অর্ডার · সরবরাহ · প্রোফাইল · সাহায্য

**Ops agent** — deliberately minimal, and a work queue rather than a dashboard: Onboarding queue ·
Verification queue · Today's routes · Uncosted trips · Price observations due.

Five to seven destinations each. P2 is not a dashboard-building exercise.

---

## 2. Key screens

| Screen               | The one thing it must get right                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Farmer home          | **Today: orders needing a response**, and money arriving. Nothing else above the fold           |
| Create listing       | Product → quantity → price → when. Four steps, big targets, recent products first               |
| Order inbox          | Accept / Reject as two large buttons, with the amount the farmer will receive                   |
| Earnings             | Gross, commission, net, settlement status — traceable to the ledger, never recomputed in the UI |
| Discovery            | **Delivered price per kg**, distance, freshness, farm name — in that order                      |
| Listing detail       | The full breakdown: product + delivery + handling = total. No hidden line                       |
| Checkout             | One screen: address, fulfilment, quote, confirm                                                 |
| Order tracking       | Current state in plain words and the expected window                                            |
| Route assembly (ops) | Drag orders onto a route; running total of drops and load                                       |

---

## 3. Farmer UX principles

The farmer app is judged against one user: a ৳9,000 Android phone, sunlight, limited literacy in
English, a connection that drops.

- **Minimal typing.** Product from a picker with recent items first; quantity with a stepper;
  price with the last-used value pre-filled.
- **Local units accepted on input.** `২ মণ` parses. Stored metric, displayed in the farmer's unit.
- **Progressive disclosure.** Grade, variety and photos are optional and come after the listing
  exists.
- **Numbers over prose.** A farmer scanning for "how much will I get" should find one large figure.
- **Confirm anything financial in SMS too**, because the screen may be someone else's phone.
- **Never optimistic UI on money.** A farmer must not see "order accepted" that later evaporates.
- **Drafts survive a dropped connection.** Form state is preserved; nothing destructive is lost to
  a failed request (idempotency).

---

## 4. Bangla-first

Bangla is the default on every farmer and buyer surface, English is the toggle, and the brandmark
is **লাঙ্গল** — the plough. Line-height is looser than Latin at every step; body text never below
16px; touch targets 48px; button labels short enough not to wrap at 320px. Bangla numerals are a
**user preference**, not a consequence of the interface language.

Errors say what to do next, not only what failed. `"নম্বরটি ঠিক নেই। ১১ সংখ্যার নম্বর দিন, ০১ দিয়ে শুরু।"`

---

## 5. Consumer and retailer UX

**Consumer** — the whole journey must survive a distracted person on a bus: product, nearby supply,
one clear delivered total, confirm. The farmer's name and the harvest date carry the trust; the
breakdown carries the honesty.

**Retailer** — quantity entry that accepts _mon_, comparison against a wholesale reference, and
repeat-last-order. Retailers are ordering weekly, so speed of reorder beats discovery polish.

---

## 6. Privacy — who sees what

|                                 | Buyer sees              | Farmer sees            | Ops sees | Admin sees      | Public                 |
| ------------------------------- | ----------------------- | ---------------------- | -------- | --------------- | ---------------------- |
| Farm name, union/upazila        | ✓                       | own                    | ✓        | ✓               | ✓ (published listings) |
| **Exact farm coordinates**      | **✗ until `CONFIRMED`** | own                    | ✓        | ✓               | ✗                      |
| Farmer phone                    | ✗ until `CONFIRMED`     | own                    | ✓        | ✓               | ✗                      |
| Buyer name / phone              | own                     | ✗ until `CONFIRMED`    | ✓        | ✓               | ✗                      |
| Buyer exact address             | own                     | only after `CONFIRMED` | ✓        | ✓               | ✗                      |
| NID / documents                 | ✗                       | own (submitted)        | **✗**    | ✓ (review only) | ✗                      |
| Payout account                  | ✗                       | own                    | **✗**    | masked          | ✗                      |
| Farmer ratings, fulfilment rate | ✓                       | own                    | ✓        | ✓               | ✓                      |
| Order economics                 | ✗                       | own summary            | ✗        | ✓               | ✗                      |
| Price observations              | ✗                       | ✗                      | ✓        | ✓               | aggregate only         |

**Location privacy matters most for farmers.** Precise coordinates plus a phone number is a
poaching and harassment kit. Discovery returns _distance and area_, never a point (ADR-27).

---

## 7. Accessibility and performance

WCAG 2.2 AA, contrast asserted in tests, semantic controls, labels wired by id, errors announced
without stealing focus, keyboard reachable, focus never suppressed, reduced-motion honoured.

Budgets carried from P1: ≤150 KB gzip JS on discovery, listing and checkout; LCP under 2.5 s on
emulated Fast-3G mid-tier Android; images resized at upload with EXIF stripped — a farmer's photo
carries GPS coordinates that are location PII.

**Every screen has loading, error, empty and success states.** No exceptions; this is where a slow
network makes or breaks trust.
