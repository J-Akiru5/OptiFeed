# Restore drill

ISO/IEC 25010 **reliability** evidence, workstream **W12**. This is the procedure
that [`.github/workflows/restore-drill.yml`](../../.github/workflows/restore-drill.yml)
automates: take a logical dump, destroy the application schema, restore the
dump, and prove that every row count, aggregate and schema object came back.

A drill only counts if it was **executed**. The evidence is the workflow run URL
plus the uploaded `restore-drill-report.md`; a procedure that has not run recently
is not evidence.

## Scope

This drill exercises **our own dump/restore path and schema recovery**:

- `pg_dump --format=custom --no-owner --no-privileges`;
- `DROP SCHEMA public CASCADE` (the simulated disaster);
- `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error`;
- `prisma migrate status` against the restored database;
- a Prisma relational query round-trip against the restored schema.

It deliberately does **not** claim the following:

| Not covered | Why / where it is tracked |
| --- | --- |
| Supabase provider backups, PITR, project restore | Issue **#325**. The drill never talks to Supabase. |
| `auth.users` and other Supabase-managed identity data | Issue **#322**. A logical dump of the app schema cannot restore Supabase Auth. |
| RLS enforcement as `anon` / `authenticated` | The restore and verification connect as the database owner, which bypasses RLS. Policies are counted, not exercised. |
| Production data volume, RTO/RPO targets | The dataset is synthetic and tiny; the measured restore time is a smoke-test number, not a capacity plan. |
| Grants / privileges | `--no-privileges` is intentional (so the dump restores into any role set without ACL conflicts), so ACLs are not restored or compared. |
| Cross-server or cross-major-version restore | Server and client are both PostgreSQL 16. |
| Application and firmware behaviour after a restore | Out of scope; covered by the regular test suites. |

The workflow schedules a weekly run **in addition to** manual dispatch. It is not
a substitute for the provider-level backup check in #325.

## How CI runs it

| Item | Value |
| --- | --- |
| Workflow | `.github/workflows/restore-drill.yml` |
| Triggers | `workflow_dispatch`; weekly schedule (`17 3 * * 1`, default branch only); `push` when the drill's own files change (self-test) |
| Runner | `ubuntu-24.04`, `timeout-minutes: 30` |
| Database | `postgres:16` service container, health-checked with `pg_isready` |
| Credentials | Container-only (`drill` / `drill_only` on `localhost:5432`); no repository secret is read |
| Artefacts | `restore-drill-<run_id>-<run_attempt>` (report, dump, snapshots, round-trip), retained 90 days |

The uploaded dump contains only the synthetic fixture: no real farm data, no
credentials, and a fixed fake device token. It is evidence, not a production
backup.

Steps, in order:

1. install dependencies and generate the Prisma client;
2. install `postgresql-client-16` so the client major matches the server;
3. **assert** `DATABASE_URL` is loopback and not a Supabase host;
4. record server/client versions and the runner image;
5. bootstrap the two provider objects the migrations assume (`anon`,
   `authenticated`, `storage.buckets`) — see below;
