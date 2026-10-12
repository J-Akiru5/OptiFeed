# OptiFeed: Industry-Grade Hardening Plan (v3: decisions locked, independently reviewed)

Paste this together with `system-context.html`. The briefing says how the system works. This plan says what to change, in what order, and how to prove each change worked.

## 0. Instructions for the executing AI

**Hard rules (from briefing section 2, repeated because they matter most):**
- Work only on branch `Karl`. Start with `git checkout Karl && git pull origin develop --rebase`.
- Never push to `develop` or `main`. Open small PRs from `Karl` to `develop`. One phase task = one commit or one small PR.
- Never run `prisma migrate reset`. Production uses `migrate deploy`. Local dev uses `migrate dev` only on a throwaway database.
- Every new migration must be additive (new columns, tables, indexes, policies). Never write `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` without an explicit human OK in the chat.
- Next.js here is 16. The file is `proxy.ts`, not `middleware.ts`. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before touching routing, route handlers, or caching.
- Match repo style: Biome (tabs, 100 columns, double quotes), Conventional Commits, Server Actions in `lib/actions/`, no code comments.
- Never commit `.env*` or any service-role key.
- Run `git fetch origin` before every `pnpm self-check`, because the migration check diffs against `origin/develop`.
- Do not guess when a fact is not in the briefing. Open the file and read it. Items marked **(verify)** or **(unverified theory)** below are inferred and must be confirmed in code before you fix them.

