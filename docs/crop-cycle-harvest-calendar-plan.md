# Crop Cycle & Harvest Calendar — Implementation Plan

**Status:** Proposed — awaiting owner approval
**Date:** 2026-10-24
**Owners:** Jeff (product), implementation agent
**Related:** `docs/SUPERADMIN-MULTITENANCY-PLAN.md` (Dispatch/revenue, M6),
`docs/rbac-permissions.md`, `apps/web/lib/prediction.ts`, `apps/web/prisma/schema.prisma`

---

## 1. Why this exists

The dashboard currently answers “how much should I feed today?” It cannot answer
“where am I in the grow-out, when should I harvest, and what is coming up next?”
There is no stocking date, no grow-out period, no target harvest weight, no
harvest record, and no calendar. The AI advisor also has no cycle context, so it
optimises today’s feed without knowing whether the pond is three weeks from
harvest or three weeks from stocking.

This plan adds a **single active grow-out cycle per pond**, a **harvest and pond
calendar**, **actual harvest capture**, **harvest/sampling reminders**, and
**cycle-aware AI advice**.

---

## 2. Locked decisions (from the clarification round)

| Decision | Choice |
| --- | --- |
| Cycle scope | One active cycle per pond. Starting a new cycle requires the current cycle to be harvested or cancelled. |
| Harvest date | Enter stocking date + grow-out days; the target harvest date auto-calculates and remains editable. |
| Calendar contents | Crop-cycle events, sampling reminders, manual pond events, daily feeding schedule, device/maintenance events. |
| Calendar technology | FullCalendar (v7) template, themed to PakaonAI. |
| Reminders | In-app notifications **and** email. |
| Harvest capture | Actual harvest weight, fish count, and final FCR. Buyer/price/revenue stays in the later Dispatch phase. |
| AI context | The advisor uses grow-out day, days to harvest, target weight, and projected harvest biomass. Safety clamps are unchanged. |
| Pond scope | Active pond by default, with an all-ponds calendar toggle. |

### Assumptions to confirm (small defaults, not blockers)

- Default grow-out period: **135 days** (4.5 months), editable 30–365.
- Default target harvest weight: **250 g per fish**, editable.
- Default expected survival: **85%**, editable and optional.
- Harvesting or cancelling a cycle **pauses the feeder automatically**.
- Starting a new cycle updates `Pond.population` to the stocking count but does
  **not** auto-resume feeding; the operator resumes from Schedule.
- Email recipients: the pond owner plus farm `ADMIN`/`OPERATOR` users with an
  email address.
- Email provider: **Resend** (`RESEND_API_KEY`, `REMINDER_FROM_EMAIL`). If the
  key or sender is missing, email is skipped and the in-app reminder still fires.

---

## 3. Scope

### In scope

- Grow-out cycle setup and editing.
- Target harvest date calculation and override.
- Month / week / list calendar with filters.
- Manual pond events.
- Derived sampling-due, feeding, and device/maintenance events.
- Harvest completion with weight/count/final FCR.
- Fallow-pond safety after harvest/cancel.
- In-app and email reminders.
- Cycle context in the AI feeder advisor.
- Dashboard and Growth summaries.

### Out of scope (for this plan)

- Buyer, price per kg, gross sales, commissions, statements (Dispatch/M6).
- Multiple cohorts/batches in the same pond.
- Market-price feeds or harvest-profit forecasting.
- Drag-and-drop rescheduling of derived events (sampling/feeding/device).
- Native mobile apps.

---

## 4. Domain model

### 4.1 `CropCycle`

One row per grow-out cycle. At most one `ACTIVE` row per pond.

```prisma
enum CropCycleStatus {
  ACTIVE
  HARVESTED
  CANCELLED
}

model CropCycle {
  id                   String           @id @default(cuid())
  pondId               String
  farmId               String?          // immutable ownership stamp
  label                String?          // "Batch 2026-10"
  status               CropCycleStatus  @default(ACTIVE)

  stockingDate         DateTime         @db.Date
  stockingCount        Int
  stockingAvgWeightG   Float?           // optional; needed for final FCR
  growOutDays          Int              @default(135)
  targetHarvestDate    DateTime         @db.Date
  targetHarvestWeightG Float?           // per fish
  expectedSurvivalPct  Float?           // 1–100

  actualHarvestDate    DateTime?        @db.Date
  actualHarvestWeightKg Float?
  actualHarvestCount   Int?
  actualFcr            Float?

  notes                String?
  createdBy            String
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt

  pond   Pond        @relation(fields: [pondId], references: [id], onDelete: Cascade)
  events PondEvent[]

  @@index([pondId, status])
  @@index([farmId])
}
```

