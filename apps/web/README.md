# OptiFeed

Aquaculture feed management for catfish ponds: automated feeding schedules,
biomass/FCR tracking, ESP32 feeder control, and low-pellet / offline alerts.

## Stack

- **Next.js 16** (App Router, next-intl for en/hil) + **Prisma** + **Supabase** (PostgreSQL + Auth)
- **ESP32** feeder over device-token REST (`/api/ingest`, `/api/feed-command`, `/api/schedule-sync`)
- **Telegram** alerts for CRITICAL events, **OpenRouter (DeepSeek)** chat assistant
- pnpm workspaces monorepo (`apps/web`, `packages/config`)

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env   # fill in every key
pnpm --filter web prisma:generate
pnpm --filter web exec prisma migrate deploy   # or migrate dev on a throwaway DB
pnpm --filter web seed:dev                     # demo data (dev only)
pnpm dev
```

Key env vars (full list in `apps/web/.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres (direct URL for migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase Auth |
| `CRON_SECRET` | Bearer secret for `/api/cron/device-watch` (H10 runs the pg_cron SQL) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | CRITICAL alerts (no-op until set) |
| `NEXT_PUBLIC_BASE_URL` | Absolute links in alerts/exports |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` / `OPENROUTER_REASONING_EFFORT` | AI chat + feeding prediction |
| `E2E_ALLOWED_DB_HOST` | Playwright guard: e2e only runs against this DB host |

## Commands (repo root)

| Command | What it does |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm lint` | Biome across the workspace |
| `pnpm typecheck` | `tsc --noEmit` for apps/web |
| `pnpm test` | Vitest unit tests (apps/web) |
| `pnpm test:e2e` | Playwright (requires `DATABASE_URL` + `E2E_ALLOWED_DB_HOST`) |
| `pnpm self-check` | Full plan gate incl. build; `--quick` skips build |

## Branch workflow

1. Work on `Karl`. Never push `develop` or `main` directly.
2. Open a PR `Karl` → `develop`; CI runs lint, typecheck, tests, auth-route gate, and a dummy-env `next build`.
3. Jeff promotes `develop` → `main` for releases (decision D5). Vercel deploys from Git integration.

## Migration rules

- **Additive only**: `ALTER ... ADD` / `UPDATE` are fine; `DROP`/`DELETE` require a human OK and a backup (H7/H9).
- **Never** run `prisma migrate reset` against a shared database.
- Local dev uses `migrate dev` on a throwaway database only.
- Vercel's Build Command runs `prisma generate && prisma migrate deploy && next build` (H3) so merged migrations auto-apply; the repo's `pnpm build` keeps `migrate deploy` until task 0.3 (blocked on H3).

## Firmware

`firmware/firmware-main/firmware-main.ino` — ESP32-WROOM feeder: polls
`/api/feed-command` + `/api/schedule-sync`, posts events to `/api/ingest`
with an `X-Device-Token`. Safety caps live in firmware and mirror
`lib/limits.ts` (`MAX_DISPENSE_MS`, `MAX_GRAMS_PER_DISPENSE`,
`MAX_GRAMS_PER_DAY`).
