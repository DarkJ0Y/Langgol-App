# Development

Practical setup for working on Langgol. Architecture lives in [`03_ARCHITECTURE.md`](03_ARCHITECTURE.md).

---

## 1. Prerequisites

| Tool       | Version               | Notes                                                             |
| ---------- | --------------------- | ----------------------------------------------------------------- |
| Node       | ≥ 22                  | 24 is what CI and local development currently use                 |
| pnpm       | ≥ 10                  | `corepack enable` picks up the pinned version from `package.json` |
| PostgreSQL | ≥ 15 **with PostGIS** | Plain `postgres` will fail the extensions migration               |
| psql       | any                   | Used by the database guarantee checks                             |

## 2. First run

```bash
pnpm install
cp .env.example .env          # then fill in AUTH_SECRET and JOB_TRIGGER_SECRET
docker compose up -d          # or point DATABASE_URL at a hosted PostGIS branch
pnpm db:migrate
pnpm db:seed
pnpm verify                   # format check + lint + typecheck + tests
```

Generate the two secrets with:

```bash
openssl rand -base64 48
```

## 3. Database

PostGIS is a hard requirement. Radius search uses `ST_DWithin` against a GIST index; haversine
in SQL cannot use an index and degenerates to a full scan.

| Option                                        | When                                           |
| --------------------------------------------- | ---------------------------------------------- |
| `docker compose up -d`                        | Default. Uses `postgis/postgis:16-3.4`         |
| A hosted Postgres branch with PostGIS enabled | No local Docker, or shared review environments |
| A local PostgreSQL install                    | Requires the PostGIS extension package         |

`DATABASE_URL` may point at a connection pooler; `DIRECT_URL` must not, because migrations
cannot run over a transaction pooler.

### Commands

```bash
pnpm db:validate                              # validate the schema — no database needed
pnpm db:migrate                               # create/apply migrations in development
pnpm db:migrate:deploy                        # apply pending migrations (CI, staging, production)
pnpm db:seed                                  # idempotent reference data
pnpm --filter @langgol/db run migrate:status  # is every migration applied and unmodified?
pnpm --filter @langgol/db run verify:guarantees   # read-only; safe anywhere including production
pnpm --filter @langgol/db run verify:behaviour    # writes rows — CI and scratch databases ONLY
```

### Migrations that Prisma cannot generate

CHECK constraints, append-only rules, PostGIS geography columns, their triggers and GIST indexes
are **part of the security model** and cannot be expressed in `schema.prisma`. They live in
hand-authored migrations next to the generated ones:

| Migration                 | Contents                                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| `..._enable_extensions`   | `postgis`, `pgcrypto` — must run before any table using their types    |
| `..._init`                | Prisma-generated tables, enums, indexes and foreign keys               |
| `..._database_guarantees` | CHECK constraints, append-only rules, geography triggers, GIST indexes |

Because those objects are invisible to `schema.prisma`, a naive `prisma migrate diff` drift check
would try to drop them. Integrity is verified instead by `migrate:status` (every migration applied
and unmodified) plus the two guarantee scripts, which CI runs on every build.

**The geography column is maintained by a trigger, not `GENERATED ALWAYS`.** A generated column
would be invisible to Prisma and cause perpetual drift; the trigger keeps the physical schema and
Prisma's view of it identical. Application code writes `latitude`/`longitude`; the database
derives `geo`.

### Seed data and what is deliberately missing

The seed loads administrative geography (8 divisions, 64 districts, and the 9 upazilas of the
pilot candidate district) and `PlatformConfig` v1.

**Centroid coordinates are not seeded, on purpose.** Inventing plausible coordinates would make
every distance calculation, delivery quote and radius search silently wrong while appearing to
work. They must be loaded from an authoritative source as a P0 data task. Until then the seed
prints a warning, and code that needs a location reports "unknown" rather than guessing.

Several `PlatformConfig` values are `null` because they are **open product decisions**
(pilot loss budget Q1, settlement hold hours Q2, cancellation fee schedule Q3). Code paths that
need them refuse to proceed rather than assuming a value.

## 3b. Authentication modes

OTP is the production mechanism. `development` mode exists so engineering can proceed before
SMS infrastructure is contracted — **not** as a fallback.

