# Mission 2026-10-29e (OpenCode lead): ISO/IEC 25010 readiness remediation

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `8eb6ce4` (v1.29.0, 2026-10-29).
Integration branch: `integration/iso-readiness` (worktree `S:/Dev/Capstone/optifeed-worktrees/batch-29b`).

This document is the **single source of truth** for this mission. It supersedes the informal
assessment given in chat; the evidence table below is the baseline the mission is measured against.

## Objective

Raise the repository's ISO/IEC 25010 **alignment** from the assessed **C+** to a defensible **B/B+** by
closing the five gaps that drag the score, without destabilising a working product.

**Not in scope, stated plainly:** a repository cannot be ISO certified. ISO 9001 (QMS) and ISO 27001
(ISMS) certify an organisation's management system, not a codebase. This mission produces alignment
evidence and remediation, not a certificate.

## Baseline (assessed 2026-10-29 @ v1.29.0)

| Characteristic | Grade | Gap this mission addresses |
|---|---|---|
| Functional suitability | B+ | E2E specs exist but never run in CI; no coverage measurement |
| Performance efficiency | C+ | **not addressed** — no budget, no load tests (out of scope, recorded) |
| Compatibility | B | — |
| Usability | B- | **not addressed** — no automated a11y assertions (recorded as follow-up) |
| Reliability | B- | Errors console-only; no RPO/RTO; restore never documented as a drill |
| Security | C- | 93 production vulns (2 critical, 36 high); no vuln automation; no SECURITY.md |
| Maintainability | A- | — |
| Portability | B | — |

## A-level exit criteria (owner raised the bar, 2026-10-29)

The mission does not close at "B/B+". Every characteristic must reach **A**, and each A must be
evidenced by something re-verifiable from this repository or a green CI job.

| Characteristic | A-level exit criterion |
|---|---|
| Functional suitability | ≥90% line coverage on `apps/web/lib` enforced as a CI threshold; E2E green in CI across the core flows; requirement→test traceability matrix; API conformance 100% |
| Performance efficiency | Enforced bundle-size budget; Lighthouse CI budgets on key pages; recorded API latency baseline (p50/p95) with a regression gate; documented index/EXPLAIN audit for the heaviest queries |
| Compatibility | Playwright smoke on Chromium **and** Firefox **and** WebKit; responsive assertions at phone/tablet/desktop; documented supported matrix |
| Usability | axe-core on key pages with **zero serious/critical** violations enforced in CI; keyboard-navigation tests for primary flows; i18n key parity across en/hil/tl |
| Reliability | Error capture + admin view; readiness/health probes; SLOs documented; **an executed restore drill against a disposable database with a recorded result** |
| Security | Zero reachable critical/high; audit gate + Dependabot; SBOM in CI; secret scanning in CI; threat model; incident-response plan; SECURITY.md |
| Maintainability | Coverage threshold met; dead-code and complexity checks enforced; ADR index; docs for every operational process |
| Portability | Reproducible container build (Dockerfile + compose) and a documented environment matrix; no hard-coded production hosts |

An "A" that a stranger cannot re-verify from this repository alone does not count.

## Owner decisions (Jeff, 2026-10-29)

| ID | Decision |
|---|---|
| E1 | **First-party error capture.** No external service. Errors are persisted in our own database and surfaced in an admin view; alerting can reuse the planned Telegram channel later. |
| E2 | **E2E runs against a disposable Postgres service container in CI.** No production or staging credentials ever enter CI. |
| E3 | **Patch criticals and reachable highs, then gate at `high`** with a documented, expiring allowlist for unreachable transitive cases. No broad major-version upgrades. |
| E4 | **No production restore is executed by an agent.** The mission documents RPO/RTO and a runnable drill procedure; executing a restore against Supabase stays an owner action. |
| E5 | **Every finding becomes a tracked issue.** Anything spotted during the audit that is not fixed inside the current workstream is filed as a GitHub issue with evidence and acceptance criteria — never left only in a chat message or a worker report. The lead files them centrally to avoid duplicates. |

## Workstreams