Migration adds a partial unique index so the invariant survives concurrent
requests:

```sql
CREATE UNIQUE INDEX "CropCycle_one_active_per_pond"
  ON "CropCycle" ("pondId")
  WHERE "status" = 'ACTIVE';
```

The action catches Prisma `P2002` and returns: “This pond already has an active
grow-out cycle. Harvest or cancel it first.”

### 4.2 `PondEvent`

Persisted calendar rows for cycle milestones and manual events. Derived events
(sampling, feeding, device) are **not** stored; they are computed at read time so
they cannot drift from the data that owns them.

```prisma
enum PondEventType {
  STOCKING
  HARVEST_PLANNED
  HARVEST_ACTUAL
  SAMPLING
  MAINTENANCE
  OTHER
}

enum PondEventStatus {
  PLANNED
  DONE
  MISSED
  CANCELLED
}

model PondEvent {
  id          String           @id @default(cuid())
  pondId      String
  cropCycleId String?
  farmId      String?
  type        PondEventType
  status      PondEventStatus  @default(PLANNED)
  title       String
  startsAt    DateTime
  endsAt      DateTime?
  allDay      Boolean          @default(true)
  notes       String?
  source      String?          // "manual" | "cycle" | "device" | "sampling" | "feeding"
  sourceId    String?          // device event id, if applicable
  createdBy   String
  completedBy String?
  completedAt DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  pond      Pond       @relation(fields: [pondId], references: [id], onDelete: Cascade)
  cropCycle CropCycle? @relation(fields: [cropCycleId], references: [id], onDelete: SetNull)

  @@index([pondId, startsAt])
  @@index([farmId, startsAt])
  @@index([cropCycleId])
}
```

`STOCKING` and `HARVEST_PLANNED` are created with the cycle. `HARVEST_ACTUAL` is
created when the cycle is marked harvested. Manual events are `MAINTENANCE` or
`OTHER`.

### 4.3 `ReminderLog`

Idempotency ledger for reminders. One row per reminder/channel/occurrence.

```prisma
model ReminderLog {
  id          String   @id @default(cuid())
  pondId      String
  cropCycleId String?
  pondEventId String?
  kind        String   // "harvest_d14" | "harvest_d7" | ... | "sampling_due"
  channel     String   // "in_app" | "email"
  dedupeKey   String   @unique
  recipient   String?
  status      String   @default("SENT") // "SENT" | "FAILED"
  attempts    Int      @default(1)
  lastError   String?
  sentAt      DateTime @default(now())

  @@index([pondId, kind])
}
```

`dedupeKey` examples: `harvest:<cycleId>:d7:in_app`,
`sampling:<pondId>:2026-11-01:email`.

### 4.4 `Pond.isFallow`

Harvesting or cancelling a cycle leaves the pond row active for planning but
must stop feeding an empty pond. Add:

```prisma
isFallow Boolean @default(false)
```

Rules:

- Harvest/cancel sets `isFallow = true` and pauses the paired `EnergyDevice`.
- Starting a new cycle sets `isFallow = false` and updates `Pond.population`.
- Feed actions (`FeedNowButton`, schedule resume, manual feed) are blocked while
  `isFallow` is true.
- The dashboard and Growth page show a “Pond is fallow — start a new cycle”
  state instead of a feed recommendation.
- `computeDeterministicPrediction` returns a no-data result with reason
  `"fallow"` when the pond is fallow.

This is safer than setting `Pond.population = 0`, because the feed calculation
currently treats `0` as “use `DEFAULT_FISH_COUNT` (5000)”.

---

## 5. Cycle lifecycle and business rules

### 5.1 Create cycle

Inputs: pond, label, stocking date, stocking count, optional stocking average
weight, grow-out days, target harvest date (auto/editable), target harvest weight
per fish, expected survival, notes.

