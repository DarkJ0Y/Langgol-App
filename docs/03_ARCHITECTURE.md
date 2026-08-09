# 03 — System Architecture

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Scope:** MVP build, designed for Phase 7–14 expansion without rewrite

---

## 1. Architectural principles

1. **The domain is framework-free.** Money, pricing, the order state machine and eligibility rules live in plain TypeScript with no Next.js, no Prisma, no React. They are unit-testable in milliseconds and survive any framework migration.
2. **The server is the only authority.** Prices, totals, roles, ownership, and state transitions are decided server-side, always. The client renders and requests; it never asserts.
3. **Every external service sits behind an interface we own.** Payments, SMS, storage, maps, geocoding. Provider choice must be a config change, not a refactor.
4. **Money moves only through the ledger.** No balance column anywhere is authoritative.
5. **Everything that changes state is idempotent** and emits an event.
6. **Configuration, not constants.** Fee rates, tariffs, windows and caps live in `PlatformConfig` with versions, and every order records the version it was priced under.
7. **Optimise for the slow phone on the weak network**, then for developer convenience.

---

## 2. Technology decisions

| Layer           | Choice                                                                               | Rationale                                                                                                                                    | Rejected alternative                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | **Next.js (App Router) + TypeScript strict**                                         | Server Components cut JS shipped to low-end Android; one codebase for buyer, farmer, admin; mature ecosystem                                 | SPA + separate API — doubles surface area and payload for no MVP benefit                                                                              |
| UI              | **React + Tailwind CSS + Radix primitives**                                          | Accessible primitives, no heavyweight component library, full control of visual language ([`00_PRODUCT_VISION.md`](00_PRODUCT_VISION.md) §9) | Full MUI/AntD — visual identity would be generic, bundle heavy                                                                                        |
| Database        | **PostgreSQL on Supabase + PostGIS**                                                 | Relational integrity is non-negotiable for money; PostGIS for radius search; managed ops                                                     | MongoDB — no transactional guarantees we can rely on for a ledger                                                                                     |
| ORM             | **Prisma**                                                                           | Type safety, migrations, good DX; raw SQL escape hatch for geo and ledger                                                                    | Drizzle is a fine alternative; Prisma chosen for team familiarity and migration tooling                                                               |
| Auth            | **Auth.js (NextAuth v5) with a custom phone-OTP provider, DB sessions**              | Bangladeshi users authenticate by phone, not email. OTP must route through a local SMS aggregator, which means we own the OTP flow anyway    | Supabase Auth — couples us to their user table and their SMS vendors; using Prisma alongside Supabase RLS creates two authorization models (see §6.3) |
| Validation      | **Zod** at every trust boundary                                                      | One schema for parse + type inference                                                                                                        | —                                                                                                                                                     |
| Background work | **Postgres-backed job/outbox table + a worker process**; a scheduler triggers sweeps | Zero extra infrastructure at MVP scale; transactional with the state change                                                                  | Redis/BullMQ — added only when volume demands it                                                                                                      |
| Cache           | **None at MVP**, except Next.js data cache                                           | Premature. Add Redis when a measured bottleneck exists                                                                                       | —                                                                                                                                                     |
| Object storage  | **Supabase Storage** behind a `FileStorage` interface                                | Private buckets + signed URLs; swappable for S3                                                                                              | Direct S3 — more setup, no MVP gain                                                                                                                   |
| Observability   | Structured JSON logs, request ids, error tracking (Sentry-class), Postgres metrics   | —                                                                                                                                            | —                                                                                                                                                     |
| Testing         | Vitest (unit), Playwright (E2E), Testcontainers-or-ephemeral-Postgres (integration)  | —                                                                                                                                            | —                                                                                                                                                     |
| Monorepo        | **pnpm workspaces + Turborepo**                                                      | Enforces the domain/infra boundary at package level                                                                                          | Single package — boundary erodes within weeks                                                                                                         |

### 2.1 Provider abstractions (the ones that matter)

