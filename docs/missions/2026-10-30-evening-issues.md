# Mission 2026-10-30 (evening): issues #365, #370, #371, #387, #388

Orchestrator: Claude (Sonnet 5.5). Workers: OpenCode `deepseek-v4.1-flash`, one worktree each (`S:\Dev\optifeed\mission-I-xx`), branches from `origin/develop` v1.31.8. Rules: `2026-10-26-autonomous-mission.md`.

## State at 19:30 (verified)

| Branch | Version |
|---|---|
| main (production) | 1.31.5 |
| staging | 1.31.7 |
| develop | 1.31.8 |

No open PRs. Older issues #316-#339 are handled by other sessions in the `iso-*` worktrees; this mission does not touch them.

## Decisions (Jeff, 2026-10-30)

| ID | Decision |
|---|---|
| E30 | #387 Feed Now limit follows the pond/device per-meal ceiling and the remaining daily ceiling. The 1000 g request cap stays only as an absolute hard safety ceiling and is not raised. Errors name the setting and the number. |
| E31 | #388 Device connectivity has three states: Online, Weak signal, Offline. Thresholds are configurable by the superadmin. One late beat must not flip to Offline. If configuration needs a schema change, the worker stops and proposes an additive migration. |
| E32 | #371 A failed Pond Settings save keeps every typed value; errors are inline with a link to the conflicting setting. Where device or org values conflict, the pond setting wins. |
| E33 | #370 Global search indexes settings keys (daily feed ceiling, calibration, capacity, thresholds) and deep-links to the field. |
| E34 | #365 Verify only: no new code. |
| E35 | Jeff 10-30 22:20: Wi-Fi RSSI is stored (additive migration on EnergyDevice, optional heartbeat field wifi_rssi, firmware 1.6.2 change; flashing still needs Jeff's yes). |
| E36 | Offline alerts follow the platform connectivity thresholds; the org offlineAfterMin is deprecated for timing. |
| E37 | Pond-settings drafts live in the database, one per (pond, user) with the device reference, and survive browser sessions. |
| E38 | SUPERSEDES E30: the only gram cap is the daily cap. No per-dispensation cap; the relay-time guard and firmware gate stay. |
| E39 | The org default feeding rate stays a default, not a ceiling; ponds may override. |
| E40 | Jeff 10-31: migrations are allowed on the production database. Additive and nullable only; full JSON backup first, `prisma migrate deploy`, never `migrate reset`. Promoting `main` still needs Jeff's explicit word. |
| E41 | Jeff 10-31: OpenCode workers use `opencode/mimo-v2.6-flash-free` while the Go plan is rate limited (about 3 hours); the earlier agreement was `deepseek-v4.1-flash`. |

## #365 verification (Claude)

Pakoy's full write surface (#344) shipped in v1.31.2 (`5ad31c9`, `5b8a54e`, merged by #357) and is in develop, staging and main. Issue #365 was filed at 01:32 on 30 Oct, when production still ran v1.23.0; main reached v1.31.5 at 12:23. Expected to be resolved on production; Jeff to confirm in the app, then close.

## Tasks

| Task | Issue | Branch | Status |
|---|---|---|---|
| I-94 | #387 Feed Now cap = pond setting | `mission/I-94-feed-now-cap` | merged (v1.32.0, `cd37e21`) |
| I-95 | #388 three connectivity states, superadmin thresholds | `mission/I-95-offline-states` | merged (v1.33.0, `f687163`) |
| I-96 | #371 keep typed values + #370 search settings keys | `mission/I-96-settings-search` | merged (v1.32.0, `cd37e21`) |
| I-97 | RSSI storage, Weak signal from RSSI, alerts follow platform thresholds (E35, E36) | `mission/I-97-rssi-alerts` | merged (v1.34.0, `6e463a3`) |
| I-98 | Daily cap only (E38) | `mission/I-98-daily-cap-only` | merged (v1.34.0, `6e463a3`) |
| I-99 | Pond drafts in the database (E37) | `mission/I-99-pond-drafts-db` | merged (v1.34.0, `6e463a3`) |
| I-100 | Firmware 1.7.0: tunable constants driven by the dashboard (Jeff 10-31) | `mission/I-100-firmware-dashboard-config` | running |
| I-105 | Vitest 4 policy (#328 stays open) | `mission/I-105-vitest4-policy` | merged (v1.38.0, `75a8a27`) |
| I-106 | #353 and #322 SQL backup export, #323 deployment policy docs | `mission/I-106-backup-export` | merged (v1.38.0, `75a8a27`) |
| I-107 | XLSX export/import, PDF reports, schedule import (Jeff 10-31) | `mission/I-107-xlsx-pdf` | built by Claude (OpenCode workers unavailable); v1.39.0 PR open |

Waves in between (I-101 to I-104, v1.35.0 to v1.37.0) are recorded in `CHANGELOG.md`.

## Integration log

| Version | PR | Content | Notes |
|---|---|---|---|
| v1.32.0 | #391 | I-94 (#387) and I-96 (#371, #370) | Required checks green. `bundle budget + latency` (not required) failed: first-load JS +87 to +107 kB on dashboard, schedule and pond settings, because client components imported `lib/limits` (zod). Merged anyway; fixed in v1.33.0. |
| v1.33.0 | #392 | I-95 (#388) plus `lib/limits-core` (zod-free) | All 57 routes within budget locally and in CI. |

| v1.34.0 | #394 | I-98 daily cap only (E38), I-97 RSSI + alerts on platform policy (E35, E36), I-99 drafts in the database (E37) | quality, compile and bundle budget green. Full JSON backup `db-backups/full-before-v1.34.0-rssi-drafts.json` (38 tables, 3,354 rows), then `prisma migrate deploy` applied `20261030010000_add_feed_request_kind` (from another session), `20261030020000_add_device_wifi_rssi`, `20261030120000_add_pond_settings_draft` (all additive); schema up to date. |

| v1.34.1 | #396 | knip duplicate export fix (`MAX_ACCEPTED_FEED_GRAMS` literal) | Found after v1.34.0: the non-required `dead-code` check failed on the develop push; the first staging promotion attempt also stalled on pending checks (nothing promoted). |

| v1.38.0 | #406 | I-105, I-106: SQL backup export with audit trail and identity manifest, restore dry run, deployment policy docs | All 10 checks green (including e2e). Merged as `75a8a27`. #323, #353, #322 closed; #328 commented and left open. No migration. |
| v1.39.0 | pending | I-107: XLSX export and import, PDF growth/SGR/FCR reports, import by upload with column mapping, feeding schedule import, CSV boolean fix | Adds exceljs (server only, dynamic import). No migration. Not yet on staging or main. |

## Promotion (Jeff, 2026-10-31: "promote all to staging and production")

| Step | PR | Result |
|---|---|---|
| develop to staging | #395 (`e11f762`) | v1.34.1; every check green; preview Ready |
| staging to main | #397 (`cc876e1`) | v1.34.1; every check green; production deploy Ready |

Production verified: `/api/health` ok, `/en/privacy` shows 1.34.1, `/en`, `/en/terms`, `/en/login` return 200. No migration was needed at promotion (already applied).

Issues #387, #371, #370, #388 closed with version and SHA. #365 verified (see above), left open for Jeff to confirm.

## Open for Jeff

1. Hiligaynon strings from I-94 to I-99 are drafts for native review.
2. DONE (Jeff 10-30): `bundle budget + latency` is now a required check on develop, staging and main (branch protection: quality + bundle budget + latency).
3. (Done 10-31) Production is on v1.34.1.
4. **Firmware per-dose limit.** The app no longer caps a single dose (E38), but `firmware-main.ino` still has `MAX_GRAMS_PER_DISPENSE 1000.0` and refuses larger doses (`feed_refused`). Lifting it is a safety change and a flash: Jeff's explicit yes needed. Units on firmware 1.6.0/1.6.1 already send `wifi_rssi`; 1.6.2 is a version bump.
5. OpenCode: DeepSeek models were blocked by the workspace Privacy region ("requires Global regions"; set it to Global), then the Go plan usage limit was exceeded. I-107 was built directly by Claude. Launching a worker with `--auto` was blocked by the permission classifier on 10-31, so the `mimo-v2.6-flash-free` workers (E41) have not run yet.
6. v1.38.0 and v1.39.0 are on develop only. Promoting them to staging and then main waits for your word; E40 only lifts the migration restriction on the production database.
7. (Applied) Firmware 1.6.2 (adds wifi_rssi) must be flashed by you, with your yes; applying the two migrations (EnergyDevice RSSI columns, PondSettingsDraft table) is done by Claude after a full JSON backup.
