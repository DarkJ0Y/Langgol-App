# Putting Langgol live on cPanel, with Supabase

This puts Langgol on **langgol.apeiroworld.com**, on the same cPanel account as Somakolon, with
its data in **Supabase** (project `hedathblxvjwmzwxetyp`) instead of a cPanel database.

It is a **demo deployment** (`APP_ENV=staging`): there is no SMS sign-in yet, so people log in
with one click as one of the demo accounts. Because anyone could do that, **the whole site sits
behind a cPanel password** (step 5). Do not skip it.

Every cPanel step is done in the cPanel website; no Terminal is needed. Somakolon is not touched.

**You need:**

- the **`langgol_app.zip`** package from GitHub (step 2)
- your **Supabase database password**
- about 30 minutes

How it fits together: cPanel runs the Langgol web server (Node.js). The server connects to
Supabase over the internet. Nothing is stored in a cPanel database.

---

## 1. The Supabase database (done once, by your developer)

The tables, the Bangladesh administrative areas, the crop catalogue and the demo accounts are
created from the developer's computer, not from cPanel. What you need from Supabase is the address
and password, for step 3.

1. [supabase.com/dashboard](https://supabase.com/dashboard) → the Langgol project → **Project
   Settings** → **Database** → **Reset database password**. Choose a strong password made of
   **letters and digits only** (other characters break the address) and **write it down**.
2. At the top of the project page click **Connect**. Under **Connection string**, find:
   - **Transaction pooler**: an address ending `…pooler.supabase.com:6543/postgres`
   - **Session pooler**: the same address ending `…pooler.supabase.com:5432/postgres`

   Use these two. **Do not use the "Direct connection"** (`db.….supabase.co`): it works only over
   IPv6, and neither the hosting server nor GitHub can reach it.

**Developer: applying the schema and the seed.** Put the session pooler address, with the
password, in `.env.supabase` at the repository root. It is gitignored like every other `.env.*`.

```bash
# .env.supabase
DATABASE_URL="postgresql://postgres.hedathblxvjwmzwxetyp:PASSWORD@aws-…pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://postgres.hedathblxvjwmzwxetyp:PASSWORD@aws-…pooler.supabase.com:5432/postgres"
APP_ENV=staging
```

```bash
set -a && . ./.env.supabase && set +a
pnpm db:migrate:deploy
pnpm --filter @langgol/db run migrate:status
pnpm db:seed            # APP_ENV=staging: creates the demo accounts and marketplace too
```

Both URLs are the **session** pooler here, deliberately. Migrations cannot run over the
transaction pooler. The running site uses the transaction pooler for `DATABASE_URL` (step 3).

The migration `p15_rls_deny_all_backstop` switches on Row Level Security for every table and
removes the access of Supabase's public API keys. Langgol does not use Supabase's REST API, so
with that in place nobody can read the data through it, even with the project's public key.
Afterwards, Supabase → **Advisors** → _Security Advisor_ should show no "RLS disabled" errors.

## 2. Download the package

The package is built by GitHub on every push, then started once and checked before it is
offered for download.

1. GitHub → **DarkJ0Y/Langgol-App** → **Actions** → **cPanel package** (left list).
2. Open the newest run with a **green tick** on the branch you are deploying.
3. At the bottom, under **Artifacts**, click **langgol_app**. You get `langgol_app.zip`.

The package holds **no passwords or keys**, because the repository is public. You add them
on the server in step 3.

## 3. Create the subdomain, upload, and fill in the settings

**Subdomain.** cPanel → **Domains** → **Create A New Domain** → `langgol.apeiroworld.com`. Untick
_Share document root_. The document root becomes `public_html/langgol.apeiroworld.com` →
_Submit_. Then cPanel → **SSL/TLS Status** → tick `langgol.apeiroworld.com` → **Run AutoSSL**, so
the site gets `https://`.

**Upload.** cPanel → **File Manager**

1. Top right → **Settings** → tick **Show Hidden Files (dotfiles)** → _Save_.
2. Open your home folder **`/home/apeirowo`** (the one that _contains_ `public_html`).
3. **Upload** `langgol_app.zip`. Select it → **Extract** → to `/home/apeirowo`. Delete the zip.
4. Check: **`/home/apeirowo/langgol_app/app.js`** must exist, with a folder `server` beside it.
   If you see `langgol_app/langgol_app/…`, move the inner folder's contents up one level.

**Settings.** In `langgol_app`, select **`env.txt`** → **Rename** → `.env`. Then select `.env` →
**Edit**, and replace the four `CHANGE_ME`:

| Line           | Put in                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | the **transaction pooler** address (port **6543**) and password. Keep `?pgbouncer=true&connection_limit=5` at the end |
| `DIRECT_URL`   | the **session pooler** address (port **5432**) and password                                                           |

The easiest way: paste each address from Supabase over the whole value, put your password in place
of `[YOUR-PASSWORD]`, and for `DATABASE_URL` add `?pgbouncer=true&connection_limit=5` at the end.

**Leave `generate` as it is** on the three secret lines. The site replaces each with a random
secret the first time it starts and saves it in this file. Never copy these to another site.

**Demo login (optional).** To give people one email and password that opens every feature, set
`DEMO_PASSWORD` to a password you choose (8 or more characters). `DEMO_EMAIL` is already
`demo@langgol.app`; change it if you like. Leave `DEMO_PASSWORD` empty and the email/password
form is simply not shown; the one-click demo accounts still work.

_Save Changes_. Then select `.env` → **Permissions** → **600** → _Change Permissions_.

## 4. Create the Node.js application

cPanel → **Setup Node.js App** → **Create Application**

| Field                    | Value                                                         |
| ------------------------ | ------------------------------------------------------------- |
| Node.js version          | **22** (the newest 22.x in the list; 24 also works)           |
| Application mode         | **Production**                                                |
| Application root         | `langgol_app`                                                 |
| Application URL          | **langgol.apeiroworld.com** from the list, box after it empty |
| Application startup file | `app.js`                                                      |

→ **Create**. Leave the environment variables empty: everything is in `.env`.

**Do not click "Run NPM Install".** The package already contains everything it needs; there is
nothing to install.

## 5. Password-protect the site (before anyone opens it)

The demo sign-in page lets anyone in as **Dev Admin** with one click. The cPanel password is
what keeps strangers out.

cPanel → **Directory Privacy** → open `public_html` → click **`langgol.apeiroworld.com`** (the
folder name itself, not the arrow) →

1. Tick **Password protect this directory**, name: `Langgol demo` → **Save**.
2. **Create User**: a username and a strong password → **Save**. Write them down. Share these
   with the people you want to show the demo to. Add a user per person if you like.

## 6. Start it and check

**Setup Node.js App** → **Restart** (the circular arrow). Open **https://langgol.apeiroworld.com**.
The first load takes a few seconds.

- [ ] The browser **asks for a username and password** before showing anything. Check this in a
      private window. If the home page appears without asking, go back to step 5 right away.
- [ ] After the password, the Langgol home page appears in Bangla.
- [ ] **Market** shows the demo produce listings.
- [ ] Sign in → _Development_ → **ডেভ অ্যাডমিন** (Dev Admin) opens the admin screens.
- [ ] If you set `DEMO_PASSWORD`: sign in with `demo@langgol.app` and that password. The home page
      lists every area — market, farmer, account and administration — and each one opens.
- [ ] Sign in as **ডেভ ক্রেতা** (Dev Buyer), open a listing, get a quote.
- [ ] `/health` shows `{"status":"ok","check":"live"}`.
- [ ] In File Manager, `langgol_app/.env` no longer contains the word `generate`.

---

## When something goes wrong

The server's messages go to **`/home/apeirowo/langgol_app/stderr.log`** (open it in File Manager
and click _Reload_). If that file does not exist, look in cPanel → **Errors**. Langgol refuses to start on a wrong setting and writes the reason there. After
fixing a cause, **Restart** the app.

