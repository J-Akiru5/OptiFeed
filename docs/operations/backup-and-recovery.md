# Backup and recovery

This document defines what OptiFeed backs up, the recovery objectives it is designed to meet,
how long copies are kept, and how a restore is executed and verified. It is the authoritative
recovery procedure; [`docs/runbook.md`](../runbook.md) §4 stays the short incident-triage entry
point and points here for the full drill.

## Document status

**No restore drill has been executed.** The values in section 4 are decisions, not measurements.
Everything that has not been verified is marked as unverified below rather than described as if
it worked.

| Item | State |
| --- | --- |
| Policy and procedure written | 2026-10-29, targeting v1.30.0 |
| Provider backup configuration confirmed | **No** — open item H7 in `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md` |
| First restore drill executed | **No** — the record template `restore-drill-record.md` is empty |
| RPO/RTO measured | **No** — see section 4 |
| Restore performed against production | **Never**, and it must not happen without the owner's explicit decision (mission decision E4) |

Scope: the production Supabase project (`xjjnkikgkraixlfhhvoh`, Singapore) that serves
`pakaonai.syntaxure.dev`, the Supabase Storage buckets used by the app, and the configuration
needed to bring the service back. The application code is not covered here; it lives in Git
with released tags (see `CONTRIBUTING.md` §9).

The `staging` deployment shares this database and these credentials, by decision
(`docs/deployment-workflow.md` §6). For backup and recovery this means **there is one production
database and one recovery target**; a staging incident is a production incident.

---

## 1. Terms

| Term | Meaning here |
| --- | --- |
| **RPO** (recovery point objective) | How much data we accept losing, measured backwards from the moment of failure. An RPO of 24 hours means the restored database may be up to 24 hours old. |
| **RTO** (recovery time objective) | How long from the owner deciding to restore until the service is back and verified. Not "until the command finishes". |
| **Recovery point** | The exact backup or timestamp chosen for a restore. It is recorded before anything is restored. |
| **Drill** | A restore executed into a disposable target to prove the procedure and the backup. It never touches production. |
| **Production restore** | A restore that replaces or repoints the live database. Owner decision only. |

---

## 2. What is backed up today

"Verified" means someone has observed the mechanism working for this project. Nothing in this
table has been verified end to end; the repository has no backup automation and no drill record.

| Asset | Where it lives | Mechanism | Cadence | Verified? |
| --- | --- | --- | --- | --- |
| Postgres data: all Prisma tables in the `public` schema (farms, ponds, cycles, biomass logs, feed events, devices, memberships, audit rows, and the rest) | Supabase project `xjjnkikgkraixlfhhvoh` | Supabase provider backups, if the project's plan includes them | Assumed daily; **plan not confirmed** | **No** |
| Postgres schema history | Same database, `_prisma_migrations` | Carried inside the same database backup; migrations themselves are in `apps/web/prisma/migrations/` (38 at v1.29.0) | Continuous in Git | Yes in Git; backup coverage follows the row above |
| Supabase Auth identities (`auth.users`, password hashes, provider links) | Supabase Auth schema | Only if the provider backup includes the auth schema. The project's earlier JSON table exports **did not include `auth.users`** (`docs/login-domain-rename-plan.md`, rollback row) | Follows the provider backup | **No — known gap** |
| Pre-migration snapshot | Taken by the owner before a migration | Manual `pg_dump`, or JSON table exports. Historical exports were written to `C:/Users/Lenovo/Documents/PakaonAI/db-backups/` outside the repository | Event-driven, not scheduled | Partly: exports are recorded in mission logs; no full `pg_dump` is recorded |
| Storage: `avatars` bucket (optional profile photos) | Supabase Storage | Provider backup coverage unconfirmed; the objects themselves are the only guaranteed copy | Unknown | **No** |
| Storage: `firmware` bucket (OTA binaries) | Supabase Storage | No archival copy recorded; binaries are rebuildable from source and the offline signing key | On release | **No** |
| Configuration: Vercel environment variables (`DATABASE_URL`, `DIRECT_URL`, Supabase keys, device token, AI keys) | Vercel project `opti-feed-web`, scoped to Production and Preview | None. The names are listed in `docs/deployment-workflow.md` §6; values are held by the owner | Manual | Values are owner-held only |
| Configuration: database extensions, `pg_cron` schedules, Vault secrets | Supabase | Job definitions are in `docs/sql/*.sql`; Vault secrets are not in Git | Manual | Partly |
| Configuration: Supabase Auth settings, RLS policies, bucket policies | Supabase dashboard and migrations | Mostly expressed in migrations; dashboard-only settings are not versioned | Manual | **No** |
| Firmware signing key (OTA, ECDSA P-256) | Offline, outside the repository | Owner-held offline backup, per `docs/firmware-ota-plan.md` and `firmware/README.md` | Manual | Not verifiable from the repository |