Rules:

- `stockingDate` must be today or in the past (allow up to 7 days in the future
  with a warning only if the owner confirms later).
- `growOutDays` 30–365, default 135.
- `targetHarvestDate` defaults to `stockingDate + growOutDays`; users may
  override it. Editing either field recomputes the other; the last edited field
  wins.
- `stockingCount` 1–1,000,000.
- `targetHarvestWeightG` 1–10,000, optional.
- `expectedSurvivalPct` 1–100, optional.
- Projected harvest biomass =
  `stockingCount × (expectedSurvivalPct / 100) × targetHarvestWeightG / 1000` kg.
- Transaction creates the cycle, `STOCKING` event, and `HARVEST_PLANNED` event.
- Sets `Pond.population = stockingCount`, `Pond.isFallow = false`.
- Does **not** auto-resume the feeder. The operator resumes from Schedule.

### 5.2 Edit cycle

Only an `ACTIVE` cycle can be edited. Date changes update the linked
`HARVEST_PLANNED` event. Changing `stockingCount` after biomass logs exist does
not rewrite `Pond.population`; the UI explains that population changes belong in
Pond Settings. Cancelling and starting a new cycle is the clean path.

### 5.3 Mark harvested

Inputs: actual harvest date (default today), total harvested weight kg, fish
count, optional final FCR, notes.

Rules:

- `actualHarvestDate` between `stockingDate` and today.
- `actualHarvestWeightKg` > 0.
- `actualHarvestCount` ≥ 0.
- If final FCR is omitted, compute it when possible:

  `totalFeedKg = sum(FeedEvent.grams) / 1000` for feed events on the pond’s
  device between the stocking date and harvest date.

  `gainKg = actualHarvestWeightKg − (stockingCount × stockingAvgWeightG / 1000)`

  `finalFcr = totalFeedKg / gainKg` when `gainKg > 0`.

- Set status `HARVESTED`, write actual fields, `completedAt`, and create the
  `HARVEST_ACTUAL` event.
- Pause the paired `EnergyDevice`, set `Pond.isFallow = true`.
- Keep `Pond.population` at the stocking count (the cycle row owns the actual
  harvest numbers). A new cycle overwrites population.
- Create an in-app notification: “Harvest recorded for <pond> — <kg> kg”.
- Do not modify FCR reports automatically; `actualFcr` lives on the cycle to
  avoid mixing multi-cycle feed data into a pond-level report.

### 5.4 Cancel cycle

Only an `ACTIVE` cycle can be cancelled. Sets `CANCELLED`, cancels planned
events, pauses the feeder, and sets `isFallow = true`. History is retained.

### 5.5 Start next cycle

After `HARVESTED` or `CANCELLED`, the Harvest page offers “Start next cycle”.
It creates a fresh cycle, updates population, clears fallow, and leaves feeding
paused until the operator resumes.

---

## 6. Permissions

Add one permission:

- `manage_crop_cycle` — create/edit cycles, schedule harvest, manage manual
  events, mark harvested/cancelled.

Defaults:

| Role | `manage_crop_cycle` |
| --- | --- |
| OWNER | yes |
| ADMIN | yes |
| OPERATOR | yes |
| VIEWER | no (read-only calendar) |

`record_dispatch` remains reserved for the later Dispatch/sales phase. No
backfill is needed because role defaults apply when no explicit override exists.

---

## 7. Server actions and API

### 7.1 Server actions (`apps/web/lib/actions/crop-cycle.ts`)

- `createCropCycle(input)`
- `updateCropCycle(input)`
- `markCycleHarvested(input)`
- `cancelCropCycle(input)`
- `startNextCycle(input)`

Each action:

1. `requireWriteAccess()` and `requirePermission("manage_crop_cycle")`.
2. Resolve the active pond/owner and verify pond ownership.
3. Validate with Zod schemas in `apps/web/lib/crop-cycle/schema.ts`.
4. Run inside a transaction.
5. Return `{ success, error?, cycleId? }` in the existing action style.
6. Revalidate `/[locale]/(dashboard)/dashboard/harvest`,
   `/[locale]/(dashboard)/dashboard`, and
   `/[locale]/(dashboard)/dashboard/growth`.