| ID | Workstream | Branch | Worktree | Depends on | Status |
|---|---|---|---|---|---|
| I-62 | **W1 Supply chain.** Triage the 93 findings, pin `pnpm.overrides`/targeted upgrades for the 2 criticals and reachable highs, add `.github/workflows/security.yml` (`pnpm audit --audit-level=high`) and `.github/dependabot.yml`. No broad majors. | `mission/I-62-supply-chain` | `iso-supply-chain` | — | merged @ `ca9be76` (`ba5a0a7`) |
| I-63 | **W2+W3 Quality gates.** Coverage thresholds ratcheted at the current level (no drop allowed), and a Playwright E2E job in `.github/workflows/ci.yml` backed by a **local Supabase stack** (`supabase start`: Postgres + Auth + storage) with `prisma migrate deploy` + `scripts/e2e/seed-e2e.ts`. A plain Postgres service container is **not sufficient** — see discovery below. | `mission/I-63-ci-quality` | `iso-ci` | I-62 (to avoid concurrent heavy installs) | queued |
| I-64 | **W4 Reliability.** Additive `ErrorEvent` model + migration, `reportError()` persistence with dedupe and scrubbing, and an admin/superadmin error view. Additive only. | `mission/I-64-error-capture` | `iso-errors` | — | merged @ `568b012` (`9d19f09`) |
| I-65 | **W5+W6 Governance.** `SECURITY.md` (disclosure policy), `CODEOWNERS`, RPO/RTO and retention policy, and a restore-drill runbook in `docs/`. | `mission/I-65-governance` | `iso-governance` | — | merged @ `8e51d75` (`810bf9b`) |
| I-66 | **W7 Performance.** Bundle-size budget in CI, Lighthouse CI budgets on key pages, API latency baseline (p50/p95) with a regression gate, and an index/EXPLAIN audit of the heaviest queries. | `mission/I-66-performance` | `iso-perf` | I-62 (bundle tooling) | queued |
| I-67 | **W8 Compatibility.** Playwright smoke on Chromium + Firefox + WebKit, responsive assertions, supported-browser matrix. | `mission/I-67-compatibility` | `iso-compat` | I-63 | queued |
| I-68 | **W9 Usability/a11y.** axe-core on key pages with zero serious/critical enforced, keyboard tests for primary flows, i18n key parity. | `mission/I-68-a11y` | `iso-a11y` | — | queued |
| I-69 | **W10 Security depth.** CycloneDX SBOM in CI, secret scanning (gitleaks), threat model, incident-response plan, CSP enforcement review. | `mission/I-69-security-depth` | `iso-security` | I-62 | queued |
| I-70 | **W11 Portability.** Multi-stage Dockerfile, compose for local, environment matrix, removal of hard-coded production hosts. | `mission/I-70-portability` | `iso-portability` | — | queued |
| I-71 | **W12 Reliability drill.** SLOs, readiness probe, and an **executed** restore drill against a disposable database with a written record. | `mission/I-71-reliability-drill` | `iso-drill` | I-64, I-65 | queued |
| I-72 | **W13 Maintainability.** Dead-code (knip) and complexity budgets, ADR index, operational docs index. | `mission/I-72-maintainability` | `iso-maint` | — | queued |

## Constraints that apply to every workstream

1. **No production database writes and no production migrations.** I-64 adds a migration that will
   apply on the next `main` deployment; it must be **additive only** (new table, no drops, no renames)
   and the release PR must say so, with a backup precondition.
2. **No deploys.** No `vercel`, no deploy hooks, no `main`/`staging` pushes.
3. **No shared-branch writes.** Workers push only their own branch; the lead integrates.
4. **No new runtime dependency** unless the workstream explicitly needs one, and never a major bump
   outside a fix (E3).
5. **Never weaken a check to make it pass.** A failing test, lint rule or audit finding is investigated,
   not silenced. Allowlist entries require a written reason and an expiry date.
6. **Heavy work is serialised.** Workers install once and run focused checks; the lead runs the single
   full gate on the integrated tree.
7. **Every claim is evidenced.** A worker that cannot run a check says so and why.

## Verification plan

1. Per branch: `biome check` on touched files, focused `vitest`, and for I-64 a fresh
   `prisma generate` + `prisma validate`.
2. **Security evidence:** `pnpm audit --prod --audit-level=high` exits 0, or the only remaining findings
   are in the allowlist with a written expiry.
3. Integration: full gate on the merged tree — `pnpm lint`, `pnpm typecheck`, `prisma validate`,
   `pnpm api:check`, `pnpm test` with the new coverage thresholds, `pnpm build`.
