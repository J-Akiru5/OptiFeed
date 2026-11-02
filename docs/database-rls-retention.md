# Database containment: RLS, list indexes and DeviceStateEvent retention

Last verified: 2026-11-02. Implements issue **#593** (Lane D). Migration:
`apps/web/prisma/migrations/20261103100000_db_rls_index_retention`.

This document records the pre-flight that makes RLS safe for the app, the
tables that are intentionally service-role-only, the `DeviceStateEvent`
retention rule, and the query-plan evidence for the new indexes. It does not
authorise a production apply; that remains an owner decision with a backup.

---

## 1. Pre-flight: which role does the app use?

RLS only constrains a role that is neither the table owner nor `BYPASSRLS`.
Enabling it without checking that first can silently empty every query the app
runs. The check below was executed read-only against the shared hosted database
on 2026-11-02 through the same connection string the app uses.

```sql
SELECT current_user, session_user, current_setting('is_superuser');

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname = current_user;

SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'Notification';

SELECT has_table_privilege(current_user, 'public."Notification"', 'SELECT');
```

Observed result:

| Check | Value |
| --- | --- |
| `current_user` | `postgres` |
| `session_user` | `postgres` |
| `is_superuser` | `off` |
| `rolbypassrls` | **`true`** |
| Table owner (all audited tables) | `postgres` |
| `has_table_privilege(..., 'SELECT')` | `true` |

**Conclusion:** the application connects as `postgres`, which owns the tables
and has `BYPASSRLS`. Enabling RLS does not change what the Prisma app can read
or write. RLS is containment for the Supabase `anon`/`authenticated` surface,
not the app's tenant-isolation boundary — that remains `resolveOrgScope()` and
the ownership filters in application code (ADR-0006).

Re-run this check before applying the migration to a different database. If the
role is neither the owner nor `BYPASSRLS`, stop: enabling RLS will break the
app.

---

## 2. What the migration changes

The audit found 44 public tables, 20 with `rowsecurity = false`. One of those is
`_prisma_migrations`, Prisma's own bookkeeping table, which is excluded. The
migration enables RLS on the remaining **19 application tables**:

| Area | Tables |
| --- | --- |
| Tenant administration | `AiProviderConfig`, `CropCycle`, `Membership`, `MembershipPermission`, `Organization` |
| Devices and pond operations | `Device`, `FeedingEvent`, `MortalityLog`, `PondEvent` |
| Platform administration | `ImpersonationSession`, `PlatformAdmin`, `PlatformAuditLog` |
| Background work and diagnostics | `BackgroundJob`, `ErrorEvent`, `IssueReport`, `JobArtifact`, `ReminderLog` |
| Authentication rate limiting | `login_lockout`, `rate_limit_bucket` |

For each table the migration runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
It creates **no policy** on these tables, and none of them grants
`anon`/`authenticated` anything. The resulting access model is default-deny:
a non-owner role sees zero rows unless a future, reviewed migration adds both a
grant and a scoping policy. That is the "explicit deny" for this issue.

The migration is additive and re-runnable in effect:

- `ENABLE ROW LEVEL SECURITY` is idempotent.
- The indexes use `CREATE INDEX IF NOT EXISTS`.
- The revoke is idempotent.

It contains no `DROP`, `DELETE`, `TRUNCATE`, `ALTER COLUMN` or policy change.

### PondOwnershipHistory

`PondOwnershipHistory` was the only table granting the Supabase public API roles
anything (`anon SELECT`, `authenticated SELECT`). It already had RLS enabled
with a farm-scoped policy, so this was not a confirmed leak, but it was the one
place the public surface could read. The decision is now explicit:

> `PondOwnershipHistory` is **service-role-only**. The server reads it through
> Prisma. The `anon`/`authenticated` grants are revoked. The existing policy is
> left in place so that a future, reviewed grant is still row-scoped rather
> than a blanket read.

After this migration there are **zero** `anon`/`authenticated` grants in the
`public` schema.

---

## 3. Tables intentionally service-role-only

The next migration must not "fix" these by adding public grants. They are
reachable only through the server-side Prisma role:

- All 19 tables listed in section 2.
- `PondOwnershipHistory` (section 2).

Tables that already had RLS enabled and scoped policies (`Pond`, `EnergyDevice`,
`FeedEvent`, `FeedRequest`, `DeviceStateEvent`, `ScheduleCommand`, `BiomassLog`,
`FishSample`, `FcrReport`, `FeedLevelLog`, `Notification`, `Farm`, `User`,
`user_lockout`, and the platform incident/settings tables) are unchanged by this
migration. They currently have no `anon`/`authenticated` grants either, so those
policies exist for the PostgREST surface but that surface has no table
privilege. Adding a grant there is a reviewed decision, not a routine fix.

---

## 4. DeviceStateEvent retention

`DeviceStateEvent` is the device audit trail (commands, acknowledgements,
schedule changes, manual triggers, reconciliation). It previously had no
automated retention and grew forever. The rule is implemented in
`apps/web/lib/retention.ts`:

| Setting | Value |
| --- | --- |
| Window | **180 days** (`DEVICE_STATE_RETENTION_DAYS`) |
| Batch | 5,000 rows per cron run (`DEFAULT_BATCH_SIZE`), oldest first |
| Caller | `GET /api/cron/device-watch`, in the same housekeeping block as the 7-day heartbeat sweep, 30-day `ErrorEvent` sweep and 30-day draft sweep |
| Response field | `deviceStateEventsDeleted` |

