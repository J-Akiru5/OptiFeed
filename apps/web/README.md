# OptiFeed

Aquaculture feed management for catfish ponds: automated feeding schedules,
biomass/FCR tracking, ESP32 feeder control, and low-pellet / offline alerts.

## Stack

- **Next.js 16** (App Router, next-intl for en/hil/tl) + **Prisma** + **Supabase** (PostgreSQL + Auth)
- **ESP32** feeder over device-token REST (`/api/ingest`, `/api/feed-command`, `/api/schedule-sync`)
- **In-app** alerts for CRITICAL events (no Telegram — ADR-0007), **OpenCode Go (DeepSeek V4.1 Flash)** chat assistant
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
| `RESEND_API_KEY` / `REMINDER_FROM_EMAIL` | Harvest/sampling reminder email (optional; in-app only until all email vars are set) |
| `RESET_FROM_EMAIL` | Sender for the password-reset email (optional; falls back to `INVITE_FROM_EMAIL`) |
| `NEXT_PUBLIC_BASE_URL` | Absolute links in alerts/exports and reminder emails |
| `NEXT_PUBLIC_SITE_URL` | Origin advertised by `robots.txt`, `sitemap.xml` and social metadata (defaults to production) |
| `OPENCODE_GO_API_KEY` / `OPENCODE_GO_MODEL` / `OPENCODE_GO_REASONING_EFFORT` | AI chat + feeding prediction (OpenCode Go) |
| `GEMINI_API_KEY` | Gemini fallback when the primary provider fails |
| `E2E_ALLOWED_DB_HOST` | Playwright guard: e2e only runs against this DB host |

Alerts are **in-app only** — a `Notification` row is the source of truth. E-mail
is a best-effort extra (Resend) for crop reminders, invitations and password
resets. There is no Telegram variable and no Telegram client: the platform does
not use Telegram ([ADR-0007](../../docs/adr/0007-no-telegram.md)).

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

## Password recovery

Three routes, in order of preference:

1. **Self-service** — Sign in → *Forgot password?* → `/forgot-password` asks for
   the farm ID, mints the recovery link in code
   (`admin.auth.admin.generateLink`, type `recovery`) and emails it through
   Resend; `/reset-password` sets the new password from that link's session.
   Requests are rate limited (3 per 10 minutes per IP, fail-closed) and never
   reveal whether a farm ID exists. Every request for a real account is written
   to the platform audit log as `platform.user.password_reset_requested`
   (actor `self-service`, `after = { farmId, emailSent }`) — the link itself is
   never recorded.
2. **Platform console** — Superadmin → Users → account → *Reset password*
   issues a one-time temporary password (reason + step-up + audit row
   `platform.user.reset_password`), shown once and forced to change at the next
   sign-in. This is the reliable route: login addresses are internal pond
   mailboxes and cannot receive mail.
3. **CLI** — `pnpm --filter web manage-user reset-password --farm-id <id>
   --password <value>` (temporary + forced change by default).

Reset email needs `RESEND_API_KEY`, `NEXT_PUBLIC_BASE_URL` and a sender:
`RESET_FROM_EMAIL`, falling back to `INVITE_FROM_EMAIL`. If one is missing the
email is skipped with a single warning, the request still succeeds, and the
audit row records `emailSent: false`.

## Branch workflow

1. Work on a short-lived branch cut from `origin/develop`. Never push `develop`,
   `staging` or `main` directly.
2. Open a PR into `develop`; CI runs lint, typecheck, tests, auth-route gate, and a dummy-env `next build`.
3. Releases are commanded promotions: `develop` -> `staging` (Vercel Preview),
   then `staging` -> `main` (Vercel Production). `develop` never deploys. Jeff
   commands each promotion, or the OpenCode lead does under a standing
   authorization recorded in `docs/missions/`. Vercel deploys from the Git
   integration; see `docs/deployment-workflow.md` section 5.0.

## Migration rules

- **Additive only**: `ALTER ... ADD` / `UPDATE` are fine; `DROP`/`DELETE` require a human OK and a backup (H7/H9).
- **Never** run `prisma migrate reset` against a shared database.
- Local dev uses `migrate dev` on a throwaway database only.
- Vercel's Build Command runs `prisma generate && prisma migrate deploy && next build` (H3) so merged migrations auto-apply; the repo's `pnpm build` keeps `migrate deploy` until task 0.3 (blocked on H3).

## Firmware

`firmware/firmware-main/firmware-main.ino` — ESP32-WROOM feeder: polls
`/api/feed-command` + `/api/schedule-sync`, posts events to `/api/ingest`
with an `X-Device-Token`. The server's only gram cap is the device's daily
ceiling (`resolveDailyCapG`, hard guard 5,000 g); 5,000 g is also the payload
sanity bound, not a per-dose limit. The firmware keeps its own hardware safety
caps (`MAX_DISPENSE_MS`, `MAX_GRAMS_PER_DISPENSE`, `MAX_GRAMS_PER_DAY`).
