# Query and index audit

Scope: the heaviest Prisma reads in `apps/web`, the indexes declared in
`apps/web/prisma/schema.prisma` (plus the ones that only exist in migrations), and the queries that
look unindexed.

**Every claim below is tagged.** No `EXPLAIN`, no `EXPLAIN ANALYZE`, no `pg_stat_statements` was run:
this environment has no database, so a plan or a row count would be an invention.

| Tag | Meaning |
|---|---|
| `[static]` | Derived by reading the Prisma schema, the generated SQL shape Prisma documents, and the migration DDL. Leading-column and sort-order reasoning only. |
| `[measured]` | Produced by tooling in this repository. Only the numbers in *Measured evidence* carry this tag. |
| `[inferred]` | A plan choice argued from index shape and selectivity. Plausible, unverified. |

Priority is impact on the user-visible path, weighted by table growth rate. `FeedEvent` and
`DeviceStateEvent` are the two fastest-growing tables (one row per heartbeat and per dispense per
device), so a sequential scan there is the only class of problem in this document that gets worse
purely with time.

## 1. The index inventory `[static]`

Prisma emits an index for every `@@index`, `@@unique`, `@unique` and `@id`. Two sources matter here:

- **`schema.prisma`** - the declared indexes.
- **`prisma/migrations/*/migration.sql`** - three things the schema cannot express: a partial unique
  index (`CropCycle_one_active_per_pond`), and the fact that
  `FeedEvent_deviceId_createdAt_idx` was created early and later **dropped** (`DROP INDEX
  "FeedEvent_deviceId_createdAt_idx"`), so `FeedEvent` carries `(deviceId, receivedAt)` only. Do not
  reason from the older migration.

Indexes on the tables this audit touches:

| Table | Indexes | Notes |
|---|---|---|
| `FeedEvent` | `pkey(id)`, `unique(eventId)`, `(deviceId, receivedAt)`, `(farmId)` | No index with `receivedAt` or `eventType` as the leading column |
| `DeviceStateEvent` | `pkey(id)`, `(deviceId, createdAt)`, `(eventType, createdAt)`, `(farmId)` | No `(farmId, createdAt)` |
| `Pond` | `pkey(id)`, `(ownerId)`, `(farmId)`, `(status)` | |
| `CropCycle` | `pkey(id)`, `(pondId, status)`, `(farmId)`, `unique(pondId) WHERE status='ACTIVE'` | Partial unique from the migration only |
| `PondEvent` | `pkey(id)`, `(pondId, startsAt)`, `(farmId, startsAt)`, `(cropCycleId)` | |
| `BiomassLog` | `pkey(id)`, `(pondId, recordedAt)`, `(farmId)` | No `(pondId, batchLabel)` |
| `FcrReport` | `pkey(id)`, `(pondId, periodStart)`, `(pondId, periodEnd)`, `(farmId)` | No leading `periodEnd` |
| `Notification` | `pkey(id)`, `(pondId, read)`, `(farmId)` | No leading `read`, no `createdAt` |
| `FeedLevelLog` | `pkey(id)`, `(deviceId, recordedAt)`, `(farmId)` | |
| `WaterTempLog` | `pkey(id)`, `(deviceId, recordedAt)`, `(farmId)` | |
| `EnergyDevice` | `pkey(id)`, `unique(mac)`, `unique(token)`, `unique(tokenHash)` | **No `pondId`, `approvalStatus`, `lastSeenAt` or `createdAt`** |
| `FeedRequest` | `pkey(id)`, `(deviceId, status)`, `(farmId)` | |
| `ScheduleCommand` | `pkey(id)`, `(deviceId, status)`, `(deviceId, appliedAt)`, `(farmId)` | No `pondId` |
| `BackgroundJob` | `pkey(id)`, `(status, createdAt)`, `(ownerId, createdAt)`, `(expiresAt)` | No `finishedAt` |
| `PlatformAuditLog` | `pkey(id)`, `(orgId, createdAt)`, `(actorUserId, createdAt)` | **No leading `createdAt`** |
| `User` | `pkey(id)`, `unique(supabaseId)`, `unique(farmId)`, `unique(email)`, `(farmId)`, `(role)` | **No `createdAt`** |
| `ImpersonationSession` | `pkey(id)` only | No `actorUserId`, no `orgId` |

