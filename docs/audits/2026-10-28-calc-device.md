# Calculation audit — device & hopper operations (I-36)

Date: 2026-10-28
Worker: I-36 (`mission/I-36-device`)
Area: hopper level, days of feed remaining, grams → dispense duration / calibration,
feed figures, last-known/offline values, and the numeric handling in the device API
routes (`ingest`, `feed-command`, `schedule-sync`).
Reference: the team's "Catfish Feed Calculation Data Collection Sheet" (see
`docs/missions/2026-10-27-issues.md`, brief `brief-CALC-AUDIT.md`).

Constraints observed: no schema change, no migration, no database access, no firmware
change, no change to the device auth contract or to any cap value. Device auth
(`verifyDeviceToken`, `isDeviceApproved`, rate limits) and the caps in `lib/limits.ts`
are untouched.

Baseline `origin/develop` @ `d2ff03a` (v1.19.0). All fixed items have a regression test
using the data-sheet numbers where they apply.

## Reference formulas

- Daily feed (g) = ABW (g) × **live fish** × feeding rate (%) / 100
- Live fish = stocked fish − mortality (sheet: 300 → 285)
- Per 15 days = daily × 15
- Dispense duration (s) = grams ÷ grams per second
- Corrected g/s from a target check = g/s before × measured grams ÷ target grams
- Days of feed left = hopper capacity × level % ÷ (grams per meal × meals per day)

## Ledger