```ts
interface PaymentProvider {
  readonly id: string
  createCharge(i: CreateChargeInput): Promise<ChargeResult> // idempotencyKey required
  capture(chargeRef: string, key: string): Promise<ChargeResult>
  refund(i: RefundInput): Promise<RefundResult>
  verifyWebhook(raw: Buffer, headers: Headers): WebhookVerification
}

interface PayoutProvider {
  // farmer settlement
  disburse(i: DisburseInput): Promise<DisburseResult>
  getStatus(ref: string): Promise<DisburseStatus>
}

interface SmsProvider {
  send(
    to: E164,
    template: TemplateId,
    vars: Record<string, string>,
    lang: Language,
  ): Promise<SmsResult>
}
interface FileStorage {
  putSigned(bucket, key, opts): Promise<SignedUpload>
  getSigned(bucket, key, ttl): Promise<string>
}
interface GeoProvider {
  distance(a: LatLng, b: LatLng, mode: 'HAVERSINE' | 'ROAD'): Promise<DistanceResult>
  geocode(q): Promise<LatLng | null>
}
```

MVP implementations: `MockPaymentProvider` (dev/test), `CashOnDeliveryProvider`, one real gateway/MFS provider, `LocalSmsProvider`, `SupabaseFileStorage`, `HaversineGeoProvider` (road distance behind a feature flag).

**Rule:** `MockPaymentProvider` is only registrable when `NODE_ENV !== 'production'`, enforced by a startup assertion that throws. Fake production payment behaviour is a data-integrity incident waiting to happen.

---

## 3. Repository layout

```text
langgol/
├── apps/
│   └── web/                          # ONE Next.js app for MVP (see §3.1)
│       ├── app/
│       │   ├── (marketing)/          # public landing
│       │   ├── (buyer)/              # discovery, listing, cart, checkout, orders
│       │   ├── (farmer)/             # farm, listings, order inbox, earnings
│       │   ├── (admin)/              # verification, moderation, orders, settlement, analytics
│       │   ├── api/
│       │   │   ├── webhooks/[provider]/route.ts
│       │   │   └── internal/cron/[job]/route.ts
│       │   └── actions/              # server actions — thin: authn → zod → use case → result
│       ├── components/
│       └── middleware.ts             # session, locale, security headers, rate-limit hooks
│
├── packages/
│   ├── domain/                       # ⭐ pure: NO framework, NO db, NO io
│   │   ├── money/                    # Money value object, rounding, allocation
│   │   ├── quantity/                 # base-unit conversion, sale units
│   │   ├── pricing/                  # delivered-cost engine + ranking + funding models (04)
│   │   ├── orders/                   # state machine, guards, fault attribution (05)
│   │   ├── ledger/                   # journal builders, invariants (06)
│   │   ├── economics/                # ⭐ measurement formulas, baselines, allocation (10)
│   │   ├── experiments/              # strata derivation, variant assignment (10 §8)
│   │   └── policy/                   # authorization predicates (07)
│   ├── application/                  # use cases: orchestrate domain + ports, own transactions
│   │   ├── ports/                    # interfaces from §2.1 + repositories
│   │   └── usecases/                 # placeOrder, acceptOrder, cancelOrder, publishListing, ...
│   ├── infrastructure/               # adapters: prisma repos, providers, jobs, outbox dispatcher
│   ├── db/                           # prisma schema, migrations, seed
│   ├── ui/                           # design system: tokens, primitives, patterns
│   ├── i18n/                         # bn/en message catalogues, formatters
│   ├── shared/                       # result types, errors, ids, logging, env parsing
│   └── config/                       # eslint, tsconfig, tailwind preset
│
├── docs/
└── e2e/
```

### 3.1 Why one app, not `apps/web` + `apps/admin`

The brief suggests separate web and admin apps. For the MVP that is a cost without a benefit: two deploys, two auth setups, duplicated design system wiring, cross-app session complexity — to protect an admin surface that is already protected by role checks and can be network-restricted at the edge.

**Recommendation:** one Next.js app with an `(admin)` route group gated by `ADMIN`/`OPS_AGENT` role in middleware **and** re-checked in every server action. Split into `apps/admin` at Phase 6–7, when admin gains heavy analytics and a different release cadence. The package boundaries above make that split mechanical.

_Flagging this as a deviation from the brief's suggested structure, per §21 of the brief which invites a better architecture._

---

## 4. Layering and the request lifecycle

