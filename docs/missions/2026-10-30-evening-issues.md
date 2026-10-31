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
| E41 | Jeff 10-31: OpenCode workers use `opencode/mimo-v2.6-flash-free` while the Go plan is rate limited (about 3 hours); the earlier agreement was `deepseek-v4.1-flash`. SUPERSEDED by E43. |
| E42 | Claude 10-31, Jeff away: #412 Finding 1 (acknowledge re-arms the alert) decided as Option A. The 6 h window applies to the latest pellet notification regardless of acknowledgement; a tier change still fires at once. Finding 2 unifies on `<=`. Jeff can switch to Option B (shorter post-acknowledge cooldown). |
| E43 | Jeff 10-31 evening: OpenCode workers use `opencode-go/deepseek-v4.1-flash` only (max 2 at a time); on a rate limit the only fallback is `opencode/deepseek-v4.1-flash-free`. Karl owns #411, #418 and #419: untouched. The firmware PR for #409 stays open for Jeff's review (needs reflash and bench check). Jeff added the Bash permission rule that lets `opencode run --auto` launch. |
| E44 | Jeff 10-31 night: resolve #432 (AI provider keys) first. After it is merged and deployed, Jeff signs in as superadmin and tests whether Pakoy can really act on the system. #365 is closed only after that test. |
| E45 | Claude 10-31 night (finding, decision open): Pakoy's `records.add_calendar_item` takes only a start time. The calendar stores `endsAt` and `color` (`schema.prisma`), but the action never passes them, so the request in the #365 screenshot ("1pm to 5pm", "color it blue") cannot be done as asked. See the register below. |
| E46 | Jeff 10-31 night: PR #435 (#432 phase A) is bound to the orchestrator session so its state is visible. Auto-fix stays off for it: it is an OpenCode worker's PR, and Auto-fix is only for PRs this session opened. |
| E47 | Claude 10-31 night (verified, answering Jeff): PR #425 (#409, firmware 1.8.1) contains the lamp logic. It is built on the merged #422 (`status.h`, `FaultManager`, the bench pins blue GPIO 26 and yellow GPIO 18 are all in its tree), its diff touches no lamp or fault line, and it merges cleanly into the current develop. 1.8.1 is 1.8.0 plus the farm-local schedule, persisted schedule and daily cap, and `safety.h` helpers. |
| E48 | Jeff 10-31 night: advance #419 and #418 on staging. Both are on develop (#423 and #434). The one thing standing in the way was the #417 migration `20261031130000_add_hopper_diameter_density`: staging builds skip migrations and share the production database, so staging would have queried columns that did not exist. See E53. |
| E49 | Jeff 10-31 night: #430 stays with Karl. |
| E50 | Jeff 10-31 night: why does #328 need a schedule, and what if we upgrade now? No technical reason to wait. Done now on branch `chore/328-vitest-4` (vitest and `@vitest/coverage-v8` 4.1.12, commit `834db1a`, no PR yet). `pnpm audit` goes from 116 findings (2 critical, 40 high) to 109 (0 critical, 40 high): the criticals are gone, the highs remain (shadcn and its tree). All 337 test files and 4,260 tests pass. The CI coverage floors do not: vitest 4 measures lower on the same code (statements 89.8, functions 91.93, branches 82.27, lines 91.8 against floors of 90, 94.5, 84.5 and 90), and the config says the floors are a ratchet that is never lowered. Decision needed, see the #328 row. |
| E51 | Jeff 10-31 night: #319 must not conflict with or regress anything on the plan. The rules a backfill must follow are in the #319 row. Checked offline against the E53 backup: the production database has 4 ponds, 0 crop cycles and no saved growth target, so there is no drift and nothing to backfill. |
| E52 | Jeff 10-31 night: #365 is decided when #432 has landed (reaffirms E44). |
| E53 | Jeff 10-31 night: "It's fine to migrate on production db anyways just go and migrate." Done by Claude under E40. Target confirmed as the production Supabase project before anything ran. Full read-only JSON backup first: 39 tables, 4,867 rows, saved outside the repo as `S:\Dev\optifeed\db-backups\full-before-hopper-diameter-20261031-2334.json` (kept local; it holds production data). `prisma migrate status` showed exactly one pending migration, `20261031130000_add_hopper_diameter_density`; `prisma migrate deploy` applied it; status then read "Database schema is up to date" (45 migrations). Verified: `EnergyDevice.hopperDiameterCm` and `hopperBulkDensityGCm3` exist, both nullable double precision; `EnergyDevice` still has its 2 rows and none carries a value. Additive, nothing rewritten, so production v1.39.0 is unaffected. |

