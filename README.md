# LANGGOL

A digital operating system for the agricultural ecosystem of Bangladesh.

> **Farmers should earn more. Consumers should pay less. Agriculture should become more transparent, efficient, accessible and sustainable.**

---

## Status: Phase 1 — Platform foundation

This repository currently contains **only the platform foundation**. The marketplace, orders,
payments, settlement and credit are deliberately **not** built yet — see
[`docs/09_ROADMAP.md`](docs/09_ROADMAP.md).

| Phase | State |
|---|---|
| P0 Foundations & decisions | Running in parallel (geography validation, baseline collection, legal) |
| **P1 Platform skeleton** | **In progress — this repository** |
| P2 Farmer supply side | Not started — requires explicit approval |

## Documentation

Architecture and product documentation is the source of truth and is kept in sync with the code.
When implementation reveals a needed architectural change, the document is updated **first**, with
the reason recorded, and only then is the change implemented.

| Doc | Contents |
|---|---|
| [00_PRODUCT_VISION](docs/00_PRODUCT_VISION.md) | Mission, economic thesis, ecosystem, principles |
| [01_MVP_REQUIREMENTS](docs/01_MVP_REQUIREMENTS.md) | Pilot scope, user stories, decisions register |
| [02_DATABASE](docs/02_DATABASE.md) | Schema, constraints, indexes, seeds |
| [03_ARCHITECTURE](docs/03_ARCHITECTURE.md) | Stack, layering, abstractions, ADRs |
| [04_MARKETPLACE](docs/04_MARKETPLACE.md) | Delivered-cost engine, ranking, funding models |
| [05_ORDER_SYSTEM](docs/05_ORDER_SYSTEM.md) | Order state machine, fault attribution |
| [06_FINANCIAL_ARCHITECTURE](docs/06_FINANCIAL_ARCHITECTURE.md) | Money, ledger, settlement, tax |
| [07_SECURITY](docs/07_SECURITY.md) | Threat model, authn/authz, audit |
| [08_BANGLADESH_CONTEXT](docs/08_BANGLADESH_CONTEXT.md) | Geography, language, payments, regulation |
| [09_ROADMAP](docs/09_ROADMAP.md) | Phases, gates, risks |
| [10_ECONOMIC_MEASUREMENT](docs/10_ECONOMIC_MEASUREMENT.md) | Metrics, baselines, experiments, gates |

## Repository layout

```text
apps/
  web/                  Single Next.js app (buyer, farmer, admin route groups) — ADR-01
packages/
  domain/               Pure domain: NO framework, NO database, NO I/O
    money/              Integer poisha arithmetic — critical infrastructure
    quantity/           Base-unit quantities; mon/seer/kg are presentation only
    config/             PlatformConfig schema and resolution
    identity/           Phone normalisation, OTP policy
    policy/             Authorization predicates
    notifications/      Channel-agnostic intents and templates
  application/          Use cases, ports, transaction boundaries
  infrastructure/       Adapters: Prisma repositories, SMS, storage, clock
  db/                   Prisma schema, migrations, seed
  shared/               Result type, errors, ids, logging, env parsing
  i18n/                 Bangla-first message catalogues and formatters
  ui/                   Design system: tokens, primitives
  config/               Shared tsconfig + ESLint configuration and custom rules
```

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill in local values
pnpm verify                   # format check + lint + typecheck + tests
```

### Database

Local development expects PostgreSQL 15+ **with PostGIS**. See
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for options (Docker, or a hosted Supabase branch).

```bash
pnpm db:validate    # validate the Prisma schema (no database required)
pnpm db:migrate     # apply migrations (requires DATABASE_URL)
pnpm db:seed        # seed reference data (requires DATABASE_URL)
```

## Engineering rules that are enforced, not merely documented

- **No floating point for money.** Integer `poisha` only, via a branded `BigInt`.
- **No business rates in code.** Commission, tariffs and fees live in versioned `PlatformConfig`.
  A custom ESLint rule fails the build on a business-rate literal.
- **Metric is authoritative.** `mon`, `seer` and friends are conversion/display layers.
- **Bangla first.** The farmer experience defaults to Bangla; English is the toggle.
- **Database constraints are part of the security model**, not a convenience.
- **Never log** OTPs, secrets, or unnecessary personal data.

## Licence

Proprietary — all rights reserved.
