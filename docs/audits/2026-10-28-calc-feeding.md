# Calculation audit — feed amount & schedule math (I-34)

Worker: I-34 (`opencode-go/deepseek-v4.1-flash`), branch `mission/I-34-feeding`,
worktree `S:\Dev\optifeed\mission-I-34`, based on `origin/develop` @ `d2ff03a`
(v1.19.0 tree). Reference: the team's **Catfish Feed Calculation Data Collection
Sheet** and `docs/missions/2026-10-27-issues.md` (E1–E29).

Area: `lib/feed-calc.ts`, `lib/volumeCalc.ts`, `lib/fcr-calculation.ts`
(`calculateFeedRequirement`), `lib/prediction.ts`, `lib/actions/prediction.ts`,
`lib/actions/schedule.ts`, `lib/schedule/*`, `lib/settings/feeding-caps.ts`,
`lib/settings/missed-feeding.ts`, `lib/feed/commands.ts`, and the dashboard feed
volume / feeding-rate / per-meal figures (plus the three other places that
compute the same numbers: `lib/feed-grams.ts`, `lib/actions/biomass.ts`,
`lib/jobs/pdf-export.ts`).

## TL;DR

- **The dashboard over-feeds because it counts dead fish.** Every feed figure
  used `Pond.population` = the **stocked** count. The sheet feeds **live fish**
  (stocked − mortality). One resolver (`lib/population.ts`, DB half in
  `lib/population-server.ts`) now decides the count for the dashboard,
  prediction, device-gram sync, biomass auto-adjust, PDF, log-sample preview and
  the feeder hero. Demo Pond: **2,110.05 g → 2,004.55 g** when the cycle records
  the sheet's 285 live fish.
- **An unknown population used to become 5,000 fish** (`DEFAULT_FISH_COUNT`)
  inside `totalBiomassG` / `calculateNextFeeding`. That is now `null` → the UI
  shows “—” and the auto-adjust records why it skipped.
- **The FCR calculator showed 0 %** because `suggestedFeedingRatePct` divided
  by the fish count (5,000× too small). 1,000 kg biomass gaining 500 kg in 30
  days now reads **2.5 %** instead of **0 %**.
- **Saving a schedule could exceed the daily cap**: the cap was checked against
  the *old* grams × the *new* meals, then a second function wrote new grams.
  The save now validates the amount the device will actually dispense.
- **The prediction ignored the platform daily-cap factor** and could suggest a
  dose the manual-feed path refuses. The same factor now bounds both.
- **Two next-feeding implementations** (wall-clock vs machine-local) are now
  one, and the slot spacing truncates whole minutes like the firmware instead
  of rounding (06:00→17:50, 4 meals: 09:56, not 09:57).

## Ledger