```text
Browser
  │  server action / route handler
  ▼
Interface layer      auth session · zod parse · rate limit · idempotency key · i18n
  │                  ── never contains business rules ──
  ▼
Application layer    use case: open transaction → load aggregates via ports →
  │                  call domain → persist → write outbox → return Result
  ▼
Domain layer         pure functions & value objects: pricing, FSM, ledger journals, policy
  │
  ▼
Infrastructure       Prisma repositories · payment/SMS/storage/geo adapters · dispatcher
  │
  ▼
PostgreSQL           constraints & triggers = final backstop
```

**Concrete example — placing an order:**

```ts
// apps/web/app/actions/orders.ts
export async function placeOrderAction(input: unknown) {
  const session = await requireUser() // 401 if absent
  const dto = PlaceOrderSchema.parse(input) // quoteId, idempotencyKey, paymentMethod
  await rateLimit(`order.create:${session.userId}`, { limit: 5, windowSec: 60 })
  return toActionResult(
    await placeOrder({ actor: session, ...dto }), // application use case
  )
}
```

```ts
// packages/application/usecases/placeOrder.ts  (abbreviated)
export async function placeOrder(cmd: PlaceOrderCommand): Promise<Result<OrderView, DomainError>> {
  return withIdempotency(
    { scope: 'order.create', key: cmd.idempotencyKey, userId: cmd.actor.userId },
    () =>
      db.transaction(async (tx) => {
        const quote = await tx.quotes.findOwnedById(cmd.quoteId, cmd.actor.userId)
        if (!quote) return err(NotFound('quote'))
        if (quote.consumedAt) return err(Conflict('quote_already_used'))
        if (quote.expiresAt < now()) return err(Expired('quote_expired'))

        const listings = await tx.listings.findManyForUpdate(quote.lineListingIds)
        const check = revalidateQuote(quote, listings, now()) // ← DOMAIN, pure
        if (!check.ok) return err(check.error) // price/availability drifted

        for (const line of quote.lines) {
          const reserved = await tx.listings.reserve(line.listingId, line.quantityBase) // atomic UPDATE
          if (!reserved) return err(InsufficientInventory(line.listingId))
        }

        const order = await tx.orders.create(buildOrderFromQuote(quote, cmd)) // ← DOMAIN
        await tx.orderEvents.append(order.id, transition(null, 'PENDING', cmd.actor)) // ← DOMAIN
        await tx.ledger.post(journalForOrderPlaced(order)) // ← DOMAIN
        await tx.quotes.markConsumed(quote.id, order.id)
        await tx.outbox.add([OrderPlaced(order), NotifySeller(order)])
        return ok(toOrderView(order))
      }),
  )
}
```

Everything marked ← DOMAIN is a pure function with no I/O. That is what makes the money math testable.

---

## 5. Domain layer highlights

### 5.1 Money

```ts
// Branded so a raw number can never be passed where money is expected.
export type Poisha = bigint & { readonly __brand: 'Poisha' }

export const Money = {
  fromTaka(t: string): Poisha,                     // string input — never a float
  add(a: Poisha, b: Poisha): Poisha,
  mulRatio(a: Poisha, num: bigint, den: bigint): Poisha,   // half-up
  percent(a: Poisha, bps: number): Poisha,                 // basis points, half-up
  allocate(total: Poisha, weights: bigint[]): Poisha[],    // remainder → platform, deterministic
  format(a: Poisha, locale: 'bn'|'en'): string,            // ৳1,234.50 / ১,২৩৪.৫০
}
```

`Poisha` is `bigint`. It is serialised to JSON as a **string** at the boundary; `BigInt` has no JSON representation and silently coercing to `number` loses precision above 2^53. A lint rule bans `Number(` on any `*Poisha` identifier.

### 5.2 Order state machine

Declarative transition table; the only way status changes. Specified in [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md).

```ts
const TRANSITIONS: Transition[] = [
  {
    from: 'PENDING',
    to: 'CONFIRMED',
    actors: ['FARMER', 'ADMIN'],
    guard: withinAcceptanceWindow,
    effects: ['COMMIT_RESERVATION', 'NOTIFY_BUYER'],
  },
  {
    from: 'PENDING',
    to: 'CANCELLED',
    actors: ['BUYER', 'FARMER', 'SYSTEM', 'ADMIN'],
    guard: always,
    effects: ['RELEASE_RESERVATION', 'REFUND_IF_PREPAID'],
  },
  // ...
]
export function transition(
  order: OrderState,
  to: OrderStatus,
  actor: Actor,
  ctx: Ctx,
): Result<TransitionOutcome, DomainError>
```