### What this means in practice

- The only mechanism with a cadence anyone can state is the provider backup. If the project's
  plan does not include automated backups, the effective RPO is **"since the last manual
  dump"**, which is unbounded.
- A restore of Postgres alone is not a restored service: the app also needs the matching
  environment variables, the Auth identities that its `User.supabaseId` values point at, and the
  Storage objects that `User.avatarPath` names.
- The historical habit of exporting selected tables to JSON before a change is a **rollback aid
  for that change**, not a disaster-recovery backup. It does not cover the whole schema and it
  does not cover Auth.

---

## 3. Restore paths

There are three, in descending order of preference. Which ones the provider actually offers has
not yet been confirmed; the first drill records that.

| Path | What it restores | Limits |
| --- | --- | --- |
| **Provider point-in-time recovery (PITR)** | The database to a chosen timestamp | Paid add-on on most plans; may create a new project rather than restoring in place. `docs/runbook.md` §4 describes this as preferred and as creating a new project; that description is **unverified for this project** and must be checked in the drill. |
| **Provider daily backup restore** | The database to the most recent daily snapshot | Granularity is a day; a restore may create a new project. Whether Storage and Auth are included is plan-dependent and unconfirmed. |
| **Logical restore** (`pg_dump` / `pg_restore`) | Whatever the dump contains — schema and data as dumped | Only as fresh as the last manual dump; `auth.users` is absent unless explicitly dumped; large objects and Storage are not included. |

Because every path may produce a **new** project rather than repairing the old one, a real
recovery also includes repointing `DATABASE_URL` and `DIRECT_URL` in Vercel and redeploying. That
step is part of the RTO, not an afterthought.

---

## 4. RPO and RTO — decisions

These numbers are chosen, not observed. They exist so that an incident has a target to measure
against and so that "is this acceptable?" has an answer. The first drill measures the real
duration; after it, either the procedure improves or the target is re-decided in writing.

### RPO: 24 hours

**Decision: we accept losing up to 24 hours of database changes.**

Rationale:

1. **It is what the mechanism can deliver.** Provider backups are daily, and no WAL archiving,
   PITR window, or scheduled dump has been confirmed. A 1-hour RPO would be a claim the system
   cannot support today.
2. **The data is re-enterable at that horizon.** Biomass samples are taken on a weekly cadence
   and recorded on data sheets; daily feed totals are reconciled against the feeder's own
   records and the operator's log. Losing one day is recoverable by re-entry. Losing a week is
   not, without the paper trail.
3. **The alternative has a cost and a dependency.** Sub-hour RPO requires PITR or a scheduled
   `pg_dump` to durable storage. Neither is approved, configured, or monitored, and both add
   recurring cost or infrastructure to a capstone.
4. **The blast radius is one project.** There is no second database to reconcile. Restoring the
   one project to a known-good point restores the whole service.

**Condition:** this target only holds if automated daily backups actually exist. If the first
drill finds that they do not, the effective RPO becomes "since the last manual dump" and this
section must be amended, not quietly ignored.

### RTO: 24 hours

**Decision: we target service restored and verified within 24 hours of the owner deciding to
restore**, with the sub-targets below.