## #365 verification (Claude)

Pakoy's full write surface (#344) shipped in v1.31.2 (`5ad31c9`, `5b8a54e`, merged by #357) and is in develop, staging and main. Issue #365 was filed at 01:32 on 30 Oct, when production still ran v1.23.0; main reached v1.31.5 at 12:23. Expected to be resolved on production; Jeff to confirm in the app, then close.

Update 10-31 night: production serves v1.39.0 (`bdc4539`, Vercel deployment 10-31 09:51 UTC), which contains #344. The issue stayed open only because nobody tested it in the app. The screenshot reply ("I don't have calendar access") predates the fix. One real gap remains (E45): no end time and no colour on the calendar action. Test plan after #432 lands: sign in as superadmin, ask Pakoy to add a calendar event, add or edit a biomass sample, and propose a member or role change (needs the step-up password), then press Accept on each and confirm the result in the app. Record what worked and what did not here, then close or split the gap into a new issue.

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
| I-107 | XLSX export/import, PDF reports, schedule import (Jeff 10-31) | `mission/I-107-xlsx-pdf` | built by Claude (OpenCode workers unavailable); merged (v1.39.0, `132c6d9`) |
| I-108 | #412 low-hopper acknowledge cooldown + `<=` boundary (E42) | `mission/I-108-hopper-ack-cooldown` | merged to develop (#424, `35011e5`) |
| I-109 | #409 firmware: schedule on farm-local time, persist schedule and daily cap | `mission/I-109-firmware-tz-nvs` | PR #425 open (firmware 1.8.1, mergeable, checks green): needs Jeff's OK, reflash and bench check |
| I-110 | #416 mark as read above the list | `mission/I-110-mark-read-top` | merged to develop (#426, `00e2378`) |
| I-111 | #400 water temperature probe in the 3D model (v1.2.0) | `mission/I-111-3d-water-temp` | merged to develop (#427); still needs a visual check in the app |
| I-112 | #431 feeding schedule slots follow the frequency | `mission/I-112-schedule-slots-frequency` | merged to develop (#433); #431 closed |
| I-114 | #432 phase A: encrypted AI provider keys, step-up, live test | `mission/I-114-ai-provider-keys` | PR #435 open; gitleaks failure fixed by the worker (allowlist for the sentinel test keys) |
| I-115 | #432 phase B: OpenAI-compatible adapter and add/remove provider UI | not started | waits for #435 |

Waves in between (I-101 to I-104, v1.35.0 to v1.37.0) are recorded in `CHANGELOG.md`.

## Integration log

| Version | PR | Content | Notes |
|---|---|---|---|
| v1.32.0 | #391 | I-94 (#387) and I-96 (#371, #370) | Required checks green. `bundle budget + latency` (not required) failed: first-load JS +87 to +107 kB on dashboard, schedule and pond settings, because client components imported `lib/limits` (zod). Merged anyway; fixed in v1.33.0. |
| v1.33.0 | #392 | I-95 (#388) plus `lib/limits-core` (zod-free) | All 57 routes within budget locally and in CI. |

| v1.34.0 | #394 | I-98 daily cap only (E38), I-97 RSSI + alerts on platform policy (E35, E36), I-99 drafts in the database (E37) | quality, compile and bundle budget green. Full JSON backup `db-backups/full-before-v1.34.0-rssi-drafts.json` (38 tables, 3,354 rows), then `prisma migrate deploy` applied `20261030010000_add_feed_request_kind` (from another session), `20261030020000_add_device_wifi_rssi`, `20261030120000_add_pond_settings_draft` (all additive); schema up to date. |

