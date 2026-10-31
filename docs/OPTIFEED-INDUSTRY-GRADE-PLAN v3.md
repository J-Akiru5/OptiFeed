# OptiFeed: Industry-Grade Hardening Plan (v3: decisions locked, independently reviewed)

Paste this together with `system-context.html`. The briefing says how the system works. This plan says what to change, in what order, and how to prove each change worked.

## Plan update log

| Date | Author | Base commit | What changed |
|---|---|---|---|
| 2026-10-31 | Agent-assisted | `95b4453` (`origin/develop` after PR #434 merged; this branch is 836 commits behind `develop` and will be reconciled separately) | Recorded the **remaining work for issue #418** (Tenant B demo seed). The implementation merged into `develop` as PR #434 (merge commit `95b4453`, commit `867cf49`) and the issue is closed; what is left is operator-side and is listed in section 5 as **H12-H15** and in section 6. Nothing in this update changes a locked decision, so there is no amendment. |
| 2026-10-28 | Agent-assisted | `2a5d5e4` (`origin/develop` at update time; this branch is 401 commits behind and will be reconciled separately) | **Amendment [A-001](amendments/A-001-feeding-single-source.md)** approved: task 1.8 and decisions D5-D10. The pond setting becomes the sole source of truth for feeding, the device dose is derived from it, the phantom 5,000-fish fallback is removed, the two next-feeding calculators are reduced to the Asia/Manila one, and the daily feeder allocation gains a 2,000 g default with a configurable ceiling under a 5,000 g emergency guard. The original section 0.5 cap sentence is retained with a pointer to the amendment. Contract: `docs/feeding-single-source-plan.md`. |
| 2026-10-26 | Agent-assisted | `34f5e84` (`origin/develop` at update time; plan branch base `7036195`) | Replaced the PIN policy with password authentication (task 2.10): all 5 existing accounts get temporary `password123`, `mustChangePassword=true`, forced change on next login; permanent passwords are 8+ chars with a letter and number and not common; weak/medium/strong meter on password-setting forms; self-service change. Task 2.7 is superseded; open question 3 is resolved. Implementation contract: `docs/password-auth-plan.md`. |
| 2026-10-24 | Karl (agent-assisted) | `7036195` (`origin/develop` when this branch was cut; `develop`/`staging`/`main` all had identical trees `9cf70ac`, last explicit sync `0e12138`) | Reconciled the workflow sections (0, 4, 6) with `CONTRIBUTING.md` and `docs/deployment-workflow.md`: the single long-lived `Karl` branch model is gone, replaced by short-lived `docs/*|fix/*|feat/*|chore/*` branches → `develop` → `staging` → `main`. Added a **Status (2026-10-24)** block to every phase and a Status column to section 5, each backed by merged-code evidence (files, tests, migrations, PR numbers). Removed the stale embedded copy of the self-check script (the merged `scripts/self-check.mjs` is authoritative). Added section 8 (open questions) and refreshed section 7 (definition of done). The legacy progress tracker `docs/tracker/optifeed-progress-tracker.html` reports a different task scope (the original 9 product-build tasks), so per instruction it was left untouched. |

## Amendments

Amendments change locked decisions or approved figures without editing history. Each one keeps the original text, states the replacement, and records who approved it.

| ID | Date | Amends | Status |
|---|---|---|---|
| [A-001](amendments/A-001-feeding-single-source.md) | 2026-10-28 | Section 0.5 daily feeder allocation; adds task 1.8 and decisions D5-D10 | approved; implementation in progress |

## 0. Instructions for the executing AI

**Hard rules (from briefing section 2, repeated because they matter most):**
- Work on a short-lived branch (`docs/*`, `fix/*`, `feat/*`, `chore/*`, `audit/*`) cut from the latest `develop`: `git fetch origin && git switch -c <branch> origin/develop`. One phase task = one commit or one small PR.
- Never commit directly to `develop`, `staging`, or `main`, and never push `staging` or `main` yourself. Open your PR into `develop`; releases then flow `develop → staging → staging → main` (only Jeff merges `staging → main`). `CONTRIBUTING.md` is the source of truth for this flow; `docs/deployment-workflow.md` covers the pipeline itself. Note: merges to `develop` publish a preview deployment that runs with production credentials — treat `develop` as production-visible.
- Never run `prisma migrate reset`. Production uses `migrate deploy`. Local dev uses `migrate dev` only on a throwaway database.
- Every new migration must be additive (new columns, tables, indexes, policies). Never write `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` without an explicit human OK in the chat.
- Next.js here is 16. The file is `proxy.ts`, not `middleware.ts`. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before touching routing, route handlers, or caching.
- Match repo style: Biome (tabs, 100 columns, double quotes), Conventional Commits, Server Actions in `lib/actions/`, no code comments.
- Never commit `.env*` or any service-role key.
- Run `git fetch origin` before every `pnpm self-check`, because the migration check diffs against `origin/develop`.
- Do not guess when a fact is not in the briefing. Open the file and read it. Items marked **(verify)** or **(unverified theory)** below are inferred and must be confirmed in code before you fix them.

**How to work:**
1. Most of Phases 0-5 are already implemented on `develop` — see the **Status (2026-10-24)** block after each phase. Work the remaining open items in the order given in section 6.
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
| D5-D10 | Feeding is pond-scoped and derived. Full text in `docs/feeding-single-source-plan.md` section 2. Summary: the pond setting is the only source of truth (D5); `gramsPerFeeding` is derived by one function, never written by a second path (D6); daily ceiling defaults to 2,000 g, configurable 500-5,000 g, hard guard 5,000 g (D7); a missing fish count blocks automatic dosing instead of assuming 5,000 fish (D8); one Asia/Manila clock, with `server_time_utc` and `farm_offset_minutes` sent to the device (D9); one label per number - device value versus recommendation (D10). |

**D1-D4 status (2026-10-24): all four are implemented, and no team decision has changed them.** D1: `apps/web/lib/rate-limit.ts` uses a Postgres `ON CONFLICT` upsert (no in-memory store) with `rate-limit.test.ts`. D2: `app/api/cron/device-watch/route.ts` + `docs/sql/cron-device-watch.sql` exist with `device-watch.test.ts` (the actual `pg_cron` scheduling per environment is still human task H10). D3: `lib/notify/telegram.ts` with `telegram.test.ts`, and CRITICAL-only coverage in `ingest-route.test.ts` ("does not Telegram-blast on WARNING-level pellet alerts"). D4: `deploy.yml` is gone; `ci.yml` contains no deploy step.

**Approved feeder caps (no longer "confirm"):** max dispense time 300,000 ms (5 minutes), max feed per request 1,000 g, max daily feeder allocation 5,000 g (or `hopperCapacityG` when that is lower).

> **Amended 2026-10-28 by [A-001](amendments/A-001-feeding-single-source.md).** The text above is retained for the record. The 5,000 g figure is now the firmware **guard**, not the website default. The amended rule is: daily allocation **default 2,000 g, configurable by farmer and admin between 500 g and the 5,000 g guard**, or `hopperCapacityG` when lower, and the platform `dailyCapFactor` may only lower it. Read A-001 before implementing any cap work.

**Stop-point status (2026-10-24): the stop-point is resolved in code, but Jeff's written confirmation is still owed — see open question 2 (section 8).** Task 0.3 landed through a different mechanism than originally written: the build script is now `prisma generate && node scripts/migrate-if-production.mjs && next build`, and `apps/web/scripts/migrate-if-production.mjs` runs `prisma migrate deploy` only when `VERCEL_ENV=production`, i.e. only for the production deployment of `main` (`docs/deployment-workflow.md` section 4, verified against `apps/web/package.json`). The original H3 question — whether Vercel's Build Command runs `migrate deploy` — is superseded by that guard. Until Jeff confirms, record H3 as open; do not guess.

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

**Status (2026-10-24):**

- 0.1 **done** — baseline long superseded: the tree now holds 59 test files / 690 `it`+`test` blocks (counted 2026-10-24). CI job `quality` is a required check on `develop` (branch protection, `docs/deployment-workflow.md` section 9), and PR #122 merged green into `7036195`.
- 0.2 **done** — `scripts/self-check.mjs` exists (250 lines) and root `package.json` registers `"self-check"`.
- 0.3 **done via a different mechanism** — build is `prisma generate && node scripts/migrate-if-production.mjs && next build`; migrations run only when `VERCEL_ENV=production` (`docs/deployment-workflow.md` section 4). Jeff's written H3 confirmation: **needs confirmation** (section 8, question 2).
- 0.4 **done** — `apps/web/lib/limits.ts` exists and is imported from 18 sites across `lib/actions` and API code.

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

**Status (2026-10-24): done.** `lib/limits.ts` exists and is imported from 18 sites; offline rejection is tested (`lib/__tests__/server-actions.test.ts` — "rejects when lastSeenAt is older than OFFLINE_THRESHOLD_MS (N10)"); the null-population auto-adjust skip is implemented (`lib/feed-grams.ts` lines 39-58, writes an `auto_adjust_skipped` `DeviceStateEvent` with reason "population not set - cannot compute biomass without a fish count"); `components/FeedNowButton.tsx` disables when offline.

**1.2 Firmware safety (gap #1, N9).** In `firmware-main.ino`:
- Add `#define MAX_DISPENSE_MS 300000UL`. If a requested dose's computed time exceeds it, the firmware must REFUSE the dose and report an error event, not silently truncate it (a device calibrated to 2 g/s would otherwise deliver half of a valid 1,000 g dose). Keep a clamp in `dispenseFeed` only as a backstop. Every relay-on path also gets a hard stop check in `loop()` that forces `RELAY_OFF` if the relay has been on longer than `MAX_DISPENSE_MS`.
- Add `MAX_GRAMS_PER_DISPENSE` and a RAM daily gram counter that resets at local midnight from the RTC. Refuse dispenses that would exceed `MAX_GRAMS_PER_DAY`.
- Validate every server-pushed value before storing it. Existing `> 0` checks stay. Add what is missing (N9): a range check on `grams_per_feeding` (it has none today), upper bounds on every value, `gramsPerSecond` in 0.5 to 50, `buttonFeedGrams` in range, `hopperFullCm` less than `hopperEmptyCm`, and a range on `temp_offset_c`. Ignore the whole config on any failure.
- N1 needs no change (already guarded). Do not touch the interval logic.
- Enable the ESP32 task watchdog (`esp_task_wdt_init`) so a hung loop reboots, and the boot code still forces `RELAY_OFF`.

Acceptance: static checks in self-check (names above must exist). The firmware caps equal the server caps in `lib/limits.ts`: `MAX_GRAMS_PER_DISPENSE` = `MAX_FEED_GRAMS_PER_REQUEST` (1,000 g), `MAX_GRAMS_PER_DAY` = `MAX_FEED_GRAMS_PER_DAY_PER_DEVICE` (5,000 g), `MAX_DISPENSE_MS` (300,000 ms) identical on both sides. Human test on the bench device (H6): command a huge dose and confirm the relay stops at the cap.

**Status (2026-10-24): done in code; the bench test (H6) is still open.** `firmware-main.ino` defines `MAX_GRAMS_PER_DISPENSE 1000.0` and `MAX_GRAMS_PER_DAY 5000.0` (lines 167-168, commented as matching `limits.ts`), keeps the RAM daily counter `dailyGramsDispensed` with midnight/RTC reset (lines 238-251), and refuses out-of-range or over-cap doses (lines 978, 991). Watchdog `esp_task_wdt_init` is enabled. The server accepts a `feed_refused` event type (`app/api/ingest/route.ts` line 28), closing the "dose refused" reporting loop.

**1.3 Idempotent events (gap #2).**
- Firmware: generate `eventId` once when the event is created. Add an `eventId` field to the queued-event struct. `postFeedEvent` takes the id as a parameter and never calls `generateEventId()` itself. A retry resends the same id.
- Server `/api/ingest`: for `feed_dispensed`, if `requestId` is present, treat a second event with the same `requestId` and `source` as a duplicate (204), even if `event_id` differs. Keep the existing `event_id` dedupe.

Acceptance: a test posts the same `feed_dispensed` twice, and the second post creates no new row and no extra grams.

**Status (2026-10-24): done.** The firmware generates the event id once (`generateEventId` present in `firmware-main.ino`) and ingest dedupes by `requestId`: `ingest-route.test.ts` line 112 — "treats a retry with the same requestId and a different event_id as a duplicate".

**1.4 Notification dedup and heartbeat retention (gap #3, N11, N15).**

This task must land BEFORE any Telegram work (3.5). Otherwise a hopper at 5% sends a message every 5 seconds.
- Pellet alerts fire only on a tier transition (above 20 to 20 or below, above 5 to 5 or below) or at most once every 6 hours while still low. Implement this by checking for an existing unacknowledged `Notification` of category `pellet` and the same tier for that pond within the window, or by storing the last notified tier on `EnergyDevice` (additive migration). The `pellet_low` `DeviceStateEvent` follows the same rule.
- Heartbeats are one per 5 s (17,280/day). Each currently writes two rows (N11, N15).
- Stop writing a `FeedEvent` row for every heartbeat. The review found no code that reads `eventType: "heartbeat"` rows (only `history.ts` reads `feed_dispensed`), so thinning is safe; still run the grep once to confirm. Keep `lastSeenAt` updated on every heartbeat, and write a heartbeat row at most once per 5 minutes per device unless a value changed.
- Stop writing the "connected" `DeviceStateEvent` on every heartbeat (N15). Write it only when the device was previously offline (`lastSeenAt` older than `OFFLINE_THRESHOLD_MS`) or has no prior state.
- Add retention: the guarded cron endpoint (see 3.1) deletes heartbeat `FeedEvent` rows older than 7 days in small batches (about 5,000 per run, so each run stays well under the Vercel Hobby 10-second function limit). Add a composite index on `(deviceId, timestamp)` (or whatever the table uses) in an additive migration.
- Do not delete the `connected` rows already in the database: historical rows stay until a human explicitly approves a cleanup (deletions need a human OK). The retention above covers heartbeat `FeedEvent` rows only.

Acceptance: a test sends 100 heartbeats at 3 percent and gets at most one CRITICAL notification, and 100 heartbeats from an online device write no extra "connected" events.

**Status (2026-10-24): done, with the acceptance tests passing by name.** Heartbeat row thinning is implemented ("Thinning (N11)", `app/api/ingest/route.ts` line 125) and `connected` is written only on first contact or offline→online (`route.ts` lines 171-177, guarded by `wasOffline`). Tests: `ingest-route.test.ts` — "100 heartbeats at 3% produce at most one CRITICAL pellet notification" and "writes connected exactly once on offline→online reconnect". Retention runs from the cron route (`app/api/cron/device-watch/route.ts`, `retention.test.ts`). Existing historical `connected` rows were left untouched, as required.

**1.5 Role enforcement (gap #6).** Add `requireWriteAccess()` in `lib/auth/session.ts` (allows `ADMIN` and `OPERATOR`, rejects `VIEWER`). Call it at the top of: `requestFeed`, `toggleDevicePause`, `updateScheduleCommand`, `updatePondSettings`, `updateNotificationPrefs`, `saveBiomassLog`, `saveHopperCalibration`, `saveDurationCalibration`, `saveTemperatureCalibration`, `setDeviceTime`, `renameFarm`, and `/api/import` plus `/api/import/confirm`. Disable the matching buttons in the UI for VIEWER.

Acceptance: tests show a VIEWER gets an error and nothing is written for every action listed.

**Status (2026-10-24): done.** `requireWriteAccess` is defined in `lib/auth/session.ts` and called 38 times across 11 action files (`biomass`, `calibration`, `crop-cycle`, `energy`, `farm`, `notifications`, `pond-event`, `prediction`, `schedule`, `settings`, `time`); the import routes carry the same enforcement, and role checks appear in 8+ components (`FeedNowButton.tsx`, `EnergyControllerCard.tsx`, calibration forms, import/export, token reveal, farm rename). `lib/__tests__/permissions.test.ts` covers "gives VIEWER read-only defaults".

**1.6 Fix individual fish measurements (added 2026-10-13; teammate report: "individual measurements don't save").**
- Root causes found in review: (a) `biomassLogSchema` requires `sampleLengthCm > 0`, but individual mode makes length optional — a weight-only entry makes the whole save throw; (b) the form silently drops rows whose weight parses to NaN or <= 0, so filled rows vanish with no per-row warning; (c) the form catch swallows the real server error behind a generic message; (d) `FishSample` rows are stored but never displayed anywhere — the only surface is a "{n} fish" badge, so saved data looks lost.
- Fix `lib/limits.ts`: allow `sampleLengthCm` of 0 in the schema (average mode still requires length in the form, so the normal path is unchanged). Keep every other rule.
- Fix `lib/actions/biomass.ts`: validate the `fishSamples` payload with a per-row Zod schema (weight > 0 required, length >= 0) instead of an unvalidated `JSON.parse`; a malformed payload returns `{ success: false, error }` naming the problem — never a silent parse-and-continue. Align with the 1.5 convention: return `{ success, error }` instead of throwing for user-input failures.
- Fix `LogSampleForm.tsx`: mark invalid rows with an inline error instead of filtering them out; surface the server's actual error message.
- Fix `growth/page.tsx`: make each history row expandable and render the per-fish table (weight, length) from `fishSamples` (already fetched via `include`).

Acceptance: a weight-only individual entry saves; an invalid row shows a named per-row error; VIEWER is still denied; the saved individual rows are visible on Growth; tests cover parse failure, per-row validation, and persistence.

**Status (2026-10-24): done.** `fishSamples` is validated per row in `lib/actions/biomass.ts` (9 references), with coverage in `lib/__tests__/biomass-save.test.ts` and `import-fish-samples.test.ts`; Growth display work is merged (per-fish rows render from `fishSamples`).

**1.7 Batch label on biomass logs (added 2026-10-13; request: know which batch a measurement belongs to and the date).**
- One additive migration: `ALTER TABLE "BiomassLog" ADD COLUMN "batchLabel" TEXT` (nullable; no change to the farmId-stamp trigger, which keys off the parent row).
- `LogSampleForm.tsx`: optional "Batch" text field with a datalist of labels previously used on this pond (no batch-management UI; free text is fine).
- `growth/page.tsx` history table: add a Batch column next to Date; the expanded per-fish view shows batch and date as its header.
- Exports: `biomass_logs` CSV gains `batchLabel`; `fish_samples` CSV gains `batchLabel` and `recordedAt` so every individual row answers "which batch, what date".
- Do not touch `avgWeightKg`, the feed formula, or FCR inputs — locked.

Acceptance: the label round-trips (form → DB → Growth table → CSV export); tests cover storage and export columns. Migration follows the same H7 gate as the other migrations in this batch, and runs on the dev database first (H8).

**Status (2026-10-24): partial.** The additive migration exists (`prisma/migrations/20261013030000_add_biomass_batch_label`) and `batch-summary.test.ts`/`csv.test.ts` cover batch summaries and CSV export; the full form → Growth → CSV round-trip was **not individually re-verified** in this documentation pass — needs confirmation. The H7/H8 human gates still apply to it.

**1.8 Feeding single source of truth and daily ceiling (added 2026-10-28; owner request).** Contract: `docs/feeding-single-source-plan.md`. In short:
- Make the pond setting (`feedingRatePct`, `feedsPerDay`, `population`, effective schedule) the only source of truth. Every feeding read takes an explicit `pondId`; remove `pond.findFirst({ ownerId })` from the FCR path (`lib/actions/fcr.ts:12`).
- Derive `EnergyDevice.gramsPerFeeding` with one function (`feed-calc.ts`) from settings + latest biomass. Remove the second writer in `growth-plan-apply.ts:170-173`; the plan writes `Pond.feedingRatePct` and the dose is re-derived.
- Delete the phantom 5,000-fish fallback from automatic paths (`feed-calc.ts:13`, `growth-plan-loader.ts:139`, `fcr-calculation.ts:27-30`). A null population blocks dosing and prompts for the fish count.
- Fix the FCR calculator: it currently understates the suggested rate by exactly `DEFAULT_FISH_COUNT` (5,000x) and labels per-fish feed as a total.
- Keep one next-feeding calculator (Asia/Manila, `next-feeding-slot.ts`); delete the server-local `next-feeding.ts`.
- Daily ceiling: additive migration `ALTER TABLE "EnergyDevice" ADD COLUMN "dailyCapG" INTEGER`; default 2,000 g, configurable 500-5,000 g by farmer and admin, hard guard 5,000 g, platform `dailyCapFactor` may only lower it. Apply the same resolver in `schedule.ts`, `ponds.ts`, `feed/commands.ts`, `calibration.ts`, `prediction.ts` (two paths currently omit the platform factor).
- Send `server_time_utc` and `farm_offset_minutes` to the device so RTC and UTC are linked (firmware consumption is phase 2 and needs a reflash).

Acceptance: a settings change and a biomass log produce exactly `feedPerMealG(population, rate, feeds)` on the device; two ponds owned by one farmer never cross-read; no automatic dose exists without a population; the FCR rate for 13.78 g -> 50 g over 60 days at FCR 1.5 is about 88 %/day, not 0.018 %; every cap path agrees at 499 / 500 / 5,000 / 5,001 g; the hero and dashboard show the same next-feed time under `TZ=UTC`.

**Status (2026-10-28): implemented on `feat/feeding-single-source`, pending integration.** Commits: `a57fc9b` (F-06 ceiling), `60e2e68` (F-04 FCR), `6f53b59` (F-01/F-02/F-03/F-05/F-07), `f6ce770` (merge `origin/develop`), `e4dd4b7` (remove the last phantom population constant). Verification: `pnpm --filter web typecheck`, `biome check`, and the full Vitest suite (219 files, 2,240 tests) pass. `pnpm self-check` is 52/56; the four failures are pre-existing and unrelated to this branch (`DEMO_PIN` in `.env.example`, the `staging` entry in the Vercel allowlist, the build-script migrate gate, and one API-auth heuristic). Version **1.21.0** is prepared in `package.json`, `apps/web/package.json`, `LEGAL_APP_RELEASE` and `CHANGELOG.md`; no tag or release was created. The migration still needs the H7/H8 gates and the backfill decision (contract section 7) before it runs anywhere.

### Phase 2: Security

| ID | Task | Acceptance |
|---|---|---|
| 2.1 | Identity (briefing section 17 #4): `getCurrentUser()` must look the user up by the Supabase auth user id (`User.supabaseId`) and confirm the farmId matches the email prefix. Never trust only the email local part. Add tests with an email like `demo-farmer-1@evil.com`. | Test passes: the wrong-domain email cannot act as the farm. |
| 2.2 | Close signup (briefing section 17 #2). `createUser` already uses `supabase.auth.admin.createUser` (Admin API, `admin.ts`), so that part is done. Remaining work: DELETE `app/[locale]/signup/` (do not redirect; the self-check requires the page file to be gone), and remove the dead signup branch in `proxy.ts`. Human task H1 turns off "Allow new users to sign up". | No public signup route. `createUser` still works for an admin. |
| 2.3 | RLS, `User` table only. `Farm` RLS and the repaired `Notification` policies already exist in migration `20261004010000_fix_rls_policies_and_farm`; do not redo them. Order matters: (1) H7 backups confirmed first, (2) run on the dev Supabase project first, never production first. Add one additive migration that enables RLS on `User` with no anon or authenticated policies (deny by default; Prisma keeps access through the database owner role). Re-check that Realtime on `Notification` still works for a logged-in farmer on the dev database. | `select tablename, rowsecurity from pg_tables where schemaname='public'` shows `true` for every table except `Device` and `FeedingEvent` (deprecated, dropped later under H9, and intentionally untouched here): `Farm`, `PondOwnershipHistory`, the 12 Aug-31 tables and `user_lockout` already are `true`, and this task makes `User` `true` (H2 runs the query and reports which tables, if any, are `false`). Realtime bell still works in dev. |
| 2.4 | Device tokens (N6): store a SHA-256 hash of each token, compare with `crypto.timingSafeEqual`, and give every device a unique random token. Rotate any device still using `esp32-tok-cict-001` before pilot use. Give OTA its own password, separate from the token. The seed may keep the demo token for local dev only. | Auth by hash works. A static check finds no plaintext compare. H5 confirms the demo token is not in production. |
| 2.5 | Firmware TLS (briefing section 19.4): call `secureClient.setCACert(...)` with the root CA that signs your host. Check the real chain of the production domain first, and document how to update it. Keep a clear error path when verification fails. | Self-check finds `setCACert`. Bench test with a wrong CA fails to connect (H6). |
| 2.6 | Rate limiting (decision D1, locked): replace the in-memory `Map` with a PostgreSQL table using an atomic upsert (`INSERT ... ON CONFLICT DO UPDATE` on `(key, window_start)`, additive migration). No Upstash. Keep the same limits (login 5 per 60 s per IP, API 30 per 60 s per user, device 20 per 60 s). Fail CLOSED on login if the table is unreachable, fail OPEN on the device routes, so a limiter outage cannot stop feeding. Old rows must be deleted periodically: the `pg_cron` job from 3.1 runs a cleanup of expired windows. | The unit test for the store passes. A test shows login is rejected when the store throws. |
| 2.7 | Lockout and PIN (N8): lock per `(farmId, ip)` pair for 5 attempts per 15 minutes, plus a global per-farmId threshold of 20 failures per hour that only slows login and notifies, so a stranger cannot lock the real farmer out. **PIN-specific policy superseded by 2.10 (2026-10-26); lockout rules remain.** | Tests cover the lockout rules. |
| 2.8 | Login errors (N7, gap #10): wrap the Prisma calls in `loginWithPin` with a try and catch that returns a friendly "service temporarily unavailable, try again" message, retries once on connection errors, and reports to Sentry. Human task H4 checks `DATABASE_URL` against the Supabase "Connect" page (user `postgres.<project-ref>`, transaction pooler port 6543, `?pgbouncer=true&connection_limit=1`, plus `DIRECT_URL` on the session or direct port for migrations). | Test: with Prisma mocked to throw, login shows the friendly message and does not crash. |
| 2.9 | Delete `registerEnergyDevice` (unused, has a missing-auth path). | `grep` finds no match. |
| 2.10 | Password authentication (supersedes 2.7's PIN policy). Replace numeric PIN login with password login. Add `User.mustChangePassword`; backfill all existing users; force a change on next login. All 5 existing accounts start with temporary `password123`; permanent passwords must be 8+ chars with a letter and number and not common. Add a weak/medium/strong meter on password-setting forms; enable self-service change. Implementation contract: `docs/password-auth-plan.md`. | All 5 accounts are forced to change; `password123` works once; the permanent policy rejects it; the meter shows Weak/Medium/Strong; self-service change works; tests/typecheck/lint pass. |

**Status (2026-10-24):**

- 2.1 **done** — `supabaseId` lookup in `lib/auth/session.ts`; `lib/__tests__/session-identity.test.ts` contains the `evil.com` wrong-domain email cases.
- 2.2 **code done** — `app/[locale]/signup/` is gone and `proxy.ts` has zero `signup` references. The dashboard toggle (H1) is still a human task.
- 2.3 **code done** — migration `20261013020000_enable_rls_on_user` runs `ALTER TABLE "User" ENABLE ROW LEVEL SECURITY` with no policies (deny by default); zero `DROP`/`TRUNCATE` in it. H2/H7/H8 verification in the dashboards remains open.
- 2.4 **code done** — SHA-256 `tokenHash` is written (`prisma/seed.ts` line 79, `createHash("sha256")`), device auth compares with `timingSafeEqual` (4 sites in `lib/`), covered by `device-auth.test.ts`. Rotating live tokens is still H5.
- 2.5 **code done** — the firmware calls `setCACert`/`attachBundle` (self-check asserts it); the wrong-CA bench test is still H6.
- 2.6 **done** — `lib/rate-limit.ts` uses a Postgres `ON CONFLICT` upsert with no `Map` store; `rate-limit.test.ts` exists (decision D1 honoured).
- 2.7 **superseded** — per-IP lockout exists (`lib/auth/lockout.ts`, `lockout.test.ts`) and remains. The PIN-length policy is replaced by task 2.10; see the password authentication contract below.
- 2.8 **code done** — friendly-error handling exists with `lib/__tests__/login-errors.test.ts` ("with Prisma mocked to throw…"); the `DATABASE_URL` dashboard check and monitors (H4) remain human tasks. Sentry stays removed (see 3.2).
- 2.9 **done** — no `registerEnergyDevice` references remain anywhere in TS sources.
- 2.10 **implemented and verified (2026-10-26)** — migration `20261026000000_add_must_change_password` applied; all 5 existing accounts reset to temporary `password123` and flagged for a forced change; unit tests (67 files / 756 tests), typecheck, lint, production build, and the auth e2e spec passed. The demo account is stabilized by the e2e setup and then reset to `password123`. Implementation branch: `feat/password-auth` (merged with `origin/develop` at `280c5ac`; PR #157, green `quality`/`compile` CI). See `docs/password-auth-plan.md`.

#### Password authentication contract (task 2.10, 2026-10-26)

- **Initial credentials:** all 5 existing accounts get `password123` as a temporary password and `mustChangePassword = true`.
- **Forced change:** login redirects flagged users to `/change-password`; the dashboard, admin, and superadmin layouts also redirect until the password is changed.
- **Temporary-only exception:** `password123` is accepted only in temporary mode. Permanent passwords require 8+ characters, at least one letter and one number, not on the common-password blocklist, and at most 72 bytes.
- **Strength meter:** Weak / Medium / Strong on password-setting forms only (forced change, self-service change, admin/superadmin account creation).
- **Self-service:** Profile Settings gets a working Change password form.
- **E2E:** setup stabilizes `demo-farmer-1` on `DEMO_PASSWORD` with the flag cleared; the other 4 accounts remain on `password123` for manual first-login testing.
- **Rollout:** apply the additive `mustChangePassword` migration, reset the 5 accounts, verify sign-in, and confirm Supabase accepts `password123` (leaked-password protection may reject it).
- **Security caveat:** `password123` is a known breached password. It is temporary-only, but there is a takeover window; reset `superadmin` to a unique password immediately after rollout.
- **Implementation contract:** `docs/password-auth-plan.md`.

### Phase 3: Reliability and observability

| ID | Task | Acceptance |
|---|---|---|
| 3.1 | Dead-device alerts (gap #4, decision D2, locked). Add `GET /api/cron/device-watch` protected by `withCronAuth()` (add it to `lib/auth/with-auth.ts`, so the existing CI auth gate passes). It requires `Authorization: Bearer $CRON_SECRET`. It finds devices with `lastSeenAt` older than the offline threshold and no `disconnected` event since `lastSeenAt`, then creates the `disconnected` `DeviceStateEvent` plus a CRITICAL `connectivity` notification. The same endpoint runs heartbeat retention (1.4) and rate-limit table cleanup (2.6) in small batches, so each run stays under the Vercel Hobby 10-second limit. Scheduling uses Supabase `pg_cron` AND the `pg_net` extension (`pg_cron` only runs SQL; `pg_net` makes the HTTP call). Store `CRON_SECRET` in Supabase Vault, not in plain SQL. Write the job as a documented SQL file (`docs/sql/cron-device-watch.sql`, with placeholders for the URL and secret). A human runs it by hand in each environment (H10), so the production URL never ends up in the dev database. Add `CRON_SECRET` to `.env.example`. | Test: a stale device gets exactly one alert and no repeat. A request without the secret gets 401. The SQL file exists and contains no real URL or secret. |
| 3.2 | Error tracking (gap #9): add `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `GEMINI_MODEL`, `NEXT_PUBLIC_BASE_URL`, `DEMO_PIN` to `.env.example`. Tag device-route errors with `deviceId`. Capture exceptions in the catch blocks of ingest, feed-command, schedule-sync, login, and the cron route. Keep `tracesSampleRate` low (0.1). H4 sets the DSN in Vercel. **Reverted 2026-10-13: Sentry removed entirely (dependency, config files, env keys, CSP clause) — `reportError` is console-only; catch-path instrumentation and the `.env.example` keys for Gemini/base URL/DEMO_PIN remain.** | `.env.example` contains `SENTRY_DSN`. |
| 3.3 | Central constants: move `OFFLINE_THRESHOLD_MS`, `STALE_SENT_MS`, `STALE_DISPATCHED_MS`, `REQUEST_EXPIRY_MS`, `RECONCILIATION_LOOKBACK_HOURS`, and the hopper thresholds into `lib/constants.ts` (or `lib/thresholds.ts`). Delete the copies and the unused hopper and gram constants that conflict with DB defaults. | Self-check: one definition per constant. |
| 3.4 | Backups (H7): confirm what your Supabase plan backs up. If it is not daily with a tested restore, add a scheduled `pg_dump` (GitHub Actions to private storage). Do one restore test into the dev project. This matters because of the earlier production wipe. | Human sign-off. |
| 3.5 | Telegram alerts (decision D3, locked) for CRITICAL events: device offline and low pellet. Requires 1.4 (dedup) to be merged first. Add a `lib/notify/telegram.ts` send helper with one retry and a timeout, called from the notification creators. Read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from the environment and add both to `.env.example`. Limitation to document: one chat ID means every farm's alerts go to one chat. That is fine for a pilot or an ops group; a per-farm contact field (additive migration) is a later task. Never log the bot token. | Test with a mocked sender: one message per alert, none on repeats, failure of Telegram never breaks ingest. |
| 3.6 (optional) | Missed-feed detection: the cron route also raises a WARNING when a scheduled feed time passed and no `feed_dispensed` arrived within 15 minutes. | Test with a stubbed clock. |
| 3.7 (later, not in the first version) | Hardware-fault alerts. Nothing reports a hardware fault today (the system has offline, low pellet and some schedule events). This needs a new device event type, a firmware change to emit it (including the "dose refused" error from 1.2), and a Telegram template. Treat it as its own task after 3.5 is working. | Separate plan item. |

**Status (2026-10-24):**

- 3.1 **done (endpoint, SQL file, tests)** — `app/api/cron/device-watch/route.ts` and `docs/sql/cron-device-watch.sql` exist (the SQL carries placeholders only: "NO trailing /en/", "Store the secret in Supabase Vault" — no real URL or secret); `device-watch.test.ts` proves exactly-one alert and 401 without the secret. Actual `pg_cron` + `pg_net` scheduling per environment is still H10.
- 3.2 **partial** — Sentry was removed entirely on 2026-10-13 (the row's revert note is authoritative; 0 `sentry` references in `apps/web/package.json`), so `.env.example` intentionally lacks `SENTRY_*`. `.env.example` does document `NEXT_PUBLIC_BASE_URL` and `DEMO_PIN`, but **not** `GEMINI_MODEL` — decide whether to re-add it (section 8, question 4).
- 3.3 **partial** — `OFFLINE_THRESHOLD_MS` is now defined exactly once (self-check passes), but the `STALE_*` constants are still defined in 5 places; the hopper/gram constant conflicts were not re-checked here — needs confirmation.
- 3.4 **open (human)** — H7; no repository evidence can close it.
- 3.5 **done (code)** — `lib/notify/telegram.ts` + `telegram.test.ts`, plus `ingest-route.test.ts` "does not Telegram-blast on WARNING-level pellet alerts (3.5: CRITICAL only)"; `.env.example` documents `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Creating the bot and setting the env vars remains H11. Requires 1.4 first — satisfied (1.4 is done).
- 3.6 **skipped by decision** (2026-10-13, recorded in the old section 6: "3.6 stays optional and is skipped for now"). The decision is preserved here; re-opening it is a team choice.
- 3.7 **not started — deliberately deferred** to after 3.5 is proven live (H11).

### Phase 4: Tests and CI

| ID | Task | Acceptance |
|---|---|---|
| 4.1 | Device route tests (gap #5), Vitest with Prisma mocked. For `/api/ingest`: invalid token (401), bad body (400), duplicate `event_id` (204, no write), duplicate `requestId` (204), rate limit, pellet thresholds and dedup, reconnect auto-clear, `schedule_acked` applies the Pond update, `feed_dispensed` completes the `FeedRequest`. For `/api/feed-command`: no request returns an empty body, pending is marked dispatched, expiry after 60 s, outgoing values clamped. For `/api/schedule-sync`: pending command is marked sent, baseline is returned. | New test files exist. All pass. |
| 4.2 | Tests for limits, roles, `getCurrentUser`, `loginWithPin` failure, lockout, `device-watch`, and the feed-calc edge cases (null population, zero grams). | `pnpm test` passes with more than the 109 baseline. |
| 4.3 | CI: in `.github/workflows/ci.yml` also trigger on pull requests to `develop` (plus pushes to `develop`, `staging`, `main`). Use dummy env values for the build step (no real DB secrets), and keep the API auth grep gate. A `next build` with a fake DB env is unproven: verify it at this phase, because it fails if any page queries the database at build time. If it does, fix that page or use a throwaway local database in CI instead. Pin pnpm through the root `packageManager` field everywhere (briefing section 17 #13). Delete `deploy.yml` (decision D4, locked: Vercel's Git integration deploys, and the file is invalid). | Self-check: `ci.yml` mentions `develop`, `deploy.yml` has no `secrets.` in an `if:`. |
| 4.4 | Guard Playwright: the e2e setup must stop if `DATABASE_URL` is not on an allow-listed host (`E2E_ALLOWED_DB_HOST`), so tests can never run against production (gap #7). The dev Supabase project (H8) must exist before RLS migrations or Playwright runs. | Running e2e with a prod URL fails fast. |
| 4.5 (optional) | A CI step that compiles the firmware with `arduino-cli`. | Job passes. |
| 4.6 | Separate environments (H8): a second Supabase project for dev and tests. | Human sign-off. |

**Status (2026-10-24):**

- 4.1 **done** — `lib/__tests__/ingest-route.test.ts`, `feed-command.test.ts` and `schedule-sync.test.ts` all exist (plus `device-auth.test.ts`, `retention.test.ts`).
- 4.2 **done** — 690 `it`/`test` blocks across 59 test files, far above the 109-test baseline (counted 2026-10-24).
- 4.3 **done** — `ci.yml` triggers on pull requests to `develop`/`staging`/`main` and on pushes to those branches, uses dummy DB values with zero `secrets.` references, and `deploy.yml` is deleted (D4). The old "(and pushes to `Karl`)" trigger never shipped and is obsolete under the current branch model. The phrase "A `next build` with a fake DB env is unproven" is now stale: `docs/deployment-workflow.md` section 3 records CI running `next build` with dummy credentials on every green run.
- 4.4 **done** — `apps/web/e2e/global-setup.ts` enforces `E2E_ALLOWED_DB_HOST`.
- 4.5 **done** — `.github/workflows/firmware.yml` compiles the sketch with `arduino-cli` on `firmware/**` changes (it never flashes a device).
- 4.6 **open (human)** — H8; needs confirmation.

### Phase 5: Cleanup and consistency

| ID | Task | Acceptance |
|---|---|---|
| 5.1 | Fix N13: store `linkTo` without a locale (for example `/dashboard/notifications`) and resolve it with the locale-aware `Link` or `getPathname`. Add a one-off, additive-safe data fix for existing rows (update, never delete). | No `"/en/` string in notification creators. |
| 5.2 | Deprecated models: first stop writing `Device` and `FeedingEvent` in `seed.ts`. Dropping the tables is a later, separate release, after a backup and Jeff's OK (H9). Do not drop them in this plan. | Seed no longer writes them. |
| 5.3 | Stub packages: remove `@optifeed/types` and `@optifeed/ui` from workspace dependencies, or fill them. Recommended: remove them, and leave `packages/config`. Resolve the 9 `TODO(karl)` comments or turn each into a tracked issue. | `pnpm install` and `pnpm build` still pass. |
| 5.4 | Docs: replace `apps/web/README.md` with a real one (setup, env, commands, branch workflow, the migration rules). Fix or delete the stale parts of `docs/vercel-deployment-checklist.md` (remove Upstash unless D1 re-adds it) and `Firmware-Implementation`. Add a short `docs/runbook.md`: what to do if the feeder runs wild, the device is offline, or the database is down, and how to restore a backup. | Docs exist. |
| 5.5 | Product wording: ask the user whether this is catfish or shrimp, then make README, landing page, and metadata consistent. Do not translate new copy into Hiligaynon until the English text is final. | User confirmed. |

**Status (2026-10-24):**

- 5.1 **done** — no notification creator hardcodes `linkTo` with `/en/` (0 hits across TS sources).
- 5.2 **done** — `prisma/seed.ts` no longer writes the deprecated models (comments at `seed.ts` lines 73 and 131: "The deprecated Device model is no longer written — task 5.2", "FeedingEvent model is no longer written"). Dropping the tables stays behind H9, by design.
- 5.3 **done** — no `@optifeed/types` or `@optifeed/ui` in `apps/web/package.json` or the root workspace, and zero `TODO(karl)` comments remain in TS/TSX sources.
- 5.4 **partial** — `docs/runbook.md` exists and `apps/web/README.md` is a real README (setup, stack, commands); but `docs/vercel-deployment-checklist.md` still mentions Upstash twice although decision D1 forbids it — that stale section remains to fix.
- 5.5 **open (user decision)** — `apps/web/README.md` now opens with "Aquaculture feed management for catfish ponds", but whether catfish is the final wording (and whether the landing page and metadata match) still needs your confirmation.

### Phase 6: Release (Jeff only)

The AI does not do this. It prepares a release note listing the migrations in order (so `migrate deploy` is predictable), the new env vars, and a rollback note. Releases now flow `develop → staging → staging → main` per `docs/deployment-workflow.md` section 5: a release PR to `staging`, then Jeff merges the `staging` → `main` PR, which deploys production and runs `prisma migrate deploy`. This flow is live — promotion PRs #117, #123 and #124 were merged on 2026-10-24 and `main` sits at `b5ca877` with a tree identical to `develop`. Decision D5 (promotion cadence) is still open, and the H1-H8 human gates still apply to the hardening work.

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

**Status (2026-10-24): done — the code copy of this script has been removed from this document.** The script was created and merged as `scripts/self-check.mjs` (task 0.2) and the root `package.json` registers `"self-check": "node scripts/self-check.mjs"`. **The checked-in file is the source of truth**: it has evolved since this plan was written (verified 2026-10-24: its branch rule is now `not on a protected branch` for `develop`/`staging`/`main` instead of `on branch Karl`, and it gained checks such as "CI workflow never deploys"). Read and edit `scripts/self-check.mjs`; never paste code from this document back over it.

What the script does, unchanged in substance:

- fetches `origin`, then fails if any script or workflow contains `prisma migrate reset`;
- static assertions: `lib/limits.ts` exists and is used by the write actions, `requireWriteAccess` is defined and called, device routes use `timingSafeEqual`, the signup route is gone, `FeedNowButton` disables when offline, `OFFLINE_THRESHOLD_MS` is defined once, no hardcoded `/en/` notification links, firmware defines `MAX_DISPENSE_MS`/stores `eventId`/sets TLS CA/enables the watchdog, route tests exist, `.env.example` documents the expected keys, CI mentions `develop`, `deploy.yml` is gone, no Upstash dependency;
- runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` only when it is safe to do so (while task 0.3's original rule applied, it refused the build instead; `--quick` skips the build);
- exits with code 1 on any FAIL, so the output doubles as a progress meter.

**After self-check, the AI must also answer these questions in its report (things a script cannot prove):**
1. Which tasks from this plan are done, partly done, or skipped, and why?
2. Did any change touch a migration? List the files and confirm each is additive.
3. Which items marked **(verify)** or **(unverified theory)** turned out to be true, and which were not?
4. Which values marked **(confirm)** did the user approve?
5. What does the user still have to do in the dashboards (section 5)?
6. Is task 0.3 merged, and if not, is H3 still open?

## 5. Human tasks and decisions

Karl or Jeff must do these. The AI cannot.

| ID | Who | Task | Status (2026-10-24) |
|---|---|---|---|
| H1 | Karl | Supabase, Authentication, turn off "Allow new users to sign up". | Open — dashboard action, no repo evidence possible |
| H2 | Karl | Run `select tablename, rowsecurity from pg_tables where schemaname='public';` and report the result. | Open — repo-side prerequisite done (User RLS migration merged); the query itself still must run |
| H3 **(originally blocked 0.3)** | Jeff | Vercel Build Command must be `prisma generate && prisma migrate deploy && next build` (or an equivalent). Jeff must confirm this IN WRITING before the 0.3 PR is merged. | Superseded in mechanism — `migrate-if-production.mjs` now gates migrations on `VERCEL_ENV=production`; written confirmation still **needs confirmation** (section 8, question 2). 0.3 has effectively landed |
| H4 | Karl | Check `DATABASE_URL` and `DIRECT_URL` format in Vercel. Set `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `CRON_SECRET`. Add the uptime monitor for `/api/health` (for example UptimeRobot or Better Stack). | Open, partially obsolete — `CRON_SECRET` is documented in `.env.example`; the Sentry keys were deliberately removed with the 2026-10-13 Sentry revert (see 3.2). URL check + monitor still open |
| H5 | Karl | Run `select count(*) from "EnergyDevice" where token = 'esp32-tok-cict-001';` on production. It must be 0 before real use. Rotate tokens on real devices. | Open — code now stores SHA-256 `tokenHash` and compares with `timingSafeEqual`, but the production query and rotation were not run here |
| H6 | Karl | Bench-test firmware: huge dose stops at the cap, wrong certificate refuses to connect, power cycle keeps the relay OFF, unplug WiFi and confirm the button still works, and the retry test (kill the reply) creates no duplicate row. | Open — all caps/TLS/watchdog/idempotency code is merged; the physical tests still need the hardware on the bench |
| H7 **(do first)** | Jeff | Confirm backups and do one restore test, BEFORE any RLS or other migration. This matters because of the earlier production wipe. | Open — still the first gate for any further migration |
| H8 **(do before RLS and e2e)** | Jeff | Create a separate Supabase project for dev and tests. Run every new migration there first. | Open — needs confirmation |
| H9 | Jeff | Approve dropping the deprecated `Device` and `FeedingEvent` tables, in a later release, after a backup. | Open, by design (deferred release) |
| D1 | Locked | Postgres atomic-upsert rate limiter. No Upstash. | Implemented — `lib/rate-limit.ts` + `rate-limit.test.ts`; no `@upstash` dependency |
| D2 | Locked | `pg_cron` + `pg_net` calling `/api/cron/device-watch`. | Endpoint + SQL file done; scheduling in Supabase is H10 |
| D3 | Locked | Telegram bot for CRITICAL events. Hardware faults come later (3.7). | Code done (`lib/notify/telegram.ts` + tests); bot creation is H11 |
| D4 | Locked | Delete `deploy.yml`. | Done — file gone, CI never deploys |
| D5 | Jeff | When to promote `develop` to `main`. Still open. | Open — and note the flow is now `develop → staging → main`; promotions #117/#123/#124 happened 2026-10-24 |
| H10 | Karl | In Supabase (each environment separately): enable `pg_cron` and `pg_net`, store `CRON_SECRET` in Vault, and run `docs/sql/cron-device-watch.sql` by hand with that environment's own URL. Do not copy the production URL into dev. | Open — SQL file exists with placeholders only |
| H11 | Karl | Create the Telegram bot, then set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the environment (Vercel and local `.env`, never committed). | Open — code and `.env.example` entries ready |
| H12 | Karl | Run the Tenant B demo seed against the live database so the second tenant has presentation data: `SEED_TENANT_B_CONFIRM=yes pnpm --filter web seed:tenant-b`. The confirmation is required because the staging deployment runs against the production database; a loopback host needs no acknowledgement. Add `--unlock` if the presenter should skip the forced password change on `tenant2-admin`. | Open — script merged into `develop` as PR #434 (`95b4453`); never executed against the live database, so no demo row exists yet |
| H13 | Karl | Decide whether the `tenant2-operator` demo member is wanted on the live database. The seed creates it through Supabase Auth when `SUPABASE_SERVICE_ROLE_KEY` is available; without that key the seed still runs but skips the member and its pond, and the tenant console then shows one member instead of two. | Open — owner decision; the seed already degrades safely |
| H14 | Jeff | Promote `develop` → `staging` so the demo seed script and the `#418` changelog entry reach the preview environment. `develop` does not deploy in this repository, so the merged seed is not runnable from the preview until the promotion happens. | Open — promotion is human-commanded (section 6) |
| H15 | Karl | Confirm with the other developer that their uncommitted work is intact after the shared `refs/stash` incident recorded in section 8. `refs/stash` is shared across every worktree of this repository, so a `git stash push`/`pop` in one worktree can move or drop another worktree's stash entry. The entry was restored by hand; the other developer should verify. | Open — the other developer's confirmation is owed |

**Status dates:** H1-H11 were last verified on 2026-10-24 (or on the later date named inside the row). H12-H15 were added on 2026-10-31 with the #418 update and were not re-verified against the 2026-10-24 baseline.

## 6. PR flow (current — replaces the old "all from `Karl`" order)

The old section 6 sequenced every plan PR out of one long-lived `Karl` branch. That model was retired by the branch migration recorded in `CONTRIBUTING.md`: one task, one short-lived branch, one PR. Do not reopen a `Karl`-to-`develop` mega-sequence — the plan's work has been delivered as feature branches instead.

Current flow (verified 2026-10-24 against `CONTRIBUTING.md` and `docs/deployment-workflow.md`):

```
docs/* | fix/* | feat/* | chore/* ──PR──▶ develop ──release PR──▶ staging ──PR + Jeff──▶ main
```

- Cut the branch from `origin/develop`, keep it to one reviewable task, open the PR into `develop`; CI job `quality` must be green (required check).
- Work branches and their PRs create no deployment: the allowlist in `apps/web/vercel.json` permits only `main` and `develop`, and PR previews are intentionally disabled (they would inherit production credentials).
- Every merge to `develop` publishes a preview deployment that runs with production credentials (`docs/deployment-workflow.md` section 6) — treat merges as production-visible.
- `staging` does not deploy; validation is the `develop` deployment of the candidate SHA plus review of the promotion diff.
- Only Jeff merges the `staging` → `main` PR; that push deploys production and runs `prisma migrate deploy` (via `migrate-if-production.mjs`).

Evidence the flow is live: feature/plan PRs #70 (identity firmware), #74 (provisioning portal), #87 (identity UI), #99 (reset buttons), #105 (PlatformIO build), #109 (seed identity + proxy guard), #115 (crop-cycle plan), #119 (crop cycle), #120 (page latency), #122 (feed calibration) all merged into `develop`; releases promoted by #117, #123 (`develop` → `staging`) and #124 (`staging` → `main`, merged 2026-10-24 — `main` at `b5ca877`).

Remaining work in dependency order:

1. Human gates first: H7 (backups — do first), H8 (dev Supabase project), then H2, H1, H4, H5.
2. Code leftovers: 2.10 (password authentication replaces the PIN policy; contract in `docs/password-auth-plan.md`), 3.3 (`STALE_*` consolidation), 5.4 (remove Upstash from `docs/vercel-deployment-checklist.md`), 3.2 decision (`GEMINI_MODEL`), 1.7 round-trip confirmation, 5.5 (product wording).
3. Then H10/H11 to make 3.1 and 3.5 live, keeping 3.6 skipped (decision 2026-10-13) and 3.7 deferred until after 3.5 is proven.
4. Issue #418 (Tenant B demo seed) — the code merged into `develop` as PR #434 (`95b4453`) and the issue is closed. Only the operator steps remain, and they are independent of the hardening work above: **H12** (run the seed against the live database), **H13** (decide on the demo operator member), **H14** (promote `develop` → `staging`), **H15** (confirm the other developer's work after the shared-`refs/stash` incident in section 8). Contract: `docs/tenant-b-demo-seed-plan.md`.

Preserved decision (2026-10-13, from the old ordering): tasks 10a and 11 shipped stacked in one PR on top of the Phase 2 commits, and 3.6 stays optional and skipped. Nothing else in the old numbered list is actionable as written — the statuses after each phase are the source of truth for what remains.

## 7. Definition of done

- `pnpm self-check` passes in full (including the build) with every PASS. **Status: needs confirmation** — this documentation pass did not run it; CI `quality` (the required check on `develop`) is green on `7036195`, and the script's static assertions were spot-checked against the tree on 2026-10-24.
- The test suite is healthy: 690 `it`/`test` blocks in 59 files (2026-10-24) versus the original 109-test baseline; all green through CI.
- The locked values in `feed-calc.test.ts` are unchanged — 10 tests present including the `DEFAULT_FISH_COUNT` fallback references; unchanged-since-baseline provenance **needs confirmation** (not re-derived here).
- No migration contains a destructive statement — verified for this plan's migrations: `20261013020000_enable_rls_on_user` has zero `DROP`/`TRUNCATE`, and `20261013030000_add_biomass_batch_label` is an `ADD COLUMN` migration (spot-check still to be repeated by `pnpm self-check`, which diffs added migrations against `origin/develop`).
- Section 5 human items H1, H2, H4, H5, H6, H7, H8, H10 and H11 are marked done by a human, and H3's written confirmation is resolved (see section 8, question 2). **Status: all still open as of 2026-10-24.**
- A short screen recording or screenshots: a rejected 100000 g request, a single pellet alert at low hopper, a VIEWER blocked from "Feed Now", and a dead-device alert. **Status: open — not produced by this update.**

## 8. Open questions (added 2026-10-24)

Conflicts and decisions recorded rather than silently rewritten:

1. **Deployment-matrix conflict between the two workflow documents.** `CONTRIBUTING.md` section 10 says only `staging` and `main` deploy and that `develop` runs "CI validation only", while `CONTRIBUTING.md`'s own section 1 table (and `docs/deployment-workflow.md` sections 1-2, verified 2026-10-22) say the opposite: `staging` does **not** deploy, and `develop` and `main` do, per the `apps/web/vercel.json` allowlist (`"develop": true`, `"main": true`). This plan follows `docs/deployment-workflow.md`, which is backed by the checked-in `vercel.json`. **Needs confirmation** from whoever can see the Vercel dashboard; `CONTRIBUTING.md` section 10 should be fixed by a separate docs PR (it also claims `develop` uses production credentials in §1's warning while denying a `develop` deployment in §10 — the document contradicts itself).
2. **H3 — Jeff's written confirmation.** Task 0.3 no longer depends on Vercel's Build Command running `migrate deploy`, because `migrate-if-production.mjs` runs migrations only when `VERCEL_ENV=production`. Is Jeff's written confirmation of the old Build Command still required, or can H3 be closed as superseded? **Needs confirmation.**
3. **PIN length (task 2.7) — resolved 2026-10-26.** PINs are replaced by passwords under task 2.10. All 5 existing accounts get temporary `password123` and must set a permanent password on first login; permanent passwords are 8+ characters with a letter and number and must not be common. No further PIN-length decision is needed. Contract: `docs/password-auth-plan.md`.
4. **`.env.example` leftovers (task 3.2).** Sentry is deliberately absent (reverted 2026-10-13), but `GEMINI_MODEL` — which the self-check still asserts — is also absent. Re-add `GEMINI_MODEL`, or drop both the plan line and the self-check assertion? **Team decision.**
5. **Decision D5** — promotion cadence for `staging` → `main` remains open with Jeff. Promotions #117/#123/#124 show it is happening ad hoc.
6. **Product wording (task 5.5).** `apps/web/README.md` now says "catfish ponds". Confirm this is final and that the landing page and metadata match. **User decision.**
7. **Baseline of this update (recorded, not a conflict).** The requested baseline `main = staging = develop = 0e12138` was accurate at 2026-10-24 16:41 +0800. Heads have since advanced to `develop 7036195`, `staging a100c35`, `main b5ca877` — with **identical trees** (`9cf70ac`), because PRs #122→#123→#124 promoted the same content. `git rev-parse origin/{develop,staging,main}^{tree}` all return `9cf70ac`.
8. **`refs/stash` is shared across every worktree of this repository (recorded 2026-10-31, incident during #418).** `git stash` is repository-wide, not per-worktree. With seventeen worktrees in use, a `git stash push` in one of them pushes onto the same `refs/stash` stack the others read, and a `git stash pop` in a worktree pops whatever entry is on top — which may belong to a different developer. During #418 this happened: an agent's `git stash pop` applied another developer's work into the wrong worktree and dropped their stash entry. The entry was recovered by hand from the dangling commit and restored with `git stash store`. **Needs confirmation** from the other developer (H15) that their work is intact, and a decision on whether agents should avoid `git stash` in a multi-worktree repository — using a dedicated worktree and a branch-local commit is the safe alternative.
