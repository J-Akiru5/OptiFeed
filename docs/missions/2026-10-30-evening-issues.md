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

## #365 verification (Claude)

Pakoy's full write surface (#344) shipped in v1.31.2 (`5ad31c9`, `5b8a54e`, merged by #357) and is in develop, staging and main. Issue #365 was filed at 01:32 on 30 Oct, when production still ran v1.23.0; main reached v1.31.5 at 12:23. Expected to be resolved on production; Jeff to confirm in the app, then close.

## Tasks

| Task | Issue | Branch | Status |
|---|---|---|---|
| I-94 | #387 Feed Now cap = pond setting | `mission/I-94-feed-now-cap` | merged (v1.32.0, `cd37e21`) |
| I-95 | #388 three connectivity states, superadmin thresholds | `mission/I-95-offline-states` | merged (v1.33.0, `f687163`) |
| I-96 | #371 keep typed values + #370 search settings keys | `mission/I-96-settings-search` | merged (v1.32.0, `cd37e21`) |
| I-97 | RSSI storage, Weak signal from RSSI, alerts follow platform thresholds (E35, E36) | `mission/I-97-rssi-alerts` | running |
| I-98 | Daily cap only (E38) | `mission/I-98-daily-cap-only` | running |
| I-99 | Pond drafts in the database (E37) | `mission/I-99-pond-drafts-db` | running |

## Integration log

| Version | PR | Content | Notes |
|---|---|---|---|
| v1.32.0 | #391 | I-94 (#387) and I-96 (#371, #370) | Required checks green. `bundle budget + latency` (not required) failed: first-load JS +87 to +107 kB on dashboard, schedule and pond settings, because client components imported `lib/limits` (zod). Merged anyway; fixed in v1.33.0. |
| v1.33.0 | #392 | I-95 (#388) plus `lib/limits-core` (zod-free) | All 57 routes within budget locally and in CI. |

Issues #387, #371, #370, #388 closed with version and SHA. #365 verified (see above), left open for Jeff to confirm.

## Open for Jeff

1. Hiligaynon strings from I-94 to I-99 are drafts for native review.
2. Make `bundle budget + latency` a required check (see #323).
3. Production is behind develop; promotion is yours.
4. Firmware 1.6.2 (adds wifi_rssi) must be flashed by you, with your yes; applying the two migrations (EnergyDevice RSSI columns, PondSettingsDraft table) is done by Claude after a full JSON backup.