### 7.2 Server actions (`apps/web/lib/actions/pond-event.ts`)

- `createPondEvent(input)`
- `updatePondEvent(input)` (manual events and planned harvest reschedules)
- `completePondEvent(input)`
- `deletePondEvent(input)` (manual events only; cycle milestones are cancelled,
  never deleted)

### 7.3 Calendar API (`GET /api/calendar/events`)

Query:

`GET /api/calendar/events?from=2026-10-01&to=2026-11-30&pondId=<id|all>&types=harvest,sampling,manual,feeding,device`

Validation:

- `from` and `to` valid dates, `to > from`, maximum 400 days.
- `pondId` either owned by the caller or `all`.
- Unknown `types` ignored; empty list defaults to all except `feeding`.
- Maximum 1,000 merged events; return `meta.truncated: true` when capped.

Response event shape:

```ts
type CalendarEventDto = {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD (all-day) or ISO with offset
  end?: string;
  allDay: boolean;
  type: "harvest" | "sampling" | "manual" | "feeding" | "device";
  status?: "planned" | "done" | "missed" | "cancelled";
  editable: boolean;
  display?: "auto" | "background";
  pondId: string;
  pondName: string;
  href?: string;
};
```

Sources:

- **Persisted:** `PondEvent` rows in range.
- **Sampling:** latest `BiomassLog` per pond + `Pond.sampleIntervalDays`; generate
  due dates forward within range (cap 12 occurrences). The first is “next due”.
  A logged sample automatically moves the next due date.
- **Feeding:** `resolveCurrentSchedule` per pond; generate timed events for each
  day in range when `types` includes `feeding`. Cap range at 62 days and use
  `display: "background"` in time views. Excluded by default in month view.
- **Device/maintenance:** `DeviceStateEvent` whitelist
  (`connected`, `disconnected`, `command_failed`, `pellet_low`,
  `pellet_refilled`, `schedule_changed`, `prediction_applied`), limited to 200.

All queries are scoped by `ownerId`/`farmId`; no cross-tenant reads.

---

## 8. UI

### 8.1 Navigation

- Sidebar: add **Harvest** (`CalendarDays` icon) after Growth.
- Mobile bottom nav: add Harvest and replace History (History remains in the
  sidebar and in the dashboard “View History” links).

### 8.2 Harvest page (`/[locale]/dashboard/harvest`)

Sections:

1. **Header:** “Harvest & Grow-out”, pond selector context, “New cycle” or
   “Edit plan” action.
2. **Cycle summary:** label, grow-out day / total, progress bar, days to
   harvest, target date, target weight, projected biomass, status badge.
3. **Calendar:** FullCalendar with month/week/list views, filters, all-ponds
   toggle, “New event” button, today/prev/next controls.
4. **Upcoming events:** next 5 persisted/derived events with links.
5. **Empty/fallow state:** “No active cycle” + “Start grow-out cycle” CTA.

### 8.3 Cycle form

Native date inputs, numeric inputs with unit suffixes, live projected-biomass
preview, inline validation. It opens in a modal/drawer from the Harvest page and
from the dashboard empty state.

### 8.4 Calendar behavior

- **Month:** harvest, sampling, manual, and device chips; feeding hidden unless
  the filter is on (shown as background/dots).
- **Week/day:** feeding events as background bands; harvest/sampling as chips.
- **List:** next 30 days, grouped by date.
- **Click a day:** create a manual event (write access only).
- **Click an event:** detail drawer. Planned manual/harvest events can be edited;
  derived events are read-only; actual harvest opens cycle detail.
- **Drag/drop:** allowed only for manual events and `HARVEST_PLANNED` (with
  confirmation). Actual/stocking/derived events are locked.
- **Filters:** Harvest, Sampling, Manual, Feeding, Device; persisted in the URL.
- **All ponds:** event titles include pond name; the cycle summary becomes a
  compact per-pond list.

### 8.5 Dashboard

Add a full-width **Grow-out & Harvest** strip after the three metric tiles:

