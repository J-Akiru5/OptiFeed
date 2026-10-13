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
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Chat assistant |
| `DEMO_PIN` | Seed script only |

Notes:
- **No Upstash.** Rate limiting is a PostgreSQL atomic upsert (decision D1):
  fail-closed on login, fail-open on device routes. `UPSTASH_*` is dead.
- **No `SENTRY_*`.** Sentry was removed entirely (2026-10-13); errors log to
  the console (`[obs]`) in Vercel function logs.

## 2. Build Command (H3)

Vercel Build Command must be:

```
prisma generate && prisma migrate deploy && next build
```

This is how merged migrations reach production. Task 0.3 (removing
`migrate deploy` from the repo's `pnpm build`) is blocked until this is
confirmed in writing.

## 3. Git integration

- Vercel Git integration deploys `develop` (preview) and `main` (production).
- There is **no** GitHub Actions deploy workflow (`deploy.yml` deleted,
  decision D4).
- CI (`.github/workflows/ci.yml`) runs lint/typecheck/tests/auth-gate and a
  dummy-env `next build` on `Karl`/`develop` — it never touches a database.

## 4. Migrations

- Additive-only; destructive statements need a backup (H7) and human OK.
- After restoring a database, run `prisma migrate deploy` manually
  (see `docs/runbook.md`).