Postgres does **not** create an index for a foreign key automatically. Every FK column that appears in
a `where` clause needs its own index, and several do not have one - that is the single most common
defect below.

Two declared indexes are redundant: `User.farmId` is `@unique` **and** has `@@index([farmId])`, and
`Farm.ownerId` is `@unique` **and** has `@@index([ownerId])`. Postgres keeps both B-trees, so each
write maintains two identical indexes. Dropping the plain `@@index` entries costs nothing and saves
write amplification on two small-but-hot tables `[static]`.

## 2. Heaviest queries

### 2.1 Platform feed aggregate - sequential scan of the largest table `[inferred]`

`apps/web/lib/platform/analytics.ts:244`

```sql
SELECT to_char(date_trunc('day', "receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1), 'YYYY-MM-DD') AS day,
       COALESCE(NULLIF("source", ''), 'unknown') AS source,
       COUNT(*)::int, COALESCE(SUM("grams"), 0)::float8
FROM "FeedEvent"
WHERE "eventType" = 'feed_dispensed'
  AND "receivedAt" >= $2 AND "receivedAt" < $3
GROUP BY 1, 2
ORDER BY 1, 2
```

- **Filters:** `eventType` (equality), `receivedAt` (range). **No tenant predicate** - this is the
  platform-wide dashboard, so the whole table is in scope by design.
- **Available indexes:** `(deviceId, receivedAt)`, `(farmId)`, `unique(eventId)`. None has
  `receivedAt` or `eventType` as its leading column, so none can serve this predicate.
- **Likely plan `[inferred]`:** sequential scan of `FeedEvent`, then a hash aggregate. Cost is linear
  in total table size, not in the size of the requested window.
- **Severity:** the highest in this document. `FeedEvent` receives a heartbeat row per device every
  few minutes; `apps/web/lib/retention.ts` prunes heartbeats after seven days, which bounds the table
  but does not make the scan cheap.
- **Recommendation (not applied - no schema change in this workstream):** `CREATE INDEX
  "FeedEvent_eventType_receivedAt_idx" ON "FeedEvent"("eventType", "receivedAt")`. That single index
  also serves 2.5 and 2.6 below. A partial index `WHERE "eventType" = 'feed_dispensed'` would be
  smaller still.

Note the contrast with `DeviceStateEvent`, which does have `(eventType, createdAt)` - the same query
shape was already solved there and not on `FeedEvent`.

### 2.2 Heartbeat retention sweep - contradicts its own comment `[static]`

`apps/web/lib/retention.ts:14`

```ts
// (deviceId, receivedAt) index makes this range scan cheap.
const stale = await prisma.feedEvent.findMany({
  where: { eventType: "heartbeat", receivedAt: { lt: cutoff } },
  select: { id: true },
  take: batchSize,   // 5_000
});
```

The comment is wrong. The predicate has **no `deviceId`**, so `(deviceId, receivedAt)` cannot be used:
`receivedAt` is the second column of that index, and a B-tree can only be range-scanned on a prefix of
its columns. The plan is a sequential scan of the whole of `FeedEvent`, ordered by nothing, taking the
first 5,000 matching rows `[inferred]`.

The cron that calls this (`apps/web/app/api/cron/*`) runs on a schedule, so this is a repeated full
scan, not a one-off.

- **Recommendation:** the `(eventType, receivedAt)` index in 2.1 makes this an index range scan with
  no further change. This is the strongest argument for that one index: it fixes a hot write-path
  sweep and a platform dashboard read at the same time.

### 2.3 Farmer audit trail - sorts by an unindexed ordering `[inferred]`

