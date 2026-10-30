# Mission 2026-10-29e — final outcome and A-level scorecard

Merged into `develop` as **`c6fe6e6`** through PR **#333**, released as **v1.30.0** (MINOR).
Every CI job on the merged commit was green: `quality`, `e2e (local supabase stack)`,
`public smoke (chromium, firefox, webkit)`, `dump, destroy, restore`, `CycloneDX SBOM`, `audit`,
`dead-code`, `complexity`, `gitleaks`.

## Scorecard against the A-level criteria

| Characteristic | Grade | Evidence that can be re-checked | What is still missing |
|---|---|---|---|
| Functional suitability | **A** | **92.42%** lines / 94.85% functions / 84.95% branches on `apps/web/lib`, gated at 90/94.5/84.5; E2E green in CI (31 passed, 4 skipped, 1 fixed spec); ~3,300 unit tests | — |
| Performance efficiency | **A** | Bundle budget for all **56 routes** validated byte-for-byte against a live server; Lighthouse actually ran (a11y 0.90–0.94, BP 0.86–0.90, SEO 0.95, LCP ≤5 s, CLS ≤0.02, zero 3rd-party); latency p50/p95 measured and gated for stable endpoints; static query audit | EXPLAIN plans need a database (#338, #339) |
| Compatibility | **A** | **54** smoke tests across Chromium, Firefox and WebKit (ran locally and in CI); responsive 390/834/1440; supported matrix in `docs/compatibility.md` | Mobile is emulated, not physical |
| Usability | **A** | axe-core with the **whole rule set, none disabled**, over six surfaces: **0 violations of any impact**; keyboard flows for pond switcher, chat, steppers, modal; en↔hil catalogue parity enforced | Tagalog is 9.3% and owner-decision pending (#327) |
| Reliability | **A−** | First-party error capture (dedupe, scrub-before-truncate, never throws, 30-day retention, admin console); health endpoint; RPO/RTO chosen with rationale; **restore drill executed and PASS** — 37 table counts, 9 schema-object counts, 18 invariants, 11 Prisma round-trips, 273 ms restore | Provider backups/PITR unverified (**#325**); no alerting channel; drill covers our dump/restore, not Supabase's |
| Security | **A−** | Production audit **93 → 1 allowlisted**, 0 critical; audit gate + Dependabot; CycloneDX SBOM; gitleaks on tree and history; threat model; incident-response plan; CSP `object-src 'none'`; `SECURITY.md` + `CODEOWNERS` | Dev-only criticals remain via vitest 3 (**#328**); five authz defects filed (**#329–#332, #334**) |
| Maintainability | **A** | Knip: 0 unused files/dependencies/exports/types; complexity budget from 1,073 measured functions; six ADRs; operations index; coverage gate | — |
| Portability | **A−** | Multi-stage Dockerfile, compose, environment matrix, env-driven site URL (10 tests) | **The image has never been built** — no Docker on the build machine |

**Overall: 5 × A, 3 × A−.** Not "all A", and the three A− are A− for concrete, named reasons rather than
missing paperwork.

## What would close the last three

| Gap | Why it is not closed | What closes it |
|---|---|---|
| Reliability A− | Only the owner can confirm Supabase plan backups/PITR; no alerting sink exists | Verify provider backups (#325); add a notification sink (the planned Telegram channel) |
| Security A− | Dev-only criticals need a vitest 4 major; five authz defects are real code changes with their own tests | #328 and #329–#332, #334 |
| Portability A− | No Docker on the build machine | Build and run the image once on any Docker host; the Dockerfile and matrix are ready |

## Honest notes

- The drill's scope is stated in `docs/operations/restore-drill.md`: it proves **our** dump/restore and schema
  recovery. It does **not** prove the provider has backups (#325) or that `auth.users` survives a restore (#322).
- The E2E job's first real run failed on one spec whose locator was scoped to a device row while the control
  panel renders in a sibling row. Fixed and re-run; a green first attempt would have been luck, not evidence.
- Coverage rose from 80.92% to 92.42% across five campaigns (~1,100 behaviour tests). The threshold was
  raised to the A target rather than left at the measured floor.
- 24 follow-up issues (#316–#339) carry every finding that was not fixed inside this mission, each with
  evidence and done-when criteria.

## Authorized production migration (2026-10-29)

The mission constraint said "no production database writes and no production migrations". The owner
explicitly authorized an exception while the system is not operational, so that `staging` — which shares
the production database — runs the complete v1.30.0 feature set.

- **Applied:** `20261029010000_add_error_events` via `prisma migrate deploy` against project ref
  `xjjnkikgkraixlfhhvoh` (the production project, verified before the run).
- **Before:** 38 migrations applied, exactly one pending. **After:** `Database schema is up to date!` (39).
- **Verified after the run:** `ErrorEvent` exists with all 13 designed columns, the three indexes plus the
  primary key (`ErrorEvent_fingerprint_key`, `ErrorEvent_lastSeenAt_idx`,
  `ErrorEvent_resolved_lastSeenAt_idx`), the `ErrorSeverity` enum (`ERROR`/`WARNING`/`INFO`), one
  `_prisma_migrations` row, and **0** rows.
- **Why it was needed:** `scripts/migrate-if-production.mjs` only runs migrations when
  `VERCEL_ENV === "production"`, so the staging (Preview) deployment shipped code referencing a table that
  did not exist. Without this, error capture silently no-ops, `/superadmin/operations/errors` returns 500,
  and `/api/cron/device-watch` returns 500 after its useful work.
- **Verification limit, stated plainly:** `staging` preview deployments sit behind Vercel SSO, so the
  application-level check cannot be made with an unauthenticated request. The evidence above is database-level;
  a signed-in browser is needed to confirm the admin page.

This addendum supersedes the earlier "no production migration" line for this one migration only. The migration
is additive: `CREATE TYPE`, `CREATE TABLE` and three `CREATE INDEX` statements, with no drops, renames or
data changes.