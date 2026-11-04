# Demo tenant reconciliation — issue #709

**Status:** reviewed script, **not executed**. The orchestrator runs it after a
full logical backup. Nothing in this directory touches a database by itself.

**Scope:** `Pond.ownerId = 'demo-farmer-1'` **and**
`Pond.farmId = 'farm_demo-farmer-1'` (the telemetry ownership stamp, not the
login slug). Every statement is scoped to a temp table built from that
predicate. No other tenant is read for mutation and no other tenant is written.

**Issue:** <https://github.com/J-Akiru5/OptiFeed/issues/709>

**Target branch:** `chore/demo-reconcile-709` → `develop`.

---

## 1. Why this exists

The 2026-11-03 audit found the demo tenant's hopper series, feed series, FCR
reports and biomass series contradict each other (G1–G4, G7–G9). The code-level
writers were fixed in #779/#771 (`30901dc1`): new seeds and imports are tagged,
seed FCR reports are no longer created, and `device-registration.ts` stamps
`Farm.id`. The **stored rows** were not repaired.

This script repairs the stored rows that can be repaired mechanically, records
the evidence for the ones that need an owner decision (FCR), and leaves a
complete undo log in a `DeviceStateEvent`.

It is **one transaction**. If any assertion at the end fails, or any statement
errors, `psql` stops (`ON_ERROR_STOP`) and the transaction is rolled back. A
failed run changes nothing.

---

## 2. Hard preconditions

1. **A full logical backup, taken immediately before the run.** The backup is
   the rollback. See §7 for the exact command.
2. **A verified target.** The demo tenant is in the production Supabase project
   (`xjjnkikgkraixlfhhvoh`), which staging shares by decision P0-1 in
   `docs/audits/2026-11-03-production-readiness.md`. This is therefore a
   production data change even though the rows are demo rows. The owner
   authorised reconciling the stored demo history on 2026-11-04.
3. **The database owner role (or a role with `BYPASSRLS`).** Run as the role in
   `DIRECT_URL`, not `optifeed_app`. The app role reads tenant rows only when
   `app.farm_ids` is set; the preflight `SELECT`s would see nothing and abort
   rather than silently under-scope.
4. **No concurrent seed/import.** `prisma/seed.ts` starts with `deleteMany()`
   across nearly every table and is **not** tenant-scoped; never run it against
   this database. `seed-dev.ts` deletes and recreates the demo pond. Neither
   belongs in a reconciliation window.
5. **`psql` 15+** (the audit ran PostgreSQL 17.6).

The script takes a transaction-scoped advisory lock (`709709`), a 10 s lock
timeout and a 120 s statement timeout. A concurrent writer that holds a lock
aborts the run safely instead of waiting indefinitely.

---

## 3. How to run

```powershell
# 1. Backup first (see section 7 for the full command).
# 2. Reconcile (one transaction; prints the mutation log, then asserts, then commits).
psql "$env:DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/demo-reconcile/reconcile.sql

# 3. Verify (read-only; first result set is PASS/FAIL/INFO).
psql "$env:DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/demo-reconcile/verify.sql
```

The reconcile script prints `reconcile_709_log` **before** the assertions, so a
rollback still shows what it attempted. A successful run prints it again and
ends with `COMMIT`.

A second run is a **safe no-op**: the duplicate days are gone, every level day
is covered, the year-2000 rows are already untrusted, `demo-pond-001` is already
retired, the provenance tags are already applied, and the audit marker is
written at most once. The log reports `0` for each of those steps.

---

## 4. What it changes, in order

The script's sections are numbered the same way. `first run` is the audited
state at filing (556 FeedEvents, 667 level rows, 132 hand_fed over 66 days);
`already patched` is the state after the 2026-11-04 batch described on the
issue (572 FeedEvents, 859 level rows, provenance already tagged).

