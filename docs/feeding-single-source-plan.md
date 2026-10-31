# Feeding single source of truth and daily ceiling — contract (task 1.8)

Status: **proposed** — implementation branch `feat/feeding-single-source`, cut from
`origin/develop` `2a5d5e4`. Plan branch `docs/update-industry-grade-plan` is behind
`develop`; paths and line numbers below are verified against `2a5d5e4`, not against this
branch's tree.

Owner: Jeff. Implementation: agent-assisted. This document is the contract; code follows
it, not the other way round.

Supersedes one default in the master plan section 0.5: the daily feeder allocation. The
hard guard stays 5,000 g; the **default** becomes 2,000 g and becomes configurable.

## 1. Why — verified starting point (2026-10-28, `origin/develop` `2a5d5e4`)

The reference formula in the team's own document (`Formula for the amount of feeds per
day.docx`) is correctly implemented in exactly one place:

```
Daily Feed (g)  = Total Biomass (g) × Feeding Rate (%)
Feed per Meal   = Daily Feed (g) ÷ Feeds Per Day
1,185 g × 5% = 59.25 g/day → 2 meals = 29.63 g → 3 meals = 19.75 g
```

`apps/web/lib/feed-calc.ts:12-35` reproduces those numbers including the `17.775 → 17.78`
half-value guard. Every defect below is a *second* implementation disagreeing with it.

| # | Defect | Evidence | Effect |
|---|---|---|---|
| 1 | FCR calculator divides by `DEFAULT_FISH_COUNT` twice | `lib/fcr-calculation.ts:27-30` | Suggested feeding rate is **5,000× too small**, always. 88 %/day is reported as 0.018 %. |
| 2 | FCR calculator treats "Current Biomass (kg)" as per-fish weight | `lib/fcr-calculation.ts:23-28`, `messages/en.json` `fcrCalculator` | Entering the labelled quantity (true biomass) yields `max(0, target − biomass) = 0` → 0 kg feed. "Total Feed Needed" is a per-fish number labelled as a total. |
| 3 | FCR action reads an arbitrary pond | `lib/actions/fcr.ts:12` `pond.findFirst({ ownerId, status: "ACTIVE" })` | Multi-pond farm gets the first active pond's FCR, not the pond on screen. |
| 4 | Population has five sources of truth | `feed-calc.ts:13` (5,000 fallback), `growth-plan-loader.ts:139` (`cycle.stockingCount`), `actions/biomass.ts:208-232` (`Pond.population`, skip if null), `feed-grams.ts:39-59` (same), `fcr-calculation.ts:27` (5,000 constant) | Same pond, different biomass per screen; device and website disagree. |
| 5 | Preview recomputes instead of reading the device value | `dashboard/page.tsx:273-280`, `jobs/pdf-export.ts:115-122` | Dashboard and PDF show a number the feeder will not dispense. Fallback is 330 g (`page.tsx:273`) while firmware's own default is 150 g (`firmware-main.ino:402`). |
| 6 | Growth-plan apply writes grams, never the rate | `growth-plan-apply.ts:170-173` | From that moment the formula and the device can never reconverge. |
| 7 | Formula output is not clamped to the per-request ceiling | `page.tsx:275`, `pdf-export.ts:117` | With `population = null` → 5,000, 13.78 g, 3 %, 2 meals: 2,067 g/day → **1,033.5 g/meal**, above the 1,000 g limit, still displayed. |
| 8 | Two next-feeding calculators | `schedule/next-feeding.ts:32,38` uses `setHours` (server local); `schedule/next-feeding-slot.ts:70-71` uses Asia/Manila | On a UTC server the hero is 8 hours off. `next-feeding.ts` also ignores minutes and cannot handle an overnight window. |
| 9 | Daily cap enforced four different ways | `feed/commands.ts:153-169` (feed requests only), `actions/schedule.ts:91-92` (+factor), `actions/ponds.ts:442-443` (**no** factor), `prediction.ts:237` (**no** factor), firmware `:2311` (all dispenses, hard 5,000) | A tightened platform cap is honoured on two paths and ignored on two; the server can approve a dose the firmware refuses. |
| 10 | Two definitions of "daily feed" | `feed-calc.ts:21-23` (biomass × rate) vs `growth-plan.ts:369-377` (gap × population × survival × FCR ÷ days) | Both labelled as feed amounts, never reconciled; rounding differs (`round2` with epsilon vs `Math.round`). |
| 11 | "Dispensed today" means two things | `feeder-hero.ts:69-78` (machine only) vs `pond-charts.ts:170-178` (all sources incl. `hand_fed`) | Hero and History show different totals under the same word. |

Nothing here is a maths error in `feed-calc.ts`. The system fails because eleven call
sites each decided what "the feeding number" means.

## 2. Locked decisions

| ID | Decision |
|---|---|
| **D5** | **The pond setting is the only source of truth.** `Pond.feedingRatePct`, `Pond.feedsPerDay`, `Pond.population` and the effective schedule (pending `ScheduleCommand` wins over the row, via `resolveCurrentSchedule`) are authoritative. No consumer invents a default, and no consumer reads "any pond". Every feeding read takes an explicit `pondId`. |
| **D6** | **The device dose is derived, not stored twice.** `EnergyDevice.gramsPerFeeding = feedPerMealG(totalBiomassG(population, latest avgWeightKg), feedingRatePct, feedsPerDay)`. The same function runs on settings save, biomass save, growth-plan apply and schedule sync. Nothing else may write `gramsPerFeeding`. |
| **D7** | **Daily ceiling.** Default **2,000 g/device/day**. Absolute emergency guard **5,000 g** (matches firmware `MAX_GRAMS_PER_DAY`). Farmer and admin may configure **500–5,000 g**. The platform `dailyCapFactor` may only lower the result further. Effective cap = `min(configured ?? 2000, 5000) × dailyCapFactor`, then `min(hopperCapacityG)` when set. |
| **D8** | **No phantom fish.** A null/zero `Pond.population` produces **no automatic dose and no automatic adjustment**. UI shows "Set fish count" with a link; the device keeps its last value and an `auto_adjust_skipped` event records why. Previews may show a clearly-labelled estimate, never an actionable number. |
| **D9** | **One clock.** All scheduling is Asia/Manila wall clock. Server sends `server_time_utc` (ISO-8601 Z) and `farm_offset_minutes` (480) with every schedule/feed poll so the device can link RTC to UTC. The device's RTC is treated as farm-local time; the daily counter resets at farm midnight. |
| **D10** | **One label per number.** `gramsPerFeeding` is "the feeder will dispense". A formula output is "recommended". When they differ, both are shown with the reason (manual override, growth-plan adjustment, cap clamp). |

## 3. Target chain

```
Pond.feedingRatePct · Pond.feedsPerDay · Pond.population   (single source, D5)
        │
        ▼