**How to work:**
1. Do Phase 0 first. Then go in order, P1 to P5.
2. After each phase, run `pnpm self-check` (defined in section 4), fix every FAIL, and report the output to the user before starting the next phase.
3. If a task needs a human (Supabase dashboard, Vercel dashboard, Jeff's decision), do not fake it. Add it to the "Human tasks" list in section 5 and continue with the rest.
4. Confirm the numbers marked **(confirm)** with the user. They depend on the real feeder hardware.

## 0.5 Locked decisions (signed off by the team leader)

These are decided. Do not reopen them. Do not ask the user about them again.

| ID | Decision |
|---|---|
| D1 | Rate limiter: a PostgreSQL table with an atomic upsert. No Upstash Redis. |
| D2 | Scheduler: Supabase `pg_cron` (with `pg_net`) calls the guarded `/api/cron/device-watch` endpoint. No GitHub Actions schedule. |
| D3 | Off-platform alerts: Telegram bot for CRITICAL events (device offline, low pellet). Hardware-fault alerts are a later task (3.7). |
| D4 | Delete `.github/workflows/deploy.yml`. Vercel's Git integration deploys. |

**Approved feeder caps (no longer "confirm"):** max dispense time 300,000 ms (5 minutes), max feed per request 1,000 g, max daily feeder allocation 5,000 g (or `hopperCapacityG` when that is lower).

**Stop-point:** task 0.3 (removing `migrate deploy` from the build script) must NOT be merged until Jeff has confirmed in writing that Vercel's Build Command (H3) runs `prisma migrate deploy`. If you reach the end of your other work and H3 is still open, stop and report. Do not guess.

**Verification status:** every finding in section 1 was checked against the code by an independent review. Rows marked **(corrected)** replace earlier wrong or overstated claims. Rows marked **(confirmed)** were verified.

## 1. Additional bugs and risks found beyond the assessment

The PakaonAI assessment already covers 10 gaps (unbounded feed amounts, duplicate event_id on retry, heartbeat/notification flood, no dead-device alert, untested device routes, roles not enforced, shared database, CI/deploy gaps, thin monitoring, login errors). These are the extra findings, after an independent review against the code.

| # | Finding | Why it matters | Where |
|---|---|---|---|
| N1 **(corrected)** | The feared divide-by-zero is already guarded: `intervalMinutes = (feedsPerDay > 1) ? totalMinutes / (feedsPerDay - 1) : 0`, plus a range check, and `feedsPerDay = 1` already gives a single feed at `schedule_start`. | No bug. Do not change this logic. Keep only a regression check. | `firmware-main.ino` lines ~401 and ~410 |
| N2 **(corrected)** | `requestFeed` already rejects a pending request ("Feed already pending"). The real gap is that a request already `dispatched` to the device is not checked, so a second dose can be queued while the first is running. | Double feeding. | `lib/actions/energy.ts` lines ~41-47 |
| N3 **(confirmed)** | `totalBiomassG` uses `population \|\| 5000`. A pond with no population entered is fed as if it had 5000 fish, which can be 50x too much or too little. | Silent over- or under-feeding, and a wrong FCR. | `lib/feed-calc.ts`, `lib/constants.ts` |
| N4 **(confirmed)** | The deviation guard divides by the current `gramsPerFeeding`. If that is 0 the result is `Infinity` or `NaN`. | Guard misfires. | `lib/actions/biomass.ts` |
| N5 **(confirmed, most serious)** | `apps/web/package.json` line 8 is `prisma generate && prisma migrate deploy && next build`, and `ci.yml` runs `pnpm build` with production `DATABASE_URL` secrets. Every CI build can migrate the production database. | One bad migration on any branch hits production. | `ci.yml`, `apps/web/package.json` |
| N6 **(confirmed)** | The seed and firmware use the well-known token `esp32-tok-cict-001`. Tokens are stored in plaintext. The OTA password equals the device token. | Anyone who reads the repo can impersonate a device or flash firmware if that token exists in production. | `seed.ts`, firmware, `EnergyDevice.token` |
| N7 **(unverified theory)** | "tenant/user not found" looks like a Supabase pooler (Supavisor) connection error from `DATABASE_URL` (wrong pooler user, host or port, or a paused project). The string is not in the repo. The "changed twice" history is most likely `directUrl` being removed and re-added (commits b01eb84 and d22e8cb). | Intermittent login failures that look like auth bugs. | `DATABASE_URL` in Vercel, `loginWithPin` |
| N8 **(confirmed)** | The lockout is per farmId only, and PINs are 4 to 6 digits. Anyone can lock a farm out, and a 4-digit PIN is weak. | Denial of service and brute-force surface. | `lib/auth/lockout.ts` |
| N9 **(corrected)** | The firmware already checks `> 0` for `button_feed_grams`, `hopper_full_cm`, `hopper_empty_cm`, `grams_per_second`, and range-checks `feeds_per_day`. Real holes: `grams_per_feeding` has no check at all, nothing has an upper bound, there is no `hopper_full < hopper_empty` cross-check, and `temp_offset_c` is unchecked. | One bad DB value still drives the relay. | `firmware-main.ino` lines ~341-343 and config parsing |
| N10 **(confirmed)** | "Feed Now" queues a request even when the device is offline. It expires after 60 s with no message to the user, and the button is never disabled. | The farmer thinks the fish were fed. | `requestFeed`, dashboard UI |
| N11 **(corrected)** | The assessment's ~34,500 rows/day is RIGHT. Every heartbeat writes two rows: a `FeedEvent` (`ingest` ~line 109) and an unconditional `DeviceStateEvent` "connected" (`ingest` ~lines 119-126). 17,280 x 2 = 34,560 per day. The earlier plan only thinned the `FeedEvent`. | The "connected" spam also floods the audit page. Retention must be sized for both. | `app/api/ingest`, firmware loop |
| N12 **(corrected)** | `Farm` RLS is already done: migration `20261004010000_fix_rls_policies_and_farm` (on Karl/develop) enables RLS on `Farm` with 2 working policies and repairs every broken policy to use the email local part, including `Notification`. Only `User` has no RLS (no migration touches it). Production still has only the broken Aug-31 policies, or none. H2 checks. | Data exposure on `User` if the Data API is reachable. | RLS migrations |
| N13 **(confirmed)** | `Notification.linkTo` hardcodes `/en/` (known). | Wrong locale for Hiligaynon users. | notification creators |
| N14 **(confirmed)** | `OFFLINE_THRESHOLD_MS` is copy-pasted in 6 files, `STALE_*` in 2, and hopper and gram constants conflict with DB defaults (known). | The same rule drifts apart over time. | see briefing section 17 |
| N15 **(new, confirmed)** | Same cause as N11: an unconditional "connected" `DeviceStateEvent` is written on every heartbeat, not only when the device returns from offline. | 17,280 junk rows per device per day, and an unreadable audit page. | `app/api/ingest` ~lines 119-126 |

Confirmed by the review: N3, N4 (`biomass.ts` ~line 97 divides by zero, giving Infinity, so the guard always rejects), N5, N6 (token hardcoded, and `ArduinoOTA.setPassword(DEVICE_TOKEN)` confirmed), N8, N10, N12 (User part), N13, N14.

## 2. The plan

Every task has an ID, the change, the acceptance test, and a check. "Check" means something `pnpm self-check` or a named command can verify.

### Phase 0: Safety net (no behavior change)

| ID | Task | Acceptance |
|---|---|---|
| 0.1 | Sync branch. Run `pnpm install --frozen-lockfile`, `pnpm prisma:generate`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Record the baseline (expected 109 tests in 13 files passing). | Baseline numbers reported to the user. |
| 0.2 | Add `scripts/self-check.mjs` (section 4) and the root script `"self-check": "node scripts/self-check.mjs"`. Commit as `chore: add self-check script`. | `pnpm self-check --quick` runs. Many FAILs are expected at baseline. |
| 0.3 **(STOP-POINT)** | The `build` script is confirmed to run `prisma migrate deploy`. Change it to `prisma generate && next build`. Do this in its own PR, separate from 0.2. **Do not merge it until Jeff confirms H3 in writing** (Vercel's Build Command must still run `prisma generate && prisma migrate deploy && next build`), otherwise production silently stops getting migrations. Until then, `pnpm self-check` cannot fully pass (the full self-check skips the `pnpm build` step while this task is open, see section 4), so report this as an open blocker rather than working around it. | `pnpm build` never touches a database schema. Self-check verifies. |
| 0.4 | Add `apps/web/lib/limits.ts` skeleton exporting named constants (filled in 1.1). | File exists. |

### Phase 1: Protect the fish and the feed data (critical)

**1.1 Server-side bounds (gap #1, N2, N3, N4, N10).** Create `lib/limits.ts` with these constants and one Zod schema per input. The feed caps are approved (section 0.5). Confirm only the other ranges with the user.

| Constant | Suggested default (confirm) |
|---|---|
| `MAX_FEED_GRAMS_PER_REQUEST` | 1000 (approved) |
| `MAX_FEED_GRAMS_PER_DAY_PER_DEVICE` | 5000 (approved), and never more than `hopperCapacityG` when set |
| `MAX_DISPENSE_MS` | 300000 (approved) |
| `FEEDING_RATE_PCT` range | 0.1 to 10 |
| `FEEDS_PER_DAY` range | 1 to 24, integer |
| `BUTTON_FEED_GRAMS` range | 1 to 500 |
| `POPULATION` range | 1 to 1,000,000, integer |
| `SAMPLE_COUNT`, `sampleWeightKg`, `sampleLengthCm` | integer at least 1, number greater than 0, number greater than 0 |

Apply them in:
- `requestFeed`, `updateScheduleCommand`, `updatePondSettings`, `saveBiomassLog`, and `updateNotificationPrefs` (use the Zod schema from `lib/limits.ts`).
- `/api/feed-command` and `/api/schedule-sync` (clamp everything sent to the device).
- `requestFeed` must also reject when a dispatched `FeedRequest` exists for the device (N2; the pending check already exists, keep it). It must reject when `grams / gramsPerSecond` exceeds `MAX_DISPENSE_MS / 1000`, so the firmware never has to truncate a valid dose.
- Schedule validation (`updateScheduleCommand`, `updatePondSettings`) must reject any `feedsPerDay x gramsPerFeeding` above the daily cap (not only single requests), and any single `gramsPerFeeding` whose run time exceeds `MAX_DISPENSE_MS`.
- `requestFeed` (continued): It must reject when the device's `lastSeenAt` is older than the offline threshold (N10), with a clear error message. It must reject when today's total (completed plus pending grams, in Asia/Manila) plus the request exceeds `MAX_FEED_GRAMS_PER_DAY_PER_DEVICE`.
- Offline rejection also applies in the UI (decision locked): disable the "Feed Now" button in `components/FeedNowButton.tsx` while `lastSeenAt` is older than the offline threshold (the component already computes `isOffline` and shows `offlineWarning`; the button must also stop being clickable), and keep the `offlineWarning` text visible next to the disabled button. Update every copy that promises queueing: `messages/en.json` and `messages/hil.json` `offlineWarning` (say the request is rejected, retry when the device reconnects), `offlineDesc` (split the wording: feed requests are rejected while the device is offline, schedule changes still apply when it reconnects), keep `alreadyQueued` as it is (pending while online is still valid), and the hardcoded English string in `components/EnergyControllerCard.tsx` (~line 108, "dashboard commands will queue") must say dashboard commands are rejected instead (device-local scheduled and physical button feeds still work while offline). Add a test that `requestFeed` rejects when `lastSeenAt` is older than `OFFLINE_THRESHOLD_MS`.
- `lib/feed-calc.ts`: remove the silent `|| DEFAULT_FISH_COUNT` fallback from automatic feeding. If `population` is null, `syncDeviceGramsForPond` and `saveBiomassLog` must skip the auto-adjust and record a `DeviceStateEvent` saying why. UI previews may still show an estimate, clearly labeled. Keep the locked reference values in `feed-calc.test.ts` passing.
- `lib/actions/biomass.ts`: if current `gramsPerFeeding` is 0 or not finite, skip the deviation comparison and accept a value that passes the bounds.

Acceptance: tests that send out-of-range values get a validation error and write nothing. A second "Feed Now" while one is pending is rejected. Feed Now while the device is offline is rejected server-side, and the button is disabled with the offline warning visible. The user sees a readable message, not a stack trace.

**1.2 Firmware safety (gap #1, N9).** In `firmware-main.ino`:
- Add `#define MAX_DISPENSE_MS 300000UL`. If a requested dose's computed time exceeds it, the firmware must REFUSE the dose and report an error event, not silently truncate it (a device calibrated to 2 g/s would otherwise deliver half of a valid 1,000 g dose). Keep a clamp in `dispenseFeed` only as a backstop. Every relay-on path also gets a hard stop check in `loop()` that forces `RELAY_OFF` if the relay has been on longer than `MAX_DISPENSE_MS`.
- Add `MAX_GRAMS_PER_DISPENSE` and a RAM daily gram counter that resets at local midnight from the RTC. Refuse dispenses that would exceed `MAX_GRAMS_PER_DAY`.
- Validate every server-pushed value before storing it. Existing `> 0` checks stay. Add what is missing (N9): a range check on `grams_per_feeding` (it has none today), upper bounds on every value, `gramsPerSecond` in 0.5 to 50, `buttonFeedGrams` in range, `hopperFullCm` less than `hopperEmptyCm`, and a range on `temp_offset_c`. Ignore the whole config on any failure.
- N1 needs no change (already guarded). Do not touch the interval logic.
- Enable the ESP32 task watchdog (`esp_task_wdt_init`) so a hung loop reboots, and the boot code still forces `RELAY_OFF`.

Acceptance: static checks in self-check (names above must exist). The firmware caps equal the server caps in `lib/limits.ts`: `MAX_GRAMS_PER_DISPENSE` = `MAX_FEED_GRAMS_PER_REQUEST` (1,000 g), `MAX_GRAMS_PER_DAY` = `MAX_FEED_GRAMS_PER_DAY_PER_DEVICE` (5,000 g), `MAX_DISPENSE_MS` (300,000 ms) identical on both sides. Human test on the bench device (H6): command a huge dose and confirm the relay stops at the cap.

**1.3 Idempotent events (gap #2).**
- Firmware: generate `eventId` once when the event is created. Add an `eventId` field to the queued-event struct. `postFeedEvent` takes the id as a parameter and never calls `generateEventId()` itself. A retry resends the same id.
- Server `/api/ingest`: for `feed_dispensed`, if `requestId` is present, treat a second event with the same `requestId` and `source` as a duplicate (204), even if `event_id` differs. Keep the existing `event_id` dedupe.

Acceptance: a test posts the same `feed_dispensed` twice, and the second post creates no new row and no extra grams.

**1.4 Notification dedup and heartbeat retention (gap #3, N11, N15).**

This task must land BEFORE any Telegram work (3.5). Otherwise a hopper at 5% sends a message every 5 seconds.
- Pellet alerts fire only on a tier transition (above 20 to 20 or below, above 5 to 5 or below) or at most once every 6 hours while still low. Implement this by checking for an existing unacknowledged `Notification` of category `pellet` and the same tier for that pond within the window, or by storing the last notified tier on `EnergyDevice` (additive migration). The `pellet_low` `DeviceStateEvent` follows the same rule.
- Heartbeats are one per 5 s (17,280/day). Each currently writes two rows (N11, N15).
- Stop writing a `FeedEvent` row for every heartbeat. The review found no code that reads `eventType: "heartbeat"` rows (only `history.ts` reads `feed_dispensed`), so thinning is safe; still run the grep once to confirm. Keep `lastSeenAt` updated on every heartbeat, and write a heartbeat row at most once per 5 minutes per device unless a value changed.
- Stop writing the "connected" `DeviceStateEvent` on every heartbeat (N15). Write it only when the device was previously offline (`lastSeenAt` older than `OFFLINE_THRESHOLD_MS`) or has no prior state.
- Add retention: the guarded cron endpoint (see 3.1) deletes heartbeat `FeedEvent` rows older than 7 days in small batches (about 5,000 per run, so each run stays well under the Vercel Hobby 10-second function limit). Add a composite index on `(deviceId, timestamp)` (or whatever the table uses) in an additive migration.
- Do not delete the `connected` rows already in the database: historical rows stay until a human explicitly approves a cleanup (deletions need a human OK). The retention above covers heartbeat `FeedEvent` rows only.

Acceptance: a test sends 100 heartbeats at 3 percent and gets at most one CRITICAL notification, and 100 heartbeats from an online device write no extra "connected" events.

**1.5 Role enforcement (gap #6).** Add `requireWriteAccess()` in `lib/auth/session.ts` (allows `ADMIN` and `OPERATOR`, rejects `VIEWER`). Call it at the top of: `requestFeed`, `toggleDevicePause`, `updateScheduleCommand`, `updatePondSettings`, `updateNotificationPrefs`, `saveBiomassLog`, `saveHopperCalibration`, `saveDurationCalibration`, `saveTemperatureCalibration`, `setDeviceTime`, `renameFarm`, and `/api/import` plus `/api/import/confirm`. Disable the matching buttons in the UI for VIEWER.

Acceptance: tests show a VIEWER gets an error and nothing is written for every action listed.

### Phase 2: Security

| ID | Task | Acceptance |
|---|---|---|
| 2.1 | Identity (briefing section 17 #4): `getCurrentUser()` must look the user up by the Supabase auth user id (`User.supabaseId`) and confirm the farmId matches the email prefix. Never trust only the email local part. Add tests with an email like `demo-farmer-1@evil.com`. | Test passes: the wrong-domain email cannot act as the farm. |
| 2.2 | Close signup (briefing section 17 #2). `createUser` already uses `supabase.auth.admin.createUser` (Admin API, `admin.ts`), so that part is done. Remaining work: DELETE `app/[locale]/signup/` (do not redirect; the self-check requires the page file to be gone), and remove the dead signup branch in `proxy.ts`. Human task H1 turns off "Allow new users to sign up". | No public signup route. `createUser` still works for an admin. |
| 2.3 | RLS, `User` table only. `Farm` RLS and the repaired `Notification` policies already exist in migration `20261004010000_fix_rls_policies_and_farm`; do not redo them. Order matters: (1) H7 backups confirmed first, (2) run on the dev Supabase project first, never production first. Add one additive migration that enables RLS on `User` with no anon or authenticated policies (deny by default; Prisma keeps access through the database owner role). Re-check that Realtime on `Notification` still works for a logged-in farmer on the dev database. | `select tablename, rowsecurity from pg_tables where schemaname='public'` shows `true` for every table except `Device` and `FeedingEvent` (deprecated, dropped later under H9, and intentionally untouched here): `Farm`, `PondOwnershipHistory`, the 12 Aug-31 tables and `user_lockout` already are `true`, and this task makes `User` `true` (H2 runs the query and reports which tables, if any, are `false`). Realtime bell still works in dev. |
| 2.4 | Device tokens (N6): store a SHA-256 hash of each token, compare with `crypto.timingSafeEqual`, and give every device a unique random token. Rotate any device still using `esp32-tok-cict-001` before pilot use. Give OTA its own password, separate from the token. The seed may keep the demo token for local dev only. | Auth by hash works. A static check finds no plaintext compare. H5 confirms the demo token is not in production. |
| 2.5 | Firmware TLS (briefing section 19.4): call `secureClient.setCACert(...)` with the root CA that signs your host. Check the real chain of the production domain first, and document how to update it. Keep a clear error path when verification fails. | Self-check finds `setCACert`. Bench test with a wrong CA fails to connect (H6). |
| 2.6 | Rate limiting (decision D1, locked): replace the in-memory `Map` with a PostgreSQL table using an atomic upsert (`INSERT ... ON CONFLICT DO UPDATE` on `(key, window_start)`, additive migration). No Upstash. Keep the same limits (login 5 per 60 s per IP, API 30 per 60 s per user, device 20 per 60 s). Fail CLOSED on login if the table is unreachable, fail OPEN on the device routes, so a limiter outage cannot stop feeding. Old rows must be deleted periodically: the `pg_cron` job from 3.1 runs a cleanup of expired windows. | The unit test for the store passes. A test shows login is rejected when the store throws. |
| 2.7 | Lockout and PIN (N8): lock per `(farmId, ip)` pair for 5 attempts per 15 minutes, plus a global per-farmId threshold of 20 failures per hour that only slows login and notifies, so a stranger cannot lock the real farmer out. New and reset PINs must be at least 6 digits. | Tests cover both rules. |
| 2.8 | Login errors (N7, gap #10): wrap the Prisma calls in `loginWithPin` with a try and catch that returns a friendly "service temporarily unavailable, try again" message, retries once on connection errors, and reports to Sentry. Human task H4 checks `DATABASE_URL` against the Supabase "Connect" page (user `postgres.<project-ref>`, transaction pooler port 6543, `?pgbouncer=true&connection_limit=1`, plus `DIRECT_URL` on the session or direct port for migrations). | Test: with Prisma mocked to throw, login shows the friendly message and does not crash. |
| 2.9 | Delete `registerEnergyDevice` (unused, has a missing-auth path). | `grep` finds no match. |

### Phase 3: Reliability and observability

| ID | Task | Acceptance |
|---|---|---|
| 3.1 | Dead-device alerts (gap #4, decision D2, locked). Add `GET /api/cron/device-watch` protected by `withCronAuth()` (add it to `lib/auth/with-auth.ts`, so the existing CI auth gate passes). It requires `Authorization: Bearer $CRON_SECRET`. It finds devices with `lastSeenAt` older than the offline threshold and no `disconnected` event since `lastSeenAt`, then creates the `disconnected` `DeviceStateEvent` plus a CRITICAL `connectivity` notification. The same endpoint runs heartbeat retention (1.4) and rate-limit table cleanup (2.6) in small batches, so each run stays under the Vercel Hobby 10-second limit. Scheduling uses Supabase `pg_cron` AND the `pg_net` extension (`pg_cron` only runs SQL; `pg_net` makes the HTTP call). Store `CRON_SECRET` in Supabase Vault, not in plain SQL. Write the job as a documented SQL file (`docs/sql/cron-device-watch.sql`, with placeholders for the URL and secret). A human runs it by hand in each environment (H10), so the production URL never ends up in the dev database. Add `CRON_SECRET` to `.env.example`. | Test: a stale device gets exactly one alert and no repeat. A request without the secret gets 401. The SQL file exists and contains no real URL or secret. |
| 3.2 | Error tracking (gap #9): add `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `GEMINI_MODEL`, `NEXT_PUBLIC_BASE_URL`, `DEMO_PIN` to `.env.example`. Tag device-route errors with `deviceId`. Capture exceptions in the catch blocks of ingest, feed-command, schedule-sync, login, and the cron route. Keep `tracesSampleRate` low (0.1). H4 sets the DSN in Vercel. | `.env.example` contains `SENTRY_DSN`. |
| 3.3 | Central constants: move `OFFLINE_THRESHOLD_MS`, `STALE_SENT_MS`, `STALE_DISPATCHED_MS`, `REQUEST_EXPIRY_MS`, `RECONCILIATION_LOOKBACK_HOURS`, and the hopper thresholds into `lib/constants.ts` (or `lib/thresholds.ts`). Delete the copies and the unused hopper and gram constants that conflict with DB defaults. | Self-check: one definition per constant. |
| 3.4 | Backups (H7): confirm what your Supabase plan backs up. If it is not daily with a tested restore, add a scheduled `pg_dump` (GitHub Actions to private storage). Do one restore test into the dev project. This matters because of the earlier production wipe. | Human sign-off. |
| 3.5 | Telegram alerts (decision D3, locked) for CRITICAL events: device offline and low pellet. Requires 1.4 (dedup) to be merged first. Add a `lib/notify/telegram.ts` send helper with one retry and a timeout, called from the notification creators. Read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from the environment and add both to `.env.example`. Limitation to document: one chat ID means every farm's alerts go to one chat. That is fine for a pilot or an ops group; a per-farm contact field (additive migration) is a later task. Never log the bot token. | Test with a mocked sender: one message per alert, none on repeats, failure of Telegram never breaks ingest. |
| 3.6 (optional) | Missed-feed detection: the cron route also raises a WARNING when a scheduled feed time passed and no `feed_dispensed` arrived within 15 minutes. | Test with a stubbed clock. |
| 3.7 (later, not in the first version) | Hardware-fault alerts. Nothing reports a hardware fault today (the system has offline, low pellet and some schedule events). This needs a new device event type, a firmware change to emit it (including the "dose refused" error from 1.2), and a Telegram template. Treat it as its own task after 3.5 is working. | Separate plan item. |

### Phase 4: Tests and CI

| ID | Task | Acceptance |
|---|---|---|
| 4.1 | Device route tests (gap #5), Vitest with Prisma mocked. For `/api/ingest`: invalid token (401), bad body (400), duplicate `event_id` (204, no write), duplicate `requestId` (204), rate limit, pellet thresholds and dedup, reconnect auto-clear, `schedule_acked` applies the Pond update, `feed_dispensed` completes the `FeedRequest`. For `/api/feed-command`: no request returns an empty body, pending is marked dispatched, expiry after 60 s, outgoing values clamped. For `/api/schedule-sync`: pending command is marked sent, baseline is returned. | New test files exist. All pass. |
| 4.2 | Tests for limits, roles, `getCurrentUser`, `loginWithPin` failure, lockout, `device-watch`, and the feed-calc edge cases (null population, zero grams). | `pnpm test` passes with more than the 109 baseline. |
| 4.3 | CI: in `.github/workflows/ci.yml` also trigger on pull requests to `develop` (and pushes to `Karl`). Use dummy env values for the build step (no real DB secrets), and keep the API auth grep gate. A `next build` with a fake DB env is unproven: verify it at this phase, because it fails if any page queries the database at build time. If it does, fix that page or use a throwaway local database in CI instead. Pin pnpm through the root `packageManager` field everywhere (briefing section 17 #13). Delete `deploy.yml` (decision D4, locked: Vercel's Git integration deploys, and the file is invalid). | Self-check: `ci.yml` mentions `develop`, `deploy.yml` has no `secrets.` in an `if:`. |
| 4.4 | Guard Playwright: the e2e setup must stop if `DATABASE_URL` is not on an allow-listed host (`E2E_ALLOWED_DB_HOST`), so tests can never run against production (gap #7). The dev Supabase project (H8) must exist before RLS migrations or Playwright runs. | Running e2e with a prod URL fails fast. |
| 4.5 (optional) | A CI step that compiles the firmware with `arduino-cli`. | Job passes. |
| 4.6 | Separate environments (H8): a second Supabase project for dev and tests. | Human sign-off. |

### Phase 5: Cleanup and consistency

| ID | Task | Acceptance |
|---|---|---|
| 5.1 | Fix N13: store `linkTo` without a locale (for example `/dashboard/notifications`) and resolve it with the locale-aware `Link` or `getPathname`. Add a one-off, additive-safe data fix for existing rows (update, never delete). | No `"/en/` string in notification creators. |
| 5.2 | Deprecated models: first stop writing `Device` and `FeedingEvent` in `seed.ts`. Dropping the tables is a later, separate release, after a backup and Jeff's OK (H9). Do not drop them in this plan. | Seed no longer writes them. |
| 5.3 | Stub packages: remove `@optifeed/types` and `@optifeed/ui` from workspace dependencies, or fill them. Recommended: remove them, and leave `packages/config`. Resolve the 9 `TODO(karl)` comments or turn each into a tracked issue. | `pnpm install` and `pnpm build` still pass. |
| 5.4 | Docs: replace `apps/web/README.md` with a real one (setup, env, commands, branch workflow, the migration rules). Fix or delete the stale parts of `docs/vercel-deployment-checklist.md` (remove Upstash unless D1 re-adds it) and `Firmware-Implementation`. Add a short `docs/runbook.md`: what to do if the feeder runs wild, the device is offline, or the database is down, and how to restore a backup. | Docs exist. |
| 5.5 | Product wording: ask the user whether this is catfish or shrimp, then make README, landing page, and metadata consistent. Do not translate new copy into Hiligaynon until the English text is final. | User confirmed. |

### Phase 6: Release (Jeff only)

The AI does not do this. It prepares a release note listing the migrations in order (so `migrate deploy` is predictable), the new env vars, and a rollback note. Jeff promotes `develop` to `main` (decision D5), after H1 to H8.

## 3. Per-task test commands

Run from the repo root after each task, then run the full `pnpm self-check`.

```
pnpm lint
pnpm typecheck
pnpm --filter web test -- lib/__tests__/<file>.test.ts
pnpm --filter web exec vitest run lib/__tests__/feed-calc.test.ts
pnpm self-check --quick
```

## 4. Self-check script

Create `scripts/self-check.mjs` exactly as below and add `"self-check": "node scripts/self-check.mjs"` to the root `package.json`. Run `pnpm self-check` (full, includes `pnpm build`) before every PR and at the end of every phase. Use `pnpm self-check --quick` while iterating (skips the build). Safety rule: the script refuses to run `pnpm build` while the build script still contains `migrate deploy` (task 0.3 open) and records that as a FAIL instead, so a full run can never migrate a database by accident; until 0.3 merges, phase-end runs stop at that FAIL and report 0.3 as the blocker. It exits with code 1 if anything fails. At baseline the static checks fail until their tasks are done, so the output is also a progress meter.

```js
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const quick = process.argv.includes("--quick");
spawnSync("git fetch origin", { shell: true, encoding: "utf8" });
const results = [];

function record(name, ok, detail = "") {
	results.push({ name, ok });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function sh(cmd) {
	return spawnSync(cmd, { shell: true, encoding: "utf8" });
}

function read(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === ".next" || name === ".git") continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

function posix(p) {
	return p.split("\\").join("/");
}

const web = "apps/web";
const sourceFiles = walk(web)
	.filter((f) => /\.(ts|tsx)$/.test(f))
	.map(posix);
const resetCmd = ["migrate", "reset"].join(" ");

const branch = sh("git branch --show-current").stdout.trim();
record("on branch Karl", branch === "Karl", branch);

const staged = sh("git diff --cached --name-only").stdout.split("\n").filter(Boolean);
const stagedEnv = staged.filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith(".env.example"));
record("no .env files staged", stagedEnv.length === 0, stagedEnv.join(", "));

const guarded = [
	"package.json",
	`${web}/package.json`,
	...walk(".github").map(posix),
	...walk("scripts")
		.map(posix)
		.filter((f) => !f.endsWith("self-check.mjs")),
];
const resetHits = guarded.filter((f) => read(f).includes(resetCmd));
record(
	"no destructive reset command in scripts or workflows",
	resetHits.length === 0,
	resetHits.join(", "),
);

const buildScript = JSON.parse(read(`${web}/package.json`) || "{}").scripts?.build ?? "";
record(
	"web build script does not run migrate deploy",
	!buildScript.includes("migrate"),
	buildScript,
);

const diffRes = sh(
	`git diff --name-only --diff-filter=A origin/develop -- ${web}/prisma/migrations`,
);
record(
	"can diff against origin/develop",
	diffRes.status === 0,
	diffRes.status === 0 ? "" : "run git fetch origin",
);
const newMigrations = diffRes.stdout.split("\n").filter((f) => f.endsWith(".sql"));
const destructive = newMigrations.filter((f) =>
	/DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE/i.test(read(f)),
);
record(
	"new migrations are additive (no DROP/TRUNCATE)",
	destructive.length === 0,
	destructive.join(", "),
);

record("no middleware.ts (Next 16 uses proxy.ts)", !existsSync(`${web}/middleware.ts`));

const apiRoutes = sourceFiles.filter((f) => /app\/api\/.+\/route\.ts$/.test(f));
const allow = /api\/(ingest|feed-command|schedule-sync|health)\//;
const noAuth = apiRoutes.filter(
	(f) => !allow.test(f) && !/from "@\/lib\/auth\/(session|with-auth)"/.test(read(f)),
);
record("every API route has an auth import", noAuth.length === 0, noAuth.join(", "));

record("limits module exists", existsSync(`${web}/lib/limits.ts`));
for (const f of ["energy", "schedule", "settings", "biomass"]) {
	record(`actions/${f}.ts uses limits`, read(`${web}/lib/actions/${f}.ts`).includes("limits"));
}

const writeActions = ["energy", "schedule", "settings", "biomass", "time", "farm"];
for (const f of writeActions) {
	record(
		`actions/${f}.ts enforces write access`,
		read(`${web}/lib/actions/${f}.ts`).includes("requireWriteAccess"),
	);
}
record(
	"requireWriteAccess defined",
	read(`${web}/lib/auth/session.ts`).includes("requireWriteAccess"),
);

for (const f of ["import", "import/confirm"]) {
	record(
		`api/${f} enforces write access`,
		read(`${web}/app/api/${f}/route.ts`).includes("requireWriteAccess"),
	);
}

record(
	"registerEnergyDevice removed",
	!sourceFiles.some((f) => read(f).includes("registerEnergyDevice")),
);

const deviceRoutes = sourceFiles.filter((f) =>
	/app\/api\/(ingest|feed-command|schedule-sync)\/route\.ts$/.test(f),
);
const timingHelper = sourceFiles.some(
	(f) => f.startsWith("apps/web/lib/") && read(f).includes("timingSafeEqual"),
);
record(
	"device routes verify tokens with timingSafeEqual",
	deviceRoutes.length === 3 &&
		timingHelper &&
		deviceRoutes.every((f) => /timingSafeEqual|@\/lib\/auth\//.test(read(f))),
);

record(
	"getCurrentUser looks up by supabaseId",
	/supabaseId/.test(read(`${web}/lib/auth/session.ts`)),
);

record("signup route deleted (not redirected)", !existsSync(`${web}/app/[locale]/signup/page.tsx`));

record(
	"FeedNowButton disables when offline",
	/disabled=\{[^}]*isOffline/.test(read(`${web}/components/FeedNowButton.tsx`)),
);

const thresholdDefs = sourceFiles.filter((f) => /const\s+OFFLINE_THRESHOLD_MS/.test(read(f)));
record("OFFLINE_THRESHOLD_MS defined once", thresholdDefs.length <= 1, thresholdDefs.join(", "));

const hardLinks = sourceFiles.filter(
	(f) => !f.includes("__tests__") && /linkTo[^\n]*["`]\/en\//.test(read(f)),
);
record("no hardcoded /en/ in notification links", hardLinks.length === 0, hardLinks.join(", "));

const fw = read("firmware/firmware-main/firmware-main.ino");
record("firmware: MAX_DISPENSE_MS defined", /MAX_DISPENSE_MS/.test(fw));
record(
	"firmware: queued event stores its own eventId",
	/struct\s+\w+\s*\{[^}]*eventId[^}]*\}/.test(fw),
);
record("firmware: TLS certificate set", /setCACert|attachBundle/.test(fw));
record("firmware: watchdog enabled", /esp_task_wdt_init/.test(fw));

const tests = sourceFiles.filter((f) => /\.(test|spec)\.tsx?$/.test(f));
for (const route of ["ingest", "feed-command", "schedule-sync"]) {
	record(
		`tests cover /api/${route}`,
		tests.some((f) => read(f).includes(`api/${route}`)),
	);
}

const envExample = read(`${web}/.env.example`);
for (const key of [
	"SENTRY_DSN",
	"SENTRY_ORG",
	"SENTRY_PROJECT",
	"GEMINI_MODEL",
	"NEXT_PUBLIC_BASE_URL",
	"DEMO_PIN",
	"CRON_SECRET",
	"TELEGRAM_BOT_TOKEN",
	"TELEGRAM_CHAT_ID",
]) {
	record(`.env.example documents ${key}`, envExample.includes(key));
}

const ci = read(".github/workflows/ci.yml");
record("CI runs for develop", ci.includes("develop"));
record(
	"deploy.yml deleted (Vercel Git integration deploys)",
	!existsSync(".github/workflows/deploy.yml"),
);
record("device-watch cron route exists", existsSync(`${web}/app/api/cron/device-watch/route.ts`));
record("cron SQL file exists", existsSync("docs/sql/cron-device-watch.sql"));
record("telegram helper exists", existsSync(`${web}/lib/notify/telegram.ts`));
record("no Upstash dependency (D1 uses Postgres)", !/@upstash\//.test(read(`${web}/package.json`)));
const limiterFiles = sourceFiles.filter(
	(f) => /rate-limit|limiter/.test(f) && !f.includes("__tests__"),
);
record(
	"rate limiter has no in-memory Map store",
	limiterFiles.length > 0 && !limiterFiles.some((f) => /new Map/.test(read(f))),
	limiterFiles.filter((f) => /new Map/.test(read(f))).join(", "),
);

function run(name, cmd) {
	const r = sh(cmd);
	record(name, r.status === 0, r.status === 0 ? "" : `exit ${r.status}`);
	if (r.status !== 0) console.log((r.stdout + r.stderr).split("\n").slice(-25).join("\n"));
}

run("pnpm lint", "pnpm lint");
run("pnpm typecheck", "pnpm typecheck");
run("pnpm test", "pnpm test");
if (!quick && buildScript.includes("migrate")) {
	record(
		"pnpm build skipped: build script still runs migrate deploy (task 0.3)",
		false,
		"merge 0.3 first",
	);
} else if (!quick) {
	run("pnpm build", "pnpm build");
}

const arduino = sh("arduino-cli version");
if (arduino.status === 0) {
	record("firmware compiles", true, "arduino-cli found; compile manually with your board FQBN");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
	console.log(`Failed:\n${failed.map((r) => `  - ${r.name}`).join("\n")}`);
	process.exit(1);
}
```

**After self-check, the AI must also answer these questions in its report (things a script cannot prove):**
1. Which tasks from this plan are done, partly done, or skipped, and why?
2. Did any change touch a migration? List the files and confirm each is additive.
3. Which items marked **(verify)** or **(unverified theory)** turned out to be true, and which were not?
4. Which values marked **(confirm)** did the user approve?
5. What does the user still have to do in the dashboards (section 5)?
6. Is task 0.3 merged, and if not, is H3 still open?

## 5. Human tasks and decisions

Karl or Jeff must do these. The AI cannot.

| ID | Who | Task |
|---|---|---|
| H1 | Karl | Supabase, Authentication, turn off "Allow new users to sign up". |
| H2 | Karl | Run `select tablename, rowsecurity from pg_tables where schemaname='public';` and report the result. |
| H3 **(blocks 0.3)** | Jeff | Vercel Build Command must be `prisma generate && prisma migrate deploy && next build` (or an equivalent). Jeff must confirm this IN WRITING before the 0.3 PR is merged. |
| H4 | Karl | Check `DATABASE_URL` and `DIRECT_URL` format in Vercel. Set `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `CRON_SECRET`. Add the uptime monitor for `/api/health` (for example UptimeRobot or Better Stack). |
| H5 | Karl | Run `select count(*) from "EnergyDevice" where token = 'esp32-tok-cict-001';` on production. It must be 0 before real use. Rotate tokens on real devices. |
| H6 | Karl | Bench-test firmware: huge dose stops at the cap, wrong certificate refuses to connect, power cycle keeps the relay OFF, unplug WiFi and confirm the button still works, and the retry test (kill the reply) creates no duplicate row. |
| H7 **(do first)** | Jeff | Confirm backups and do one restore test, BEFORE any RLS or other migration. This matters because of the earlier production wipe. |
| H8 **(do before RLS and e2e)** | Jeff | Create a separate Supabase project for dev and tests. Run every new migration there first. |
| H9 | Jeff | Approve dropping the deprecated `Device` and `FeedingEvent` tables, in a later release, after a backup. |
| D1 | Locked | Postgres atomic-upsert rate limiter. No Upstash. |
| D2 | Locked | `pg_cron` + `pg_net` calling `/api/cron/device-watch`. |
| D3 | Locked | Telegram bot for CRITICAL events. Hardware faults come later (3.7). |
| D4 | Locked | Delete `deploy.yml`. |
| D5 | Jeff | When to promote `develop` to `main`. Still open. |
| H10 | Karl | In Supabase (each environment separately): enable `pg_cron` and `pg_net`, store `CRON_SECRET` in Vault, and run `docs/sql/cron-device-watch.sql` by hand with that environment's own URL. Do not copy the production URL into dev. |
| H11 | Karl | Create the Telegram bot, then set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the environment (Vercel and local `.env`, never committed). |

## 6. Order of PRs (all from `Karl` to `develop`)

1a. `chore: add self-check script` (0.2). Safe to merge now.
1b. `chore: build script without migrate` (0.3). Separate PR. Do not merge until H3 is confirmed in writing by Jeff.
2. `fix: server-side feed limits and duplicate-request guard` (1.1)
3. `fix(firmware): dispense caps, config validation, watchdog` (1.2)
4. `fix: idempotent feed events end to end` (1.3)
5. `fix: dedupe pellet alerts and thin heartbeat rows` (1.4)
6. `feat: enforce write access for non-viewer roles` (1.5)
7. `fix: identity lookup, close signup, delete unused action` (2.1, 2.2, 2.9)
8. `feat: hashed device tokens, TLS verification` (2.4, 2.5)
9. `feat: shared rate limiter, safer lockout, login error handling` (2.6 to 2.8)
10. `feat: RLS for User` (2.3, only after H7 and on the dev database first)
11. `feat: device-watch cron endpoint, cron SQL file, Sentry, central constants` (3.1 to 3.3), then `feat: telegram alerts` (3.5, only after PR 5)
12. `test: device routes and new behavior`, then `ci: run on develop` (4.x)
13. `chore: cleanup, docs, stale code` (5.x)

## 7. Definition of done

- `pnpm self-check` passes in full (including the build) with every PASS.
- All 109 original tests still pass, plus the new ones.
- The locked values in `feed-calc.test.ts` are unchanged.
- No migration contains a destructive statement.
- Section 5 items H1 to H8, H10 and H11 are marked done by a human, including H3 (without it, 0.3 cannot merge and the full self-check cannot pass).
- A short screen recording or screenshots: a rejected 100000 g request, a single pellet alert at low hopper, a VIEWER blocked from "Feed Now", and a dead-device alert.
