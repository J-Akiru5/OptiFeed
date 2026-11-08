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
SET LOCAL app.org_ids = '<Organization.id>,<other org id>';
```

`SET LOCAL` is transaction-scoped, so pooled connections do not leak the context. The app-side
work is a `withTenant` helper (Prisma interactive transaction) that sets these values before any
tenant query; routes/actions are migrated to it before the switch. That refactor is **not** in
this plan branch and must be completed and tested before the connection changes. Slice 1 of that
refactor is described in §9.

> `app.org_ids` is the multi-org list the Phase 2 policies read. The earlier singular `app.org_id`
> draft in this section was superseded by `20261104160000_tenant_app_role_phase2`.

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

- No app connection-string change.
- No data deletion.
- No policy applied to any database.

## 7. Phase 1 migration

See `apps/web/prisma/migrations/20261104150000_tenant_app_role_phase1/migration.sql`. It creates
the role, grants and core policies; it is inert for the current `postgres` connection.

## 8. Phase 2 implementation (this branch)

- `apps/web/lib/db/tenant-context.ts` provides the request-scoped context: `runWithTenant()`,
  `tenantPrisma()`, `getTenantContext()`, `applyTenantContext()` and `runWithTenantClient()`.
  `withTenant()` remains as a deprecated alias. They set `app.farm_ids`, `app.pond_ids`,
  `app.user_id`, `app.supabase_id` and `app.org_ids` with transaction-local
  `set_config(..., true)`. A unit test pins the order, values and omission of empty arrays — see
  §9 for the runtime plumbing and the first converted slice.
- `apps/web/prisma/migrations/20261104160000_tenant_app_role_phase2/migration.sql` adds policies
  for the remaining tenant tables (`BiomassLog`, `FcrReport`, `FishSample`, `CalibrationRun`,
  `ScheduleCommand`, `PondSettingsDraft`, `PondEvent`, `MortalityLog`, `CropCycle`, `ReminderLog`,
  `DeviceConnectivityDaily`, `ImportConfirmation`, `AssistantAction`, `BackgroundJob`,
  `JobArtifact`, `PondOwnershipHistory`, `Device`, `FeedingEvent`, `OrgSetting`) and replaces the
  two single-org policies with `app.org_ids`.
- Platform-only tables remain default-deny for `optifeed_app`: `AiProviderConfig`, `PlatformAdmin`,
  `PlatformAuditLog`, `ImpersonationSession`, `PlatformIncident`, `PlatformIncidentEvent`,
  `PlatformSetting`, `ErrorEvent`, `IssueReport`, `CronHeartbeat`. Platform-admin paths must keep a
  privileged connection until a separate platform context is designed.
- The app is **not switched**. One read path is converted to the request-scoped context (§9); every
  other route handler, action and job still calls the privileged client directly. They must be moved
  to `runWithTenant` (or `applyTenantContext` inside an existing transaction) before the
  `DATABASE_URL` change. Platform admin paths are excluded from the tenant role.
- `apps/web/scripts/security/tenant-isolation-proof.mjs` is the read-only two-tenant proof. It compares
  privileged and `optifeed_app` counts for two farms and fails if a cross-tenant read is non-zero.
  Run it on a staging copy before the switch. See `docs/security/tenant-isolation-proof.md`.
- The switch window remains owner-run.

## 9. Slice 1 — request-scoped tenant context (option B, landed)

**Status: implemented, not enforcing.** The app connection is still `postgres` (`BYPASSRLS`) and
`optifeed_app` still has no password (the issue's 2026-11-07 status comment), so the settings below
change visibility for nobody. What changed is that a request can carry a correct context, one read
path uses it, and a missing context now fails loudly. RLS begins to enforce only when the connection
role changes (§5). Nothing in this slice switches the role, sets a password, or alters a policy.

### 9.1 Context API

`apps/web/lib/db/tenant-context.ts`:

| Export | Purpose |
| --- | --- |
| `TenantContext` | `farmIds`, `pondIds`, `userId`, `supabaseId`, `orgIds` — the five settings the policies read. |
| `runWithTenant(context, work)` | Opens one interactive transaction, applies `set_config('app.…', …, true)` on it, then runs `work` with that client published through `AsyncLocalStorage`. |
| `tenantPrisma()` | The transaction client bound to the current context. **Throws `MissingTenantContextError` outside a tenant unit of work** — there is no privileged fallback. |
| `getTenantContext()` | Read-only view of the active context, or `null`. |
| `applyTenantContext(tx, context)` | Applies the settings to a transaction the caller already owns. |
| `runWithTenantClient(tx, context, work)` | Publishes an existing transaction as the current tenant client. |
| `withTenant(context, work)` | Deprecated alias of `runWithTenant`, kept for the Phase 2 test. |

`AsyncLocalStorage` keeps the transaction client out of every function signature while making a
missing context a loud failure. The store exists only for the callback's async chain, so concurrent
requests cannot see each other's tenant; there is no module-level mutable "current tenant". The
settings are issued on the same connection as the queries and `set_config(..., true)` is
transaction-local, so a pooled connection cannot carry one request's tenant into the next.

A missing context is a bug, not a reason to fall back: `tenantPrisma()` throwing is the property that
keeps a half-converted request from silently reading with the privileged client while its neighbours
read with the tenant role.

### 9.2 Converted slice: tenant device registration options

`getTenantRegistrationOptions()` in `apps/web/lib/actions/device-registration.ts` — the pond list a
tenant admin picks a new feeder from on `/[locale]/(admin)/admin/devices`.

Why this one: it is the smallest read path that is still security-relevant. It reads exactly three
tables a wrong-context bug would expose (`Organization`, `Pond`, `OrgSetting`), it is gated by
`requireTenantAdmin()` + `claim_feeder`, and its result decides which pond a device may be registered
on. It also already resolves the full five-field context (`resolveOrgScope()` + `getCurrentUser()`),
so the conversion added no queries and no new dependency.

- Tenant reads inside the slice: `Organization.findUnique`, `Pond.findMany`,
  `OrgSetting.findUnique` — all on `tenantPrisma()`.
- Bootstrap reads that stay privileged: `getCurrentUser()` (session → `User`) and
  `resolveOrgScope()` (membership → org → members → farms → ponds). They *produce* the context and
  cannot depend on it. This is not a mechanical context change either: `User` allows the caller's own
  row via `app.supabase_id`, but `resolveOrgScope` then reads *co-members'* `User` rows by id before
  it knows their `farmId`, which no current policy permits. Resolving scope under the app role needs
  its own policy/query design — a separate decision, not part of this slice.
- `PlatformSetting` remains privileged: the app role cannot read platform tables by design (§8), so
  the settings default fallback stays on the privileged client and is not tenant data.

### 9.3 What an unconverted path still does

Every other path calls the privileged client directly. At this commit, 145 non-test modules under
`apps/web/lib` and `apps/web/app` still import the scoped `prisma` client, and none of them set
`app.*`. That is why enforcement is still zero.

The consequence for planning: under `optifeed_app`, an unconverted query does **not** "return the
same rows with RLS on". With no context, `ANY(string_to_array(current_setting(...), ','))` compares
as `NULL`, so the role sees **no rows** and refuses writes. A page whose data loaders are not
converted goes blank; an action whose writes are not converted fails. Do not switch the role until
the paths that serve a request are converted.

### 9.4 What slice 1 proved, and what it did not

Proved without a database (the tests are named in §9.6):

- A query issued through `tenantPrisma()` runs on the transaction that already executed the five
  `set_config` calls, in order, for the current tenant.
- `tenantPrisma()` outside a tenant unit of work throws `MissingTenantContextError`; it never returns
  the privileged client.
- Concurrent `runWithTenant` calls keep their own context and transaction, and the context does not
  survive the request.
- The converted slice's tenant reads (`Organization`, `Pond`, `OrgSetting`) use the transaction
  client, its bootstrap reads stay privileged, and its result is scoped to the caller's org
  (org B's pond never appears).
- `withTenant` publishes the context too, so the Phase 2 alias cannot diverge.

Not proved: that Postgres accepted a setting, that `optifeed_app` sees fewer rows, or that the
policies compile against a live connection. Those need a real database and the §4 two-tenant proof.
The tests use a Prisma double that records `$executeRaw` and delegate calls; they assert the
application boundary, not database behaviour.

### 9.5 Remaining slices, rough order

Ordered by blast radius and verification cost: read-only tenant-console surfaces first, then shared
reads, then writes, then the hot path. Each slice is one worktree, one PR, and the same gate:
converted path + a test that pins the transaction/`set_config` boundary + the two-tenant proof (§4)
on a staging copy.

1. **Tenant console reads.** The device list (`getDevices` / `getPendingDevices` in
   `lib/actions/admin.ts`), the admin overview (`lib/actions/admin-overview.ts`), and the pond/settings
   reads in `lib/actions/ponds.ts` and `lib/settings/*`. Small, gated, easy to verify.
2. **Tenant-console writes.** `addTenantDevice`, `decidePendingDevice`, pond CRUD. This is where the
   INSERT/UPDATE/DELETE `WITH CHECK` clauses become load-bearing, so it needs a negative
   cross-tenant write test, not just a read count.
3. **Shared dashboard reads.** `lib/pond-selection.ts` (`getActivePond`, `listSelectablePonds`),
   `lib/pond-charts.ts`, `lib/analytics/*`, `lib/calendar/*`. These serve every farmer page and need
   the org scope to be resolvable under the app role before they can be converted.
4. **Notifications and alerts.** `lib/actions/notifications.ts`, `lib/notifications/*`,
   `lib/feed/*` read paths. The policies here key on `app.pond_ids`, so the context must carry the
   pond list, not just the farm.
5. **Ingest and device routes.** `app/api/*` telemetry writes — every heartbeat and reading. This is
   the hot path the issue's option A warned about: measure p95 before and after, and do not put a
   transaction around per-row ingest work without that measurement.
6. **Cron, jobs and exports.** `lib/jobs/*` and `app/api/cron/*`: long-running work must not hold one
   tenant transaction open for the whole job; scope the transaction to the unit of work.
7. **Platform admin.** Excluded from the tenant role until a platform context exists (§8). It must
   not be "converted" to `tenantPrisma()`.

Identity/scope resolution is the shared prerequisite: until `getCurrentUser`/`resolveOrgScope` can
run under the app role, each slice keeps that one bootstrap step privileged. As §9.2 notes, the
current `User` policy cannot grant the co-member read the scope chain needs, so this is a policy
decision to make before the enforcement switch — not a mechanical conversion.

### 9.6 Tests

`apps/web/lib/__tests__/tenant-context-runtime.test.ts`:

- `tenantPrisma > throws MissingTenantContextError instead of returning the privileged client`
- `tenantPrisma > returns the transaction client that runWithTenant opened`
- `tenantPrisma > runs a tenantPrisma query on the transaction that already applied set_config`
- `tenantPrisma > keeps concurrent contexts on their own transaction`
- `tenantPrisma > publishes the context through the deprecated withTenant alias`

`apps/web/lib/__tests__/tenant-context-slice.test.ts`:

- `getTenantRegistrationOptions > applies the caller's context before reading the org, the ponds and the settings`
- `getTenantRegistrationOptions > keeps the context bootstrap on the privileged client`
- `getTenantRegistrationOptions > reads the org's own registration policy through the tenant client`
- `getTenantRegistrationOptions > never opens the tenant transaction for a caller who is not a tenant admin`

`apps/web/lib/__tests__/tenant-context.test.ts` (Phase 2, unchanged) still pins the setting order,
values and omission of empty arrays.
