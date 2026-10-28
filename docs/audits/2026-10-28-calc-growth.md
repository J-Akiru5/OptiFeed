# Calculation audit — growth and stock metrics (I-35)

Date: 2026-10-28
Worker: I-35 (`opencode-go/deepseek-v4.1-flash`)
Worktree: `S:\Dev\optifeed\mission-I-35`
Branch: `mission/I-35-growth` (rebased onto `origin/develop` @ `2a5d5e4`, v1.19.1)
Area: ABW, total biomass, mortality/live count, FCR (feed given incl. hand-fed ÷ biomass gain),
SGR (`lib/sgr.ts`), average daily gain, growth plan and harvest projections
(`lib/growth-plan*.ts`, `lib/actions/growth-plan.ts`, `lib/actions/biomass.ts`,
`lib/actions/fcr.ts`, `lib/growth-history.ts`, `lib/crop-cycle/*`), and the growth/harvest page
figures.

Reference: "Catfish Feed Calculation Data Collection Sheet", where
**daily feed = ABW × live fish × feeding rate**, live fish = stocked − mortality (300 → 285), and
FCR = feed given ÷ biomass gain.

## Data-sheet check

The sheet's own rows reproduce with the reference formula, with one known inconsistency:

| Set | ABW (kg) | Live fish | Rate | Daily feed (kg) | 15 days (kg) |
|---|---|---|---|---|---|
| 1 | 0.0093 | 300 | 10 % | 0.279 (sheet says 0.093*) | 1.395 |
| 2 | 0.0138 | 285 | 10 % | 0.3933 | 5.895 |
| 3 | 0.0262 | 285 | 8 % | 0.59736 | 8.955 |
| 4 | 0.0702 | 285 | 5 % | 1.00035 (sheet rounds 1.0) | 15 |
| 5 | 0.1405 | 285 | 5 % | 2.002125 (sheet rounds 2.0) | 30 |

\* Row 1 is the sheet inconsistency the brief warned about: `0.0093 × 300 × 10 % = 0.279 kg`,
not `0.093 kg` (0.093 is 0.0093 × 10, i.e. the count was omitted). The data was **not** changed.

## Ledger

