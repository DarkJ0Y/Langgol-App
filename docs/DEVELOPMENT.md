# Development

Practical setup for working on Langgol. Architecture lives in [`03_ARCHITECTURE.md`](03_ARCHITECTURE.md).

---

## 1. Prerequisites

| Tool       | Version               | Notes                                                                       |
| ---------- | --------------------- | --------------------------------------------------------------------------- |
| Node       | ≥ 22                  | 24 is what CI and local development currently use                           |
| pnpm       | ≥ 10                  | `corepack enable` picks up the pinned version from `package.json`           |
| PostgreSQL | ≥ 15 **with PostGIS** | Optional locally — see §2b. Plain `postgres` fails the extensions migration |
| psql       | any                   | Only needed if you run the database guarantee checks locally                |

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

## 2b. Working without a local database

A database is **not** required to do most work on this repository, and it is not required to get
a change verified. The split is deliberate:

```bash
pnpm verify        # format, lint, typecheck, unit tests — no database, no Docker
pnpm build         # production build — no database
```

The integration suites skip themselves unless **both** `LANGGOL_INTEGRATION=1` and `DATABASE_URL`
are set, so a run without a database is a clean pass rather than a silent gap: the summary says
how many were skipped.

```bash
pnpm test                                    # unit tests only; integration suites skipped
LANGGOL_INTEGRATION=1 pnpm test              # everything, if DATABASE_URL points somewhere real
```

Anything that genuinely needs PostgreSQL — migrations, CHECK constraints, triggers, partial
indexes, PostGIS radius search — is verified by the `database` job in
[.github/workflows/ci.yml](../.github/workflows/ci.yml), which starts a `postgis/postgis` service
container, applies the migrations, runs both guarantee scripts, seeds, and then runs the
integration suites. CI triggers on **every branch**, and can be started by hand from the Actions
tab, precisely so that a contributor without a local database still gets those checks.

Use a local database when you are actively iterating on schema or SQL; otherwise push and let CI
do it.

## 3. Database

PostGIS is a hard requirement. Radius search uses `ST_DWithin` against a GIST index; haversine
in SQL cannot use an index and degenerates to a full scan.

| Option                                        | When                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| No database at all                            | Most work. See §2b — `pnpm verify` and `pnpm build` pass  |
| GitHub Actions                                | Anything needing real SQL, without a local container      |
| `docker compose up -d`                        | Iterating on schema or SQL. Uses `postgis/postgis:16-3.4` |
| A hosted Postgres branch with PostGIS enabled | Shared review environments                                |
| A local PostgreSQL install                    | Requires the PostGIS extension package                    |

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

| Migration                              | Contents                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `..._enable_extensions`                | `postgis`, `pgcrypto` — must run before any table using their types        |
| `..._init`                             | Prisma-generated tables, enums, indexes and foreign keys                   |
| `..._database_guarantees`              | CHECK constraints, append-only rules, geography triggers, GIST indexes     |
| `..._p2_marketplace_core`              | Marketplace tables plus their CHECKs, quote single-use rules, GIST indexes |
| `..._p1_roles_and_user_profile`        | Role definitions, profile columns, revocation-attribution CHECK            |
| `..._p1_role_attribution_foreign_keys` | `granted_by`/`revoked_by` FKs, **ON DELETE RESTRICT**                      |
| `..._p2_email_verification`            | `verification_tokens`, its CHECKs, one-live-token partial unique index     |
| `..._p2_email_change_retracts_proof`   | Trigger clearing `email_verified_at` when the address changes              |

Because those objects are invisible to `schema.prisma`, a naive `prisma migrate diff` drift check
would try to drop them. Integrity is verified instead by `migrate:status` (every migration applied
and unmodified) plus the two guarantee scripts, which CI runs on every build.

> ### ⚠ Read every generated migration before committing it
>
> `prisma migrate dev` **will emit `DROP INDEX` for the hand-authored GIST indexes.** Prisma cannot
> represent a GIST index on an `Unsupported("geography(...)")` column, so it does not see those
> indexes in the datamodel, concludes they are drift, and drops them.
>
> This happened while generating `20260812204242_p2_marketplace_core`: the generated file contained
> `DROP INDEX "addresses_geo_gix";` and `DROP INDEX "admin_areas_geo_gix";`. Both were removed by
> hand and replaced with a comment.
>
> **Every time you run `prisma migrate dev`, grep the new migration for `DROP INDEX` and delete any
> line that drops a `*_geo_gix` index.** Losing them does not fail a test or raise an error — it
> silently turns every radius search into a full table scan.
>
> ```bash
> grep -n "DROP INDEX" packages/db/prisma/migrations/<new>/migration.sql
> ```

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

### Why `pnpm build` goes through a wrapper

`apps/web`'s build script is `node scripts/build.mjs`, not `next build`. The wrapper exists for
one Windows-specific reason, documented in full at the top of that file: Next runs `@vercel/nft`
during the production compile, nft cannot statically resolve the home-directory path inside the
Prisma client runtime, and so it globs the entire user home directory. That is slow everywhere,
and fatal on a machine with a Docker Desktop socket under `AppData\Local` that Windows will not
let a normal process `scandir` — the resulting `EACCES` surfaces as a webpack compilation error
and the build dies pointing at the server-actions plugin instead of the real cause.

The list nft ignores comes from Next's `traceIgnores`, which is hard-coded to `[]`, so
`outputFileTracingExcludes` in `next.config.mjs` cannot reach it. The wrapper points `HOME` at an
empty scratch directory for the duration of the build; the glob then finds nothing and the same
real files are traced. POSIX builds run plain `next build` and are unaffected.

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