| Stage | Target |
| --- | --- |
| Owner acknowledges the incident | Within **4 business hours** (08:00–18:00 Asia/Manila, weekdays) |
| Decision: restore, forward-fix, or accept the loss | Within **8 business hours** |
| Restore executed, app repointed, and verified | Within **24 hours** of the decision |
| Affected farms told what was lost, if anything | Within **24 hours** of confirming the loss |

Rationale:

1. **There is no on-call rotation.** One owner-operator runs this service alongside classes and
   a defense schedule. A 1–4 hour RTO would be a promise nobody can keep at 02:00.
2. **The setup work dominates the restore.** Creating or restoring a Supabase project, repointing
   two Vercel environment variables, and redeploying is measured in hours, not minutes, and it
   depends on dashboard access rather than a command.
3. **Feeding does not stop the moment the server does.** The ESP32 keeps its schedule in NVS and
   restores it at boot (`firmware/README.md`, OTA checkpoint section), so a short server outage
   does not immediately halt scheduled feeding. This lowers the urgency relative to a system
   where an outage stops the animals being fed. It is a design property, not something this
   document has tested.
4. **A day is a defensible bound; four hours is not.** Twenty-four hours is one working day for
   one person, which is the real capacity.

**Not covered by these objectives:** Storage objects and configuration. There is no RPO/RTO for
the `avatars` bucket, the `firmware` bucket, or Vercel/Supabase settings. That is a gap, listed
in section 10, not an implicit "zero".

**What invalidates these decisions:** a plan without provider backups, a restore path that takes
longer than a day in the drill, real customer data with contractual obligations, or the isolation
of staging onto its own database (which would add a second recovery target).

---

## 5. Retention

Backup retention is capped by what the published Privacy Policy tells users, not by what the
provider defaults to. The policy says backups are kept **"Up to 30 days, then overwritten or
deleted"**, and security, rate-limit, and audit logs are kept **90 days**. Neither figure may be
exceeded without changing the policy and the legal version first.

| Data | Retention | Basis | Enforced by |
| --- | --- | --- | --- |
| Provider database backups | **30 days maximum** | Privacy Policy retention table | Provider retention setting; confirm it in the drill and record the actual value |
| Pre-migration manual dumps and exports | **30 days** after the migration is verified, then deleted | Privacy Policy; data minimisation | Owner, manually; record the deletion |
| Restored scratch project or local dump used for a drill | **Deleted at the end of the drill**, same day | Data minimisation | Operator, recorded in the drill record |
| `ErrorEvent` rows | **30 days** | This document, section 5.1 | Scheduled purge; not yet implemented (see 5.1) |
| Security, rate-limit, and audit logs | 90 days (published maximum) | Privacy Policy | Not audited by this document; no purge job verified |
| Import/export job artefacts | 7 days (published) | Privacy Policy | Not audited by this document |

### 5.1 `ErrorEvent` retention

**Decision: 30 days, then delete.** Error records are diagnostic telemetry, not farm records.
They are useful for the release that produced them and for one comparison cycle after it; beyond
that they are a liability, because a stack trace can contain a user id, a route, or a device
identifier even after scrubbing.

Thirty days is **deliberately below** the 90-day maximum the Privacy Policy publishes for
security and audit logs. A shorter period needs no policy change. If this ever moves above 90
days, the Privacy Policy and `apps/web/lib/legal/config.ts` must change first, and the new legal
version must be published.

Enforcement requires a scheduled delete. The repository already runs `pg_cron` for the jobs
worker (`docs/sql/cron-jobs.sql`) and for the device and crop watchers (`docs/sql/cron-device-watch.sql`,
`docs/sql/cron-crop-watch.sql`), so a daily purge on the same mechanism is the natural fit. **As of
this writing no purge job exists**, and the `ErrorEvent` model itself has not landed.