lib/feed-calc.ts  ──►  dailyFeedG ──► feedPerMealG          (only formula, D6)
        │
        ▼
deriveDeviceDose(pondId)  ──►  EnergyDevice.gramsPerFeeding   (only writer)
        │
        ├──► /api/feed-command + /api/schedule-sync ──► firmware cache
        ├──► schedule validation (daily = feeds × grams ≤ effective cap)
        ├──► hopper days remaining
        └──► previews: "feeder will dispense X g" (D10)

FCR / growth plan ──► recommended rate ──► Pond.feedingRatePct (clamped ±10 %)
                                     └──► re-derive dose (never write grams directly)
```

## 4. Tasks

### F-01 — `lib/feeding/source.ts`, the single pond-scoped reader

`resolvePondFeeding(pondId)` returns
`{ pondId, deviceId, population, feedingRatePct, feedsPerDay, scheduleStart, scheduleEnd, dailyCapG }`
using `resolveCurrentSchedule(pondId, deviceId)` for the schedule. It must reject an
unknown pond rather than fall back.

Acceptance: a test proves the reader returns the requested pond's values when two ponds
exist for one owner, and that a pending `ScheduleCommand` overrides the `Pond` row.

### F-02 — One derivation, one writer

`deriveDeviceDose(pondId, { avgWeightKg })` calls `feedPerMealG` and writes
`EnergyDevice.gramsPerFeeding` in a transaction with a `deviceStateEvent` recording
`{ pondId, population, ratePct, feedsPerDay, avgWeightKg, grams }`. Call sites:
`updatePondSettings`, `saveBiomassLog`, `growth-plan-apply`, `syncDeviceGramsForPond`.
All other writes are removed.

Acceptance: after a settings save and after a biomass log, the stored value equals
`feedPerMealG(...)` to 2 decimals; no other code path writes the column (grep + test).

### F-03 — Remove the phantom population

`feed-calc.totalBiomassG` and `feedPerMealG` return `null` for a missing population.
`DEFAULT_FISH_COUNT` is deleted from every automatic path (dashboard, PDF, growth,
prediction, chat, assistant, FCR). UI copy added in `en.json` and `hil.json`:
"Set your fish count to calculate feed."

Acceptance: with `population = null`, no number is shown as actionable, no device write
happens, and an `auto_adjust_skipped` event exists. Existing locked `feed-calc` reference
values still pass.

### F-04 — FCR calculator is pond-scoped and correct

Add `pondId` to `calculateFcrFeed`; remove `findFirst`. Input becomes per-fish weight
(relabel) **and** population (required, prefilled from the pond). Rate becomes
`dailyFeedRationKg / currentWeightKg × 100` — no `DEFAULT_FISH_COUNT`.

Acceptance: for 13.78 g → 50 g over 60 days at FCR 1.5 the rate is ≈ 88 %/day (not
0.018 %); the reported "total feed" equals per-fish feed × population; a test locks both.

### F-05 — Growth plan keeps the chain intact

`growth-plan-apply` writes `Pond.feedingRatePct = clamp(recommendedRate, ±10 %)` inside
`FEEDING_RATE_PCT_MIN/MAX`, then calls `deriveDeviceDose`. It may not write
`gramsPerFeeding` directly. The plan's `recommendedGramsPerFeeding` remains display-only.

Acceptance: after apply, `feedPerMealG(population, newRate, feeds)` equals the stored
device value, and the next dashboard render shows no mismatch.

### F-06 — Daily ceiling, default 2,000 g

Additive migration (no drops):

```sql
ALTER TABLE "EnergyDevice" ADD COLUMN "dailyCapG" INTEGER;
```

Application ranges: `DAILY_CAP_MIN_G = 500`, `DEFAULT_DAILY_CAP_G = 2000`,
`HARD_DAILY_CAP_G = 5000`. `resolveDailyCapG(device, platformFactor)` implements D7 and is
the only cap function. Apply it in `schedule.ts`, `ponds.ts`, `feed/commands.ts`,
`calibration.ts`, `prediction.ts`/`actions/prediction.ts`, and the ingest hopper
projection. UI: farmer field on `dashboard/settings/hardware` (or pond settings) and admin
field on the pond/device pages, both showing the 2,000 default and the 5,000 guard.

Acceptance: caps tested at the boundaries (499 refused, 500 accepted, 5,001 refused);
tightening the platform factor lowers every path identically; a farmer and an admin can
each raise the ceiling and both are audited.

### F-07 — One clock

Delete `lib/schedule/next-feeding.ts`; `feeder-hero.ts` returns a
`computeNextFeedingSlot` result instead of a `Date`. Add `server_time_utc` and
`farm_offset_minutes` to `/api/feed-command` and `/api/schedule-sync` responses.

Acceptance: hero and dashboard show the same next-feed time for the same pond under a
non-Manila `TZ` (test with `TZ=UTC`); overnight windows covered.

### F-08 — Tests, changelog, migration gate

`pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`, `pnpm self-check`. Changelog entry
under `Unreleased`. Migration reviewed under the existing H7/H8 gates (dev database
first, `migrate deploy` only).

## 5. Migration and rollout

The column is nullable and additive. Resolution order:
`dailyCapG ?? 2000`, then `min(5000)`, then `× dailyCapFactor`, then `min(hopperCapacityG)`.

**Operational risk:** a farm whose current schedule is above 2,000 g/day would stop at the
new default. Recommended backfill (needs owner approval):

```sql
UPDATE "EnergyDevice" d
SET "dailyCapG" = LEAST(5000, GREATEST(2000,
      CEIL(d."gramsPerFeeding" * p."feedsPerDay" / 100.0) * 100))