`apps/web/lib/actions/audit.ts:79` (list, count and "last touch" share one `where` built by
`apps/web/lib/audit/trail.ts:88`)

```ts
where = { device: { pondId: { in: pondIds } }, ...eventType/source/createdAt filters }
prisma.deviceStateEvent.findMany({ where, orderBy: { id: "desc" }, skip, take, include: { device } })
prisma.deviceStateEvent.count({ where })
```

- **Filters:** a relation predicate on `device.pondId` (a join/subquery against `EnergyDevice`), plus
  optional `eventType IN`, `source`, `createdAt` range, `actorId IS NOT NULL`.
- **Ordering:** `id DESC`, i.e. the primary key.
- **Available indexes:** `(deviceId, createdAt)`, `(eventType, createdAt)`, `(farmId)`, `pkey(id)`.
- **Likely plan `[inferred]`:** for page 1 the planner can walk `pkey(id)` backwards and stop after
  `pageSize` matches, which is cheap. That advantage disappears as `skip` grows: `OFFSET n` still
  walks `n` index entries, and every one of them needs the `deviceId`/`eventType`/`source` filter
  applied (heap access for `source`). The `count(*)` has no ordering escape hatch and must evaluate
  the whole tenant's subset.
- **Two problems, both real:**
  1. `ORDER BY id` is not the column the indexes are sorted by. `createdAt` order would align with
     `(deviceId, createdAt)` and `(eventType, createdAt)`.
  2. `id` is a `cuid()`, so it is only *approximately* time-ordered (the v1 format prefixes a
     timestamp in base36). Ordering the audit by `id DESC` therefore approximates "newest first" but
     is not guaranteed to equal `createdAt DESC`, and cannot use a `createdAt` index.
- **Recommendation:** `@@index([farmId, createdAt])` on `DeviceStateEvent` and order by
  `createdAt DESC` (the row already carries an immutable `farmId` stamp, so the tenant filter becomes
  a plain indexed column instead of a relation subquery). Note that `farmId` is nullable for legacy
  rows, so the index would need to be partial or the rows backfilled first - check that before
  committing to it.

### 2.4 Platform audit explorer - sort over the whole table `[inferred]`

`apps/web/lib/platform/audit-log.ts:166`

```ts
prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take })
prisma.platformAuditLog.count({ where })
```

- **Unfiltered case** (the landing view of `/superadmin/operations/audit`): `where = {}`, so this is
  `ORDER BY "createdAt" DESC LIMIT n OFFSET m` with **no usable index** - `PlatformAuditLog` has
  `(orgId, createdAt)` and `(actorUserId, createdAt)` but nothing leading with `createdAt`.
- **Likely plan `[inferred]`:** full scan + top-N sort, or a full sort. The append-only table only
  grows.
- **Filtered case:** `action` and `targetId` are matched with `contains` + `mode: "insensitive"`,
  which Prisma compiles to `ILIKE '%...%'`. A B-tree cannot serve a leading wildcard, so those filters
  are heap filters on top of whatever the planner chose.
- **Recommendation:** `@@index([createdAt])` on `PlatformAuditLog`. For the text filters, the honest
  answer is a `pg_trgm` GIN index (`CREATE EXTENSION IF NOT EXISTS pg_trgm` then
  `CREATE INDEX ... USING gin (action gin_trgm_ops)`), which is a deliberate, reviewed decision - not
  something to add casually.

### 2.5 Feed chart aggregation `[static]`

`apps/web/lib/pond-charts.ts:107`

```sql
SELECT to_char(date_trunc('day', "receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1), 'YYYY-MM-DD') AS day,
       COALESCE(NULLIF("source", ''), 'unknown') AS source, COUNT(*)::int, SUM("grams")::float8
FROM "FeedEvent"
WHERE "eventType" = 'feed_dispensed'
  AND "deviceId" IN (...)
  AND "receivedAt" >= $2 AND "receivedAt" < $3
GROUP BY 1, 2
```