**Cross-check against the implementing workstream:** the mission plan
(`docs/missions/2026-10-29-iso-readiness.md`) records the requirement for I-64 as "Retention
policy + index plan in I-64" but states no number. The 30-day default in this document is the
decision recorded here. At the time of writing the `mission/I-64-error-capture` branch has no
commits, so there is no implementation note to reconcile against. **When I-64 lands, check its
retention constant and purge schedule against this section and correct whichever is wrong**; do
not let the document and the job disagree.

---

## 6. Restore drill runbook

A drill proves three things: the backup exists, it restores, and the restored data is usable.
The first drill is **non-production** by design. Mission decision E4 reserves any production
restore for the owner; no agent, worker, or CI job may execute one.

### Roles

| Role | Who | Responsibilities |
| --- | --- | --- |
| Operator | **Jeff (owner) only** | Holds Supabase organization-owner and Vercel access. Executes every step in this section. Chooses the recovery point. |
| Recorder | The second developer (@Karlcalimotan) when available; otherwise the operator | Timestamps each step, captures command and query output, fills `restore-drill-record.md`. |
| Reviewer | The other developer | Confirms the record is complete and that production was not modified. |

Two people are better than one because the recorder catches the step the operator skips. If only
the operator is available, the drill still proceeds and the record is reviewed afterwards.

### Cadence

- **First drill: before the v1.30.0 production deployment**, because that release carries the
  additive `ErrorEvent` migration and `CONTRIBUTING.md` §9 requires a backup before a release
  with migrations.
- Then **once per semester**, and after any change to the Supabase plan, the backup mechanism,
  or the restore procedure.
- Every drill gets its own filled record. A drill with no record did not happen.

### Plan A — provider restore into a disposable project (preferred)

Use this when the Supabase organization can create another project. It exercises the same path a
real recovery would use.

**Phase 0 — prepare (15 minutes)**

1. Confirm the target. Write down the **production project ref** (`xjjnkikgkraixlfhhvoh`) and the
   **scratch project ref** (not yet created). Say them out loud or write them; every destructive
   control in Supabase is one click from the wrong project.
2. Record the production baseline in the drill record: current time, the number of applied
   migrations, and the row counts and latest timestamps from the queries in section 7.1. These
   are read-only queries; run them against production through the SQL editor.
3. Open **Database → Backups** and record what is actually offered: the latest backup timestamp,
   the backup type, whether PITR is available, and the retention setting. **This answers the open
   H7 question, whatever the outcome.** If no automated backup exists, stop Plan A, switch to
   Plan C, and record that finding as the drill's most important result.
4. Choose the **recovery point**: normally the most recent completed backup. Record its
   timestamp before restoring.

**Phase 1 — restore into the scratch target (30–60 minutes)**

5. Create a scratch Supabase project in the same region (Singapore) and note its ref.
6. Restore the chosen backup into the scratch project, using whatever the dashboard offers. If
   the only option is an **in-place** restore on the production project, **do not use it**;
   switch to Plan B and record why.
7. While the restore runs, record the start time. Do not touch the production project.

**Phase 2 — point a local app at the restored database (20 minutes)**