6. `prisma migrate deploy`;
7. seed the deterministic fixture;
8. record the baseline snapshot;
9. `pg_dump` and record size + SHA-256;
10. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`;
11. assert `public` has zero tables;
12. `pg_restore` and measure wall-clock;
13. `prisma migrate status` must report *up to date*;
14. record the restored snapshot and the Prisma round-trip;
15. compare, render `restore-drill-report.md`, append it to the job summary;
16. upload the artefacts (always, even on failure).

### Why the bootstrap step exists

The committed migrations were written against Supabase and assume two
provider-managed objects:

- roles `anon` and `authenticated` — `20261004030000_add_pond_ownership_history`
  runs `GRANT SELECT ... TO anon, authenticated`;
- table `storage.buckets` — `20261027040000_add_user_avatar` inserts the
  `avatars` bucket.

A stock `postgres:16` container has neither, so
[`scripts/ops/bootstrap-drill-db.sql`](../../scripts/ops/bootstrap-drill-db.sql)
recreates just those objects before migrations run. It is **not** a migration
and must never be applied to a real project.

### Dispatching

GitHub only registers a `workflow_dispatch` workflow once it exists on the
repository's **default branch** (here `staging`). A brand-new workflow file on a
feature or integration branch cannot be dispatched until that happens — which is
why the drill also runs on a `push` that touches `.github/workflows/restore-drill.yml`
or `scripts/ops/**`. Pushing the branch is the pre-merge execution path.

```bash
# after the workflow exists on the default branch: run the current branch's copy
gh workflow run restore-drill.yml --ref <branch>

# or run the default-branch copy
gh workflow run restore-drill.yml

gh run list --workflow restore-drill.yml --limit 5
gh run view <run-id> --log
gh run download <run-id> --name restore-drill-<run_id>-1
```

The first dispatch on a branch is the acceptance run for that change; record its
run URL wherever the mission keeps its evidence.

## Running it by hand

Use this to reproduce a failed CI run or to drill a local Postgres. It needs
PostgreSQL 16 tooling (`psql`, `pg_dump`, `pg_restore`), Node 22 and pnpm 10.

> **Never point this at production, staging or a real Supabase project.** Step 5
> destroys the `public` schema. The scripts refuse a non-loopback host unless
> the acknowledgement variables below are set, and you should not set them for
> anything except a disposable scratch database.

Start a scratch database (Docker is optional; any local Postgres 16 works):

```bash
docker run --rm -d --name optifeed-drill \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill_only -e POSTGRES_DB=drill \
  -p 5433:5432 postgres:16
```

From the repository root, in a bash shell (Git Bash or WSL on Windows):

```bash
export DATABASE_URL="postgresql://drill:drill_only@localhost:5433/drill"
export DIRECT_URL="$DATABASE_URL"
artifacts=artifacts/manual-drill
mkdir -p "$artifacts"

pnpm install
pnpm --filter web prisma:generate

# 1. provider baseline + migrations
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/ops/bootstrap-drill-db.sql
pnpm --filter web exec prisma migrate deploy

# 2. deterministic data + baseline evidence
node scripts/ops/seed-drill.mjs
node scripts/ops/snapshot-drill.mjs --label baseline --out "$artifacts/baseline.json"

# 3. dump
pg_dump --format=custom --no-owner --no-privileges \
  --file "$artifacts/restore-drill.dump" "$DATABASE_URL"
export DRILL_DUMP_FILE="$artifacts/restore-drill.dump"
export DRILL_DUMP_BYTES="$(stat -c%s "$DRILL_DUMP_FILE" 2>/dev/null || stat -f%z "$DRILL_DUMP_FILE")"
export DRILL_DUMP_SHA256="$(sha256sum "$DRILL_DUMP_FILE" | awk '{print $1}')"

# 4. the disaster
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c 'DROP SCHEMA IF EXISTS public CASCADE;' -c 'CREATE SCHEMA public;'
node scripts/ops/snapshot-drill.mjs --expect-empty --label destroyed \
  --out "$artifacts/destroyed.json"

# 5. restore (timed)
start=$(date +%s%3N)
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname "$DATABASE_URL" "$artifacts/restore-drill.dump"
export DRILL_RESTORE_MS=$(( $(date +%s%3N) - start ))

# 6. verify
pnpm --filter web exec prisma migrate status
node scripts/ops/snapshot-drill.mjs --label restored --out "$artifacts/restored.json"
node scripts/ops/snapshot-drill.mjs --roundtrip --out "$artifacts/roundtrip.json"

# 7. report (fails with exit 1 on any difference)
node scripts/ops/render-drill-report.mjs \
  --baseline "$artifacts/baseline.json" \
  --restored "$artifacts/restored.json" \
  --destroyed "$artifacts/destroyed.json" \
  --roundtrip "$artifacts/roundtrip.json" \
  --out "$artifacts/restore-drill-report.md"

docker rm -f optifeed-drill
```

`render-drill-report.mjs` reads the remaining report fields from environment
variables (`DRILL_RUN_URL`, `DRILL_REF`, `DRILL_SHA`, `DRILL_POSTGRES_VERSION`,
`DRILL_PSQL_VERSION`, `DRILL_TS_*`, `DRILL_MIGRATE_STATUS`, ...). Unset values
render as `not recorded`, so a manual run can still produce a usable report.

## The safety guard

Every script under `scripts/ops/` calls `assertDrillTarget()` from
[`drill-guard.mjs`](../../scripts/ops/drill-guard.mjs) before connecting:

| Target in `DATABASE_URL` | Result |
| --- | --- |
| `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0` | allowed |
| any other host, no acknowledgement | **refused** before any query |
| other host + `RESTORE_DRILL_ALLOW_NONLOCAL=yes` only | **refused** |
| other host + `RESTORE_DRILL_ALLOW_NONLOCAL=yes` + matching `RESTORE_DRILL_ALLOWED_DB_HOST` | allowed, with a warning |
| missing or non-postgres `DATABASE_URL` | **refused** |

This mirrors `apps/web/scripts/e2e/guards.ts`: a single acknowledgement flag can
survive in a shell history and be reused by mistake, while an exact hostname
cannot match by accident. The scripts print only `host:port/database`, never the
connection string.

The workflow adds its own guard: the `Assert the drill target` step fails when
the host is not loopback or when the URL contains `supabase`, so a misconfigured
job cannot silently point at a managed database even if a future edit removes
the guard from a script.

## The dataset

`scripts/ops/seed-drill.mjs` writes through Prisma with literal ids
(`drill-org`, `drill-farm`, `drill-pond`, `drill-device`, ...), literal
timestamps and a fake device token. It creates:

- one organization, one membership and one permission override;
- one user (tenant slug `drill-farmer`), one farm, one pond;
- one crop cycle and one stocking `PondEvent`;
- one `EnergyDevice` (calibrated, with feed-level and water-temperature state);
- three `BiomassLog` sessions with three `FishSample` rows each;
- three `FeedEvent` rows, one `FeedRequest`, two `Notification` rows;
- one `DeviceStateEvent` connection event and one **error event**
  (`eventType = 'command_failed'` with `metadata.errorCode =
  'E_DRILL_SENSOR_FAULT'`), which is how the schema records a device error.

The pond insert also fires `record_pond_ownership_event()`, so the drill restores
a trigger-written `PondOwnershipHistory` row it never created directly. That row's
`createdAt` is `now()` by design; the drill compares its **count**, not its
timestamp.

`--reset` deletes only the literal `drill-` rows this script owns, in FK order.
Without `--reset` the seed refuses to run against a database that already holds
the fixture.

Ground truth is declared in `drill-fixture.mjs` as `DRILL_INVARIANTS`, so a bad
seed fails the **baseline** instead of silently becoming the reference:

| Invariant | Expected |
| --- | --- |
| `feed_event_total_grams` | `750.000` |
| `fish_sample_count` | `9` |
| `biomass_sample_total` | `165` |
| `biomass_weight_total_kg` | `8.250` |
| `unread_notifications` | `1` |
| `error_event_rows` | `1` |
| `error_event_code` | `E_DRILL_SENSOR_FAULT` |
| `active_crop_cycles` | `1` |
| `pond_ownership_created` | `1` |
| `device_token_hash_matches` | `true` |
| eight `orphan_*` FK checks | `0` |

The snapshot also records every base table in `public` with its exact row count
and nine schema-object counts (tables, columns, indexes, constraints, policies,
triggers, functions, sequences, enums), so losing a policy or trigger during a
restore is visible even when the data survives.

## Reading the report

`artifacts/restore-drill-report.md` (also in the job summary) contains:

- **Verdict** — PASS only when every table, schema object and invariant matches;
- what the drill proves and does not prove;
- environment: run URL, ref, commit, runner image, server/client versions;
- backup: file, size, SHA-256, timestamp;
- destruction and restore: timestamps, tables left after the drop, restore wall
  clock, `prisma migrate status`, round-trip result;
- row-count and schema-object tables with a per-row match flag;
- every invariant with expected, baseline, restored values and PASS/FAIL;
- the round-trip checks;
- a differences table (empty on PASS).

The workflow fails when the comparison or any invariant fails; the report and
artefacts are still uploaded because those steps run with `if: always()`.

## When it fails

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Baseline invariant fails | seed changed without updating `DRILL_INVARIANTS` | fix the fixture/expectation together, re-run |
| `prisma migrate status` not up to date | `_prisma_migrations` was not restored | inspect `pg_restore --exit-on-error` output; verify the dump includes the table |
| Row counts differ | data loss during dump/restore | treat as a real restore failure; keep the artefacts |
| Schema-object counts differ | DDL (policy, trigger, function, extension) not restored | compare `pg_restore` output for skipped objects; check the `postgres:16` image |
| Restore step fails | incompatible client/server, role or extension | confirm `postgresql-client-16` and the service image major match |
| `Assert the drill target` fails | `DATABASE_URL` was changed | the job must only ever point at its own container |
| Round-trip fails | generated Prisma client and restored schema disagree | regenerate the client; check for schema drift |

## Maintenance

- **New table** — no change needed; row counts are discovered from
  `information_schema`.
- **Seed change** — update `DRILL_INVARIANTS` expected values in the same commit;
  the baseline run will fail otherwise, which is the point.
- **PostgreSQL upgrade** — bump the service image and the client package together
  (`postgres:16` + `postgresql-client-16`), then re-dispatch.
- **Schedule** — the weekly cron only runs from the default branch. Disable the
  `schedule` block if it competes with other CI; manual dispatch still works.
- **Evidence retention** — GitHub keeps the artefacts for 90 days. Copy the run
  URL (and, if needed, the report) somewhere durable if an audit needs it longer.

## Related

- [`docs/runbook.md`](../runbook.md) §4, "Restore a backup" — incident-time
  recovery, including Supabase PITR.
- Issue **#322** — `auth.users` coverage.
- Issue **#325** — Supabase provider backup / PITR verification.