| # | Mutation (search the script for the step text) | First run | Already patched | Re-run |
| --- | --- | ---: | ---: | ---: |
| 1a | `UPDATE "FeedEvent" SET grams = <day total>` — the surviving `hand_fed` row | 66 | 66 | 0 |
| 1b | `DELETE FROM "FeedEvent"` — the duplicate `hand_fed` rows of the same farm day | 66 | 66 | 0 |
| 2 | `INSERT INTO "FeedLevelLog"` — modelled readings for days with no reading | 192 | 0 (192 already present) | 0 |
| 3 | `UPDATE "FeedEvent" SET "rtcOk" = false` — the three 2000-01-01 heartbeats | 3 | 3 | 0 |
| 4 | **No `FcrReport` mutation.** Six rows inspected and marked stale in the audit marker | 0 | 0 | 0 |
| 5a | `UPDATE "Pond"` — `demo-pond-001` renamed, archived, fallow | 1 | 1 | 0 |
| 5b | `UPDATE "EnergyDevice"` — the seed pond's dose set to the recorded 1,500 g, paused | 1 | 1 | 0 |
| 5c | `UPDATE "ScheduleCommand"` — the pending command failed closed | 1 | 1 | 0 |
| 6a | `UPDATE "FeedEvent" SET "dataSource" = 'seed'` — the 112 seed fixtures | 112 | 0 (already `seed`) | 0 |
| 6b | `UPDATE "FeedEvent" SET "dataSource" = 'import'` — the surviving hand-fed rows | 66 | 0 (already `import`) | 0 |
| 7 | `INSERT INTO "DeviceStateEvent"` — one audit marker with the undo log | 1 | 1 | 0 |

Expected totals afterwards:

| Table | First run | Already patched |
| --- | ---: | ---: |
| `FeedEvent` | 490 (556 − 66) | 506 (572 − 66) |
| `FeedLevelLog` | 859 (667 + 192) | 859 |
| `FcrReport` | 6 (unchanged) | 6 (unchanged) |
| `hand_fed` rows | 66 (one per day) | 66 |
| `hand_fed` grams | 6,138 g (unchanged) | 6,138 g |

### 1. `hand_fed`: one row per farm day

`lib/feed-figures.ts`, `lib/pond-charts.ts` and `lib/chat/context.ts` all treat
one `hand_fed` row as a whole day. The import wrote two half-day rows per day
(08:00 and 16:00 Asia/Manila): 132 rows over 66 days. The sums were right; the
row count and every per-row plot were doubled.

**Survivor rule:** the row with the earliest `receivedAt` in the Asia/Manila
farm day, lowest `id` as a tie-break. Its `grams` becomes the **sum** of every
`hand_fed` row in that farm day; the later rows are deleted. Summing, rather
than just dropping one, is deliberate: dropping one would halve the day's feed
and silently change every total the sheet asserts. The survivor keeps its
original timestamp — no time is invented.

The merge is per `(deviceId, farm day)`, so two ponds are never folded together
just because the import used the same calendar day. The script asserts the
total hand_fed mass before and after is identical.

### 2. `FeedLevelLog`: the hopper model

The old levels were generated independently of the feed
(`prisma/seed.ts:100-112`): the level stepped 1.8 % per reading while the feed
log dispensed 4 × 1,500 g/day. One 1,500 g dispense is **32.2 %** of a 4,659 g
hopper, not 1.8 %.

The backfill is derived from the feed the device actually recorded, using the
same relation the audit used:

```
level_g(t) = C - mod( (C - level_g(anchor)) + F(anchor, t], C )
```

| Term | Meaning |
| --- | --- |
| `C` | `EnergyDevice.hopperCapacityG` (4,659 g on the demo device; the audit verifies the geometry) |
| `level_g(anchor)` | the last real reading before the gap, converted from percent to grams |
| `F(anchor, t]` | `SUM(FeedEvent.grams)` for **machine** dispenses only (`source in scheduled / dashboard / button`); a `hand_fed` row never passed through the hopper |
| `mod(..., C)` | the refill term: whenever the hopper would run empty, it is refilled to full. Every gram dispensed is accounted for, and the series returns to 100 % at a refill |