| What you see                                                                       | What it means / what to do                                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The site opens **without asking for a password**                                   | Directory Privacy is not on for `langgol.apeiroworld.com`. Step 5, now.                                                            |
| `[langgol] … .env not found`                                                       | `env.txt` was not renamed to `.env`, or it is not inside `langgol_app`. Step 3.                                                    |
| `EnvironmentError: …`                                                              | A setting in `.env` is missing or wrong. The message names it.                                                                     |
| `Can't reach database server` / `P1001`                                            | The address is wrong, or it is the _Direct connection_ (`db.….supabase.co`). Use the **pooler** addresses from Supabase → Connect. |
| `password authentication failed`                                                   | The password in `.env` is wrong. Reset it in Supabase (step 1) and put the new one in both lines.                                  |
| `Tenant or user not found`                                                         | The user part must be `postgres.hedathblxvjwmzwxetyp`, exactly as Supabase shows it.                                               |
| Pages fail with a database error on the first visit in a while                     | Supabase's free plan **pauses a project after a week without use**. Supabase dashboard → the project → **Restore**.                |
| `Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.0.x"` | The server is older than expected. Tell your developer; the package needs one more engine.                                         |
| `The table … does not exist`                                                       | Step 1's migrations were not applied to this Supabase project.                                                                     |
| "Incomplete response received from application" or a 503                           | The app crashed while starting. The reason is in `stderr.log`.                                                                     |
| A Node.js "It works!" page                                                         | The startup file is wrong: Setup Node.js App → edit → `app.js`, and check `langgol_app/app.js` is the one from the package.        |
| `Cannot find module`                                                               | The upload is incomplete. Delete `langgol_app/server`, extract the zip again, Restart.                                             |