| # | Quantity | Formula in the code (`file:line`) | Units | Inputs and where each comes from | Reference formula | Verdict | Fix |
|---|---|---|---|---|---|---|---|
| 1 | Live fish count | was `pond.population` at each call site; now `resolveLiveFish()` `lib/population.ts:71` (pure), DB resolver `lib/population-server.ts:22` | fish | `CropCycle.stockingCount` (ACTIVE cycle) → `Pond.population` fallback; `CropCycle.expectedSurvivalPct`; `mortalityCount` (no source yet, see A1) | live = stocked − mortality (300 → 285) | **DEFECT** (used stocked) | One resolver; mortality > survival > stocked; 100 % survival is not an adjustment; unknown stays `null` |
| 2 | Total biomass | `totalBiomassG()` `lib/feed-calc.ts:22` | g | live fish × `BiomassLog.avgWeightKg` (latest by `recordedAt`) | ABW (kg) × live fish × 1000 | **DEFECT** (fell back to `DEFAULT_FISH_COUNT` = 5,000) | Returns `null` for missing population/weight; no invented default |
| 3 | Daily feed | `dailyFeedG()` `lib/feed-calc.ts:36` | g/day | biomass (g) × `feedingRatePct`/100 | ABW × live fish × rate | OK (formula) — inputs wrong | `null` propagation added |
| 4 | Feed per meal | `feedPerMealG()` `lib/feed-calc.ts:49`, wrapper `calculateNextFeeding()` `lib/volumeCalc.ts:20` | g/meal | daily ÷ `feedsPerDay` (effective schedule, `resolveCurrentSchedule`) | daily ÷ meals | OK | 2-dp rounding kept; `null` instead of a default count |
| 5 | Feeding rate per growth stage | single manual rate: `Pond.feedingRatePct` seeded from `OrgSetting.defaultFeedingRatePct` (3 %) — `lib/actions/ponds.ts:277-283`, `lib/actions/admin.ts:1137`; no stage table anywhere | % BW/day | Farmer/org setting; `ScheduleCommand.feedingRatePct` once saved | Sheet declines 10 % → 10 % → 8 % → 5 % → 5 % as ABW grows | **AMBIGUOUS** (see A2) — no growth-stage table exists; nothing reads ABW to pick a rate | Left as-is; documented for Karl/Jeff |
| 6 | FCR plan: feed needed | `calculateFeedRequirement()` `lib/fcr-calculation.ts:42` | kg | `currentBiomassKg`, `targetWeightKg` from the FCR form; `currentFcr` = latest `FcrReport.fcrValue`; `days` from the form | gain × FCR | OK | Non-finite inputs coerce to 0; FCR ≤ 0 → 1.5 |
| 7 | FCR plan: suggested rate | `lib/fcr-calculation.ts:53` | % BW/day | daily ration (kg) ÷ current biomass (kg) × 100 | daily feed ÷ biomass × 100 | **DEFECT** (divided by `DEFAULT_FISH_COUNT`; 5,000× too small, always displayed 0 %) | `dailyFeed / currentBiomass × 100`; 25 kg/day on 1,000 kg = **2.5 %** |
| 8 | Prediction baseline | `computeDeterministicPrediction()` `lib/prediction.ts:469` → `calculateNextFeeding` | g/meal | live fish, latest ABW, effective rate, effective meals | same as #3/#4 | **DEFECT** (input was `pond.population ?? 5000`) | Callers pass live fish; missing population → `noData` (`lib/prediction.ts:451`) |
| 9 | FCR adjustment | `lib/prediction.ts:475` — `REFERENCE_FCR / latestFcr`, clamped 0.85–1.15; `REFERENCE_FCR = 1.5` (`:20`) | factor | latest `FcrReport.fcrValue` | Reference FCR 1.5 for catfish | OK (matches `DEFAULT_FCR` 1.5) | None |
| 10 | Prediction clamp envelope | `safetyEnvelope()` `lib/prediction.ts:270`, `clampPredictionGrams()` `:302` | g/meal | current device grams ±50 %, `feedsPerDay`, hopper capacity | device safety | OK | `min 1 g`; reasons surfaced (`minimum`, `deviationBand`, `deviceLimit`) |
| 11 | Prediction upper bound | `predictionUpperBound()` `lib/prediction.ts:248` | g/meal | `MAX_FEED_GRAMS_PER_REQUEST` (1000), `dailyFeedCapG(hopper)` ÷ meals | daily cap ÷ meals | **DEFECT** (ignored `feeding.limits.dailyCapFactor`) | New optional factor; `lib/actions/prediction.ts:100` passes the stored setting and every page passes it in `PredictionInputs.dailyCapFactor` |
| 12 | Prediction daily figure | `lib/prediction.ts:522` — `grams × feedsPerDay` | g/day | clamped per-meal × meals | daily = biomass × rate | OK-ish: it is the **planned** daily, not the model daily (see A3) | Unchanged; documented |
| 13 | Apply prediction | `applyPredictedGrams()` `lib/actions/prediction.ts:92-119` | g/meal | client value rounded to 0.1 g; device row; schedule config | — | OK (schema, cap, ±50 %, CAS) | `deviationPct` in the audit row is a fraction, not a percent (A4) |
| 14 | Schedule slot spacing | `computeNextFeedingSlot()` `lib/schedule/next-feeding-slot.ts:67`; firmware `firmware-main.ino:2521` | min | `scheduleStart`/`scheduleEnd` (`@db.Time`, wall clock in UTC parts), `feedsPerDay` | `interval = (end − start) / (feeds − 1)` | **DEFECT** (rounded; firmware truncates) | `Math.trunc`; parity test 06:00→17:50, 4 meals → 09:56 |
| 15 | Next feeding (hero) | `nextFeedingAt()` `lib/schedule/next-feeding.ts:30` | instant | same schedule | — | **DEFECT** (second implementation, machine-local `setHours`; 8 h off on a UTC server) | Delegates to #14 and returns the real farm-time instant; hero formats with `formatFarmDateTime` |
| 16 | Schedule save: daily cap | `updateScheduleCommand()` `lib/actions/schedule.ts:96-116`; shared check `checkScheduleCaps()` `lib/feed/commands.ts:266` | g/day | `dailyFeedCapG(hopper, dailyCapFactor)` vs `new meals × prospective grams` | Σ meals ≤ cap | **DEFECT** (used the stored grams while changing the rate) | Computes `computePondFeedAmount()` with the new rate/meals first; one shared `checkScheduleCaps` refuses > 1000 g/meal or a daily total over the cap |
| 17 | Schedule save: relay time | `checkScheduleCaps()` `lib/feed/commands.ts:292-301` | s | `grams / gramsPerSecond` vs `maxDispenseMs` | ≤ 300 s (or the tightened cap) | **DEFECT** (same stale input) | Uses the prospective grams |
| 17a | Pond settings save (rate + population together) | `updatePondSettings()` `lib/actions/settings.ts:133-162` | g/day | intended population override + new rate/meals | same caps | **DEFECT** (the inner schedule save re-read the pond row *before* the population was written, so the check could use the old fish count in either direction) | Pre-checks with the override via the same `computePondFeedAmount` + `checkScheduleCaps` before anything is written |
| 18 | Device gram sync | `syncDeviceGramsForPond()` `lib/feed-grams.ts:110`, `computePondFeedAmount()` `:42` | g/meal | latest `BiomassLog`, live fish, pond/override rate+meals | #4 | **DEFECT** (stocked count; also wrote a >1000 g value that `schedule-sync` then silently clamped) | Live fish; refuses > 1000 g with an `auto_adjust_skipped` reason; one shared computation for check + write |
| 19 | Biomass auto-adjust | `saveBiomassLog()` `lib/actions/biomass.ts:176-247` | g/meal | sample ABW, live fish, pond rate/meals | #4 | **DEFECT** (stocked count; `?? 5000` in the preview) | Live fish from the cycle inside the same transaction |
| 20 | Dashboard feed volume | `dashboard/page.tsx:290-297` | g/meal | `energyDevice.gramsPerFeeding` (what the feeder will dispense) → formula fallback | #4 | **DEFECT** (formula overrode the device value and used `pond.population`; `330 g` magic fallback) | Device value wins; formula uses live fish; `—` when unknown; feed-now label no longer prints `nullg` |
| 21 | Dashboard population tile | `dashboard/page.tsx:243-248, 453, 884-890` | fish | live fish; detail says “{live} live of {stocked} stocked” when survival applies | live fish | **DEFECT** (showed stocked) | Live count + source detail (en + hil key `populationLive`) |
| 22 | PDF “Feed Volume” | `lib/jobs/pdf-export.ts:115-140` | g/meal | device grams / formula | #4 | **DEFECT** (per-meal value labelled as a volume; populated with `DEFAULT_FISH_COUNT`) | “Feed per Meal” + live and stocked rows |
| 23 | Manual feed daily cap | `createManualFeedRequest()` `lib/feed/commands.ts:45-50, 158-175` | g/day | `FeedRequest.grams` (pending/dispatched/completed) in the Manila day | Σ feed ≤ cap | **AMBIGUOUS** (A5): scheduled dispenses are not counted | Unchanged; documented |
| 24 | Manual feed relay cap | `lib/feed/commands.ts:130-138` | s | grams ÷ `gramsPerSecond` vs `maxDispenseMs` | ≤ cap | OK | None |
| 25 | Feeding caps reader | `normalizeFeedingCaps()` `lib/settings/feeding-caps.ts:70`, `getFeedingLimits()` `:113` | ms / factor | `PlatformSetting feeding.limits`; clamps to `[min, hardMax]`; DB error → defaults | caps may only tighten | OK | None (verified) |
| 26 | Missed-feeding dedupe day | `dayKey()` `lib/settings/missed-feeding.ts:27-34, 69-70` | farm date | ingest timestamp → `dateToFarmDateOnly` | farm day | OK | None (grams rounded in the message text only) |
| 27 | Multi-feeder pond amount | `syncDeviceGramsForPond()` `updateMany({ pondId })` `lib/feed-grams.ts:147` | g/meal | one pond requirement copied to **every** device | pond daily ÷ meals ÷ feeders? | **AMBIGUOUS** (A6) — two feeders on one pond each dispense the full pond dose | Unchanged; documented |
| 28 | Firmware rate field | `firmware-main.ino:2509-2535` (`ratePct` read, only `grams_per_feeding` cached) | % | server `scheduleValues()` `api/schedule-sync/route.ts:54-64` | — | Cross-area observation (A7) | Not changed (firmware) |