One 1,500 g dispense therefore removes 32.2 % of the hopper; 2026-10-28, the one
day that reconciled in the audit (3,101 g dispensed vs 3,265 g drop), reproduces
under the same relation.

- **Cadence:** four readings per missing farm day, at 01:00, 07:00, 13:00 and
  19:00 Asia/Manila, stored as the naive UTC the schema uses (17:00/23:00 UTC
  the previous date, 05:00/11:00 UTC on the day). 48 days × 4 = 192 rows, the
  same count the issue records.
- **Anchor:** the latest reading before each reading instant. A gap at the very
  start of the history has no anchor and starts at 100 % of the first day;
  that fallback is stated, not hidden.
- **Distance:** `emptyCm - (levelPercent / 100) × (emptyCm - fullCm)`, clamped to
  `[fullCm, emptyCm]`, using the device's own calibration.
- **Idempotency:** only farm days with **zero** readings are planned. A day that
  already has a reading — real, imported or an earlier synthetic batch — is
  never rewritten. The script fills holes; it does not overwrite history.

> **Important:** if the 2026-11-04 batch already inserted its 192 synthetic
> readings, this step inserts **0** and the missing-day check still passes. The
> model is then not exercised against production by this run. The script
> deliberately does not rewrite another operator's rows. If that earlier series
> is later found inconsistent, it needs its own reviewed delete/replace; the
> audit marker's `levelLogIds` only lists rows **this** run inserted.

### 3. The three `2000-01-01` heartbeats

**Decision: set `rtcOk = false` and keep the rows.** Do not invent a time; do
not delete them.

`seed.ts` / `seed-dev.ts` never write heartbeat rows, so these are real device
heartbeats from an ESP32 whose RTC had not been set. `2000-01-01` is the unset
clock epoch (9,799 days before the data), not a fixture. Deleting them would
destroy the only evidence that the device booted without a clock. The issue's
own Expected item says "Fix `rtcOk`", not "delete".

Any replacement timestamp would be fabricated. `rtcOk = false` is the field
that tells every consumer the device time is untrustworthy. This is why
`verify.sql` checks **0 year-2000 rows with `rtcOk = true`** and reports the
**3 preserved rows** separately. A literal "0 rows with a year-2000 timestamp"
would require deleting real telemetry; that is not what the evidence supports.

### 4. `FcrReport`: decide, do not invent

**The six rows are not rewritten.** Recomputing them from the logs is
arithmetically impossible for the periods that matter:

- three periods predate the `Pond` row and have **0 kg** of `FeedEvent` and no
  `BiomassLog` in the window, so feed / gain is `0 / 0`;
- writing `0` as `fcrValue` would violate
  `fcrValue = totalFeedKg / biomassGainKg` and would be a fabricated number;
- deleting them would erase the imported evidence and change the FCR feed
  calculator's stored fallback, which the owner has not authorised.

The schema has no `status` / `dataSource` column on `FcrReport`, and every
reader (`lib/actions/fcr.ts`, `lib/chat/context.ts`, `lib/feeder-hero.ts`,
`lib/growth-plan-loader.ts`) selects the latest row without filtering one. A
**data-only** script therefore cannot both keep the rows and stop the UI
printing them. This script records the staleness durably:

```json
{
  "issue": 709,
  "kind": "demo-history-reconcile",
  "fcrStale": true,
  "fcrReports": [ { "id": "...", "totalFeedKg": 150.5, "feedEventKgInWindow": 0, "biomassLogsInWindow": 0, "computableFromLogs": false, ... } ]
}
```

