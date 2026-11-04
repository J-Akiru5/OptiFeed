# #711 — Dedicated tenant DB role (Option A, Phase 1)

**Status: Option A selected by the owner. The Phase 1 migration is prepared in
`apps/web/prisma/migrations/20261104150000_tenant_app_role_phase1` and is not applied. No data is
deleted by this phase.**
Prepared: 2026-11-04. Related: #711, `docs/database-rls-retention.md`,
`docs/audits/2026-11-03-production-readiness.md` (B17).

## 1. Why this exists

The app connects to Postgres as `postgres`, which has `BYPASSRLS`. RLS is enabled on the public
tables, but it cannot apply to the app's own connection. Tenant scoping is therefore entirely in
application `where` clauses. One missed predicate is a cross-tenant read with no database
backstop.

Option A means: create a dedicated app role without `BYPASSRLS`, add correct policies, prove
cross-tenant isolation with a two-tenant test, then switch the app's connection during a planned
window. This document is the plan and a **draft** SQL file; it is deliberately not a Prisma
migration because it must not apply itself before the switch is ready.

## 2. Non-destructive guarantee

The Phase 1 migration only contains:

- `CREATE ROLE` if absent,
- `GRANT` statements,
- `ENABLE ROW LEVEL SECURITY` (idempotent),
- `CREATE POLICY` statements.

It contains **no** `DELETE`, `TRUNCATE`, `DROP TABLE`, `ALTER COLUMN`, `INSERT` or data backfill.
Existing rows are untouched. The current app keeps using `postgres` (BYPASSRLS), so applying the
role/policies does not change app behaviour until the connection string is switched.

## 3. Design

### 3.1 Role

- `optifeed_app`: `LOGIN`, `NOBYPASSRLS`, `NOSUPERUSER`, no createdb/createrole.
- The password is **never** in the repository. The owner sets it with `ALTER ROLE` during the
  window, stores it in the deployment secret manager, and updates `DATABASE_URL`.
- Migrations continue to use the existing privileged connection. The app role never runs
  `prisma migrate`.
- Grants: `USAGE` on `public`, `SELECT/INSERT/UPDATE/DELETE` on tables, `USAGE/SELECT` on
  sequences, and matching default privileges for future tables.

### 3.2 Tenant context

The app already resolves the authenticated Supabase user to `User.farmId` and the active
`Membership`/`Organization` in `lib/auth/*`. Before the switch, each transaction must set:

```sql
SET LOCAL app.farm_ids = 'farm-a,farm-b';  -- User.farmId login slugs from OrgScope
SET LOCAL app.pond_ids = 'pond-1,pond-2';  -- Pond ids from OrgScope
SET LOCAL app.user_id = '<User.id>';
SET LOCAL app.supabase_id = '<Supabase Auth user id>';
SET LOCAL app.org_id = '<Organization.id>';
```

`SET LOCAL` is transaction-scoped, so pooled connections do not leak the context. The app-side
work is a `withTenant` helper (Prisma interactive transaction) that sets these values before any
tenant query; routes/actions are migrated to it before the switch. That refactor is **not** in
this plan branch and must be completed and tested before the connection changes.

### 3.3 Policy matrix (Phase 1 core tables)

| Table | Tenant rule |
| --- | --- |
| `Farm` | `ownerId = ANY(app.farm_ids)` |
| `Pond` | `ownerId = ANY(app.farm_ids) OR id = ANY(app.pond_ids)` |
| `User` | `farmId = ANY(app.farm_ids) OR supabaseId = app.supabase_id` |
| `Membership` | `orgId = app.org_id OR userId = app.user_id` |
| `Organization` | `id = app.org_id` |
| `EnergyDevice` | device → pond → `ownerId = ANY(app.farm_ids)` |
| `FeedEvent` | device → pond → `ownerId = ANY(app.farm_ids)` |
| `Notification` | `pondId = ANY(app.pond_ids)` OR pond → `ownerId = ANY(app.farm_ids)` |
| `FeedRequest` | device → pond → `ownerId = ANY(app.farm_ids)` |
| `WaterTempLog` | device → pond → `ownerId = ANY(app.farm_ids)` |
| `FeedLevelLog` | device → pond → `ownerId = ANY(app.farm_ids)` |
| `DeviceStateEvent` | device → pond → `ownerId = ANY(app.farm_ids)` |

`app.farm_ids` and `app.pond_ids` are comma-separated lists, matching `OrgScope.farmIds` and
`OrgScope.pondIds`. An unset setting makes `= ANY(NULL)` false, so the role sees no rows by
default.

The fallback joins are needed because several historical rows predate the immutable `farmId`
stamp and have `farmId = NULL`.

### 3.4 Tables that must be classified before the switch

The app role must not be switched until **every** table is either:

- tenant-scoped with a policy, or
- explicitly global (e.g. `PlatformSetting`, rate-limit buckets) and documented as such.

This inventory is the remaining Phase 1 work. A table with RLS enabled but no policy is
default-deny for `optifeed_app`; a table without RLS is fully readable by that role. Both cases
must be resolved before the switch.

## 4. Two-tenant proof

Before the switch, run with the app role and a two-tenant fixture:

1. `SET LOCAL app.farm_ids = '<farm-A>'` and `SET LOCAL app.pond_ids = '<pond-A>'`.
2. `SELECT count(*) FROM "Pond"` → only farm A rows.
3. `SELECT count(*) FROM "FeedEvent"` → only farm A rows.
4. `SELECT count(*) FROM "Notification"` → only farm A rows.
5. Repeat as farm B; assert zero overlap.
6. Attempt a cross-tenant `INSERT/UPDATE` and assert it fails with the policy violation.

The same assertions belong in an automated test once the app-side `withTenant` helper exists.

## 5. Switch plan (owner-run, planned window)

1. Take a verified backup and record the restore point.
2. Apply `20261104150000_tenant_app_role_phase1` while the app still uses `postgres`. This is
   inert for the app.
3. Set the `optifeed_app` password and store it in the deployment secret manager.
4. On a staging copy, run the two-tenant proof and the app's full test suite with
   `DATABASE_URL` pointing at `optifeed_app`.
5. Schedule the production window. Switch `DATABASE_URL` to `optifeed_app`; keep the old
   connection string available for rollback.
6. Smoke test: login, dashboard, log a sample, poll a device, one feed command in a safe state.
7. Monitor errors and slow queries.

**Rollback:** switch `DATABASE_URL` back to the privileged connection. The role and policies can
remain; nothing is deleted.

## 6. What is explicitly not done here

- No Prisma migration.
- No app connection-string change.
- No app-side `withTenant` refactor.
- No data deletion.
- No policy applied to any database.

## 7. Migration

See `apps/web/prisma/migrations/20261104150000_tenant_app_role_phase1/migration.sql`. It is a
Phase 1 migration that only creates the role, grants and policies; it is not applied by this
branch.
