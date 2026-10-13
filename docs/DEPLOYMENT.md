# Deployment

How Langgol is deployed, and why the production checklist is longer than it looks.

Development setup lives in [`DEVELOPMENT.md`](DEVELOPMENT.md). The step-by-step guide for the
cPanel host, with Supabase as the database, is [`DEPLOY-CPANEL.md`](DEPLOY-CPANEL.md).

---

## 1. The environment decides what the app will allow

`packages/shared/src/env.ts` refuses to boot on a configuration that would fail quietly. This is
the single most important thing to understand before deploying: the app would rather not start
than start in a state where sign-in silently cannot work.

| `APP_ENV`     | `AUTH_MODE=development` | Notes                                            |
| ------------- | ----------------------- | ------------------------------------------------ |
| `development` | permitted               | Local work                                       |
| `test`        | permitted               | CI                                               |
| `staging`     | **permitted**           | Demo and review deployments                      |
| `production`  | **refused at startup**  | Production must use OTP. `AuthModeError` on boot |

`staging` is what makes a demo deployment possible at all. It is also what makes one dangerous:
with `AUTH_MODE=development` the site serves `/auth/development`, and **anyone who opens that URL
can sign in as Dev Admin in one click.** There is no password on those accounts, by design — they
exist so engineering can work before SMS infrastructure is contracted.

So a staging deployment must be access-protected at the platform, or must point at a database you
would not mind a stranger reading. See §4.

## 2. What production additionally demands

Every one of these is enforced in `parseEnv` and each refuses to boot with a message saying why.

| Requirement                             | Why it is refused rather than defaulted                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `AUTH_MODE=otp`                         | A development login in production is a back door, not a fallback      |
| `SMS_PROVIDER=http`                     | `console` means nobody receives an OTP and **every login fails**      |
| `EMAIL_PROVIDER` not `console`/`memory` | A pretend provider tells users "check your inbox" and prints to a log |
| `KYC_ENCRYPTION_KEY`, 32+ bytes         | Without it every identity submission is refused, silently             |
| `NODE_ENV=production`                   | A production `APP_ENV` with a development `NODE_ENV` is a mistake     |

**A production launch is therefore blocked until a Bangladeshi SMS aggregator is contracted.** OTP
is the only production sign-in, so without `SMS_API_URL` and `SMS_API_KEY` nobody can log in.
This is not a limitation to work around; it is the system refusing to pretend.

Generate the two secrets and the KYC key with:

```bash
openssl rand -base64 48   # AUTH_SECRET, JOB_TRIGGER_SECRET
openssl rand -base64 32   # KYC_ENCRYPTION_KEY
```

Rotating `KYC_ENCRYPTION_KEY` makes existing ciphertexts unreadable and existing duplicate indexes
unmatchable. There is no re-encryption path yet, so treat rotation as a migration.

## 3. Vercel

The web app is a Next.js application inside a pnpm workspace, so Vercel needs to be told where it
lives. Configuration is in [`apps/web/vercel.json`](../apps/web/vercel.json).

### Project settings

| Setting           | Value                                       |
| ----------------- | ------------------------------------------- |
| Root Directory    | `apps/web`                                  |
| Framework         | Next.js (declared in `vercel.json`)         |
| Production Branch | whichever branch you are deploying          |
| Node version      | 22 or later, matching `engines` in the root |

Enable **Include source files outside of the Root Directory** so the workspace packages come along.
Without it the build fails on `@langgol/domain` and every other internal import.

### Why the build command is not the default

```
pnpm --filter @langgol/db run generate && pnpm --filter @langgol/web run build
```

`prisma generate` is run explicitly rather than left to the `postinstall` hook in `packages/db`.
Vercel caches `node_modules` between builds, and a cache hit skips install scripts — which means
the generated client can be missing or stale while the build still appears to succeed, and the
failure arrives at runtime as a missing export.

### Why the region is pinned

```
"regions": ["sin1"]
```

The Neon database is in `ap-southeast-1`. Vercel's default region is Washington, so every query
would cross the Pacific and back. Serverless functions run per request, and the round trips add up
fast on the marketplace pages, which issue several. Singapore puts the functions beside the data.

This is the same latency that made the integration tests time out at five seconds — see
`vitest.config.ts`. Distance to the database is a recurring cost in this project, not a detail.

### Environment variables

Set these in the Vercel project, for the environment you are deploying.

**Required. The app will not boot without them.**

| Variable             | Note                              |
| -------------------- | --------------------------------- |
| `DATABASE_URL`       | Neon pooled connection            |
| `DIRECT_URL`         | Neon unpooled. Migrations need it |
| `AUTH_SECRET`        | 32 characters minimum             |
| `JOB_TRIGGER_SECRET` | 16 characters minimum             |

**For a staging demo.**

| Variable    | Value                                |
| ----------- | ------------------------------------ |
| `APP_ENV`   | `staging`                            |
| `APP_URL`   | the deployment's own URL             |
| `AUTH_MODE` | `development`, for the demo accounts |

**Optional.** `FIREBASE_*` is needed only for photo and document uploads, which fail cleanly
without it. `KYC_ENCRYPTION_KEY` outside production means identity submission is refused rather
than stored in clear. `SMS_PROVIDER` and `EMAIL_PROVIDER` are unused when `AUTH_MODE=development`.

Note that `.env` at the repository root is loaded by `apps/web/next.config.mjs` for local work
only. On Vercel there is no such file, the loader finds nothing, and the platform's own variables
are used. Anything already set in the environment always wins over the file.

## 4. Protecting a staging deployment

Because the fixture accounts have no password, a staging URL is an open administrator login.

Vercel Deployment Protection closes this. **Vercel Authentication** limits access to members of
your Vercel account and is available on every plan for preview deployments. **Password
Protection** is a paid plan feature. Either is sufficient; no protection is not.

Confirm it is on by opening the deployment in a private window. You should be asked to
authenticate before you see the site. If the homepage renders, the protection is not active and
the admin screens are reachable by anyone with the link.

## 5. Migrations are not run by the deploy

The build does not apply migrations, deliberately. A deploy that migrates on boot will run the
same migration from several instances at once, and a failed migration takes the deployment with
it.

Run them yourself against the target database, before the deploy that needs them:

```bash
pnpm db:migrate:deploy
```

Then verify:

```bash
pnpm --filter @langgol/db run migrate:status
pnpm --filter @langgol/db run verify:guarantees   # read-only, safe against production
```

`verify:behaviour` writes rows and must never be run against production.

## 6. Seeding

`pnpm db:seed` is idempotent and seeds reference data: administrative geography, the platform
configuration and the role catalogue. It refuses to create development fixtures when
`APP_ENV=production`, so it is safe to run anywhere.

On a staging database you probably do want the fixtures, which means `APP_ENV` must not be
`production` when the seed runs.