8. Open a dedicated PowerShell window for the drill and set the scratch project's
   `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   its own service-role key as process environment variables (`$env:DATABASE_URL = "..."`). Do not
   write them to an `.env` file: process variables are not stored on disk and both Prisma and
   Next.js read them, with precedence over any `.env`. **Never paste production service-role
   values into a drill environment.**
9. Run `pnpm --filter web exec prisma migrate status` against the scratch database. Expected:
   "Database schema is up to date" with the migration count matching the production baseline. If
   it reports pending migrations, record the delta; do not apply them during the drill unless
   testing the forward path is the point of the drill.

**Phase 3 — verify (section 7)**

10. Run every check in section 7 and tick Pass / Fail / Not run in the record. "Not run" is an
    acceptable entry; an invented "Pass" is not.
11. Start the app locally against the scratch database (`pnpm dev` with the drill env file) and
    load the login page, then a dashboard for an account that exists in the restored data. If no
    usable password is known, record "app-level login not verified" and say why.
12. Do **not** send a feed command. A restored database can point at a real device; the drill
    must not cause a dispense.

**Phase 4 — tear down and record (15 minutes)**

13. Delete the scratch project and confirm it is gone. Record the deletion time.
14. Close the drill terminal, which discards the scratch environment variables, and delete any
    local dump or copy of the restored data.
15. Re-run the production baseline queries from step 2 and confirm the counts are unchanged
    (production may have grown; it must not have shrunk or changed unexpectedly).
16. Compute the measured duration from step 2 to step 11 and compare it with the 24-hour RTO.
17. Fill `restore-drill-record.md`, copy it to `restore-drill-YYYY-MM-DD.md`, and update this
    document if the procedure was wrong.

### Plan B — logical dump into a local Postgres

Use this when the provider restore path is unavailable, or when the drill must not create a
project. It proves the data is dumpable and restorable, not that the provider's restore works.
It requires the PostgreSQL client tools (`pg_dump`, `pg_restore`) on the operator's machine; they
are not a repository dependency and their presence has not been verified.

```powershell
# Read-only dump from production. Do not echo the connection string.
pg_dump --format=custom --no-owner --no-privileges `
  --file="drill-$(Get-Date -Format yyyyMMdd-HHmm).dump" `
  --dbname="$env:DIRECT_URL"

# Restore into a disposable local database (Docker is acceptable for this drill only;
# the no-Docker decision in the mission plan applied to E2E, not to recovery testing).
pg_restore --no-owner --no-privileges --dbname="postgresql://postgres:drill@localhost:5432/drill" `
  "drill-YYYYMMDD-HHmm.dump"
```

Then continue at Phase 2 step 9, pointing `DATABASE_URL` at the local database. Expect Auth to
be missing: `auth.users` is not in the dump unless it was explicitly included. Record that as a
confirmed gap rather than a surprise.

### Plan C — drill without any restorable backup

If Phase 0 step 3 finds no usable backup, the drill cannot proceed. Record the finding, open an
issue, and treat the missing backup as the incident. Do not simulate a restore with current
production data: a "restore" of data that was never backed up proves nothing, and copying
production data into a scratch project widens the exposure.

### Stop conditions

Stop the drill and record the state if any of these happen:

- the production project ref appears in a restore, delete, or reset dialog;
- the scratch project turns out to be the production project;
- a restore asks to overwrite or delete the production database;
- the dump or restore fails twice with the same error;
- personal data appears somewhere it should not (a log, a screenshot, a committed file).

---

## 7. How to verify a restore

A restore is "good" when the data is present, recent enough, internally consistent, and usable
by the application. Row counts alone are not enough; a database with all the rows and no Auth
identities cannot log anyone in.

### 7.1 Row counts and recency

Run in the **restored** database. Production uses quoted PascalCase table names; the three
snake_case exceptions (`user_lockout`, `login_lockout`, `rate_limit_bucket`) are not listed
because they are operational, not business, data.

```sql
SELECT 'User' AS table_name, count(*) FROM "User"
UNION ALL SELECT 'Farm', count(*) FROM "Farm"
UNION ALL SELECT 'Pond', count(*) FROM "Pond"
UNION ALL SELECT 'CropCycle', count(*) FROM "CropCycle"
UNION ALL SELECT 'BiomassLog', count(*) FROM "BiomassLog"
UNION ALL SELECT 'FeedEvent', count(*) FROM "FeedEvent"
UNION ALL SELECT 'EnergyDevice', count(*) FROM "EnergyDevice"
UNION ALL SELECT 'DeviceStateEvent', count(*) FROM "DeviceStateEvent"
UNION ALL SELECT 'PlatformAuditLog', count(*) FROM "PlatformAuditLog"
ORDER BY table_name;
```

```sql
SELECT 'BiomassLog' AS table_name, max("createdAt") AS latest FROM "BiomassLog"
UNION ALL SELECT 'FeedEvent', max("createdAt") FROM "FeedEvent"
UNION ALL SELECT 'DeviceStateEvent', max("createdAt") FROM "DeviceStateEvent"
UNION ALL SELECT 'PlatformAuditLog', max("createdAt") FROM "PlatformAuditLog";
```