| v1.34.1 | #396 | knip duplicate export fix (`MAX_ACCEPTED_FEED_GRAMS` literal) | Found after v1.34.0: the non-required `dead-code` check failed on the develop push; the first staging promotion attempt also stalled on pending checks (nothing promoted). |

| v1.38.0 | #406 | I-105, I-106: SQL backup export with audit trail and identity manifest, restore dry run, deployment policy docs | All 10 checks green (including e2e). Merged as `75a8a27`. #323, #353, #322 closed; #328 commented and left open. No migration. |
| v1.39.0 | #408 | I-107: XLSX export and import, PDF growth/SGR/FCR reports, import by upload with column mapping, feeding schedule import, CSV boolean fix | All checks green. Merged as `132c6d9`. Adds exceljs (server only, dynamic import). No migration. |
| develop only | #424 | I-108 (#412) | Workers: `opencode-go/deepseek-v4.1-flash`. Reviewed by Claude (diff, lint, typecheck, 74 targeted tests); all required checks green, merged `35011e5`. No migration. |
| develop only | #426 | I-110 (#416) | Worker full suite 332 files / 4,197 tests; all checks green, merged `00e2378`. No migration. |
| open | #425, #427 | I-109 (#409), I-111 (#400) | #425 re-verified by Claude: `pio run` SUCCESS (RAM 16.5 %, flash 56.5 %), `pio test -e native` 51/51. #427: GLB checksum matches the manifest, feeder tests green, a headless Blender render shows the probe under the base plate. |

## Promotion (Jeff, 2026-10-31: "promote all to staging and production")

| Step | PR | Result |
|---|---|---|
| develop to staging | #395 (`e11f762`) | v1.34.1; every check green; preview Ready |
| staging to main | #397 (`cc876e1`) | v1.34.1; every check green; production deploy Ready |

Production verified: `/api/health` ok, `/en/privacy` shows 1.34.1, `/en`, `/en/terms`, `/en/login` return 200. No migration was needed at promotion (already applied).

Issues #387, #371, #370, #388 closed with version and SHA. #365 verified (see above), left open for Jeff to confirm.

### Second promotion (Jeff, 2026-10-31: "I approve the promotion now since I reviewed")

| Step | PR | Result |
|---|---|---|
| develop to staging | #410 (`cdf2044`, merged by Jeff 16:38) | v1.39.0; no failed checks (`e2e` skipped on both promotion PRs); preview Ready. Carried Jeff's #405 and #407 (tabbed device settings, #403), merged to develop before it. |
| staging to main | #414 (`bdc4539`, merged by Jeff 17:49) | v1.39.0; production deploy Ready |

The production build ran `prisma migrate deploy` and succeeded. The FeedEvent and EnergyDevice index migrations were already in the database before the promotion (`prisma migrate status` run by Claude beforehand: 44 migrations, schema up to date), after the full JSON backup `full-before-v1.36.0-indexes.json`.

Production verified through the Vercel connector on deployment `dpl_F6QoMnUupsseAmigDNfefxmkqRNh`: `/api/health` returns `{"status":"ok"}`, `/en/privacy` shows 1.39.0, `/en/login` returns 200. Not exercised on production: the XLSX/PDF export and import flows, which need a signed-in session.

## Open for Jeff