An `OrderStatus` string assigned anywhere outside this module is a review-blocking defect.

### 5.3 Pricing

`computeDeliveredCost(input): CostBreakdown` and `rankSuppliers(candidates, buyer, config): RankedSupplier[]` — pure, deterministic, versioned by `pricingVersion`. Full specification in [`04_MARKETPLACE.md`](04_MARKETPLACE.md).

Delivery funding is a parameter of the cost computation, not a branch scattered through the UI:

```ts
type DeliveryFundingModel =
  | 'COST_RECOVERING' | 'PROMOTIONAL_SUBSIDY' | 'FREE_DELIVERY'
  | 'RETAILER_FUNDED' | 'SELLER_FUNDED' | 'SHARED'

applyFunding(tariff: Poisha, model: DeliveryFundingModel, ctx: FundingContext): FundingSplit
// → { chargedToBuyer, fundedBySeller, fundedByRetailer, promotionalSubsidy, subsidyReason }
```

`applyFunding` refuses any subsidising model when the pilot loss budget is exhausted ([`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md) §9.2). The budget check is a **pricing-path guard**, not a dashboard warning — a policy that only exists in a document is not a control.

### 5.4 Economics

```ts
computeOrderEconomics(input: EconomicsInput): OrderEconomics   // pure, versioned
resolveBaseline(order, observations, rules): BaselineSnapshot  // pure, deterministic
allocateTripCost(trip, orders, method): Map<OrderId, Poisha>   // pure
METHODOLOGY_VERSION: string
```

All pure and fully unit-tested, including the degradation rules that step confidence down when a baseline match widens in geography or time. A change to any formula requires a `METHODOLOGY_VERSION` bump and a changelog entry — the version is stamped on every record it produces. Specification: [`10_ECONOMIC_MEASUREMENT.md`](10_ECONOMIC_MEASUREMENT.md).

### 5.5 Fault attribution

Failures, cancellations and disputes carry an explicit `FaultParty` (`BUYER` · `SELLER` · `PLATFORM` · `LOGISTICS` · `FORCE_MAJEURE` · `UNDETERMINED`). It is a domain input to who bears a refund and where a cancellation fee goes, not a label applied afterwards for reporting. See [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §5.

---

## 6. Authentication and authorization

Full treatment in [`07_SECURITY.md`](07_SECURITY.md); the architectural shape:

### 6.1 Authentication

Phone + OTP as the primary factor. OTP is hashed at rest, 5-minute TTL, max 5 attempts, rate-limited per phone / per IP / per device. Sessions are database-backed (revocable, unlike stateless JWTs) with an httpOnly, Secure, SameSite=Lax cookie. Admin accounts additionally require a second factor before any money-moving action.

### 6.2 Authorization

Three layers, all mandatory:

1. **Route gate** (middleware) — coarse: is this session allowed in this route group?
2. **Policy check** (server action / use case) — `can(actor, 'order:cancel', order)` from `packages/domain/policy`, pure and unit-tested.
3. **Data scoping** (repository) — queries carry the owner filter; `findOwnedById(id, userId)` rather than `findById(id)` then compare.

Layer 3 is what actually kills IDOR. Layers 1 and 2 are defence in depth.

### 6.3 Note on Supabase RLS

We use Supabase as **managed Postgres**, and access it through Prisma with a privileged application role. Row Level Security therefore does not enforce our application's rules, because Prisma connects as one role for every user.

Two coherent options exist; mixing them is the failure mode:

- **(A) App-layer authorization** — Prisma + policy layer, RLS enabled with a deny-all default so no accidental direct-client access can read data.
- **(B) RLS-first** — the browser talks to Supabase directly with the user's JWT and Postgres policies do enforcement.

**Recommendation: (A).** Our rules (state machine guards, ledger invariants, quote validation) are not expressible as row predicates, and having two authorization systems means the weaker one defines actual security. RLS stays enabled in deny-all mode as a safety net.

---

## 7. Configuration and secrets

- Environment parsed once at startup through a Zod schema in `packages/shared/env`; the process refuses to boot on a missing or malformed variable. No `process.env.X` reads scattered through the codebase.
- Secrets live in the platform secret store; never in the repo, never in `NEXT_PUBLIC_*`. A CI check fails the build if a `NEXT_PUBLIC_` variable name matches secret-like patterns.
- **Business parameters are not environment variables.** They live in `PlatformConfig` (versioned, audited, admin-editable), and every quote and order stores the `configVersion` used, so any historical price is reproducible years later. At minimum:

| Key                                                 | MVP value                  | Notes                                                              |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `commission.bps`                                    | **300** (3%, seller-side)  | Decision D2. Never a literal in business logic                     |
| `commission.incidence`                              | `SELLER`                   | Buyer-side marketplace fee stays at zero unless economics force it |
| `delivery.tariff`                                   | slab table                 | [`04_MARKETPLACE.md`](04_MARKETPLACE.md) §3                        |
| `delivery.fundingModels.enabled`                    | list                       | Subsidising models auto-disable at budget exhaustion               |
| `delivery.circuityFactor`                           | 1.30, per district         | Calibrated against measured trips                                  |
| `settlement.rail.default`                           | per farmer, config default | `AGENT_CASH` \| `MFS` \| `BANK` \| `REGULATED_PROVIDER`            |
| `settlement.holdHours`                              | by risk tier               | T+0/T+1 target; open decision Q2                                   |
| `cancellation.feeSchedule`                          | by state                   | Destination defaults to farmer compensation (D7)                   |
| `payments.prepaidEnabled`                           | **false**                  | Hard-gated until the custody review completes (D4)                 |
| `discovery.radiusKm`                                | by role                    | Consumer vs retailer caps                                          |
| `order.acceptanceWindowMinutes`, `quote.ttlMinutes` | 120 / 15                   | Quiet-hours aware                                                  |
| `ranking.weights`                                   | §5.2 of `04`               | Changing them is an audited product decision                       |

---

## 8. Background processing

A single worker plus scheduled invocations, all Postgres-driven:

| Job                        | Cadence      | Purpose                                                                                 |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `outbox:dispatch`          | every 15 s   | Deliver domain events → notifications/analytics with retry and backoff                  |
| `orders:expire-acceptance` | every minute | `PENDING` past `acceptanceDeadline` → `CANCELLED(SELLER_TIMEOUT)`                       |
| `reservations:release`     | every minute | Expired `HELD` reservations → release inventory                                         |
| `listings:expire`          | hourly       | `available_to` passed → `EXPIRED`                                                       |
| `trips:costing-queue`      | hourly       | Nag ops for uncosted `COMPLETED` trips — blocks economics                               |
| `economics:compute`        | every 5 min  | Delivered orders with a costed trip → immutable `OrderEconomics`                        |
| `economics:rollup`         | daily        | Segment matrix: day × district × product × basket band × delivery model × buyer segment |
| `budget:monitor`           | hourly       | Derive subsidy spend from the ledger; fire 50/75/90/100% controls                       |
| `settlement:build`         | every 15 min | Build settlements for orders past their risk-tier hold (T+0/T+1 target)                 |
| `pricebaseline:remind`     | daily        | Prompt ops agents for field price observations; report baseline coverage                |

All jobs are idempotent and safe to run twice. Job endpoints are authenticated with a shared secret and are not reachable publicly.

`economics:compute` deliberately depends on `trips:costing-queue`: an order whose trip has not been costed is **not** measured with an estimate. It waits, and its absence shows up as a coverage gap in the daily report. Filling the gap with a guess would be the single easiest way to make the pilot's central number wrong.

### 8.1 Notification and farmer-interaction abstraction (IVR/USSD-ready)

IVR and USSD are **not** in the MVP (decision D8). The layers that would need to change are built so they can be added without redesign:

```ts
type Channel = 'SMS' | 'IN_APP' | 'EMAIL' | 'PUSH' | 'IVR' | 'USSD' // last two reserved

interface NotificationDispatcher {
  send(
    to: Recipient,
    template: TemplateId,
    vars: Vars,
    lang: Language,
    channel: Channel,
  ): Promise<Result>
}
```

Three design rules make the later addition mechanical:

1. **Templates are channel-agnostic and content-first.** A template declares its variables and its meaning; each channel renders it. An SMS body, an IVR script and a USSD menu string are three renderings of one message, not three separate messages.
2. **Farmer actions are modelled as intents, not as UI events.** `AcceptOrder`, `RejectOrder`, `MarkReady` are intents carrying an actor, a target and a reason. The web UI is one way to raise an intent; a keypress in an IVR call or a USSD menu selection would be another. No business rule lives in a React component.
3. **Every intent is expressible in a handful of tokens.** If a farmer action cannot be reduced to "one order, one choice, optional reason", it cannot work over a phone keypad — and that is a useful constraint on the farmer app's design _today_, not just later.

The notification channel enum already reserves `IVR` and `USSD` ([`02_DATABASE.md`](02_DATABASE.md) §10). No implementation exists, and none should be written until the reach data justifies it.

---

## 9. Frontend architecture for the target device

Non-negotiables for buyer and farmer surfaces:

- Server Components by default; `"use client"` only for genuinely interactive leaves (map pin, quantity stepper, image upload)
- Images: WebP/AVIF, explicit dimensions, lazy below the fold, aggressive resizing at upload — farmer photos from a 48 MP phone camera must never be served raw
- Fonts: one Bangla + Latin family, subset, `font-display: swap`, self-hosted
- Skeletons via streaming/Suspense, not client spinners after a blank page
- Forms degrade gracefully: server actions work without JS where practical; input is preserved across a failed submit
- Optimistic UI is forbidden for money-moving actions. A farmer must never see "order accepted" that later evaporates
- Budgets enforced in CI: ≤150 KB gzip JS on discovery/listing/checkout, LCP <2.5 s on emulated Fast-3G/mid-tier Android

### 9.1 Localisation

`next-intl` with `bn` as the default locale for farmer surfaces. All user-facing strings come from catalogues — no hardcoded text, enforced by lint. Numerals: Bangla digits for `bn` with a user preference, since many users read Western digits for money. Dates render in `Asia/Dhaka` with Bangla month names.

---

## 10. Testing strategy

The most valuable test is not "does the page render". It is:

> _Can a farmer list produce, can a buyer purchase it, does Langgol compute the correct transaction, and does the system safely complete the order?_

| Level                       | Coverage target              | What                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain unit**             | ~100% of `packages/domain`   | Money arithmetic & rounding; unit conversion; delivered-cost engine incl. the worked example and its ranking inversion; delivery funding splits; every legal and illegal FSM transition; ledger balance invariants; policy predicates; **economics formulas, baseline matching and degradation rules, trip-cost allocation** |
| **Application integration** | All use cases                | Against a real ephemeral Postgres: order placement, concurrent-order oversell attempt, idempotent replay, quote expiry/tamper, cancellation refunds, settlement build                                                                                                                                                        |
| **API/authorization**       | Every mutation               | Each endpoint hit as: anonymous, wrong role, correct role wrong owner, correct owner. Wrong-owner must return 404/403 and must not leak existence                                                                                                                                                                            |
| **E2E (Playwright)**        | 4 critical journeys          | Farmer signup→verify→list; buyer discover→checkout→track; farmer accept→fulfil→deliver; admin dispute→refund→settlement                                                                                                                                                                                                      |
| **Contract**                | Each provider adapter        | Recorded fixtures + webhook signature verification, replay and out-of-order delivery                                                                                                                                                                                                                                         |
| **Performance**             | Discovery, listing, checkout | Lighthouse CI budgets in the pipeline                                                                                                                                                                                                                                                                                        |

**Merge blockers:** any test touching money, authorization, or the order FSM. Concurrency tests (two buyers, one last crate of tomatoes) are mandatory, not optional.

---

## 11. Environments and deployment

| Environment      | Data             | Payments         | Purpose                 |
| ---------------- | ---------------- | ---------------- | ----------------------- |
| Local            | Seeded synthetic | Mock only        | Development             |
| Preview (per PR) | Ephemeral seeded | Mock only        | Review                  |
| Staging          | Anonymised       | Provider sandbox | QA, UAT with field team |
| Production       | Live             | Live             | Pilot                   |

Migrations run as an explicit gated step, never implicitly on boot. Expand→migrate→contract for any breaking change. Nightly encrypted backups plus PITR; **a restore is rehearsed before launch, not after the first incident.**

---

## 12. Observability

- Structured JSON logs with `requestId`, `userId`, `orderId`; **PII and money values are never logged in the clear**
- Error tracking with release tagging and source maps
- Domain metrics as first-class: orders by state, acceptance latency, cancellation reasons, delivery cost vs charge, quote→order conversion, OTP delivery success by carrier
- Alerts that matter: unbalanced ledger transaction attempt (page immediately), payment webhook failure rate, acceptance-timeout spike, settlement job failure, SMS delivery failure rate

An unbalanced-ledger alert should never fire. If it does, something is very wrong and a human must look immediately.

---

## 13. Architecture decision record (summary)

| #      | Decision                                                                                    | Status        | Consequence                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-01 | Single Next.js app for MVP; package-level boundaries preserved                              | Proposed      | Split to `apps/admin` is mechanical at Phase 6                                                                                                                             |
| ADR-02 | Framework-free domain package                                                               | Proposed      | Slight indirection cost; large testability and longevity gain                                                                                                              |
| ADR-03 | `BigInt` poisha everywhere; branded type                                                    | Proposed      | Serialisation discipline required at boundaries                                                                                                                            |
| ADR-04 | Double-entry ledger from day one                                                            | Proposed      | More work now; credit, refunds and audit become tractable later                                                                                                            |
| ADR-05 | Auth.js phone-OTP, DB sessions, not Supabase Auth                                           | Proposed      | We own the OTP flow and the SMS vendor relationship                                                                                                                        |
| ADR-06 | App-layer authorization; RLS deny-all as backstop                                           | Proposed      | One authorization model, not two                                                                                                                                           |
| ADR-07 | PostGIS with generated geography column                                                     | Proposed      | Raw SQL for radius queries; indexable from day one                                                                                                                         |
| ADR-08 | Postgres-backed outbox/jobs, no Redis at MVP                                                | Proposed      | Revisit at measured scale                                                                                                                                                  |
| ADR-09 | Curated product catalogue, not free-text                                                    | Proposed      | Comparable listings and usable price baselines                                                                                                                             |
| ADR-10 | Server-side quotes as the sole pricing authority                                            | Proposed      | Kills client-side price manipulation structurally                                                                                                                          |
| ADR-11 | COD as a first-class payment method                                                         | Proposed      | Ledger models cash-in-transit and agent float honestly                                                                                                                     |
| ADR-12 | **Economic measurement is a domain module with a write path**, not a query layer            | Approved      | Immutable `OrderEconomics` per order; methodology versioned; costs more upfront, makes every claim defensible                                                              |
| ADR-13 | **The trip, not the order, is the unit of delivery cost**                                   | Approved      | `DeliveryTrip` + allocation methods; aggregation economics become measurable instead of assumed                                                                            |
| ADR-14 | **Delivery funding is a first-class enum with six models**; cost-recovering is the default  | Approved      | Subsidy is always explicit, attributable and budget-controlled                                                                                                             |
| ADR-15 | **Fault attribution is an explicit domain field** on cancellations, failures and disputes   | Approved      | Determines who bears cost; makes cancellation-fee destination a rule, not a judgement call                                                                                 |
| ADR-16 | **Commission at 300 bps in config**, seller-side, zero buyer-side fee                       | Approved      | Rate changes are audited configuration, never a deploy                                                                                                                     |
| ADR-17 | **Prepaid payments hard-gated by config** until the custody/escrow review completes         | Approved      | The interface exists; the capability does not                                                                                                                              |
| ADR-18 | **Settlement targets T+0/T+1 post-delivery** with risk-tiered holds and a configurable rail | Approved      | Trades some clawback exposure for the thing farmers judge us on; agent cash is a bootstrap, not the architecture                                                           |
| ADR-19 | **Notifications and farmer actions are channel-agnostic intents**                           | Approved      | IVR/USSD becomes an adapter later rather than a redesign; constrains the farmer UI usefully today                                                                          |
| ADR-20 | **Mass base unit is the milligram, not the gram**                                           | Accepted (P1) | Makes seer (933,100 mg) and mon (37,324,000 mg) exact. A gram base rounds seer to 933 g — a silent 0.01% systematic error against the farmer. See docs/02_DATABASE.md §6.1 |
| ADR-21 | **OTP and secret hashing uses Node's built-in scrypt, not argon2id** | Accepted (P1) | argon2 needs a native module or a prebuilt-binary dependency; scrypt is memory-hard, in the standard library, and ample for a 6-digit single-use secret with a 5-minute TTL and a 5-attempt cap. Revisit if long-lived passwords are ever stored. Session tokens use SHA-256, correctly: they are 256-bit random values with no brute-force surface |