4. E2E: the new CI job must actually pass on the PR — a green local syntax check is not evidence.
5. Release: **v1.30.0** (MINOR — security fixes and new operational capability).
6. One PR into `develop`; merge only after `quality` and the new security/E2E jobs are green.

## Definition of done

- All workstreams merged into `develop` through the mission PR(s).
- Every **A-level exit criterion** above evidenced: a green CI job, a recorded measurement, or a document a stranger can follow.
- `pnpm audit` gated in CI with a documented, expiring allowlist.
- E2E executing in CI against a disposable local Supabase stack.
- Coverage ≥90% on `apps/web/lib` and cannot regress.
- Production errors persisted and visible to an administrator.
- `SECURITY.md`, `CODEOWNERS`, SBOM, secret scanning, threat model, incident-response plan, RPO/RTO, retention and an **executed** restore drill.
- Bundle, Lighthouse, latency and complexity budgets enforced.
- Cross-browser smoke green; axe-core clean on key pages.
- Reproducible container build.
- Plan updated with final evidence; nothing claimed that was not run.

## Findings during the mission

| Date | Finding | Consequence |
|---|---|---|
| 10-29 | The E2E suite authenticates through **Supabase Auth** (`supabase.auth.admin.listUsers`, `@supabase/ssr` sessions), and `e2e/global-setup.ts` refuses to run unless `DATABASE_URL` host matches `E2E_ALLOWED_DB_HOST` **and** `E2E_CONFIRM_PRODUCTION=yes`. There is no `supabase/` project config in the repo. | E2 "disposable Postgres" cannot be implemented with a bare Postgres service container. The faithful, credential-free implementation is the **Supabase local stack** (`supabase start`, Docker on the runner), plus a CI-only guard mode that keeps the production acknowledgement intact for any real-project run. |
| 10-29 | `vitest.config.ts` has **no coverage block**, and `@vitest/coverage-v8` is not installed (vitest 3.2.7). | I-63 must add the matching coverage provider as a dev dependency — the only sanctioned dependency addition in this mission. |
| 10-29 | `playwright.config.ts` runs `workers: 1` and `retries: 0` because the suite is stateful against a shared fixture. | The CI job must preserve serial execution; do not raise workers to make it "faster". |

## Findings filed as issues

| Issue | Finding | Origin |
|---|---|---|
| #316 | Header `LAST SYNCED` label is hard-coded English | #303 review |
| #317 | E2E guards/docs assume a production Supabase project; a CI-only local mode is needed | ISO audit → I-63 |
| #318 | Other `targetHarvestWeightG` writers bypass the Replace/Keep guard | #304 follow-up |
| #319 | Pre-mirror growth targets need a one-off backfill | #304 follow-up |
| #320 | `DeviceDailyCapForm` not migrated to the shared calibration field | #307 |
| #321 | Superadmin step-up dialog has no dark palette | #309 scope decision |
| #322 | Historical JSON exports omit `auth.users`, so a restore leaves orphan `User` rows | I-65 governance review |
| #323 | Repository deployment docs and agent deployment governance disagree about `staging` | I-65 governance review |
| #324 | `docs/legal/README.md` version snapshot is stale (1.11.0 vs 1.29.0) | I-65 governance review |
| #325 | Privacy Policy commits to backups, but no backup configuration has ever been verified | I-65 governance review |
| #326 | `CODEOWNERS` uses an inferred, unverified handle | I-65 governance review |
| #327 | Tagalog catalogue is 9% complete (307/3,320) and the parity gate ignores it | ISO i18n measurement |
| #328 | Dev-only criticals remain via vitest 3; the fix is a vitest 4 major | I-62 triage |

The dependency allowlist review is filed once I-62 lands and the surviving entries are known.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Dependency overrides break the build | Only criticals and reachable highs; full gate after each override batch; revert any override that does not build |
| E2E job is flaky or needs production-like data | Disposable Postgres + migrate + seed; failures iterated on the PR, never marked as passing |
| Additive migration surprises production | Additive-only review, backup precondition recorded in the release PR, no `DROP`/`RENAME` |
| Error table grows unbounded | Retention policy + index plan in I-64; scrubbing of tokens/emails before write |
| Scope creep into performance/a11y | Explicitly out of scope; recorded as follow-ups, not silently included |

## Discussion log