- `(deviceId, receivedAt)` **does** serve this: `deviceId IN (...)` plus a `receivedAt` range is
  exactly the index prefix, and `eventType`/`source` are filters applied to the fetched rows.
- **Likely plan `[inferred]`:** index scans per device id, then a hash aggregate. Cost is proportional
  to the 30-day window, which is bounded by design (`FEED_CHART_DAYS`).
- **Verdict: correctly indexed.** The window is the budget; keep it.

### 2.6 Chart and summary reads that are already right `[static]`

These are listed so the "what we checked" claim is complete, and to show the pattern the others should
follow:

| Location | Query | Index that serves it |
|---|---|---|
| `lib/pond-charts.ts:217` | `FeedLevelLog` by `deviceId IN` + `recordedAt` range, `GROUP BY` day | `(deviceId, recordedAt)` |
| `lib/pond-charts.ts:271,283` | `WaterTempLog` by `deviceId IN` + `recordedAt` range | `(deviceId, recordedAt)` |
| `lib/pond-charts.ts:170,179` | `FeedEvent` aggregate, `deviceId IN` + `receivedAt >=` | `(deviceId, receivedAt)` |
| `lib/feeder-hero.ts:70` | `FeedEvent` aggregate, `deviceId =` + `receivedAt >=` | `(deviceId, receivedAt)` |
| `lib/feeder-hero.ts:82` | `BiomassLog.findFirst` `where pondId` `orderBy recordedAt desc` | `(pondId, recordedAt)` |
| `lib/feeder-hero.ts:87` | `FcrReport.findFirst` `where pondId` `orderBy periodEnd desc` | `(pondId, periodEnd)` |
| `lib/growth-history.ts:58,73,94` | `FeedLevelLog`/`BiomassLog` paginated `where id` + range, `orderBy recordedAt desc, id desc` | `(deviceId, recordedAt)` / `(pondId, recordedAt)` |
| `lib/actions/history.ts:57` | `FeedEvent` `deviceId IN` + `receivedAt` range, `orderBy receivedAt desc, id desc` | `(deviceId, receivedAt)` |
| `lib/platform/analytics.ts:255,260` | `DeviceStateEvent.groupBy` by `eventType`, `eventType IN` + `createdAt` range | `(eventType, createdAt)` |
| `lib/platform/audit-log.ts:308,314` | `PlatformAuditLog.groupBy` by `action`/`targetType` inside a date range | `(orgId, createdAt)` / `(actorUserId, createdAt)` partially; bounded by the date range |
| `lib/calendar/event-sources.ts:246` | `BiomassLog.groupBy` by `pondId`, `_max recordedAt`, `pondId IN` | `(pondId, recordedAt)` |
| `lib/jobs/service.ts:94` | `UPDATE ... WHERE id = (SELECT ... WHERE status='queued' AND expiresAt > now ORDER BY createdAt FOR UPDATE SKIP LOCKED LIMIT 1)` | `(status, createdAt)` gives the filter and the ordering; the `UPDATE` then hits `pkey(id)` |
| `lib/actions/schedule.ts:116` | `ScheduleCommand` `deviceId` + `status`, ordered by `appliedAt` | `(deviceId, appliedAt)` |
| `lib/actions/calendar` (`resolveCurrentSchedule`) | `ScheduleCommand` `deviceId` + `status`, `orderBy appliedAt desc` | `(deviceId, appliedAt)` |
| `lib/actions/fcr.ts:39` | `FcrReport` `where pondId`, `orderBy periodEnd asc` | `(pondId, periodEnd)` - but see the unbounded read in 3.4 |

## 3. Queries that look unindexed

### 3.1 `EnergyDevice.pondId` has no index `[static]`

There is no `@@index([pondId])` on `EnergyDevice`. The FK is declared
(`pond Pond? @relation(fields: [pondId], ...)`) but Postgres does not index FK columns. Every
`where: { pondId }` on this table is a sequential scan.

Call sites that matter:

