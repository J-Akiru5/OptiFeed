# OptiFeed — Vercel Deployment Checklist

> Current-state checklist (rewritten 2026-10-14; the August 2026 audit
> findings that lived here are resolved or tracked in the plan).

---

## 1. Environment Variables (Vercel → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres (pooled) |
| `DIRECT_URL` | Supabase direct connection (migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only (lockout checks pre-auth) |
| `NEXT_PUBLIC_BASE_URL` | Canonical origin for absolute links (also the reminder email link base) |
| `CRON_SECRET` | Bearer secret for `/api/cron/device-watch` and `/api/cron/crop-watch` |
| `RESEND_API_KEY` / `REMINDER_FROM_EMAIL` | Harvest/sampling reminder email (optional; in-app only until set) |
| `OPENCODE_GO_API_KEY` / `OPENCODE_GO_MODEL` | Chat assistant + feeding prediction (OpenCode Go; model defaults to `deepseek-v4.1-flash`) |
| `DEMO_PASSWORD` | Seed/e2e scripts only |

Notes:
- **No Upstash.** Rate limiting is a PostgreSQL atomic upsert (decision D1):
  fail-closed on login, fail-open on device routes. `UPSTASH_*` is dead.
- **No `SENTRY_*`.** Sentry was removed entirely (2026-10-13); errors log to
  the console (`[obs]`) in Vercel function logs.

## 2. Build Command (H3, revised 2026-10-21)

Vercel runs the `build` script from `apps/web/package.json`:

```
prisma generate && node scripts/migrate-if-production.mjs && next build
```

`scripts/migrate-if-production.mjs` runs `prisma migrate deploy` **only when
`VERCEL_ENV=production`**, i.e. only for the production deployment of `main`.
Staging (`preview`) builds, feature previews, local builds, and CI skip it.

This keeps the H3 mechanism — merged migrations reach production with the
production deployment — while removing the previous behaviour where any
preview build could migrate the shared database. Do not put
`prisma migrate deploy` back into the build script directly.

To apply migrations to a non-production database deliberately, run it with an
explicit target:

```bash
DIRECT_URL=<target direct url> pnpm --filter web exec prisma migrate deploy
```

## 3. Git integration (revised 2026-10-21; branches reconciled 2026-10-31, #323)

- Deployments are restricted by `apps/web/vercel.json`
  (`git.deploymentEnabled`): only `staging` (Preview) and `main` (Production)
  may create deployments. `develop` and all work branches are validation-only.
  [`docs/deployment-workflow.md`](deployment-workflow.md) §1-2 and
  [ADR-0001](adr/0001-deployment-model.md) are authoritative.
- `staging` therefore runs with production credentials (below); it is a
  production-visible preview, not a sandbox. `develop` never deploys.
- There is **no** GitHub Actions deploy workflow (`deploy.yml` deleted,
  decision D4). Do not add one, and do not run `vercel deploy` by hand.
- Promotions (`develop` → `staging` → `main`) are commanded by Jeff, or by the
  OpenCode lead under a standing authorization recorded in `docs/missions/`.
- CI (`.github/workflows/ci.yml`) runs lint/typecheck/tests/auth-gate/Prisma
  validation and a dummy-env `next build` on `develop`, `staging`, and `main`
  — it never touches a database and never deploys.
- **Shared database (accepted):** Production and Preview use the same
  environment variables by decision (prototyping stage), so the staging
  deployment uses the production database. Migrations are still production-only.
  See `docs/deployment-workflow.md` §6.

## 4. Migrations

- Additive-only; destructive statements need a backup (H7) and human OK.
- After restoring a database, run `prisma migrate deploy` manually
  (see `docs/runbook.md`).

## 5. Crop reminder cron and email

- The daily harvest/sampling job is `GET /api/cron/crop-watch`, protected by
  the same `CRON_SECRET` as `device-watch`.
- After the route is deployed, run `docs/sql/cron-crop-watch.sql` once per
  environment in Supabase. Replace only `YOUR_APP_URL`, and store
  `YOUR_CRON_SECRET` in Vault as `crop_watch_secret`. The file uses `pg_cron` +
  `pg_net` and schedules 22:00 UTC (06:00 Asia/Manila) daily.
- Email uses Resend. Set `RESEND_API_KEY`, `REMINDER_FROM_EMAIL` (verified
  sending domain with SPF/DKIM) and `NEXT_PUBLIC_BASE_URL`. When any of the
  three is missing, the job skips email and logs once; in-app notifications are
  still created, so reminders keep working without Resend.
- Email failures are stored on `ReminderLog` (`status = "FAILED"`, `attempts`,
  `lastError`) and retried by later runs up to 3 attempts. A provider outage
  never fails the cron response.
- Reruns are idempotent: `ReminderLog.dedupeKey` is unique per
  occurrence/channel, so a repeat run creates no duplicate notification or
  email.
- **No email verification step here requires a deployment:** validate the
  configuration with `apps/web/.env.example` and a local typecheck/lint; do not
  deploy a branch merely to test the cron.
