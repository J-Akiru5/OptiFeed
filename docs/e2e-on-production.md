# E2E suite on the production project (isolated `e2e-` fixture)

Mission T-08, decision **D5 (amended)**: there is no separate dev database. The
integrator runs this suite against the **production Supabase project** while
PakaonAI is not in operation. Workers write code only; they never run anything
here.

The suite is isolated by construction:

- the seed creates only `e2e-org`, the three `e2e-*` logins, the farmer's farm,
  `e2e-pond` and the fake feeder `E2:E0:00:00:00:01`;
- the superadmin spec registers `E2:E0:00:00:00:02` (`e2e-feeder-2`);
- every spec logs in as an `e2e-*` account — **nothing logs in as
  `demo-farmer-1`**, and the old demo password reset is gone;
- the temporary platform-admin grant expires after two hours;
- cleanup deletes only rows that match the `e2e-` prefix / reserved MACs and the
  matching Supabase auth accounts.

## Prerequisites

1. **Backup first.** The mission rule is a full backup before any database
   work. This suite does not migrate anything, but take/confirm the backup
   before the first seed anyway.
2. Work from `apps/web` (pnpm sets that as the script CWD). Fill `.env` there:
   - `DATABASE_URL`, `DIRECT_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - `E2E_ALLOWED_DB_HOST` — copy the **hostname after `@`** in `DATABASE_URL`
     (the pooler host or `db.<ref>.supabase.co`; it must match exactly)
   - `E2E_CONFIRM_PRODUCTION=yes`
   - `E2E_PASSWORD` — a strong password used only by the three e2e accounts
   - `DEMO_PASSWORD` is no longer used by Playwright.
3. Confirm the app is not serving live traffic from your local terminal. The
   suite writes to the production project, but never to a real user's rows.

The scripts and Playwright load `apps/web/.env` themselves. Do not export the
service-role key into a shell history file.

## Run order

All commands below run from `apps/web`.

### 1. Seed the fixture

```powershell
pnpm exec tsx scripts/e2e/seed-e2e.ts
```

The script refuses to run unless the host allow-list and
`E2E_CONFIRM_PRODUCTION=yes` match, and unless `E2E_PASSWORD` is set. It prints
the fixture it created (organization, logins, pond, device MAC/label, grant
expiry) and never prints a password or device token.

### 2. Build and start the app locally

```powershell
pnpm build
pnpm exec next start -p 3000
```

`VERCEL_ENV` must be unset locally, so `scripts/migrate-if-production.mjs`
prints `[migrate] skipped` and **no migration runs**. If you see a migration
being applied, stop and check the environment before continuing.

Leave this terminal running. `PLAYWRIGHT_BASE_URL` defaults to
`http://localhost:3000`.

### 3. Run the suite (second terminal, same `apps/web` directory)

```powershell
pnpm test:e2e
```

Global setup re-checks the host allow-list, the acknowledgement, the password
and the seeded fixture. If anything is missing it stops with
“run scripts/e2e/seed-e2e.ts first”. The suite runs with **one worker** on
purpose: it keeps logins inside the 5-attempts/60s limiter and prevents the
RBAC/device specs from racing. Stateful specs do not auto-retry (`retries: 0`);
use the cleanup + re-seed loop below after a failure.

Specs that write:

- tenant sticker print (read-only);
- superadmin register / rotate / print (`e2e-feeder-2`, audit rows);
- RBAC role change + permission override in Settings;
- view-as start/stop (impersonation session + audit rows);
- remote feed refusals (audit rows; the e2e unit is intentionally offline);
- offline banner (read-only);
- the existing farmer specs, including one `e2e-batch-2026` biomass sample.

### 4. Clean up

Preview first:

```powershell
pnpm exec tsx scripts/e2e/cleanup-e2e.ts --dry-run
```

Then delete:

```powershell
pnpm exec tsx scripts/e2e/cleanup-e2e.ts
```

Then verify nothing remains:

```powershell
pnpm exec tsx scripts/e2e/cleanup-e2e.ts --dry-run
```

The last dry run must report `Organizations: 0`, `Users: 0`,
`Auth accounts: 0` (and no fixture identifiers). Stop the `next start` terminal
when done.

## If a run fails

1. Stop the app.
2. Run the cleanup **without** `--dry-run` (it is safe to repeat).
3. Seed again with step 1.
4. Re-run the suite.

A rerun without cleanup can fail on the already-registered
`E2:E0:00:00:00:02`; the spec fails with a message telling you to clean up and
seed again.

## Guard behaviour

| Mistake | What happens |
| --- | --- |
| `E2E_ALLOWED_DB_HOST` differs from the `DATABASE_URL` host | Seed, cleanup and Playwright all refuse before touching data |
| `E2E_CONFIRM_PRODUCTION` is missing or not `yes` | Same refusal |
| `E2E_PASSWORD` is empty | Seed and Playwright refuse |
| Cleanup collects a row that is not `e2e-`-owned | Cleanup refuses the whole run and deletes nothing |
| Seed/global setup finds missing fixture rows | Fails with “run scripts/e2e/seed-e2e.ts first” |

Cleanup also removes the e2e platform audit rows and impersonation sessions,
and the deprecated `Device` rows if one is attached to `e2e-pond`. It never
touches `demo-farmer-1`, `superadmin`, or any row outside the fixture.