Expected: counts at or above the backup timestamp's baseline, and a latest timestamp within the
RPO of the recovery point. A restored database whose newest row is a week older than the chosen
backup is a failed restore, even if every table exists.

### 7.2 Auth linkage

```sql
SELECT count(*) AS auth_users FROM auth.users;
SELECT count(*) AS app_users FROM "User" WHERE "supabaseId" IS NOT NULL;
```

Expected: `auth_users >= app_users`. Every `User` row points at a Supabase Auth identity through
`supabaseId`; if Auth was not restored, the app has users who cannot sign in. This is the check
most likely to fail on a logical dump, and the reason section 2 flags it.

### 7.3 Application checks

| Check | Pass condition |
| --- | --- |
| `prisma migrate status` | Reports the schema up to date, with the expected migration count |
| App boots | `pnpm dev` against the restored database serves the login page without a server error |
| Login | An account that exists in the restored data can sign in, or the record states why this was not tested |
| Dashboard | The dashboard renders pond, device status, and next feeding time for that account |
| Tenant isolation | A second test account cannot see the first farm's data |
| Device records | `EnergyDevice` rows keep their `lastSeenAt` and a hashed token; no token is printed anywhere |
| No writes | The drill sent no feed command and changed no production row |

### 7.4 What "not verified" looks like

Write it down. "Auth sign-in not verified: no disposable account with a known password exists in
the restored data" is a useful finding. Silence is not.

---

## 8. Production restore (incident only)

This is not a drill. It happens when production data is lost or corrupted and the owner decides
to restore. **No agent executes this.** The owner runs it, or explicitly directs it, after
reading this section.

1. **Declare the incident and the recovery point.** Write down the failure time, the newest
   transaction believed to be good, and the chosen backup. Confirm the data between the backup
   and the failure is accepted as lost, or plan a manual re-entry list.
2. **Capture evidence first.** The restore overwrites the state that explains the incident. Save
   the Supabase logs, the Vercel function logs, the `PlatformAuditLog` tail, and the current row
   counts **before** restoring. A restore that destroys the evidence is a second incident.
3. **Warn the users.** Farm operators should know the dashboard will be unavailable and that
   feeds scheduled through the server will not be sent during the window. Devices keep their
   cached schedule.
4. **Choose the target.** A new project is safer than an in-place restore because it leaves the
   damaged project readable for forensics. If the provider only restores in place, take a dump
   of the damaged database first, if it is readable.
5. **Restore** using the path confirmed by the drill.
6. **Repoint** `DATABASE_URL` and `DIRECT_URL` in Vercel (Production scope), and redeploy. A
   restore without the repoint leaves the app talking to the old database.
7. **Reconcile the schema.** Run `pnpm --filter web exec prisma migrate status`. If the backup
   predates migrations that were already applied, apply them with `prisma migrate deploy` — never
   `prisma migrate reset`, which destroys data (`CONTRIBUTING.md` §8). Note that a Vercel
   production deployment already runs `prisma migrate deploy` during the build
   (`apps/web/scripts/migrate-if-production.mjs`, `docs/deployment-workflow.md` §4), so the
   redeploy in step 6 applies pending migrations by itself; confirm what it applied rather than
   assuming it did nothing.
8. **Verify** with section 7, then check `/api/health`, a login, the dashboard, and one device
   poll. Confirm a device is polling again before declaring recovery.
9. **Communicate.** Tell affected farms what was recovered and what was lost. If personal data
   was exposed or lost, the DPO starts the 72-hour breach process required by RA 10173 IRR §38
   and described in the Privacy Policy.
10. **Record** the incident and the restore in a dated drill record, and open issues for anything
    that made recovery slower.

### Rollback if the restore itself fails

- **Non-production target (new project or local database):** delete it and stop. Production was
  never changed; there is nothing to roll back. Record the failure and try the next older backup
  on a new target.