| Location | Query |
|---|---|
| `app/[locale]/(dashboard)/dashboard/page.tsx:128` | `energyDevice.findMany({ where: { pondId }, orderBy: { createdAt: "asc" } })` - the dashboard's first data read |
| `lib/pond-selection.ts:56` | `getActivePond` with `include: { energyDevices: ... }` - loads **every** pond's devices, then picks one pond in JS |
| `lib/actions/notifications.ts:79` | `energyDevice.findFirst({ where: { pondId } })` inside a `for` loop over notification groups - a seq scan per pond |
| `lib/actions/search.ts:313` | `energyDevice.findMany({ where: { pondId: { in: [...] } } })` |
| `lib/calendar/farmer-page.ts:128`, `lib/calendar/event-sources.ts:296` | `energyDevice.findMany` for the calendar |

`EnergyDevice` is small (one row per feeder), so a seq scan is cheap today. It is still the wrong
access path, it is on the dashboard's critical path, and `energyDevice.findFirst` inside the
notification loop is an N+1 with a scan per iteration.

- **Recommendation:** `@@index([pondId])` on `EnergyDevice`.

### 3.2 `EnergyDevice` platform scans `[static]`

`lib/platform/analytics.ts:204,206,278,290` and `lib/platform/health.ts:198`:

- `count({ where: { lastSeenAt: { gte: cutoff } } })`
- `count({ where: { approvalStatus: "PENDING" } })`
- `findMany({ where: { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] }, orderBy: { lastSeenAt: "asc" }, take: 20 })`
- `findMany({ where: { approvalStatus: "PENDING" }, orderBy: { createdAt: "asc" }, take: 5 })`

No index on `lastSeenAt`, `approvalStatus` or `createdAt`, so each is a full table scan on
`/superadmin`. Bounded table size keeps it cheap; the `orderBy` + `take` still needs a sort of the
matching set.

- **Recommendation:** `@@index([approvalStatus, createdAt])` and `@@index([lastSeenAt])`, or a single
  partial index on the pending set if that is the only hot filter.

### 3.3 `Notification` unread counts `[static]`

`lib/actions/notifications.ts` (`PENDING_NOTIFICATION_WHERE`) and `lib/platform/analytics.ts:205`:

- `count({ where: { read: false, acknowledgedAt: null } })` - no leading `read` index; `(pondId, read)`
  cannot serve a bare `read` filter.
- `count({ where: { createdAt: range } })` - no `createdAt` index.
- `groupBy({ by: ["pondId"], where: { read:false, acknowledgedAt:null, pond: { ownerId } } })` - a
  relation predicate plus an unindexed filter.

The bell badge is on every dashboard render, so this runs constantly even when the answer is 0.

- **Recommendation:** `@@index([read, createdAt])`, or a partial index
  `WHERE read = false AND "acknowledgedAt" IS NULL` if the pending set stays small.

### 3.4 Unbounded reads that only need one row `[static]`

| Location | Problem |
|---|---|
| `lib/actions/fcr.ts:39` | `fcrReport.findMany({ where: { pondId }, orderBy: { periodEnd: "asc" } })` with **no `take`**, then `fcrReports[fcrReports.length - 1].fcrValue`. The whole FCR history is transferred to read one float. `findFirst({ orderBy: { periodEnd: "desc" } })` is the same answer with one row. The index already supports it. |
| `lib/batch-logs.ts:69` | The second `groupBy({ by: ["batchLabel"], where, _count })` exists only to compute `total = allGroups.length`. It groups every biomass row of the pond a second time to count the groups. |
| `lib/batch-logs.ts:59,69,80` | `groupBy(["batchLabel"])` filtered by `pondId` only. `(pondId, recordedAt)` serves the filter but the grouping column is unindexed, so both passes sort or hash the pond's whole biomass history. `@@index([pondId, batchLabel])` would let it group by index. |
| `lib/growth-history.ts:73` | `biomassLog.findMany` with `include: { fishSamples: ... }` - the relation is a second indexed query (`FishSample(biomassLogId)`), not an N+1, but the sample list per log row is unbounded. Bounded in practice by `pageSize`. |