**Known limitation, stated plainly:** until a follow-up adds a stale flag and a
reader filter (or switches the FCR page to the computed path, #453), the FCR
page will keep showing these six rows. This script does not pretend otherwise.
The owner's options are:

1. leave them and use the marker as the audit record (this script);
2. delete them after the backup (stops the display, loses the imported
   evidence from the live table; recoverable from the backup);
3. add `FcrReport.dataSource` / `status` and filter it in the readers (schema +
   code change, out of scope here).

The owner's earlier comment ("keep the originals") is why option 1 is the
executed one.

### 5. `demo-pond-001`: retire the stale seed pond

G9: the seed calls it "Demo Pond", the live row is "Test Pond", `ARCHIVED`, with
`EnergyDevice.gramsPerFeeding = 18` against 56 recorded 1,500 g dispenses, and
one `ScheduleCommand` still `pending` (created 2026-10-28).

**Retire**, because:

- the live demo surface is the other pond (`cmtcr6jzk…`, the 285-fish history);
  reactivating a second pond would put a contradictory 56 kg seed series back on
  the reviewer's dashboard;
- an archived pond with a pending command and a live device is the actual
  inconsistency; retiring makes the archive coherent instead of undoing it;
- `seed-dev.ts` is a developer fixture, not the production demo; its code fix is
  a separate follow-up (see §8).

Changes:

| Row | Change |
| --- | --- |
| `Pond demo-pond-001` | name `Demo Pond (retired seed)`, `status = ARCHIVED`, `isFallow = true` |
| its `EnergyDevice` (the one with 1,500 g events) | `gramsPerFeeding = 1500` (matches the 56 recorded dispenses), `isPaused = true`, `feederActive = false` |
| its `ScheduleCommand` with `status in ('pending','sent')` | `status = 'failed'` (the valid terminal state; `updatedAt` set). No schedule can be picked up for a retired pond. |

Rewriting the 56 events from 1,500 g to 18 g was rejected: it would change 56 kg
of recorded history and is a larger, unauthorised rewrite. Aligning the
configuration to the history is the smaller, reversible repair.

### 6. `FeedEvent.dataSource`: seed and import are not device telemetry

G7: all 556 demo FeedEvents were `dataSource = 'device'`, including 112 seed
rows at exactly 1,500 g and the 132 imported hand_fed rows.

| Rule | Rows | Why it is safe |
| --- | ---: | --- |
| Seed: a `feed_dispensed` row at exactly 1,500 g whose linked `FeedRequest` is also 1,500 g, `completed`, and `createdAt = FeedEvent.receivedAt` | 112 | This is exactly how `seed.ts` and `seed-dev.ts` build their fixtures (request per event, same timestamp). It selects 56 + 56 without guessing from the amount alone. |
| Import: every surviving `hand_fed` row | 66 | The merge already removed the duplicate half-day rows. The deletion is the row-count correction; this is the label. |

Nothing in the app filters on `dataSource` today (checked across `lib/**/*.ts`),
so these tags **do not hide** demo history from any screen. They make a future
audit possible. If a later release starts filtering `dataSource = 'device'`,
the demo history would disappear from that surface — the follow-up must account
for the demo tenant's labelled rows.

> The 45 seed rows in `FeedLevelLog` (from `seed.ts`) are **not** tagged here.
> Production rows were written before the code change and their ids are not in
> the issue; the only available discriminator is the 1.8 %-step formula, which
> is too weak to label real telemetry with. The seed-script change in
> `30901dc1` fixes future rows. This is a known gap, not a silent pass.

---

## 5. Verification

`verify.sql` is read-only. Its first result set is `PASS` / `FAIL` / `INFO`:

| Check | Expected |
| --- | --- |
| `hand_fed` rows | 66 (audit: 132 rows / 66 days) |
| `hand_fed` rows minus distinct farm days | 0 |
| `hand_fed` grams | 6,138 g (INFO; audit 132 × 46.5 g) |
| Missing level days in the active demo span | 0 |
| Distinct level days | 77 (INFO) |
| Year-2000 timestamps with `rtcOk = true` | 0 |
| Year-2000 rows preserved | 3 (INFO) |
| `FcrReport` rows | 6 (INFO) |
| `FcrReport.fcrValue <> totalFeedKg / biomassGainKg` | 0 |
| `FcrReport` rows with `biomassGainKg <= 0` | 0 |
| `hand_fed` rows still `dataSource = device` | 0 |
| Seed-shaped rows still `dataSource = device` | 0 |
| `FeedEvent` seed rows tagged | 112 |
| `FeedEvent` import rows tagged | 66 (after the merge) |
| `FeedEvent` device rows remaining | 312 (INFO; real telemetry) |
| `demo-pond-001` status `ACTIVE` | 0 |
| `demo-pond-001` retired (name + `ARCHIVED` + fallow) | 1 |
| `demo-pond-001` pending/sent commands | 0 |
| `demo-pond-001` devices with `gramsPerFeeding <> 1500` | 0 |
| Demo rows with a null/wrong `farmId` | 0 |
| Audit marker rows (issue 709) | 1 |
| Level rows inserted by this run | 0–192 (INFO) |
| Inserted level rows outside 0–100 % or the tenant | 0 |

It then prints two evidence sets:

1. **Why FCR is stale** — each report's claimed feed/gain vs the logged feed and
   the number of biomass samples in the window. This is the G2 contradiction,
   per row.
2. **The modelled level series** — per farm day, the count, min/max percent, min/max
   cm and the day's machine-feed grams for every synthetic level row in the demo
   tenant (this run's inserts plus any earlier batch). A sawtooth (a drop per
   machine feed, a jump at a refill) is the expected shape; a flat 1.8
   %-per-reading line is the old, unreconciled seed.

A `FAIL` means stop and investigate; do not re-run blindly. The reconcile
transaction has already committed at that point, so a failure in `verify.sql` is
either a wrong expectation or a real gap; the rollback is §7.

---

## 6. What this deliberately does **not** touch

| Item | Why not |
| --- | --- |
| **L1** — `lib/actions/device-registration.ts` stamps `DeviceStateEvent.farmId` with the login slug | A code bug, fixed in `30901dc1`. **Do not fix it in this data script.** The preflight asserts no `farmId = 'demo-farmer-1'`-stamped telemetry exists; if L1 had fired for demo, the script aborts instead of reconciling around it. |
| G5 — level/temp ingestion stopped 2026-10-31 while heartbeats continued | A telemetry/connectivity investigation, not a history contradiction. The script does not invent readings after the last recorded one. |
| G6 — water temperature is 3 days / 18 hours | Backfilling temperature needs a thermal model that does not exist. The 168 rows are real device rows; leave them. |
| G10 — 10 queued calibration tests, 0 `CalibrationRun` rows | Persisting a calibration result is a job/code fix. Do not fabricate `CalibrationRun` rows. |
| G11 — `buttonFeedGrams = 1`, `gramsPerFeeding` vs scheduled average | A configuration decision (the issue's 2026-11-04 batch set the main device to 1,000 g). The script leaves the main device alone; only the retired seed pond's dose is aligned to its own recorded 1,500 g. |
| G12 — schedule commands acknowledged out of order | Historical ordering; not a data repair. |
| G13 — sensor noise (0 cm, 96.03 cm, 12.2 % swing in 12 s) | Real telemetry noise. Filtering/calibration is a code/firmware fix, not a rewrite of measured history. |
| G14 — deprecated `Device`/`FeedingEvent` 112 rows | The models are deprecated; the script does not delete them. |
| G15 — `FishSample` missing for the Test Pond biomass logs | Do not fabricate individual fish weights. |
| G16 — no `CropCycle` | Creating a cycle needs a stocking date/count decision; the owner already corrected `population` (300) and added the 15-fish mortality separately. |
| The six `FcrReport` numbers | See §4. Marked stale; not rewritten or deleted. |
| `prisma/seed.ts`, `prisma/seed-dev.ts` | Code/seed fixtures. `seed.ts` is destructive and not tenant-scoped; never run it here. `seed-dev.ts` still targets `demo-pond-001` — a follow-up (see §8). |
| Every other tenant, the schema, migrations, tables, indexes, RLS | Out of scope. The only DDL is `CREATE TEMP TABLE` for the script's own bookkeeping; those tables vanish at `COMMIT`/`ROLLBACK`. |

---

## 7. Rollback

### 7.1 The exact rollback: the backup

Take the backup **immediately before** the run:

```powershell
# DIRECT_URL is the direct (non-pooled) connection string from apps/web/.env.
$env:PGPASSWORD = "<password from DIRECT_URL>"
pg_dump --dbname "$env:DIRECT_URL" `
  --format=custom --no-owner --no-privileges `
  --file "C:\Users\Lenovo\Documents\PakaonAI\db-backups\optifeed-pre-709-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
```

Verify the dump is readable before starting:

```powershell
pg_restore --list "C:\Users\Lenovo\Documents\PakaonAI\db-backups\optifeed-pre-709-<timestamp>.dump" |
  Select-String 'TABLE DATA public "(FeedEvent|FeedLevelLog|FcrReport|Pond|EnergyDevice|ScheduleCommand|DeviceStateEvent)"'
```

Rollback is **restore that dump**. Restore it to a scratch database first, check
the demo tenant, then restore production only with the owner's explicit
decision:

```powershell
# Scratch first (never the production URL).
pg_restore --dbname "$env:SCRATCH_URL" --clean --if-exists --no-owner --no-privileges `
  "C:\Users\Lenovo\Documents\PakaonAI\db-backups\optifeed-pre-709-<timestamp>.dump"

# Production restore: destructive to every write after the dump. Owner-only.
# pg_restore --dbname "$env:DIRECT_URL" --clean --if-exists --no-owner --no-privileges `
#   "C:\Users\Lenovo\Documents\PakaonAI\db-backups\optifeed-pre-709-<timestamp>.dump"
```

The dump is the only **exact** rollback: it restores the 66 deleted `hand_fed`
rows with their original ids, timestamps and grams, and the exact
`demo-pond-001` pre-image.

If the script fails **before** `COMMIT`, nothing is changed; no rollback is
needed. The transaction is aborted by `psql` and the connection closes.

### 7.2 Targeted undo (convenience, not a substitute for the backup)

The audit marker stores what this run changed:

```sql
SELECT metadata
FROM "DeviceStateEvent"
WHERE "eventType" = 'data_imported'
  AND "farmId" = 'farm_demo-farmer-1'
  AND metadata ->> 'issue' = '709'
  AND metadata ->> 'kind' = 'demo-history-reconcile';
```

The marker lists **this run's** changes only. If the 2026-11-04 batch had
already tagged provenance or inserted the level rows, those lists are empty and
the batch's changes are not reversed here; the backup is still the full
rollback.

```sql
-- A helper scope, repeated so every reverse statement is tenant-scoped:
--   "deviceId" IN (
--       SELECT d.id FROM "EnergyDevice" d
--       JOIN "Pond" p ON p.id = d."pondId"
--       WHERE p."ownerId" = 'demo-farmer-1'
--         AND p."farmId" = 'farm_demo-farmer-1'
--   )

-- 1. Remove the level rows this run inserted.
DELETE FROM "FeedLevelLog" l
WHERE l.id IN (
    SELECT jsonb_array_elements_text(metadata -> 'levelLogIds')
    FROM "DeviceStateEvent"
    WHERE "eventType" = 'data_imported'
      AND "farmId" = 'farm_demo-farmer-1'
      AND metadata ->> 'issue' = '709'
      AND metadata ->> 'kind' = 'demo-history-reconcile'
)
AND l."deviceId" IN (
    SELECT d.id FROM "EnergyDevice" d
    JOIN "Pond" p ON p.id = d."pondId"
    WHERE p."ownerId" = 'demo-farmer-1'
      AND p."farmId" = 'farm_demo-farmer-1'
);

-- 2. Restore each 2000-01-01 heartbeat's previous rtcOk value.
UPDATE "FeedEvent" e
SET "rtcOk" = (x.r ->> 'previous')::boolean
FROM (
    SELECT jsonb_array_elements(metadata -> 'rtcOk') AS r
    FROM "DeviceStateEvent"
    WHERE "eventType" = 'data_imported'
      AND "farmId" = 'farm_demo-farmer-1'
      AND metadata ->> 'issue' = '709'
      AND metadata ->> 'kind' = 'demo-history-reconcile'
) x
WHERE e.id = x.r ->> 'id'
  AND e."deviceId" IN (
      SELECT d.id FROM "EnergyDevice" d
      JOIN "Pond" p ON p.id = d."pondId"
      WHERE p."ownerId" = 'demo-farmer-1'
        AND p."farmId" = 'farm_demo-farmer-1'
  );

-- 3. Re-insert the hand_fed rows the merge deleted (exact pre-image).
INSERT INTO "FeedEvent" (
    id, "deviceId", "eventId", "eventType", "timestamp", grams, source,
    "feedRequestId", "commandId", "rtcOk", "feederActive", "receivedAt",
    "dataSource", "farmId"
)
SELECT *
FROM jsonb_to_recordset(
    (
        SELECT metadata -> 'handFed' -> 'deleted'
        FROM "DeviceStateEvent"
        WHERE "eventType" = 'data_imported'
          AND "farmId" = 'farm_demo-farmer-1'
          AND metadata ->> 'issue' = '709'
          AND metadata ->> 'kind' = 'demo-history-reconcile'
    )
) AS x(
    id text, "deviceId" text, "eventId" text, "eventType" text, "timestamp" text,
    grams double precision, source text, "feedRequestId" text, "commandId" text,
    "rtcOk" boolean, "feederActive" boolean, "receivedAt" timestamp,
    "dataSource" text, "farmId" text
)
WHERE x."farmId" = 'farm_demo-farmer-1'
  AND x."deviceId" IN (
      SELECT d.id FROM "EnergyDevice" d
      JOIN "Pond" p ON p.id = d."pondId"
      WHERE p."ownerId" = 'demo-farmer-1'
        AND p."farmId" = 'farm_demo-farmer-1'
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Restore the survivors' grams.
UPDATE "FeedEvent" e
SET grams = (x.s ->> 'gramsBefore')::double precision
FROM (
    SELECT jsonb_array_elements(metadata -> 'handFed' -> 'survivors') AS s
    FROM "DeviceStateEvent"
    WHERE "eventType" = 'data_imported'
      AND "farmId" = 'farm_demo-farmer-1'
      AND metadata ->> 'issue' = '709'
      AND metadata ->> 'kind' = 'demo-history-reconcile'
) x
WHERE e.id = x.s ->> 'id'
  AND e."deviceId" IN (
      SELECT d.id FROM "EnergyDevice" d
      JOIN "Pond" p ON p.id = d."pondId"
      WHERE p."ownerId" = 'demo-farmer-1'
        AND p."farmId" = 'farm_demo-farmer-1'
  );

-- 5. Undo the provenance tags this run applied (only the listed ids).
UPDATE "FeedEvent" e
SET "dataSource" = 'device'
WHERE (
    e.id IN (
        SELECT jsonb_array_elements_text(metadata -> 'provenance' -> 'seedEventIds')
        FROM "DeviceStateEvent"
        WHERE "eventType" = 'data_imported'
          AND "farmId" = 'farm_demo-farmer-1'
          AND metadata ->> 'issue' = '709'
          AND metadata ->> 'kind' = 'demo-history-reconcile'
    )
    OR e.id IN (
        SELECT jsonb_array_elements_text(metadata -> 'provenance' -> 'importEventIds')
        FROM "DeviceStateEvent"
        WHERE "eventType" = 'data_imported'
          AND "farmId" = 'farm_demo-farmer-1'
          AND metadata ->> 'issue' = '709'
          AND metadata ->> 'kind' = 'demo-history-reconcile'
    )
)
AND e."deviceId" IN (
    SELECT d.id FROM "EnergyDevice" d
    JOIN "Pond" p ON p.id = d."pondId"
    WHERE p."ownerId" = 'demo-farmer-1'
      AND p."farmId" = 'farm_demo-farmer-1'
);

-- 6. Restore demo-pond-001 from metadata -> 'g9PreImage' (read it first), or
--    restore the backup. The pre-image has the full Pond, EnergyDevice and
--    ScheduleCommand rows; use those values, not guesses. Scope the restore by
--    id = 'demo-pond-001' AND ownerId = 'demo-farmer-1' AND
--    farmId = 'farm_demo-farmer-1', like the forward statements.

-- 7. Remove the audit marker last.
DELETE FROM "DeviceStateEvent" x
WHERE x."eventType" = 'data_imported'
  AND x."farmId" = 'farm_demo-farmer-1'
  AND x.metadata ->> 'issue' = '709'
  AND x.metadata ->> 'kind' = 'demo-history-reconcile';
```

The `FcrReport` rows were not changed, so there is nothing to undo there.

---

## 8. Follow-ups (not part of this script)

1. **L1** — `lib/actions/device-registration.ts` already fixed in `30901dc1`;
   add a regression test/audit check that no `DeviceStateEvent` is stamped with
   a login slug. The preflight here is a runtime guard, not a code fix.
2. **FCR** — add `FcrReport.dataSource` / `status` (or switch the page to the
   computed path #453) so the six stale rows can be hidden without deleting
   them. Validate imported FCR against `FeedEvent` and `BiomassLog` at import
   (`lib/jobs/import-data.ts:171-181`).
3. **`seed-dev.ts`** — stop targeting `demo-pond-001` (or delete the fixture
   entirely). The code change in `30901dc1` reactivates/renames on update, but
   the fixture still writes history to a retired pond.
4. **G10** — persist `CalibrationRun` when a calibration test completes or
   expires.
5. **G13/G5/G6** — sensor noise, the level/temp ingestion stop and the thin
   water-temperature history are telemetry investigations; do not backfill them
   with invented values.
6. **The 45 seed `FeedLevelLog` rows** — if their ids can be recovered from the
   seed run's log or a pre-seed backup, tag them `seed`; the formula-based
   discriminator is too weak.
7. **G16** — decide whether the demo tenant should have a `CropCycle`; if yes,
   create it with the owner's stocking date/count, not a guess.

---

## 9. Reviewer checklist

- [ ] Every mutating statement is scoped by `reconcile_709_pond` or
      `reconcile_709_device`; those temp tables are built only from
      `Pond.ownerId = 'demo-farmer-1' AND Pond.farmId = 'farm_demo-farmer-1'`.
- [ ] There is no `TRUNCATE`, `DROP`, `ALTER`, `CREATE TABLE` (only
      `CREATE TEMP TABLE`), and no unscoped `DELETE`/`UPDATE`.
- [ ] The only `DELETE` is the 66 duplicate `hand_fed` rows, scoped by device
      and farm day; the total grams assertion proves nothing was lost.
- [ ] The level backfill only fills days with **zero** readings; it never
      rewrites a day that already has one.
- [ ] The FCR rows are not rewritten or deleted; the marker records why.
- [ ] The year-2000 rows are kept with `rtcOk = false`; the check is
      `rtcOk = true` count = 0, not row count = 0.
- [ ] The provenance tags only affect demo devices and do not change any
      reader's filter.
- [ ] The marker is idempotent (`NOT EXISTS`) and contains the undo log.
- [ ] The backup in §7 was taken and verified **before** the run.
- [ ] L1 is a code follow-up, not part of this script.