- Cycle label and progress (`Day 45 of 135`).
- Days to harvest and target date; red “Overdue by X days” when late.
- Target weight / projected biomass.
- Next event and “Open calendar”.
- No cycle: “No active grow-out cycle” + “Start cycle”.
- Fallow: “Pond is fallow — start a new cycle” + CTA; Feed Now disabled.

### 8.6 Growth page

Add a compact cycle strip above the AI advisor:
`Batch 2026-10 · Day 45 · Harvest in 90 days · Target 250 g` with a calendar
link. If fallow, show the fallow state instead of the advisor.

### 8.7 AI advisor

Add optional cycle context to `PredictionInputs` and `FeedingPrediction`:

```ts
type PredictionCycleContext = {
  cycleId: string;
  label: string | null;
  growOutDay: number;
  daysToHarvest: number;
  targetHarvestDate: string; // YYYY-MM-DD
  targetHarvestWeightG: number | null;
  projectedHarvestBiomassKg: number | null;
  stage: "early" | "grow" | "finish" | "overdue";
};
```

- Deterministic formula and safety clamps are unchanged.
- Reasoning adds a cycle note: “Day 45 of 135 — harvest in 90 days (target 250 g).”
- AI prompt receives the cycle context and rules:
  - Within 14 days of harvest: do not push growth; keep feed stable or trim.
  - If current weight is near target and harvest is close: avoid overfeeding.
  - Overdue harvest: recommend verifying the harvest date; stay conservative.
  - Cycle context can never override the formula ±20% band or device envelope.
- Advisor UI shows a Grow-out strip and a “Harvest in X days” chip.
- No active cycle: show a subtle “Set a grow-out cycle for harvest-aware advice”
  link instead of hiding the advisor.

---

## 9. Reminders (in-app + email)

### 9.1 Trigger points

- Harvest: 14, 7, 3, 1, and 0 days before the target date.
- Harvest overdue: 1, 3, and 7 days after the target date.
- Sampling: 3 days before the next due date and on the due date.
- Cycle started/harvested/cancelled: immediate in-app only.

### 9.2 Delivery

- **In-app:** `Notification` row with category `harvest` or `sampling`, tier
  `INFO`/`WARNING`/`CRITICAL`, `linkTo: "/dashboard/harvest"`.
