# OptiFeed

Aquaculture feed management for catfish ponds: automated feeding schedules,
biomass/FCR tracking, ESP32 feeder control, and low-pellet / offline alerts.

## Stack

- **Next.js 16** (App Router, next-intl for en/hil/tl) + **Prisma** + **Supabase** (PostgreSQL + Auth)
- **ESP32** feeder over device-token REST (`/api/ingest`, `/api/feed-command`, `/api/schedule-sync`)
- **Telegram** alerts for CRITICAL events, **OpenCode Go (DeepSeek V4.1 Flash)** chat assistant
- pnpm workspaces monorepo (`apps/web`, `packages/config`)
- **Languages:** English, Hiligaynon and Tagalog. Tagalog is an incremental overlay with English fallback; see [docs/i18n.md](../../docs/i18n.md).
- **Confirmations:** every mutating action uses a top-right Sonner toast; see [docs/ui-confirmations.md](../../docs/ui-confirmations.md).

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
| `CRON_SECRET` | Bearer secret for `/api/cron/device-watch` and `/api/cron/crop-watch` (the pg_cron SQL files) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | CRITICAL alerts (no-op until set) |
| `RESEND_API_KEY` / `REMINDER_FROM_EMAIL` | Harvest/sampling reminder email (optional; in-app only until all email vars are set) |
| `NEXT_PUBLIC_BASE_URL` | Absolute links in alerts/exports and reminder emails |
| `OPENCODE_GO_API_KEY` / `OPENCODE_GO_MODEL` / `OPENCODE_GO_REASONING_EFFORT` | AI chat + feeding prediction (OpenCode Go) |
| `GEMINI_API_KEY` | Gemini fallback when the primary provider fails |
| `E2E_ALLOWED_DB_HOST` | Playwright guard: e2e only runs against this DB host |

## Commands (repo root)

| Command | What it does |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm lint` | Biome across the workspace |
| `pnpm typecheck` | `tsc --noEmit` for apps/web |
| `pnpm test` | Vitest unit tests (apps/web) |
| `pnpm test:e2e` | Playwright (requires `DATABASE_URL` + `E2E_ALLOWED_DB_HOST`) |
| `pnpm test:e2e:smoke` | Cross-browser public smoke on Chromium, Firefox and WebKit (no database; see [docs/compatibility.md](../../docs/compatibility.md)) |
| `pnpm self-check` | Full plan gate incl. build; `--quick` skips build |

## Crop reminders

Harvest and sampling reminders run from `GET /api/cron/crop-watch`, authenticated
with `Authorization: Bearer $CRON_SECRET`. The route computes due reminders from
active crop cycles and biomass samples, writes one `ReminderLog` row per
occurrence/channel (unique `dedupeKey`), and creates an in-app `Notification`.
Rerunning the job is safe: duplicate inserts are skipped, so the same reminder is
never sent twice.

- **Schedule:** run `docs/sql/cron-crop-watch.sql` once per environment in
  Supabase after the route is deployed. It uses `pg_cron` + `pg_net` and reads the
  secret from Supabase Vault; replace only `YOUR_APP_URL` and store
  `YOUR_CRON_SECRET` as `crop_watch_secret`. The default schedule is 22:00 UTC
  (06:00 Asia/Manila) daily.
- **Email:** set `RESEND_API_KEY`, `REMINDER_FROM_EMAIL` (verified Resend sending
  domain) and `NEXT_PUBLIC_BASE_URL`. If any of the three is missing, email is
  skipped and logged once per process; in-app notifications still run. Email
  recipients are the pond owner plus farm `ADMIN`/`OPERATOR` users, deduplicated.
- **Failures:** a Resend failure is recorded on the `ReminderLog` as
  `status = "FAILED"` with `attempts` and `lastError`. Later daily runs retry up
  to 3 attempts; a failure never fails the whole route.
- **Preferences:** `Pond.notificationPrefs` supports `harvestReminders`,
  `samplingReminders` and `emailReminders` (all default `true`). Legacy rows that
  only contain the feeding/device flags are merged with `true` at read time.

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