### 3.5 `User.createdAt` signup chart `[static]`

`lib/platform/analytics.ts:236`:

```sql
SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $1), 'YYYY-MM-DD'), COUNT(*)::int
FROM "User" WHERE "createdAt" >= $2 AND "createdAt" < $3 GROUP BY 1 ORDER BY 1
```

No `createdAt` index on `User`. Full scan of a small table (one row per farmer), so the cost is
acceptable today and grows linearly with the user count. `@@index([createdAt])` if it ever shows up in
a profile.

### 3.6 Global search - `ILIKE '%q%'` everywhere `[static]`

`lib/actions/search.ts:160` fans out over five tables with `contains` + `mode: "insensitive"`:

| Query | Filter | Ordering | Index situation |
|---|---|---|---|
| `pond.findMany` | `name ILIKE`, owner/status | `name asc` | no trigram index; `(ownerId)` narrows the farm |
| `energyDevice.findMany` | `label`/`mac` ILIKE, pond scope | `label asc` | no trigram index |
| `user.findMany` | `displayName`/`email`/`farmId` ILIKE | `displayName asc` | no trigram index |
| `biomassLog.findMany` | `batchLabel ILIKE` **or** `recordedAt` day range | `recordedAt desc` | `(pondId, recordedAt)` narrows a tenant; **no pond scope at all for a platform search** |
| `pondEvent.findMany` | `title ILIKE` **or** `startsAt` day range | `startsAt desc` | `(pondId, startsAt)` narrows a tenant |

A leading `%` makes every B-tree useless, so each of these scans whatever its other predicate allows.
For a farmer or tenant admin that is a bounded number of rows. **For a platform admin
(`context.pondIds === null`) the `biomassLog` and `pondEvent` searches have no tenant predicate at
all**, so they scan both tables end to end on every keystroke that reaches the debounce.

The code already knows this - `search.ts:257` says platform-wide day scans are skipped "because they
cannot use the per-device/per-pond indexes" - but the `ILIKE` branch has the same problem and is not
skipped.

- **Recommendation:** `pg_trgm` GIN indexes on the searched text columns, or restrict the platform
  audience's record search to a date window. This is a product decision as much as an index one.

### 3.7 `FeedEvent` search path `[static]`

`lib/actions/search.ts:320` filters `deviceId IN (...)` + `eventType = 'feed_dispensed'` +
`receivedAt` day range, `orderBy receivedAt desc`, `take MAX_RECORD_ROWS`. `(deviceId, receivedAt)`
serves it; `eventType` is a residual filter. Correctly indexed, mentioned only for completeness.

## 4. Anti-patterns found in passing `[static]`

Not index problems, but they show up in the same reads:

1. **`pod` N+1 with a scan** - `lib/actions/notifications.ts` runs `energyDevice.findFirst` inside a
   `for (const group of groups)` loop, and `pondId` is unindexed (3.1). Two defects in one line.
2. **Counting a fetched array** - `batch-logs.ts:68` and `search.ts` derive counts from materialised
   rows instead of a `count()`.
3. **`getActivePond` over-fetches** - it loads every pond of the farm with all devices attached
   (`lib/pond-selection.ts:56`) and then returns one, so a ten-pond farm pays for ten ponds' device
   lists on every dashboard render.
4. **Ordering by `id`** - `lib/actions/audit.ts`, `lib/actions/history.ts`,
   `lib/batch-logs.ts:141`, `lib/growth-history.ts` all use `id` as a tiebreaker or the primary sort
   on a `cuid()` column. As a tiebreaker (`receivedAt desc, id desc`) it is harmless; as the primary
   sort (audit) it defeats the `createdAt` indexes (2.3).
5. **Two `groupBy` passes over the same rows** - `batch-logs.ts:59` and `:69`.

## 5. Recommended index changes, ranked

None of these were applied: this workstream makes no schema change. They are the reviewed shortlist
for a follow-up migration.