FROM "Pond" p
WHERE p.id = d."pondId";
```

This preserves every working schedule and still gives new devices the 2,000 g default
(NULL → 2,000). Without it, deploy the cap disabled for existing devices and have each
operator set their own value.

## 6. Out of scope (phase 2 — firmware, needs reflash)

- Consume `server_time_utc` / `farm_offset_minutes`, correct the RTC when it drifts more
  than 60 s, evaluate the schedule in farm-local time, reset the daily counter at farm
  midnight.
- Enforce the per-device `dailyCapG` on the device in addition to the 5,000 g guard.
- Until then the firmware keeps `MAX_GRAMS_PER_DAY 5000.0` and the server enforces the
  configured cap.
- Audit evidence and tracking — **issue #409** (2026-10-31, `origin/staging` `e11f762`,
  firmware 1.6.0). The farm-local time item above is confirmed by the code chain: the RTC
  is UTC (`configTime(0, 0)` `firmware-main.ino:4236`, `getRTCiso8601()` stamps `+00:00`,
  `firmware/README.md:687`) while the slots carry the farmer's wall clock (`schedule-sync`
  `formatTime()` returns `getUTCHours()` of the stored time), and the comparison at
  `firmware-main.ino:3519-3521` applies no offset — the only `+480` in the firmware is the
  OTA maintenance window (`:2226`). A 06:00 slot therefore fires at 14:00 PHT.
- Also new from #409, phase 2: persist the schedule, the dose sizes and
  `dailyGramsDispensed` on the device. A plain power cycle restores none of them — the
  checkpoint is written only at OTA (`:2655`) and consumed once (`:2449-2453`), so a power
  cut resets the schedule to 06:00/19:00, the doses to 150 g / 80 g and the daily-cap
  counter to zero. `firmware/README.md:718` ("restored every time") contradicts the code
  comment at `:3123` ("After a plain power cycle there is nothing to restore"); only
  `cal_gps`, WiFi and identity survive. Dead code found alongside: `ratePct` at `:3686`.

## 7. Open items for the owner

| # | Question | Default taken in this plan |
|---|---|---|
| 1 | Absolute emergency guard: 5,000 g or higher? | 5,000 g (no reflash needed) |
| 2 | Include firmware now, or web/server first? | Web/server first |
| 3 | Missing population: block, or keep the 5,000 fallback? | Block, prompt for fish count |
| 4 | Backfill existing devices to their current schedule, or apply 2,000 g to everyone? | Backfill (preserves working farms) |
| 5 | Where does the farmer set the ceiling: hardware page or pond settings? | Hardware page (it is a device limit) |

## 8. Evidence appendix — worked numbers

- Reference: 1,185 g × 5 % = 59.25 g/day; ÷ 2 = 29.63 g; ÷ 3 = 19.75 g. `feed-calc.ts`
  matches.
- Defaults today: `population null → 5,000`, 13.78 g fish, 3 % → 68,900 g biomass →
  2,067 g/day → **1,033.5 g/meal** > 1,000 g request limit.
- At 5 %: 3,445 g/day → 1,722.5 g/meal, 42 % above what the hardware can dispense.
- FCR calculator: `rate = dailyFeedRationKg ÷ (5,000 × currentWeightKg) × 100`; the
  correct value omits the 5,000. A 60-day 13.78 → 50 g plan at FCR 1.5 should report
  ≈ 88 %/day and reports 0.018 %.
- Where "3 meals a day" comes from: there is no code default. `prisma/seed.ts` writes
  `feedsPerDay: 4`; `scripts/e2e/seed-e2e.ts:230,243` writes `feedsPerDay: 3`. A pond
  showing 3 was seeded by the E2E script or edited; the new reader in F-01 surfaces the
  exact row.
