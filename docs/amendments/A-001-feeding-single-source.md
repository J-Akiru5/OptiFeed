# Amendment A-001 — Feeding single source of truth and daily ceiling

| Field | Value |
|---|---|
| Amendment | A-001 |
| Date | 2026-10-28 |
| Requested by | Jeff (owner) |
| Owner instruction | "Go update the plan as amendment and continue developing" (2026-10-28) |
| Plan | `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md` |
| Base commit | `origin/develop` `2a5d5e4` |
| Contract | `docs/feeding-single-source-plan.md` |
| Status | approved by owner instruction; implementation in progress |
| Supersedes | the daily-allocation sentence in plan section 0.5 only |

## 1. Original text (retained, not deleted)

> **Approved feeder caps (no longer "confirm"):** max dispense time 300,000 ms (5 minutes), max feed per request 1,000 g, max daily feeder allocation 5,000 g (or `hopperCapacityG` when that is lower).

## 2. Amended text

> **Approved feeder caps (no longer "confirm"):** max dispense time 300,000 ms (5 minutes), max feed per request 1,000 g, max daily feeder allocation **default 2,000 g, configurable by the farmer and by an admin between 500 g and a 5,000 g emergency guard** (or `hopperCapacityG` when that is lower).
>
> The 5,000 g figure is the guard the firmware enforces. It is no longer the default the website applies. Effective cap = `min(configured ?? 2000, 5000)`, multiplied by the platform `dailyCapFactor` (which may only lower it), then reduced to `hopperCapacityG` when that is lower.

## 3. Why this amendment exists

The owner reported that a pond displayed feeding values they never configured. The audit at `2a5d5e4` found that feeding numbers are produced by eleven independent paths that disagree with `lib/feed-calc.ts` — the one implementation that matches the team's reference formula. The defects are listed with file:line evidence in `docs/feeding-single-source-plan.md` section 1. The two that explain the report:

1. `prisma/seed.ts` writes `feedsPerDay: 4` and `scripts/e2e/seed-e2e.ts:230,243` writes `feedsPerDay: 3`. There is no code default, so a "3 meals" value comes from seeded or edited pond data, and the UI does not say which row it read.
2. Population has five sources of truth, including a phantom 5,000-fish fallback (`feed-calc.ts:13`). With the shipped defaults that produces 1,033.5 g per meal, above the 1,000 g per-request limit, while the device keeps a different stored value.

## 4. Decisions introduced

D5-D10, defined in `docs/feeding-single-source-plan.md` section 2 and summarised in the plan's locked-decisions table:

| ID | Decision |
|---|---|
| D5 | Pond setting is the only source of truth; every feeding read takes an explicit `pondId`. |
| D6 | `EnergyDevice.gramsPerFeeding` is derived by one function; no second writer. |
| D7 | Daily ceiling: 2,000 g default, 500-5,000 g configurable, 5,000 g hard guard. |
| D8 | Missing fish count blocks automatic dosing; no 5,000-fish assumption. |
| D9 | One clock: Asia/Manila, with `server_time_utc` and `farm_offset_minutes` sent to the device. |
| D10 | One label per number: device value vs recommendation. |

## 5. Scope and impact

| Area | Change | Risk |
|---|---|---|
| Schema | `ALTER TABLE "EnergyDevice" ADD COLUMN "dailyCapG" INTEGER` (additive, nullable) | Low; rolled back by ignoring the column |
| Behaviour | A schedule above 2,000 g/day stops at the new default unless the ceiling is raised | **Medium**; mitigated by the backfill in the contract section 5 or by operator action |
| Firmware | Unchanged in this pass; keeps `MAX_GRAMS_PER_DAY 5000.0` | None until phase 2 |
| API | New `server_time_utc` / `farm_offset_minutes` fields are additive | Low |
| UI | New ceiling field for farmer and admin | Low |

## 6. Open decisions taken by default

The owner was asked three questions and did not answer; proceeding was requested instead. These defaults are recorded so they can be amended by A-002 without archaeology:

| # | Question | Default taken | Where recorded |
|---|---|---|---|
| 1 | Absolute emergency guard | 5,000 g (matches firmware) | contract section 7 |
| 2 | Firmware in this pass | No; phase 2 | contract section 6 |
| 3 | Missing population | Block automatic dosing | contract section 4, D8 |
| 4 | Backfill existing devices | Preserve current schedule capped at 5,000; requires owner OK before running | contract section 5 |
| 5 | Where the ceiling is set | Hardware settings page (device limit) | contract section 4 |

## 7. Implementation record

Branch `feat/feeding-single-source`, worktree `C:\Users\Client\CApstone\OptiFeed-feeding`, cut from `origin/develop` `2a5d5e4`. Commits are appended below as tasks land; a task is not done until its acceptance test runs.

| Task | Commit | Evidence |
|---|---|---|
| F-01 pond-scoped source | `6f53b59` | `lib/feeding/source.ts` + `lib/__tests__/feeding-source.test.ts` (6 tests): reads only the requested pond, returns null for an unknown pond, lets a pending command override the row, exposes a null population, resolves the cap through `resolveDailyCapG`, and falls back to the 2,000 g default. |
| F-02 single derivation | `6f53b59` | `lib/feeding/derive.ts` is the only writer of `gramsPerFeeding`; `syncDeviceGramsForPond` delegates to it. Settings, biomass and growth-plan paths all derive through `feed-calc`. |
| F-03 no phantom population | `6f53b59` | `totalBiomassG`/`dailyFeedG`/`feedPerMealG`/`calculateNextFeeding` return null without a real count. `DEFAULT_FISH_COUNT` is gone from dashboard, PDF, growth plan, prediction, chat and the sampling preview; tests updated. |
| F-04 FCR calculator | `60e2e68` | `lib/__tests__/fcr-calculation.test.ts` rewritten (9 tests): rate 6.57 %/day for 13.78 g to 50 g over 60 days at FCR 1.5, population-independent rate, correct per-meal dose, default-FCR and zero-day cases. |
| F-05 growth-plan chain | `6f53b59` | `growth-plan-apply.ts` writes `Pond.feedingRatePct` (bounded) and re-derives the dose; metadata records `ratePrevious`, `rateApplied`, `gramsRequested`, `gramsApplied`. |
| F-06 daily ceiling | `a57fc9b` | `lib/__tests__/daily-cap.test.ts` (8 tests) plus 170 focused tests across cap, config, prediction, schedule, ponds, feed-command and biomass suites. Additive migration `20261028010000_add_device_daily_cap`. |
| F-07 one clock | `6f53b59` | `lib/schedule/next-feeding.ts` and its test deleted; the hero returns `nextFeedSlot` from `computeNextFeedingSlot`. `/api/feed-command` and `/api/schedule-sync` now send `server_time_utc` and `farm_offset_minutes`. |
| F-08 tests and changelog | `f6ce770` | Full Vitest suite after merging `origin/develop`: 219 files, 2,240 tests, all passing. `tsc --noEmit` and `biome check` clean. `pnpm self-check` 52/56; the four failures are pre-existing and untouched by this branch. |

## 8. Reversal

Revert the implementation commits; the additive column can remain unused. Restore the original cap sentence in section 0.5 and mark this amendment `withdrawn`. No data is destroyed by the change itself.

## 9. Versioning (prepared, not published)

- Proposed bump: **MINOR, 1.20.1 → 1.21.0**. The change adds a setting and changes a default; it removes no API and no file path.
- Updated on the implementation branch: `package.json`, `apps/web/package.json`, `lib/legal/config.ts` (`LEGAL_APP_RELEASE`), and `CHANGELOG.md` (new `## [1.21.0] - 2026-10-28`, fresh empty `## [Unreleased]`).
- Not done, and must stay with a human: annotated tag, GitHub Release, npm publication, and production promotion.
- The merge to `develop` is the single automatic deployment trigger; no deployment was created or triggered while preparing this amendment.