| # | Index | Fixes | Risk |
|---|---|---|---|
| 1 | `FeedEvent(eventType, receivedAt)` | 2.1 platform dashboard (full scan), 2.2 retention sweep (full scan), also 2.5 | Write cost on the highest-write table; consider a partial index on `feed_dispensed` + `heartbeat` |
| 2 | `EnergyDevice(pondId)` | 3.1 dashboard first read, notification N+1, calendar | Negligible |
| 3 | `DeviceStateEvent(farmId, createdAt)` | 2.3 farmer audit sort + deep offset | `farmId` nullable; verify backfill or use a partial index |
| 4 | `PlatformAuditLog(createdAt)` | 2.4 unfiltered explorer sort | Negligible; append-only table |
| 5 | `Notification(read, createdAt)` (or partial on pending) | 3.3 unread counts on every dashboard render | Negligible |
| 6 | `EnergyDevice(approvalStatus, createdAt)`, `EnergyDevice(lastSeenAt)` | 3.2 superadmin scans | Negligible |
| 7 | `BiomassLog(pondId, batchLabel)` | 3.4 batch summary double grouping | Write cost on a low-write table |
| 8 | `pg_trgm` GIN on `Pond.name`, `EnergyDevice.label`, `BiomassLog.batchLabel`, `PondEvent.title` | 3.6 global search | Extension + index size; deliberate decision |

## 6. Measured evidence

Only the performance workstream's own tooling produced measured numbers. None of them are query
timings:

| Claim | Value | How |
|---|---|---|
| `FeedEvent`-heavy dashboard route ships 1455.4 kB of first-load JS `[measured]` | see `perf/bundle-budget.json` | `scripts/perf/bundle-budget.mjs` |
| The DB-free request pipeline costs 5-7 ms p50 / 0.6-0.9 ms of handler time `[measured]` | `perf/baseline/api-latency.json` | `scripts/perf/api-latency.mjs` |
| `/en` server response time 27-300 ms across three Lighthouse runs `[measured]` | `.lighthouseci/lhr-*.json` (`server-response-time`) | `@lhci/cli` |

**No row counts, no plan times, no buffer statistics.** Producing those requires a database with
realistic volume; see [`api-latency.md`](./api-latency.md) for the executable follow-up, which is the
same prerequisite for turning every `[inferred]` in this document into `[measured]`.

## 7. How to verify this audit once a database exists

```sql
-- 2.1 / 2.2: does the planner use (deviceId, receivedAt) for these? Expect Seq Scan today.
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*), sum(grams) FROM "FeedEvent"
WHERE "eventType" = 'feed_dispensed'
  AND "receivedAt" >= now() - interval '30 days' AND "receivedAt" < now();

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM "FeedEvent" WHERE "eventType" = 'heartbeat' AND "receivedAt" < now() - interval '7 days' LIMIT 5000;

-- 2.3: page 1 versus page 50 of the audit trail.
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "DeviceStateEvent"
WHERE "deviceId" IN (SELECT id FROM "EnergyDevice" WHERE "pondId" = '<pond>')
ORDER BY id DESC LIMIT 25 OFFSET 0;
-- repeat with OFFSET 1250 and compare "Buffers" and elapsed time

-- 2.4: unfiltered platform audit explorer. Expect a Sort over every row.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, "createdAt" FROM "PlatformAuditLog" ORDER BY "createdAt" DESC LIMIT 25;

-- 3.1: EnergyDevice by pond. Expect Seq Scan today.
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "EnergyDevice" WHERE "pondId" = '<pond>';

-- 3.3: unread badge. Expect Seq Scan today.
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM "Notification" WHERE read = false AND "acknowledgedAt" IS NULL;
```

Compare the `Seq Scan` / `Index Scan` choice and the `Buffers: shared hit` counts before and after
adding an index, and record the two numbers here with `[measured]` next to them. `EXPLAIN (ANALYZE)`
runs the query - use it on a local database only, never against production.