| Quantity | Formula in the code (`file:line`) | Units | Inputs and where they come from | Reference formula | Verdict | Fix |
|---|---|---|---|---|---|---|
| ABW of a sampling | `sampleWeightKg / sampleCount` (`lib/actions/biomass.ts:117`, edit at `:412`) | kg/fish | `BiomassLog.sampleWeightKg` ÷ `sampleCount`, both from the form/import | ABW = sample weight ÷ fish in the sample | OK | none |
| ABW shown (g) | `avgWeightKg * 1000` (`lib/growth-history.ts:122`, `dashboard/growth/page.tsx:131`, `:247`) | g | stored ABW | same | OK | none |
| **Live fish count** | new `resolveLiveFishCount` (`lib/stock.ts:58`) | fish | `Pond.population` → `CropCycle.stockingCount × expectedSurvivalPct` → explicit fallback | live = stocked − mortality | **defect** (two different counts in two places; growth plan always used the stocked count) | one helper; `growth-plan-loader.ts:138` now passes `Pond.population`; `growth-plan.ts:275` resolves it. Data sheet 300 stocked / 285 live is the fixture in `stock.test.ts` |
| Total biomass in the plan | `ABW × live fish` (`lib/growth-plan.ts:374`) | g | latest sample ABW × resolved live count | ABW × live fish (sheet) | **defect** (multiplied by `expectedSurvivalPct` *again*; double-counted mortality when the pond count was real) | survival is applied once, only in the estimate path in `lib/stock.ts` |
| Total biomass (feed card) | `population × ABW × 1000` (`lib/feed-calc.ts:12`) | g | `Pond.population`; falls back to `DEFAULT_FISH_COUNT = 5000` | ABW × live fish | **not fixed here — I-34 owns the file** | see "Hand-off to I-34" |
| Daily feed / feed per meal | `biomass × rate / 100`, `÷ feedsPerDay` (`lib/feed-calc.ts:21`, `:29`) | g | biomass, rate %, meals/day | ABW × live × rate | formula OK; **callers must pass live fish** (I-34) | see hand-off; the dashboard's 2,110.06 g is 140.67 g × 300 × 5 % |
| Growth-plan remaining feed | `(target ABW − current ABW) × live × FCR` (`lib/growth-plan.ts:383`) | g → kg | target/current sample, live count, latest `FcrReport.fcrValue` (clamped 0.8–2.5), fallback 1.5 | target-driven feed budget (valid; the sheet's rate formula is the current-day ration) | OK after the live-count fix | uses the resolved live count; assumption FCR surfaced in `plan.feed.fcrAssumption` |
| Required feeding rate | `daily feed ÷ current biomass × 100` (`lib/growth-plan.ts:386`) | %/day | plan daily feed, ABW × live | rate = daily feed ÷ biomass × 100 | OK | none |
| Recommended grams/meal | `daily feed ÷ feedsPerDay` (`lib/growth-plan.ts:388`) | g | plan daily feed, current schedule meals | per-meal = daily ÷ meals | OK | none |
| Total cycle feed | `(target ABW − stocking ABW) × live × FCR` (`lib/growth-plan.ts:395`) | kg | cycle stocking weight, live count, FCR | feed = gain × FCR | OK | now live count, no second survival factor |
| **Harvest projection (biomass)** | `live × target ABW` (`lib/crop-cycle/metrics.ts:57-66`) | kg | `Pond.population` when supplied, else stocked × expected survival | live fish × target ABW | **defect** (always stocked × expected survival; ignored a current live count) | `liveCount` input added; passed from `dashboard/harvest/page.tsx:144` and `components/harvest/harvest-calendar.tsx:201` |
| **Final FCR** | `totalFeedKg ÷ (harvestWeightKg − stockedBiomassKg)` (`lib/crop-cycle/metrics.ts:88-107`) | ratio | `FeedEvent` `feed_dispensed` (all sources, incl. `hand_fed`) ÷ (`CropCycle.actualHarvestWeightKg` − `stockingCount × stockingAvgWeightG`) | feed given ÷ biomass gain | formula OK | no filter on `source`, so hand-fed is included as the brief requires; returns `null` instead of inventing a number |
| **FCR feed window** | `receivedAt` between farm-day bounds (`lib/actions/crop-cycle.ts:266`, `lib/crop-cycle/dates.ts:82`) | instants | stocking date → actual harvest date | cycle feed, Manila days | **defect** (UTC-midnight bounds moved up to 8 h of feed to the neighbouring day) | `farmDayRangeUtc()` converts the date-only cycle to Asia/Manila half-open bounds |
| **FCR calculator rate** | `dailyFeedRationKg ÷ currentBiomassKg × 100` (`lib/fcr-calculation.ts:34`) | %/day | current biomass (kg, total) and target biomass (kg, total) from the form, days | rate = daily ration ÷ biomass × 100 | **defect** (divided by `DEFAULT_FISH_COUNT` and multiplied the biomass by it; the answer was 5,000× too small — 2.50 % was shown as 0.00 %) | direct ratio; NaN/Infinity inputs treated as missing |
| FCR calculator total feed | `(target biomass − current biomass) × FCR` (`lib/fcr-calculation.ts:28`) | kg | form totals + latest `FcrReport` | feed = gain × FCR | OK (inputs are totals; a per-fish input would need a count) | NaN/Infinity guarded |
| FCR calculator pond | `resolveActivePond(ownerId, getActivePondId())` (`lib/actions/fcr.ts:17`) | — | selected pond cookie | the pond being viewed | **defect** (`findFirst` with no ordering could read another pond's latest FCR on a multi-pond farm) | selected pond, fails closed |
| SGR | `100 × (ln W2 − ln W1) ÷ farm days` (`lib/sgr.ts:71`) | %/day | consecutive `BiomassLog.avgWeightKg`, `elapsedFarmDays` | Hopkins 1992 | OK | none |
| Average daily gain | `(W2 − W1) × 1000 ÷ farm days` (`lib/sgr.ts:82`) | g/fish/day | same samples | ADG | OK | none |
| **Days since previous sampling** | `elapsedFarmDays` (`lib/growth-history.ts:115`, `dashboard/growth/page.tsx:137`) | farm days | consecutive `recordedAt` | calendar days in Asia/Manila | **defect** (UTC milliseconds ÷ 86,400,000; disagreed with SGR near midnight) | farm-day count, same helper as SGR |
| Grow-out day / days to harvest | `date-only daysBetween` (`lib/crop-cycle/metrics.ts:37-40`) | days | `CropCycle` `@db.Date` values | calendar days | OK (date-only, farm timezone) | none |
| Stocking density advisory | `stockingCount ÷ areaM2` (`lib/growth-plan.ts:306`) | fish/m² | cycle stocking count, pond profile area | stocking density | OK (explicitly "stocking density"); a *current* density would use live fish — see ambiguities | none |

## Defects fixed (before → after)

1. **Growth plan used the stocked count, and applied survival twice.** Before: `population` was
   forced to `activeCycle.stockingCount`, so a pond with 285 live fish still planned feed for 300,
   and `expectedSurvivalPct` was then multiplied in again. After: one resolver (`lib/stock.ts`)
   prefers `Pond.population` and estimates from stocked × survival only when the pond count is
   missing, labelled in `plan.notes` ("Live fish estimated at 900 …").
   Worked example in the tests: 210 g target gap, 285 live, FCR 1.5 → 89.78 kg remaining feed
   (vs 94.50 kg at the stocked count and 85.05 kg with double survival).
2. **Harvest projection ignored the live count.** Before: always `stockingCount × expectedSurvivalPct
   × target weight`. After: `live × target weight` when the pond has a population (285 × 250 g =
   71.25 kg instead of 1000 × 85 % × 250 g = 212.5 kg for the same cycle).
3. **Final FCR counted the wrong days.** Before: UTC-midnight bounds, so feed from 00:00–08:00
   Manila on the stocking day was excluded and the next morning's feed was included. After:
   `farmDayRangeUtc` (Asia/Manila). Hand-fed rows remain included (no `source` filter).
4. **FCR calculator feeding rate was 5,000× too small.** Before: 0.00 % for 25 kg/day on 1,000 kg
   biomass. After: 2.50 %.
5. **FCR calculator read another pond's FCR** on multi-pond farms (`findFirst`, no ordering).
   After: the selected pond, failing closed.
6. **"Days since" was a UTC day count**, so it could disagree with SGR by a day. After: the same
   farm-day helper as SGR, on both the growth page and growth history.
7. **`dailyFeedG` after a growth-plan apply** could report `0` when the plan returned `null`
   (`null !== undefined` passed the guard). After: only a finite number produces a number.

## Hand-off to I-34 (feed-calc / prediction — not edited)

`apps/web/lib/stock.ts` is the new shared live-count helper:

```ts
resolveLiveFishCount({ population, stockingCount, expectedSurvivalPct, fallbackCount })
  -> { count, source: "pond" | "stocking-estimate" | "default" } | null
liveFishCount(...)          // number | null
liveFishCountOrDefault(...) // number, using DEFAULT_FISH_COUNT last
```

Please use it wherever `feed-calc.ts` / `prediction.ts` / `valueCalc` callers need a count:

- **Dashboard "Feed volume"**: the known 2,110.06 g is `140.67 g × 300 × 5 %`. With the live count
  of 285 the same formula gives **2,002 g**. The formula is right; the population is the problem.
- `totalBiomassG` silently falls back to `DEFAULT_FISH_COUNT = 5000`; that is a 5,000-fish
  assumption, not a measurement. The UI already labels the fallback in `LogSampleForm`; keep that
  behaviour and prefer `resolveLiveFishCount`.
- **Important:** the demo pond's `Pond.population` is still 300 (the stocked number). The helper
  cannot invent the 285 without mortality data (see below), so the demo value has to be corrected
  to the live count (or mortality recorded) for the dashboard to read 2,002 g.

## Needs Karl / Jeff

1. **There is no mortality record anywhere.** The schema has no mortality table; `Pond.population`
   is the only live-count source, and nothing lowers it automatically. The sheet's 300 → 285
   therefore cannot be derived by the app today. Two candidates:
   - **A (recommended):** add a mortality log (per pond/cycle, date + count) and resolve
     `live = stocked − Σ mortality`, with `Pond.population` as an override. Requires a schema
     change and a migration — out of scope for this audit.
   - **B:** keep `Pond.population` as the single live count and require the farmer to update it
     after a mortality event (no schema change). Every calculation then agrees, but the value is
     only as good as the last update.
2. **FCR shown on the dashboard/growth page is imported, not calculated.** `FcrReport` is only
   written by seed/import; harvest writes `CropCycle.actualFcr`. So after a harvest the big FCR
   tile can keep showing an old imported value. Candidates:
   - **A:** compute FCR live from `FeedEvent` + latest biomass over a rolling window;
   - **B:** create/update an `FcrReport` when a cycle is harvested and keep reading that.
   Product decision on the period definition.
3. **Projected harvest in the AI prediction context** still uses stocked × expected survival:
   `toPredictionCycleContext()` (`lib/crop-cycle/prediction-context.ts`) has no live count. The
   harvest **page** now uses the live count; the advisor context does not. Needs a decision on
   whether to wire `Pond.population` through the dashboard/growth/chat callers.
4. **Density advisory** uses the stocked count (`fish/m²`). It reads as stocking density and is
   labelled that way; a "current density" figure would use live fish. Confirm which is wanted.
5. **`FcrReport` + `hand_fed`:** if an imported `hand_fed` daily total and device dispenses cover
   the same day, both are summed into FCR feed. That matches "all feed given", but confirm the
   import never duplicates a day the device already recorded.

## Non-area findings (reported, not fixed)

- `dashboard/page.tsx:284-287` (`daysSinceSample`) still uses `ms / 86,400,000` for the sampling
  reminder, so it has the same UTC-day issue; the dashboard page is outside this area.
- `lib/chat/context.ts:190-191` reports `population: pond.population ?? 5000` and
  `totalBiomassG` from `feed-calc`; the same live-count wiring applies (I-34's files).
- `components/harvest/cycle-form.tsx:84-90` previews `stocking × survival × target` **before** a
  cycle exists — correct there, because there is no live count yet.

## Verification

| Gate | Command | Result |
|---|---|---|
| Focused tests | `pnpm exec vitest run …` (stock, growth-plan, fcr-calculation, crop-cycle-domain, crop-cycle-actions, biomass-save, sgr, chat-agent) | pass, 154 tests |
| Full suite | `pnpm exec vitest run --maxWorkers=2` (apps/web) | **215 files / 2201 tests passed** |
| Lint | `pnpm lint` | pass |
| Typecheck | `pnpm typecheck` | pass |
| API conformance | `pnpm api:check` | pass (27 routes / 54 checks) |
| Build | `pnpm build` | pass |

No schema change, no migration, no database access, no deployment. `lib/feed-calc.ts` and
`lib/prediction.ts` were not edited (I-34 owns them).