| When (local) | Topic | What was agreed or done |
|---|---|---|
| 10-29 | Assessment | Repo scanned (1,014 files, ~127k LOC, 241 test files, 38 migrations). Graded C+ overall with Security C- as the anchor. |
| 10-29 | Owner decisions | E1 first-party error capture, E2 disposable Postgres E2E, E3 patch criticals + gate, E4 no production restore by agents. |
| 10-29 | Mission opened | This plan committed before any worker started, per the owner's instruction. Worktrees and branches cut from `origin/develop` `8eb6ce4`. |
| 10-29 | Bar raised | Owner requires **A** on every characteristic. The mission was restructured from 4 to 11 workstreams with measurable A-level exit criteria, and performance/usability moved from "out of scope" to in scope. |
| 10-29 | E5 adopted | Every audit finding becomes a tracked issue. Six already filed (#316–#321), five more from the I-65 governance review (#322–#326). |
| 10-29 | I-65 delivered | `mission/I-65-governance` @ `810bf9b`, 5 docs-only files, merged as `8e51d75`. `SECURITY.md`, `CODEOWNERS`, `backup-and-recovery.md` (RPO/RTO **24 h/24 h** with rationale and sub-targets), `restore-drill-record.md`, and a softened PITR claim in `docs/runbook.md`. Retention: backups 30 days, `ErrorEvent` 30 days — to be reconciled with I-64's implementation when it lands. |
| 10-29 | I-65 findings | Five defects filed rather than fixed in scope: stale legal version snapshot (#324), unverified backup commitment behind the Privacy Policy (#325), JSON exports omitting `auth.users` (#322), inferred CODEOWNERS handle (#326), and the staging-deployment policy conflict (#323). |
| 10-29 | I-64 delivered | `mission/I-64-error-capture` @ `9d19f09`, merged as `568b012`. Additive migration `20261029010000_add_error_events` — verified statement by statement: `CREATE TYPE`, `CREATE TABLE`, three `CREATE INDEX`, no `DROP`/`ALTER`/`RENAME`/`DELETE`. `reportError` persists with a sha256 fingerprint upsert (count increment, reopening resolved rows), never awaits and never throws, and scrubs headers, bearer tokens, JWTs, Supabase keys and e-mails **before** truncation so tokens cannot reach the log drain either. Admin console at `/superadmin/operations/errors` behind `requirePlatformAdmin()`, resolve writes a `PlatformAuditLog` row. Retention `ERROR_EVENT_RETENTION_DAYS = 30`, swept by the existing `device-watch` cron — matches the I-65 policy doc. Checks: 84 focused tests, biome clean, `tsc` exit 0, `prisma validate` valid. |
| 10-29 | i18n measured | `en` 3,320 keys, `hil` 3,301, `tl` 307. Tagalog is ~9% complete and the parity gate only covers en↔hil, so CI cannot see it. Filed as #327 with the three honest options (translate, declare beta, or remove). This directly constrains the A-level usability criterion. |
| 10-29 | I-62 delivered | `mission/I-62-supply-chain` @ `ba5a0a7`, merged as `ca9be76`. **Production audit 93 → 1** (independently re-run by the lead: 0 critical, 1 high allowlisted, 0 moderate/low; gate exits 0; production packages 606 → 357). Root cause of most findings was `shadcn` being a **runtime** dependency: it is a code-generation CLI, nothing imports its JS, so it was moved to `devDependencies` — a classification fix, not a suppression. Targeted `pnpm.overrides` (dompurify, proxy-addr, browserslist, source-map-js, baseline-browser-mapping) each stay inside the parent's declared range; `zod` bumped `^4.4.3 → ^4.6.6`. New `scripts/security/audit-gate.mjs` (fails on unallowlisted crit/high, expired/malformed/>90-day entries, exit 2 when the audit cannot run), `security.yml`, `dependabot.yml`, `docs/security/supply-chain.md`. Checks: lint 815 files, typecheck, **2,481 tests**, build, api:check 56/56, gate PASS. |
| 10-29 | I-62 residual | The full (non-`--prod`) tree still has 2 criticals and ~40 highs through the vitest/vite toolchain. Dev-only, never shipped, fix is a vitest 4 major. Filed as #328 rather than forced. |
| 10-29 | Wave 2 dispatched | I-63 (coverage + E2E on a local Supabase stack), I-68 (axe-core a11y, keyboard flows, en↔hil parity), I-69 (SBOM, gitleaks, CSP review, threat model, incident response). |