- **In-place restore failed partway:** the project may now be in an unknown state. Do not re-run
  destructive commands and do not run `prisma migrate reset`. Capture the error and the project
  ref, open a Supabase support ticket, and treat the service as down until it is restored.
- **A verified backup exists:** restore again from the next older backup on a fresh target and
  repoint. Prefer a working older backup over a broken newer one.
- **No backup works:** fall back to the most recent manual dump. If that also fails, declare data
  loss, freeze writes (pause devices in the dashboard so the server issues no commands), rebuild
  from the dump plus paper records, and tell the affected farms exactly what is gone.
- **After any successful restore:** forward-fix, do not rewind. Schema rollback is not a restore
  feature (`docs/deployment-workflow.md` §8).

---

## 9. What to record afterwards

Every drill and every production restore gets a filled copy of
[`restore-drill-record.md`](./restore-drill-record.md), committed to this folder as
`restore-drill-YYYY-MM-DD.md`. The record is evidence; a summary in a chat message is not.

The record must include the operator, the recovery point, both project refs, the measured
duration, every verification result including the ones that were not run, what was deleted during
teardown, and the follow-up issues. If the measured RTO exceeds 24 hours, say so and either fix
the procedure or amend section 4 — do not leave the target and the evidence disagreeing.

---

## 10. Known gaps

These are real and current. None of them is fixed by writing this document.

1. **The drill has never been executed.** There is no measured restore time and no proof that
   any backup is restorable.
2. **Provider backup configuration is unconfirmed.** `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`
   still lists H7 as open: "Confirm backups and do one restore test". The Privacy Policy says
   backups exist; that is a commitment, not a verification.
3. **PITR is described as available in `docs/runbook.md` §4 but has never been confirmed for
   this project.** The plan and the retention setting are unknown. Treat that sentence as an
   aspiration until the drill records what the dashboard offers.
4. **No scheduled `pg_dump`.** Backups before migrations are manual, event-driven, and depend on
   someone remembering. Nothing alerts if they stop happening.
5. **The historical JSON exports exclude `auth.users`.** A restore from them leaves `User` rows
   pointing at identities that do not exist, so no one can sign in.
6. **Storage coverage is unknown.** The `avatars` and `firmware` buckets have no confirmed backup
   path and no archival copy.
7. **No RPO/RTO exists for Storage or configuration**, only for the database.
8. **A restore may require creating a new Supabase project and repointing Vercel**, which is
   unmeasured and depends on dashboard access that only the owner holds.
9. **One person holds every recovery credential.** The RTO assumes the owner is reachable; there
   is no deputy and no break-glass procedure.
10. **No backup-failure monitoring and no restore test in CI.** A silent backup failure would be
    discovered only during an incident.
11. **`ErrorEvent` retention (30 days) has no enforcement yet.** The model and the purge job are
    both unlanded; see section 5.1.
12. **The published 30-day backup retention has not been reconciled with the provider's actual
    setting.** If the provider keeps backups longer, the Privacy Policy is inaccurate and must be
    corrected before the next legal version.

---

## 11. References

- [`docs/runbook.md`](../runbook.md) §3–4 — incident triage and the short restore procedure.
- [`docs/deployment-workflow.md`](../deployment-workflow.md) §6 (shared staging/production
  database) and §8 (rollback).
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §8 (database rules) and §9 (release preconditions).
- [`docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`](../OPTIFEED-INDUSTRY-GRADE-PLAN%20v3.md) — H7, the
  open backup gate.
- [`docs/login-domain-rename-plan.md`](../login-domain-rename-plan.md) — records that the JSON
  backup path did not cover `auth.users`.
- [Privacy Policy](https://pakaonai.syntaxure.dev/privacy) — backup and log retention commitments.
- [`docs/legal/`](../legal/) — the review record behind the published legal pages.
- [`SECURITY.md`](../../SECURITY.md) — vulnerability reporting and the breach-notification path.