## Before → after (what a farmer sees)

| Figure | Before | After | Why |
|---|---|---|---|
| Demo Pond feed volume (300 stocked, 140.67 g ABW, 5 %, 1 meal) | 2,110.05 g | 2,004.55 g at 285 live (the sheet's 2,002 g uses its rounded 140.5 g ABW) | #1–#4, #20 |
| FCR calculator suggested rate (1,000 kg → 1,500 kg, 30 d, FCR 1.5) | 0 % | 2.5 % | #7 |
| Pond with no population recorded | 5,000 fish assumed → a feed number | “—” and an explicit skip reason | #2, #8 |
| Schedule save at a higher rate | cap checked on the old grams | cap checked on the new dispatch amount | #16 |
| Next feed after 06:00→17:50 with 4 meals | 09:57 (rounded) | 09:56 (firmware parity) | #14 |

## Tests added or corrected

- `lib/__tests__/population.test.ts` (new): sheet 300 → 285 (mortality and
  survival), mortality wins, 100 % is no adjustment, no invented count, total
  loss = 0.
- `lib/__tests__/feed-calc.test.ts`: sheet biomass/per-meal fixtures; `null`
  instead of the 5,000 default; NaN/zero inputs.
- `lib/__tests__/volumeCalc.test.ts`: sheet rows 2 and 5 on **live** fish; the
  stocked comparison; `null` for an unknown population.
- `lib/__tests__/fcr-calculation.test.ts`: 2.5 % (was 0 %), plus a sheet-rate
  case.
- `lib/__tests__/next-feeding-slot.test.ts`: firmware truncation parity.
- `lib/__tests__/next-feeding.test.ts`: rewritten for farm wall clock and the
  real instant (timezone-independent assertions).
- `lib/__tests__/feed-grams.test.ts`: live-fish case, over-limit refusal,
  skip reasons; crop cycle mock.
- `lib/__tests__/feeder-hero.test.tsx`: fixtures are now real farm instants so
  the farm-time formatter is asserted regardless of the runner's timezone.
- `lib/__tests__/server-actions.test.ts`: two schedule-save cases — the cap is
  checked against the amount the new rate will produce (stored grams looked
  safe), and a dose above the 1,000 g per-meal limit is refused without writing.
- `lib/__tests__/schedule-caps.test.ts` (new): the shared cap check — per-meal
  limit, daily cap, hopper-bound cap, tightened factor, relay time, unusable
  amounts.
- `lib/__tests__/pdf-export.test.ts` and `lib/__tests__/settings-pages.test.tsx`:
  prisma mocks gain the pond and crop cycle the population resolver reads.

## Needs Karl / Jeff

**A1 — there is no mortality record anywhere in the schema.** Live fish =
stocked − mortality is the sheet's rule, but nothing captures “15 died on
Tuesday”. `PondEventType` has no mortality kind, `CropCycle` only has
`expectedSurvivalPct` (a plan) and `actualHarvestCount` (after harvest). The
resolver already accepts `mortalityCount` and prefers it; wiring it needs a
schema change (e.g. `MortalityLog { pondId, cycleId, count, reason, recordedAt }`
or a `MORTALITY` pond-event kind with a count), which this task may not make.
Candidate formulas until then:
- **A** (used now): live = stocked × `expectedSurvivalPct` when the cycle has
  one, else stocked. Consequence: the default form value 85 % cuts feed 15 %
  for every cycle that leaves it at the default.
- **B**: live = stocked − Σ mortality events (exact, needs A1).

**A2 — feeding rate per growth stage is not implemented.** The sheet declines
the rate with body weight (10 % → 8 % → 5 %); the app has one manual rate per
pond (org default 3 %). Candidate formulas:
- **A** (used now): one rate per pond, farmer-set; the growth plan and the
  prediction already propose a rate (`requiredFeedingRatePct`,
  `effectiveFeedingRatePct`) but never apply it automatically.
- **B**: a stage table keyed on ABW (e.g. <15 g → 10 %, 15–50 g → 8 %,
  >50 g → 5 %), applied when the pond has no explicit override. Needs a
  decision because it changes what the feeder dispenses after every sample.

**A3 — `Factors.dailyFeedG` is the planned daily (clamped grams × meals), not
biomass × rate.** Both are legitimate; the card can be read either way. Pick
one label (“planned today”) or add the model value beside it.

**A4 — `prediction_applied` audit rows store `deviationPct` as a fraction**
(0.42 means 42 %). Display-only today; renaming would rewrite history.

**A5 — the manual-feed daily cap counts only `FeedRequest` rows.** Scheduled
(from the firmware) and `hand_fed` rows are not counted, so Feed Now can add
up to the full cap on top of a full scheduled day. Candidate formulas:
- **A** (used now): cap applies to manual requests only.
- **B**: cap = Σ all feed today (`FeedEvent`, all sources) + the request, which
  is what “daily cap” sounds like but will start refusing Feed Now late in the
  day on a normal schedule.

**A6 — a pond with two feeders.** `syncDeviceGramsForPond` writes the whole-pond
per-meal amount to every device on the pond, so two feeders dispense twice the
calculated feed. Candidates: (A) split the daily requirement by device count,
(B) keep whole-pond per device and require the farmer to halve the rate,
(C) give each device its own share field. Needs a product decision (E22 made
multi-device ponds first-class).

**A7 — firmware `feeding_rate_pct` is read into `ratePct` and then unused**
(`firmware-main.ino:2509-2517`); the board only uses `grams_per_feeding`. Not a
web defect; listed so the firmware owner can drop or use the field.

**A8 — `DEFAULT_FISH_COUNT` (5,000) is still a demo seed** used by
`growth-plan-loader` (when neither a cycle nor a pond count exists) and by the
sample-form preview’s labelled “estimate assuming 5,000 fish”. Feed maths no
longer uses it.

**A9 — the reference sheet's row 1 is internally inconsistent** (0.0093 kg ×
300 × 10 % = 0.279 kg, not 0.093 kg). Not “fixed” — reported as instructed.