| Quantity | Formula in code (`file:line`) | Units | Inputs and where they come from | Reference formula | Verdict | Fix |
|---|---|---|---|---|---|---|
| Hopper level % | Firmware interpolates `(emptyCm − distance) / (emptyCm − fullCm) × 100`, clamped 0–100 (`firmware/firmware-main/firmware-main.ino:2656–2659`); server stores `feed_level_percent` after `z.number().min(0).max(100)` (`app/api/ingest/route.ts:73`) | % | `feed_level_percent` / `feed_level_cm` from the HC-SR04 on each heartbeat | % full between the calibrated full and empty distances | **Defect (server side of a firmware sentinel)** | See #1 |
| No-echo sentinel | `levelPercent === 0 && levelCm === 0` treated as no reading (`ingest/route.ts:295–299`) | % / cm | Firmware sends `0 %` and `0 cm` on an ultrasonic timeout | A timeout is not a level | **Fixed** | #1 |
| Hopper distance storage | `feedLevelCm` only written when reported (`ingest/route.ts:307`); history row `distanceCm: levelCm ?? 0` (`:355`) | cm | Heartbeat | Keep the last real distance | **Fixed (row) / ambiguous (history)** | #1, A5 |
| Last-known level display | `resolveFeedLevelDisplay` clamps and rounds, keeps the last reading when offline (`lib/feed-level-display.ts:55–71`) | % | `EnergyDevice.feedLevelPercent/UpdatedAt`, `lastSeenAt` | E4 last-known | **OK** | — |
| Offline threshold (display) | `now − lastSeenAt > OFFLINE_THRESHOLD_MS` (15 min) (`lib/feed-level-display.ts:40–46`, `lib/constants.ts:15`) | ms | `lastSeenAt` | Org `offlineAfterMin` default 30 | **Ambiguous** | A1 |
| Offline threshold (alert) | `offlineAlertDue` uses `settings.offlineAfterMin` (default 30) (`lib/settings/org-alerts.ts:87–105`) | ms | `OrgSetting.offlineAfterMin` | Same org setting | **OK** (but differs from display) | A1 |
| Days of feed remaining | `capacity × level% ÷ (gramsPerMeal × mealsPerDay)` (`lib/feed-level.ts:40–79`); formatted `Math.floor` (`:115`) | days | `EnergyDevice.hopperCapacityG`, level %, `EnergyDevice.gramsPerFeeding`, meals/day | Same | **Defect (two implementations, no guards)** | #3 || Two-day feed warning | Same quantity recomputed inline with float + `Math.ceil` (`ingest/route.ts:452–466`, before) | days | Device row + `Pond.feedsPerDay` | Same | **Defect** | #3 |
| Low/critical hopper badge | `isLow = level ≤ 20`, `isCritical = level ≤ 5` (hard-coded) (`lib/feed-level.ts:113–114` before) | % | Level % | Org `hopperLowPct` (default 20) + fixed critical 5 (`lib/settings/org-alerts.ts:76–84`) | **Defect** | #4 |
| Hopper refill detection | last logged level ≤ lowPct and current > lowPct (`ingest/route.ts:483–497`) | % | `FeedLevelLog`, reading | same | **OK** | — |
| Feed per meal | `biomass × rate% ÷ meals` with 2-dp rounding at each step (`lib/feed-calc.ts:66–92`) | g | ABW, live fish, rate, meals/day | Sheet | **OK** (rounding chain) | — |
| Population used for feed | `Pond.population` (stocked count, per the dashboard's "Stable stocked quantity") | fish | `Pond.population`; cycle `stockingCount`, `expectedSurvivalPct` | **Live fish** (stocked − mortality) | **Defect** | #2 |
| Live fish count | `round(count × survival% / 100)`, null when unknown (`lib/feed-calc.ts:22–43`) | fish | `Pond.population` (or cycle `stockingCount`), `CropCycle.expectedSurvivalPct` | Sheet column "Live fish" | **Fixed** | #2 |
| Device grams per feeding | `feedPerMealG(totalBiomassG(liveFish, ABW), rate, meals)` (`lib/feed-grams.ts:25–92`) | g | Latest `BiomassLog.avgWeightKg`, active `CropCycle`, pond config | Sheet | **Fixed** | #2 |
| Sample-save recommendation | `calculateNextFeeding(ABW, rate, meals, livePopulation)` (`lib/actions/biomass.ts:174, 242–246`) | g | Same | Sheet | **Fixed** | #2 |
| Dashboard "Feed volume" / next feed | `feedPerMealG(totalBiomassG(liveFish, ABW), effective rate, effective meals)` (`dashboard/page.tsx:256–263`) | g | Live fish, latest sample, `resolveCurrentSchedule` | Sheet | **Fixed** | #2 |
| Log-sample preview | `totalBiomassG(livePopulation, ABW)` (`components/LogSampleForm.tsx:84–111`, fed by `log-sample/page.tsx`) | g | Live fish from the page | Sheet | **Fixed** | #2 |
| Feeder-hero advisor | `computeDeterministicPrediction({ population: liveFishCount(...) })` (`lib/feeder-hero.ts:108–119`) | g | Hero pond + cycle survival | Sheet | **Fixed** | #2 |
| PDF report feed volume | `feedPerMealG(totalBiomassG(liveFish, ABW), …)` (`lib/jobs/pdf-export.ts:112–130`) | g | Active pond + cycle | Sheet | **Fixed** | #2 |
| Grams → dispense duration (validation) | `gramsPerFeeding / gramsPerSecond > maxDispenseMs / 1000` (`lib/actions/schedule.ts:100–108`; `lib/feed/commands.ts:124–133`) | s | Device rate + configured grams | grams ÷ g/s | **OK** (uses platform cap) | — |
| Grams → dispense duration (admin pond edit) | Same check with `MAX_DISPENSE_MS` and `dailyFeedCapG(capacity)` **without** the platform factor (`lib/actions/ponds.ts:442–456`) | s / g | Device | Same, but platform caps may only tighten | **Defect (cross-area)** | A2 |
| Rate test g/s | `actualGrams / testSeconds` (`lib/actions/calibration.ts:583`) | g/s | Weighed output + test window | g ÷ s | **OK** | — |
| Rate-test error | `(actual − previousGps × seconds) / expected × 100` (`calibration.ts:597–599`) | % | Device rate before, test seconds, weighed output | Same | **OK** | — |
| Target-check correction | `beforeGps × measured / target` (`calibration.ts:772`) | g/s | Device rate, target, weighed output | Same | **OK** | — |
| Target-check error / accept | `(measured − target) / target × 100`, accept at ±5 % (`calibration.ts:783–784`, `lib/limits.ts:65`) | % | Weighed output / target | Same | **OK** | — |
| Durations shown after calibration | `round1(gramsPerFeeding / gps)` (`calibration.ts:593–595`, `:788–789`) | s | Device grams + rate | grams ÷ g/s | **OK** | — |
| Test dose grams | `round1(gps × testSeconds)` then refuse outside 1–1000 g (`calibration.ts:271–274`) | g | Device rate + chosen window | g/s × s | **OK** | — |
| Target-check duration | `round((target / gps) × 1000)` vs `maxDispenseMs` (`calibration.ts:417–423`) | ms | Target + rate | target ÷ g/s | **OK** | — |
| Daily feed cap window | `manilaDayRange` duplicated in `calibration.ts:106–111` and `lib/feed/commands.ts:40–45`; `startOfFarmDay` in `lib/feed-figures.ts:72` | ms | `now` | Asia/Manila day | **Ambiguous (duplicate, equivalent)** | A3 |
| Drift: hopper drop | Baseline walk; falls counted, ≤5-point rises ignored without raising the baseline, >5-point rises start a refill segment (`lib/calibration/drift.ts:82–112`) | % → g | `FeedLevelLog.levelPercent`, `hopperCapacityG` | drop × capacity | **Defect** | #5 |
| Drift: dispensed grams | Sum of `feed_dispensed` machine sources over 7 days (`lib/calibration/drift-data.ts:24–50`) | g | `FeedEvent.grams` (`scheduled`/`dashboard`/`button` only) | Device output only | **Defect (hardware page)** | #6 |
| Drift: disagreement | `(observed − dispensed) / dispensed × 100`, drift above 15 % (`drift.ts:157–160`) | % | Both above | same | **OK** | — |
| Drift minimums | ≥3 feeds, ≥2 level readings, positive capacity and dispensed grams (`drift.ts:43–53, 128–155`) | count | Window | same | **OK** | — |
| Recalibration due date | `lastCalibratedAt + intervalDays × 24h` (`lib/calibration/recalibration.ts:43–50`) | ms | Device rows | same | **OK** | — |
| Recalibration overdue | `floor((now − due) / 24h)` (`recalibration.ts:52–67`) | days | now, due | same | **OK** | — |
| Recalibration reminder scope | Cursor pagination over all eligible devices (`lib/calibration/recalibration-reminders.ts`) | count | `EnergyDevice` | Every overdue device | **Defect (silent 200 cap)** | #7 |
| Last machine feed | Newest `feed_dispensed` with a machine source (`lib/pond-charts.ts:160–169`) | g | `FeedEvent` | Device output only | **OK** | — |
| Dispensed today | Every source since farm midnight (`pond-charts.ts:170–178`) | g | `FeedEvent` | Feed given today | **OK** | — |
| Last 7 days + average | Every source, 7 farm days, `/7` (`pond-charts.ts:179–199`) | g | `FeedEvent` | Feed given / 7 | **OK** | — |
| Feed amount rendering | <1,000 g → grams, ≥1,000 g → kg 2 dp (`lib/feed-figures.ts:48–69`) | g/kg | Any feed figure | One unit rule | **OK** (edge: 999.96 g renders "1,000 g") | A4 |
| Hero "dispensed today" | Machine sources since farm midnight (`lib/feeder-hero.ts:68–80, 131`) | g | `FeedEvent` | Device output only | **OK** | — |
| Next feeding (hero) | Slot list from `computeNextFeedingSlot`, resolved with `farmWallClockToInstant` (`lib/schedule/next-feeding.ts:26–60`) | instant | `@db.Time` wall clock + `now` | Farm wall clock | **Defect** | #8 |
| Next feeding (dashboard strip) | Wall-clock minutes (`lib/schedule/next-feeding-slot.ts:61–86`) | minutes | same | same | **OK** | — |
| Device schedule times | `formatTime` = `getUTCHours/getUTCMinutes` on `@db.Time` (`app/api/schedule-sync/route.ts:24–26`) | HH:MM | `@db.Time` | Farm wall clock | **OK** | — |
| Device config payload | `grams_per_feeding = clamp(…, 0, 1000)`, g/s 0.5–50, button 1–500 (`feed-command/route.ts:29–38`, `schedule-sync/route.ts:37–46`) | mixed | Device row | Caps | **OK** (silent clamp, see A6) | — |
| Manual feed grams | `clamp(request.grams, 0, 1000)` (`feed-command/route.ts:98`) | g | `FeedRequest` | Caps | **OK** | — |
| Schedule feeds/rate | `clamp` to 1–24 and 0.1–10 (`schedule-sync/route.ts:48–59`) | count / % | `ScheduleCommand` / `Pond` | Caps | **OK** | — |

## Defects fixed

### 1. A failed ultrasonic read was stored as an empty hopper (0 %)
`ingest/route.ts`. The firmware's HC-SR04 path returns `0 %` **and** `0 cm` when the
pulse times out (`firmware-main.ino:2656`, telemetry `:2743–2767`). Ingest trusted the
percent, overwrote `feedLevelPercent`, wrote a 0 % history row, and could fire a
**CRITICAL** "hopper nearly empty" notification plus a Telegram message on every failed
read. The sentinel pair (`0 %`, `0 cm`) is now "no reading": the heartbeat still updates
`lastSeenAt`, but the level, alerts and history are skipped. A real empty hopper (0 %
with a real distance) still alerts. A missing `feed_level_cm` no longer blanks the last
known distance.
Tests: `lib/__tests__/ingest-route.test.ts` (sentinel, real-empty, omitted cm, stored
cm, two-day warning).

> Firmware note (not changed here): `readFeedLevelPercent()` conflates "no echo" with
> "empty" by returning 0. Server-side rejection protects the app, but the firmware
> should report the sentinel explicitly (e.g. omit the fields or send `-1`) in a future
> build. Firmware is out of scope for this audit.

### 2. Feed maths used the stocked count instead of live fish
Known discrepancy from the brief: 2,110 g/day for the Demo Pond = 140.67 g × **300** ×
5 %. The sheet uses **285 live fish**: 0.1405 kg × 285 × 5 % = **2.002 kg/day**
(2,110 → 2,002 with the sheet's weight).

Added one resolver, `liveFishCount(count, expectedSurvivalPct)` /
`liveBiomassG(...)` (`lib/feed-calc.ts:22–58`), and used it everywhere a feed amount is
derived from a fish count:

- `lib/feed-grams.ts` (the value the ESP32 dispenses; also falls back to the active
  cycle's `stockingCount` when `Pond.population` is empty instead of skipping);
- `lib/actions/biomass.ts` (the recommendation shown after saving a sample — this path
  writes the device value directly, so it had to change too);
- the dashboard feed volume and the deterministic advisor;
- the log-sample preview;
- the feeder hero advisor;
- the PDF report.

Precedence: `Pond.population` (or the cycle's `stockingCount` when empty) × the active
cycle's `expectedSurvivalPct`; no cycle / no survival = 100 % (no deduction). A missing
count is `null`, not 5,000; in the dashboard advisor it is now reported as "not enough
data" instead of a 5,000-fish recommendation.

Before → after (unit test, data-sheet row 5): `totalBiomassG(300, 0.1405)` → 5 %
= 2,107.5 g; `liveBiomassG(300, 0.1405, 95)` → 5 % = **2,002.13 g**; per meal at 2
meals = **1,001.07 g**.
Tests: `feed-calc.test.ts`, `feed-grams.test.ts`.

### 3. Days of feed remaining was implemented twice, without guards
`lib/feed-level.ts` floors for the card; ingest recomputed it inline and used `99` as a
"no consumption" sentinel. Both could divide by zero or read a negative capacity.
One helper now owns it, `estimateDaysOfFeedRemaining` (`lib/feed-level.ts:40–79`), used
by the card (`:83–116`) and the two-day alert (`ingest/route.ts:452–466`). It returns
`null` for a missing/zero/negative capacity, meal grams or meals/day; the card floors
for display, the alert compares the fraction. The dashboard now passes the **effective**
meals/day (pending/applied schedule) instead of the stale `Pond` row.
Tests: `feed-level.test.ts` (fraction, null guards, clamp), `ingest-route.test.ts`.

### 4. Hopper badge ignored the org's low threshold
The card used the hard-coded 20 % while the alerts use `OrgSetting.hopperLowPct`. The
dashboard now passes `orgSettings.settings.hopperLowPct` to `FeedLevelCard`
(`components/FeedLevelCard.tsx`), and `getFeedLevelDisplay` defaults to 20 % for other
callers. Critical stays at the fixed 5 % (`PELLET_CRITICAL_PCT`).
Tests: `feed-level.test.ts` (custom threshold).

### 5. Drift detector counted the same pellets twice after sensor noise
Old code summed `−delta` for every consecutive pair, so `50 → 53 (noise) → 40` counted
13 points although the hopper fell 10. Rewritten as a baseline walk (`drift.ts:82–112`):
a rise ≤5 points is ignored **without** raising the baseline; a fall is counted from the
real peak; a rise >5 points starts a new refill segment (the pre-refill drop is kept).
Example fixed: 70 → 75 (noise) → 60 is now 10 points = 100 g at a 1 kg hopper, not 150 g.
Tests: `calibration-drift.test.ts` (noise, repeated noise, refill, sorted readings).

### 6. Hardware page's drift check counted hand-fed daily totals
The dashboard and assistant already filtered `source ∈ {scheduled, dashboard, button}`;
the hardware page did not, so an imported `hand_fed` daily total was compared with the
hopper drop. The query now lives in one loader, `lib/calibration/drift-data.ts`, used by
the dashboard, the hardware page and the assistant.
Tests: `calibration-drift-data.test.ts` (source filter, 7-day window, pass-through).

### 7. Recalibration reminders silently stopped at 200 devices
`take: 200` with no pagination. Now a cursor loop processes every eligible device; the
summary still counts every one.
Test: `calibration-recalibration.test.ts` (200 + 1 → checked 201, one reminder).

### 8. Feeder-hero "next feed" used the server's timezone
`nextFeedingAt` used `Date#setHours` (runtime local time). On Vercel (UTC) the hero
rendered the time eight hours off from the next-feeding strip. It now resolves
`computeNextFeedingSlot` (farm wall clock) to a real instant with
`farmWallClockToInstant` / `zoneOffsetMs` (`lib/date-local.ts:105–154`); the duplicated
offset maths moved out of `lib/chart-windows.ts`.
Tests: `next-feeding.test.ts` (Manila assertions independent of the host zone),
`date-local.test.ts` (round trip, offset).

## Needs Karl / Jeff (ambiguous, behaviour left as-is)

### A1. Two different offline definitions
Every farmer surface calls a device offline after **15 minutes**
(`OFFLINE_THRESHOLD_MS`), while the org setting `offlineAfterMin` (default **30**) only
drives the alert cron. An org that sets 45 minutes still sees "offline" after 15. The two
numbers are defensible (UI freshness vs alert delay) but they should be one policy.
Candidates: (a) display uses `OrgSetting.offlineAfterMin`, or (b) keep 15 for display and
rename the setting to "offline alert delay". Option (a) needs an org lookup on every
device surface and makes the client helper async; option (b) is a label change.

### A2. Admin pond edit ignores the platform safety caps (cross-area)
`lib/actions/ponds.ts:442–456` checks the daily cap with `dailyFeedCapG(capacity)` (no
`dailyCapFactor`) and the relay limit with the hard-coded `MAX_DISPENSE_MS`, while the
farmer path (`schedule.ts`, `feed/commands.ts`) uses `getFeedingLimits()`. This can let an
admin save a schedule the platform cap would reject. Fixing it only tightens behaviour,
but it touches admin guards, so it is reported rather than changed here.

### A3. Three Manila-day helpers
`calibration.ts:106`, `feed/commands.ts:40` (fixed +8 h arithmetic) and
`feed-figures.ts:72` (`startOfFarmDay` via `chart-windows`). They agree numerically
because Manila has no DST, but they are three copies. Consolidating on
`startOfFarmDay` is a safe follow-up once the action files are free to change together.

### A4. Feed amount threshold applied before rounding
`formatFeedAmount` chooses grams vs kg on the raw value, so 999.96–999.99 g renders as
"1,000 g" rather than "1.00 kg". Cosmetic only; choose whether the threshold should use
the rounded value.

### A5. `FeedLevelLog.distanceCm` when the device omits the distance
The column is required, so a reading with a percent but no cm writes `0` (which reads as
"full" in a distance export). The current firmware always sends both, so this only
affects partial/legacy payloads. Options: skip the history row, or make the column
nullable (schema change — not done).

### A6. Device config clamps are silent
`feed-command`/`schedule-sync` clamp `grams_per_feeding` to 1,000 g, g/s to 0.5–50 and
button grams to 1–500 with no audit row. Caps are contract and must not change; if a
clamp ever bites, an operator has no trace. Suggest an `auto_adjust_skipped`/`config_clamped`
audit event (no schema change).

### A7. Manual rate entry does not reset the recalibration clock
`saveDurationCalibration` (`lib/actions/energy.ts:110–148`) writes `gramsPerSecond` but
not `lastCalibratedAt`, so a manually calibrated feeder still shows overdue and gets a
reminder. This was already an open I-07 question (should manual entry count as a
calibration?) and is left for a decision.

### A8. Drift resolution is limited by hopper log thinning
`FeedLevelLog` stores a row at most every 30 min or on a >5-point change
(`ingest/route.ts:345–359`). A small feeding can therefore be invisible to the drop,
biasing drift toward "too little observed". Not a formula error; if drift proves noisy,
lower the thinning or log every dispensed feed.

### A9. Hand-fed rows use `receivedAt` for their farm day
Imported `hand_fed` totals are a whole day but carry the import time in `receivedAt`
(the explicit `timestamp` string is not parsed), so a day's total imported today counts
in "today". The History cards label them as daily totals, but the day they belong to is
not recorded. Needs the import schema decision (does `timestamp` hold the sheet date?).

### A10. Sensor noise threshold is a heuristic
A rise of ≤5 points is treated as noise for drift. Several small top-ups (+3, +3, +3)
are also ignored and can under-count the drop. A per-device or time-aware threshold is
the next step if drift is used for actual recalibration decisions.

### A11. Does `Pond.population` mean stocked or live fish?
The new curve applies the active cycle's `expectedSurvivalPct` to `Pond.population` (or
the cycle's `stockingCount`) because the dashboard calls that field a "stable stocked
quantity" and the sheet computes live fish as stocked − mortality. If the team intends
`Pond.population` to be an **observed live count**, applying survival again
double-deducts (e.g. 285 live × 95 % = 271). Two candidates: (a) keep the current
"population is stocked, cycle survival is the mortality allowance" rule (chosen here,
matches the sheet and the Growth page), or (b) treat `Pond.population` as live and apply
the cycle survival only when the count comes from `stockingCount`. A one-line change in
`liveFishCount` callers if Jeff prefers (b).

### A12. Data-sheet row 1 is internally inconsistent (report only)
The sheet's Sampling 1 row says ABW 0.0093 kg, 300 fish, 10 % → daily 0.093 kg. The
formula gives 0.0093 × 300 × 10 % = **0.279 kg**; per 15 days would be 4.185 kg, not
1.395 kg. Rows 2–5 check out (row 4 and 5 are rounded on the sheet:
0.0702 × 285 × 5 % = 1.000 kg and 0.1405 × 285 × 5 % = 2.002 kg). The app must not be
"fixed" to reproduce 0.093; the sheet cell needs a correction.

## Cross-area findings (reported, not fixed)

- **Population default 5,000**: `totalBiomassG` still falls back to
  `DEFAULT_FISH_COUNT` for callers that pass `null` (`lib/feed-calc.ts:66–69`), and
  `dashboard/page.tsx` still uses `pond.population ?? DEFAULT_FISH_COUNT` for the pond
  tile and offline snapshot. The feed paths in this audit no longer use 5,000, but the
  prediction/chat/PDF fallbacks elsewhere may. The honest default is "unknown".
- **Growth page prefers the stocked count**: `lib/growth-plan-loader.ts:139` passes
  `activeCycle.stockingCount` as the population and then multiplies by survival in
  `growth-plan.ts:268, 362`, i.e. stocked × survival — consistent with the new feed
  maths, but it ignores `Pond.population`. Align it with `liveFishCount` when the growth
  area is next touched.
- **Assistant chat prediction ignores the hopper capacity**: `lib/chat/context.ts:175`
  passes `hopperCapacityG: null` to `computeDeterministicPrediction`, so its safety
  ceiling is 1,000 g/meal rather than the daily cap spread over meals.
- **`fcr-calculation.ts`** multiplies and divides by `DEFAULT_FISH_COUNT`, so the value
  cancels; it is not a numerical defect, only a confusing constant.
- **Next-feeding duplicate** (`lib/schedule/next-feeding.ts` vs
  `next-feeding-slot.ts`) is resolved for the hero: the hero now calls
  `computeNextFeedingSlot`. `nextFeedingAt` remains as the instant-returning wrapper.

## Verification

Run from the repo root unless noted. `node_modules` was installed with
`pnpm install --frozen-lockfile --prefer-offline` (712 packages, 43.9 s) and
`pnpm --filter @optifeed/web run prisma:generate` once.

| Command | Result |
|---|---|
| `apps/web: pnpm exec vitest run --maxWorkers=2` (full suite, after the fixes) | **214 files / 2212 tests passed** |
| `pnpm lint` | clean, 753 files |
| `pnpm typecheck` | clean (`tsc --noEmit`) |
| `pnpm api:check` | 27 routes / 54 checks, 0 failures |
| `pnpm build` | success (Next.js production build) |

No schema change, no migration, no database access, no firmware change, no deployment.
Device auth and every cap value are unchanged; the only device-route change is that the
ultrasonic timeout sentinel no longer counts as a level reading.