```bash
AUTH_MODE=development    # local: no SMS, no OTP, no provider credentials
AUTH_MODE=otp            # staging while trialling OTP, and production (enforced)
```

### Development mode

Sign in as one of a **fixed set of fixture identities**: `farmer`, `consumer`, `retailer`,
`ops`, `admin`, `farmer-consumer`. They are created by `pnpm db:seed` outside production.

```text
Development authentication → select test identity → session → role selection
```

It is deliberately **not** an impersonation tool:

| Property                   | How                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No arbitrary user access   | The only input is a key from a closed allowlist. A user id, phone number or search term is meaningless                                        |
| No role escalation         | Each fixture's roles are declared in the domain and are not selectable by the caller                                                          |
| No real accounts reachable | The lookup is scoped in SQL to `is_development_fixture`, and a CHECK constraint confines that flag to the reserved block `+880170000000[1-9]` |
| Auditable                  | Every sign-in and every rejected attempt writes an `AuditLog` row marked as a development session                                             |

### OTP mode

```text
Phone → request OTP → verify OTP → session → role selection
```

Unchanged: phone normalisation, scrypt hashing, expiry, attempt caps, resend cooldown, rate
limits, SMS spend circuit breaker, SMS adapter, session creation, authorization.

### Production safety

Three independent guards, because one is a convention and three is a control:

1. **Startup** — `APP_ENV=production` with any mode other than `otp` throws `AuthModeError` in
   `parseEnv`. Production **fails to start**; it never silently permits a development login.
2. **Use case** — `developmentSignIn` re-asserts the rule, so a mis-wired dependency or a stale
   cached config cannot open the door.
3. **Database** — the fixture flag is confined by CHECK to a reserved phone block, and the seed
   refuses to create fixtures when `APP_ENV=production`.

Enforced entirely server-side. No `NEXT_PUBLIC_*` variable participates in this decision.

## 4. Everyday commands

```bash
pnpm verify            # what CI runs
pnpm test              # unit tests
pnpm test:watch
pnpm test:coverage     # enforces 100% on money, quantity, math, intl
pnpm lint
pnpm typecheck
pnpm format
```

## 5. Rules the tooling enforces

These are not style preferences; the build fails on them.

| Rule                                         | Why                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `langgol/no-business-rate-literal`           | Commission, tariffs, fees and thresholds live in versioned `PlatformConfig`. A hard-coded rate cannot be changed without a deploy and silently invalidates historical figures |
| `langgol/no-money-arithmetic`                | Arithmetic on `*Poisha` values is confined to the money module, which owns rounding and allocation                                                                            |
| `langgol/no-unsafe-money-cast`               | `Number()`/`parseFloat`/`Math.round` on money loses `bigint` precision                                                                                                        |
| 100% coverage on money, quantity, math, intl | Critical infrastructure                                                                                                                                                       |
| Secret-shaped `NEXT_PUBLIC_*`                | Those variables ship to the browser                                                                                                                                           |

Exemptions are deliberately narrow: `packages/domain/src/money/**` for money arithmetic;
config defaults, seeds and tests for rate literals. If a rule fires somewhere else, the rule is
usually right.

## 6. Environments

| Environment | Data                  | Payments         | SMS             |
| ----------- | --------------------- | ---------------- | --------------- |
| local       | seeded reference only | mock             | `console`       |
| test        | ephemeral             | mock             | `memory`        |
| staging     | anonymised            | provider sandbox | real, throttled |
| production  | live                  | live             | live            |

Local development never connects to production financial infrastructure. The mock payment
provider refuses to register when `APP_ENV=production`, enforced by a startup assertion that
throws rather than a convention.

## 7. Project conventions

- **Money** is `bigint` poisha, serialised as a **string** across every boundary.
- **Quantities** are `bigint` base units (milligram / millilitre / piece). `mon`, `seer`, `hali`
  and `kg` are input and display layers only — see [`02_DATABASE.md`](02_DATABASE.md) §6.1.
- **Time** is stored UTC, rendered `Asia/Dhaka`.
- **Bangla first** on farmer surfaces. No user-facing string is hard-coded.
- **Never log** OTPs, session tokens, payment secrets, or personal data that is not needed.
