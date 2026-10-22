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
| `NEXT_PUBLIC_BASE_URL` | Canonical origin for absolute links |
| `CRON_SECRET` | Bearer secret for `/api/cron/device-watch` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | CRITICAL alerts (optional; no-op until set) |
| `OPENCODE_GO_API_KEY` / `OPENCODE_GO_MODEL` | Chat assistant + feeding prediction (OpenCode Go; model defaults to `deepseek-v4.1-flash`) |
| `DEMO_PIN` | Seed script only |

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

## 3. Git integration (revised 2026-10-21)

- Deployments are restricted by `apps/web/vercel.json`
  (`git.deploymentEnabled`): only `staging` and `main` may create deployments.
  `develop` and all work branches are validation-only.
- `staging` deploys to the Preview environment; `main` deploys to Production.
- There is **no** GitHub Actions deploy workflow (`deploy.yml` deleted,
  decision D4). Do not add one, and do not run `vercel deploy` by hand.
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