## Updating later

1. Download the newest `langgol_app.zip` (step 2).
2. **If the update changes the database** (a new folder in `packages/db/prisma/migrations`), the
   developer applies it to Supabase first, with the commands in step 1. Your developer tells you
   when.
3. File Manager → `langgol_app` → delete the **`server`** folder only. **Keep `.env`**: it holds
   your settings and the generated secrets.
4. Upload the zip to `/home/apeirowo` → **Extract** (overwrite). The zip has no `.env`, so yours stays.
5. Setup Node.js App → **Restart**.

## Taking it offline

Setup Node.js App → **Stop** (or delete the app with the trash icon). The data stays in Supabase.

## Good to know

- **The secrets in `.env` matter.** A new `AUTH_SECRET` signs everyone out. A new
  `KYC_ENCRYPTION_KEY` makes every saved identity number unreadable, for good. Back up `.env`
  (download it from File Manager and keep it somewhere private). Never put it in GitHub.
- **Going to production** means real sign-in: `APP_ENV=production` with `AUTH_MODE=firebase` (and
  the Firebase settings) or `AUTH_MODE=otp` with a Bangladeshi SMS provider. Langgol refuses to
  start in production with the demo sign-in. See [`DEPLOYMENT.md`](DEPLOYMENT.md) §2.
- **Backups** are Supabase's: Database → Backups. cPanel's own backup holds no Langgol data, only
  the program and `.env`.
- **Photo and document uploads** need the `FIREBASE_*` settings (see `.env.example`). Without them
  uploads are refused cleanly and everything else works.

## For the developer: how the package is built

```bash
pnpm db:generate                                       # includes the RHEL engines (schema.prisma)
LANGGOL_STANDALONE=1 pnpm --filter @langgol/web run build
node scripts/package-cpanel.mjs                        # → deploy/cpanel/out/langgol_app
```

- `.github/workflows/cpanel-package.yml` runs exactly this on Linux, boots the result, waits for
  `/health`, and uploads the folder.
- The Next.js standalone server is under `server/`, not at the root. CloudLinux's Node.js
  selector reserves `node_modules` in the application root for its own symlink.
- pnpm's symlinked store is flattened into one plain `node_modules`, because cPanel's extraction
  does not reliably recreate symlinks.
- `app.js` ([`deploy/cpanel/app.cjs`](../deploy/cpanel/app.cjs)) loads `.env`, fills in the
  `generate` secrets once, and starts the server. Passenger takes over the port.
- Packaging works locally on Windows too, for a test run with `node app.js` (`PORT=3123`).
  Only the Linux build is for uploading: its native modules match the server.