The window is deliberately longer than the heartbeat window: this is the
command/acknowledgement audit trail used to investigate a dosing incident after
the fact, and 180 days covers a full production cycle. It is a single constant
so the policy can be changed in one place.

### Rows that are never deleted

The sweep keeps a row when either rule applies:

1. **Open alert.** The event's device belongs to a pond with an open
   `Notification` episode: `resolvedAt IS NULL AND autoCleared = false AND
   supersededById IS NULL`. Every event for that pond is kept while the alert is
   open, not only the event that triggered it.
2. **Reconciliation in progress.** `metadata.feedRequestId` or
   `metadata.expiredRequestId` names a `FeedRequest` whose status is `pending` or
   `dispatched`. `feed_reconciled` events carry `expiredRequestId`, and the
   reconciliation path must still be able to read that evidence.

If a whole batch is protected, the function deletes nothing and returns `0`;
the next run retries. It never deletes a protected row to make progress, and the
batch is not widened on retry. Rows for farm-less devices are not protected by
rule 1, because they cannot belong to an alerting pond.

The guard queries run only when the candidate query found stale rows, so an idle
cron pass costs one indexed lookup.

---

## 5. Indexes and the notification list plan

### Added

| Index | Serves |
| --- | --- |
| `Notification_pondId_createdAt_idx` `(pondId, createdAt)` | Pond notification list: filter by pond, newest first |
| `Notification_farmId_createdAt_idx` `(farmId, createdAt)` | Farm-scoped list / export |
| `PlatformAuditLog_createdAt_idx` `(createdAt)` | Global "all activity, newest first" list |

`FeedEvent.feedRequestId` already shipped in
`20261102190000_feed_request_pending_unique` (#581) and is **not** duplicated.

### Before (captured, read-only)

Query used by the pond notifications page:

```sql
SELECT "id", "tier", "message", "category", "read", "autoCleared",
       "acknowledgedAt", "createdAt"
FROM "Notification"
WHERE "pondId" = $1 AND "supersededById" IS NULL
ORDER BY "createdAt" DESC
LIMIT 20;
```

Plan on 2026-11-02, pond `cmtcr6jzk0002ayhgu6nf095r` (194 rows):

```
Limit
  -> Sort  (Sort Key: "createdAt" DESC)
       -> Index Scan using Notification_pondId_supersededById_idx
```

The index finds the pond's rows; the separate `Sort` orders them, so the cost
grows with the pond's notification count.

### After (expected, not yet verified)

With `(pondId, createdAt)` the planner can return rows already ordered and drop
the `Sort`:

```
Limit
  -> Index Scan using Notification_pondId_createdAt_idx (Backward)
```

An ascending composite index serves a `DESC` scan by scanning backward. This is
an expectation from the index shape, **not a measured plan**: the migration has
not been applied to any database in this task, so the after-plan could not be
captured. Record it during the production apply / restored-copy dry run and
replace this paragraph with the observed plan.

---

## 6. Apply, verification and rollback

### What was verified here

- `prisma validate` — schema valid.
- `prisma migrate status` against the hosted database — **4 migrations pending**:
  `20261102190000_feed_request_pending_unique`,
  `20261102200000_alert_episode_dedup`,
  `20261103090000_add_feed_event_request_unique`, and this migration. There are
  no checksum or drift errors; the hosted database is simply behind `develop`
  because `apps/web/scripts/migrate-if-production.mjs` only runs
  `prisma migrate deploy` when `VERCEL_ENV === "production"`. `develop` and
  `staging` builds skip migrations by design.
- Migration guard tests pin the 19 tables, the revoke, the three indexes and the
  absence of destructive SQL.
- Retention tests cover both protection rules, the empty-work path and batching.

`prisma migrate status` cannot be "clean" before the production apply: three
previously merged migrations are also still pending. It becomes clean only when
the promotion applies the whole queue, not by applying this migration alone.

### What was not verified

- **No dry run against a restored copy.** No restored copy exists in this
  environment, and the task explicitly forbids applying migrations to the
  hosted database. Lock behaviour is therefore reasoned, not measured:
  `ENABLE ROW LEVEL SECURITY` takes a brief `ACCESS EXCLUSIVE` lock and does not
  rewrite rows; each `CREATE INDEX` takes a `SHARE` lock and blocks writes while
  it builds. On a 20 MB database with 203 notifications (194 in the hottest
  pond) this is expected to be sub-second, but that is an expectation, not
  evidence.
- **No after-plan.** See section 5.
- **No RLS behaviour test as `anon`/`authenticated`.** The audit shows no table
  grants for those roles, and the migration does not create any, so there is no
  row-read path to exercise.

### Before the production apply

1. Take a full logical backup of the hosted database (owner/OP3).
2. Apply the full pending queue, not just this migration, during a low-traffic
   window.
3. Capture `EXPLAIN (ANALYZE, BUFFERS)` for the notification list and the global
   audit list; record the after-plans here.
4. Confirm `prisma migrate status` is clean.
5. Smoke-test the notification page, the platform audit page, and one device
   command/acknowledgement cycle.

### Rollback

The migration changes no data. To reverse it:

```sql
ALTER TABLE "..." DISABLE ROW LEVEL SECURITY;              -- per table
GRANT SELECT ON TABLE "PondOwnershipHistory" TO anon, authenticated;
DROP INDEX IF EXISTS "Notification_pondId_createdAt_idx";
DROP INDEX IF EXISTS "Notification_farmId_createdAt_idx";
DROP INDEX IF EXISTS "PlatformAuditLog_createdAt_idx";
```

Reversing the RLS enables is a deliberate exposure decision, not a routine fix.
Prefer fixing forward.