## Cross-area findings (not changed)

- `lib/chat/context.ts:171,190` still sends `pond.population ?? DEFAULT_FISH_COUNT`
  to the assistant, so Pakoy can quote a stocked/5,000 count. It should call
  `getPondPopulation()`. (Assistant area.)
- `lib/growth-plan.ts:362-385` already applies `expectedSurvivalPct` to the
  population it receives (stocked). That is the correct live-fish convention and
  now matches the resolver — but it re-implements it; a follow-up should pass
  `liveFish` in and drop the local `survivalPct` multiplication.
- `lib/actions/crop-cycle.ts:263-274` (final FCR) sums **all** `feed_dispensed`
  rows in the cycle window including `hand_fed` daily totals — correct for FCR,
  but it counts machine rows per device and would double-count if a device
  belongs to two cycles in the window. Low risk today (one ACTIVE cycle).
- `api/schedule-sync/route.ts:35-45` clamps `grams_per_feeding` to 1,000 g
  silently on the way to the board. Writes are now always ≤ 1,000 g, so the
  clamp is a safety net rather than a live truncation.

## Gates

All run on the final tree (after the pure/server population split):

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --prefer-offline` | ok — 712 packages reused, no download |
| `pnpm --filter @optifeed/web run prisma:generate` | ok — Prisma Client v6.19.3 |
| `apps/web`: `pnpm exec vitest run --maxWorkers=2` | **215 files / 2,202 tests passed**, 0 failed (283.87 s) |
| root `pnpm lint` (biome) | ok — 755 files, no findings |
| root `pnpm typecheck` | ok — `tsc --noEmit` clean |
| root `pnpm api:check` | ok — 27 route files, 54 checks, 0 failures |
| root `pnpm build` | ok — compiled successfully, 7/7 static pages, exit 0 |

No schema change, no migration, no database access, no deploy. Guards, caps and
their stored values are untouched (the cap *readers* now agree everywhere).