- **Email:** `apps/web/lib/notify/email.ts` using Resend.
  - Env: `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `NEXT_PUBLIC_BASE_URL`.
  - Recipients: pond owner + farm `ADMIN`/`OPERATOR` users with email.
  - Simple branded HTML; pond, cycle, event, days remaining, calendar link.
  - If email fails or is unconfigured, log and keep the in-app notification.
- **Preferences:** extend `Pond.notificationPrefs` with
  `harvestReminders`, `samplingReminders`, `emailReminders` (default true) and
  add the toggles to the existing notification preferences form.

### 9.3 Cron

- New route `GET /api/cron/crop-watch` protected by `withCronAuth`.
- Runs daily (Philippines morning): finds due reminders, inserts `ReminderLog`
  with `dedupeKey` first, creates notifications, sends email best-effort.
- `docs/sql/cron-crop-watch.sql` uses Supabase `pg_cron` + `pg_net`, with
  placeholders for the URL and `CRON_SECRET`, following
  `cron-device-watch.sql`.
- Re-running the job never duplicates a reminder: the unique `dedupeKey` makes
  the second insert fail and the job skips it.
- Email failures are recorded with `status = "FAILED"`, `attempts`, and
  `lastError`; retry up to 3 runs.

---

## 10. Migration plan

One additive Prisma migration:

1. `CropCycle`, `PondEvent`, `ReminderLog` tables and enums.
2. `Pond.isFallow Boolean @default(false)`.
3. Partial unique index `CropCycle_one_active_per_pond`.
4. Indexes listed above.

No destructive changes. No production migration is run by this plan; the normal
`main` deployment applies it after review. Development migrations are applied
through the project's development database path.

---

## 11. Phases and acceptance criteria

### Phase 1 — Schema and domain (1 PR)

- Models, migration, `Pond.isFallow`, Zod schemas, date helpers, pure domain
  functions, cycle/event server actions, fallow/pause safety.
- Tests: date math, projected biomass, one-active enforcement, final FCR,
  fallow guards, permissions.
- **Acceptance:** migration applies on a clean dev database; a cycle can be
  created/edited/harvested; a second active cycle is rejected; harvest pauses
  the device; all tests pass.

### Phase 2 — Harvest page and FullCalendar (1 PR)

- Install FullCalendar v7 + `temporal-polyfill`.
- Calendar API, page, filters, all-ponds toggle, event CRUD, drag/drop for
  editable events, cycle form, nav, EN/Hiligaynon copy.
- **Acceptance:** calendar shows persisted and derived events; filters work;
  create/edit/delete/harvest flows work; mobile list view works; build passes.

### Phase 3 — Dashboard, Growth, AI context (1 PR)

- Grow-out/harvest strip, fallow states, cycle strip, prediction inputs/prompt/
  factors/UI.
- **Acceptance:** advisor shows cycle context; prompt contains days-to-harvest/
  target weight; safety clamps still hold; fallow ponds show no recommendation.

### Phase 4 — Reminders (1 PR)

- `ReminderLog`, notification preferences, Resend wrapper, `crop-watch` route,
  SQL file, tests.
- **Acceptance:** one reminder per event/channel; rerunning the job creates no
  duplicates; email failure still leaves the in-app notification.

### Phase 5 — Later (not this plan)

- Link actual harvest to the planned `Dispatch` model (buyer, price, revenue).
- Multi-batch/cohort support.
- Harvest yield and profit analytics.

---

## 12. Test plan

- **Unit:** `Temporal.PlainDate` date-only helpers, grow-out day, harvest date
  recalculation, projected biomass, final FCR, stage classification, reminder
  dedupe keys, calendar event mapping/filtering, AI prompt cycle text.
- **Server actions:** ownership, `manage_crop_cycle`, one-active conflict,
  transaction rollback, fallow/pause behavior.
- **API:** date range validation, all-ponds scoping, event types, truncation.
- **E2E (Playwright):** create cycle → events appear → reschedule harvest →
  mark harvested → cycle closes, device pauses, dashboard shows fallow → start
  next cycle.
- **Gates:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm api:check`,
  production build, CI `quality`.

---

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| FullCalendar bundle/theme weight | Lazy-load the calendar client component; import only dayGrid/timeGrid/list/interaction plugins; theme with a small CSS variable layer. |
| FullCalendar v7 + React 19/Turbopack | v7 declares React 17–19 support; verify both webpack and Turbopack builds. Fall back to v6 only if a blocker appears. |
| Date-only timezone drift | Use `Temporal.PlainDate` and `Asia/Manila`; pass `YYYY-MM-DD` for all-day events. |
| One active cycle race | Partial unique index + `P2002` handling. |
| Feeding an empty pond after harvest | `Pond.isFallow` + automatic device pause + feed-action guards. |
| Calendar noise from feeding events | Background events in time views; feeding filter off by default in month view. |
| Email deliverability | Verify the Resend domain (SPF/DKIM); in-app remains the fallback; log failures. |
| Reminder duplicates on retry | Unique `ReminderLog.dedupeKey`. |
| Cron not configured | Document the manual Supabase SQL step; calendar/countdown still works without reminders. |
| Derived events drift | Never persist sampling/feeding/device events; compute from their source tables at read time. |

---

## 14. Owner actions before Phase 4

- Create a Resend account, verify the sending domain, and set
  `RESEND_API_KEY` + `REMINDER_FROM_EMAIL` in the development and production
  environments.
- Run `docs/sql/cron-crop-watch.sql` in Supabase for each environment after the
  route is deployed, with that environment's URL and `CRON_SECRET`.
- Confirm the default grow-out period (135 days), target weight (250 g), and
  survival (85%).
- Confirm that harvest/cancel should pause the feeder automatically.

---

## 15. Rollout

1. Merge Phase 1; apply the development migration; verify on the develop
   deployment.
2. Merge Phase 2; verify the calendar on desktop and mobile with the demo pond.
3. Merge Phase 3; verify the advisor shows cycle context and fallow safety.
4. Merge Phase 4 after Resend and the cron SQL are configured.
5. Promote through `staging` → `main` only after the owner reviews the develop
   deployment.

No production migration or deployment is performed by this plan without the
owner's normal promotion path.