1. Hiligaynon strings from I-94 to I-99 are drafts for native review.
2. DONE (Jeff 10-30): `bundle budget + latency` is now a required check on develop, staging and main (branch protection: quality + bundle budget + latency).
3. (Done 10-31) Production is on v1.39.0.
4. **Firmware per-dose limit.** The app no longer caps a single dose (E38), but `firmware-main.ino` still has `MAX_GRAMS_PER_DISPENSE 1000.0` and refuses larger doses (`feed_refused`). Lifting it is a safety change and a flash: Jeff's explicit yes needed. Units on firmware 1.6.0/1.6.1 already send `wifi_rssi`; 1.6.2 is a version bump. Since v1.35.0 (I-100) firmware 1.7.0 no longer refuses a dose above 1,000 g and takes its tunable constants from the dashboard; that applies only to a unit Jeff flashes with 1.7.0, and production already serves the matching config.
5. OpenCode: DeepSeek models were blocked by the workspace Privacy region ("requires Global regions"; set it to Global), then the Go plan usage limit was exceeded. I-107 was built directly by Claude. Launching a worker with `--auto` was blocked by the permission classifier on 10-31, so the `mimo-v2.6-flash-free` workers (E41) have not run yet. (Resolved 10-31 evening: Jeff added the permission rule; I-108 to I-111 ran on `opencode-go/deepseek-v4.1-flash`, E43.)
6. (Done 10-31) v1.38.0 and v1.39.0 reached staging (#410) and main (#414), both merged by Jeff. E40 only lifted the migration restriction on the production database.
7. (Applied) Firmware 1.6.2 (adds wifi_rssi) must be flashed by you, with your yes; applying the two migrations (EnergyDevice RSSI columns, PondSettingsDraft table) is done by Claude after a full JSON backup.
8. **#425 (#409 firmware)**: review, flash and run the bench check from the issue (a 06:00 slot must click at 06:00, not 14:00). One behaviour change: the daily cap and `firedToday` now roll over at farm-local midnight instead of UTC midnight (08:00 in the Philippines). Not merged by Claude.
9. **#412**: confirm Option A (E42) or ask for Option B. **#400 / #427**: look at the probe in the browser (ISO preset, 390 px, FRONT/LEFT/RIGHT); the preview PNGs under `docs/feeder/` and `docs/feeder-3d-viewer-plan.md` still describe model 1.1.2.
10. **Next promotion** carries what is on develop beyond production v1.39.0 (36 commits, checked 10-31 night): #413, #417 (additive hopper-diameter migration `20261031130000_add_hopper_diameter_density`, so take a full JSON backup before the production build applies it), Karl's #420 password recovery (its PR title says it mails through Resend: confirm the configuration), #422 lamp firmware 1.8.0 (a flash needs Jeff's yes), #423 (#419 offline defaults), #424, #426, #427, #433, and the docs PRs #421, #428 and #429, plus #425, #434 and #435 for whichever Jeff merges first. #435 adds the additive migration `20261031140000_ai_provider_secret_columns`, which the production build applies. `main` waits for your word.
11. Open issues, why each is still open and what only Jeff can decide: see the register below.

## Open issue register (Claude, 2026-10-31 night)

Branch heads at the time of writing: main and staging are both v1.39.0 with the same content (`main` shows 13 extra merge commits from earlier promotions only); develop is about 49 commits ahead. The #417 migration is applied (E53), so nothing technical blocks the staging promotion. `main` waits for Jeff's word.

| Issue | State | Why it is still open | Decision needed (Jeff) | Next step |
|---|---|---|---|---|
| #365 Pakoy access level | Fix live on production since v1.31.5 | Never tested in the app after the fix (E44); calendar action has no end time or colour (E45) | After #432: run the test plan in the #365 section. Then: extend `records.add_calendar_item` with `endsAt` and `color` (no migration), or leave as is | Claude can build the calendar extension on request; Jeff tests and closes |
| #432 AI provider keys | PR #435 (phase A) open; 9 checks passed, 1 pending at last look; mergeable | Needs a merge, then deploy; phase B (I-115) not started | Merge #435; set `AI_SECRET_KEY` (base64, 32 bytes) in Vercel for the environment under test, never in the repo or chat; approve the additive migration after a full JSON backup (E40); say when phase B starts | Jeff merges; Claude takes the backup and checks the migration before the promotion |
| #409 feeder schedule on UTC | PR #425 open, firmware 1.8.1, mergeable, checks green | Firmware: needs review, reflash and a bench check. Until then a flashed 1.8.0 still fires slots on UTC (06:00 clicks at 14:00) | Approve and merge #425; accept that the daily cap and `firedToday` roll over at farm-local midnight instead of UTC; flash and run the bench check | Jeff; Claude has re-verified `pio run` and `pio test -e native`. It already includes the lamp logic (E47) |
| #419 offline indicator | Fix merged to develop (#423, Karl): weak after 4 min, offline after 5 min, grace 0. Going to staging in the v1.40.0 promotion | Not on staging or production yet. Production has no `device.status` row, so only the new defaults can fix it | None for staging. For production: promote `main` on your word, or set the windows now in Superadmin, Settings, Device connectivity (no deploy). Close after a silent unit flips to Offline within 5 minutes | Karl owns it; Claude promotes to staging |
| #418 Tenant B demo data | PR #434 merged to develop; going to staging in the v1.40.0 promotion | The seed has not been run anywhere | Allow `pnpm --filter web seed:tenant-b` against the shared production database (deletes are scoped to the demo pond ids and feeder MACs; `--unlock` only if Jeff asks) | Karl owns it |
| #430 pond settings do not sync | Open, assigned to Karl (E49) | No comment, branch or PR. Report: pond setting says 525 fish, dashboard shows 600. Not investigated here | None: Karl owns it | Karl needs a repro first: which field, which page |
| #328 vitest 3 dev-only criticals | Upgrade done on `chore/328-vitest-4` (E50): criticals 2 to 0, 337 files and 4,260 tests pass; no PR | CI coverage floors fail under vitest 4's lower measurement (statements 89.8 against 90, functions 91.93 against 94.5, branches 82.27 against 84.5) | Re-baseline the floors to the vitest 4 measurement with a note in `vitest.config.ts` (the file says never lower them, so this is your call), or ask for tests to win the points back first | Claude opens the PR once Jeff picks |
| #319 growth-target backfill | No drift in production (E51): 4 ponds, 0 crop cycles, no saved growth target in the 10-31 23:34 backup | None: nothing to backfill | None. Close with that proof. Re-check after the Tenant B seed runs, because the seed creates cycles | Jeff closes |

**#319: what the backfill must respect.** The growth plan engine reads `CropCycle.targetHarvestWeightG`, not the pond-saved target, and the code already treats "one number everywhere" as the rule (`lib/crop-cycle/target-write.ts`). A backfill is safe only if it follows these rules:

1. Only ACTIVE cycles whose id equals the saved target's `cycleId`; never harvested or archived cycles, harvest dates, feeding configs or biomass samples.
2. Auto-fill only where the cycle value is empty. Where both values exist and differ, change nothing: the farmer may have set the cycle value on purpose after #304, and the code makes every such conflict an explicit Replace or Keep (`GROWTH_TARGET_CONFLICT`). Report those rows for a human choice.
3. Skip a saved value outside the range (`isCycleTargetWeightInRange`).
4. Write only through `writeCycleTargetMirror`. The static guard test `crop-cycle-target-writers.test.ts` scans `lib`, `app`, `components` and `scripts` and fails on any other writer of `targetHarvestWeightG`.
5. Dry run by default, an explicit `--apply`, and a full JSON backup first (E40). No migration.
6. The plan's rules stay intact: a changed target only changes the recommendation. The 10 percent per 15 days envelope and the explicit Apply step are untouched, no harvest date moves, and the device grams per feeding do not change by themselves.

Read-only count, kept for the re-check after the Tenant B seed (Supabase SQL editor; it changes nothing):

```sql
SELECT p.id AS pond_id, c.id AS cycle_id, c."targetHarvestWeightG" AS cycle_g,
       (p."notificationPrefs"->'profile'->'growthTarget'->>'targetWeightG')::numeric AS saved_g,
       p."notificationPrefs"->'profile'->'growthTarget'->>'cycleId' AS saved_cycle
FROM "Pond" p
JOIN "CropCycle" c ON c."pondId" = p.id AND c.status = 'ACTIVE'
WHERE p."notificationPrefs"->'profile'->'growthTarget' IS NOT NULL
  AND (c."targetHarvestWeightG" IS NULL
       OR round(c."targetHarvestWeightG"::numeric, 1)
          <> round((p."notificationPrefs"->'profile'->'growthTarget'->>'targetWeightG')::numeric, 1));
```

No rows means the drift does not exist and #319 can be closed with that proof.

Closed since 10-30 and not repeated here: #431, #416, #415, #412, #411, #403, #400, #399.
