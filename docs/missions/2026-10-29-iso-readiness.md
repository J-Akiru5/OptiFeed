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
| I-63 | **W2+W3 Quality gates.** Coverage thresholds ratcheted at the current level (no drop allowed), and a Playwright E2E job in `.github/workflows/ci.yml` backed by a **local Supabase stack** (`supabase start`: Postgres + Auth + storage) with `prisma migrate deploy` + `scripts/e2e/seed-e2e.ts`. A plain Postgres service container is **not sufficient** — see discovery below. | `mission/I-63-ci-quality` | `iso-ci` | I-62 | merged @ `4284b22` (`c9330a6`) |
| I-64 | **W4 Reliability.** Additive `ErrorEvent` model + migration, `reportError()` persistence with dedupe and scrubbing, and an admin/superadmin error view. Additive only. | `mission/I-64-error-capture` | `iso-errors` | — | merged @ `568b012` (`9d19f09`) |
| I-65 | **W5+W6 Governance.** `SECURITY.md` (disclosure policy), `CODEOWNERS`, RPO/RTO and retention policy, and a restore-drill runbook in `docs/`. | `mission/I-65-governance` | `iso-governance` | — | merged @ `8e51d75` (`810bf9b`) |
| I-66 | **W7 Performance.** Bundle-size budget in CI, Lighthouse CI budgets on key pages, API latency baseline (p50/p95) with a regression gate, and an index/EXPLAIN audit of the heaviest queries. | `mission/I-66-performance` | `iso-perf` | I-62 | merged @ `310f360` (`f350210`) |
| I-67 | **W8 Compatibility.** Playwright smoke on Chromium + Firefox + WebKit, responsive assertions, supported-browser matrix. | `mission/I-67-compatibility` | `iso-compat` | I-63 | running |
| I-68 | **W9 Usability/a11y.** axe-core on key pages with zero serious/critical enforced, keyboard tests for primary flows, i18n key parity. | `mission/I-68-a11y` | `iso-a11y` | - | merged @ `7f8c47b` (`66752db`) |
| I-69 | **W10 Security depth.** CycloneDX SBOM in CI, secret scanning (gitleaks), threat model, incident-response plan, CSP enforcement review. | `mission/I-69-security-depth` | `iso-security` | I-62 | queued |
| I-70 | **W11 Portability.** Multi-stage Dockerfile, compose for local, environment matrix, removal of hard-coded production hosts. | `mission/I-70-portability` | `iso-portability` | - | merged @ `d4d5378` (`1e84ba5`) |
| I-71 | **W12 Reliability drill.** SLOs, readiness probe, and an **executed** restore drill against a disposable database with a written record. | `mission/I-71-reliability-drill` | `iso-drill` | I-64, I-65 | queued |
| I-72 | **W13 Maintainability.** Dead-code (knip) and complexity budgets, ADR index, operational docs index. | `mission/I-72-maintainability` | `iso-maint` | — | queued |
| I-73 | **Coverage campaign A.** Behaviour tests for `assistant/catalog`, `assistant/turn-context` (0%) and `jobs/service` (31.5%). | `mission/I-73-coverage-assistant` | `iso-cov-a` | I-63 | merged @ `5fe967c` (`99eda28`) |
| I-74 | **Coverage campaign B.** Behaviour tests for `growth-plan-apply` (2.9%), `actions/biomass`, `crop-cycle/reminders`. | `mission/I-74-coverage-growth` | `iso-cov-b` | I-63 | merged @ `e0212c6` (`19ded8a`) |
| I-75 | **Coverage campaign C.** Behaviour tests for `actions/admin`, `membership-invite` (10.1%), `actions/superadmin`, `actions/settings`, with allow+deny on every guard touched. | `mission/I-75-coverage-actions` | `iso-cov-c` | I-63 | merged @ `ebdcb8f` (`87c5f91`) |
| I-76 | **Coverage campaign D (final).** Close the remaining gap to 90% lines: loader, prediction, export/import jobs, platform actions, offline outbox. Needs ≥550 of the 2,998 uncovered lines. | `mission/I-76-coverage-final` | `iso-cov-d` | I-75 | running |

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
| #329 | `PlatformAuditLog` IP spoofable via left-most `X-Forwarded-For` (A1) | I-69 authz review |
| #330 | Device rate-limit bucket consumed by unverified `device_id` — 429 DoS (A2) | I-69 authz review |
| #331 | Platform token reveal + legacy role change lack tenant step-up/rate limits (A3/A4) | I-69 authz review |
| #332 | CI API-auth check asserts an import, not handler guarding (A5) | I-69 authz review |

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
| 10-29 | I-69 delivered | `mission/I-69-security-depth` @ `ad0f787`, merged as `84816e4`. 7 files, zero application code. SBOM via checksum-pinned syft (chosen over `@cyclonedx/cyclonedx-npm`, which is npm-only, and cdxgen, which needs Node ≥24 while the repo pins 22); gitleaks on the tree and 100 commits with a 3-entry allowlist, each justified; full 609-commit history yields 11 findings, all verified placeholders. `object-src 'none'` **applied by the lead** with a test, since no `<object>/<embed>` exists in the app. Threat model, incident-response plan and authz review added. |
| 10-29 | I-69 authz findings | No route or action is missing a guard, but five defects in *how* controls apply were filed instead of silently patched: spoofable audit IP (#329), pre-auth rate-limit bucket (#330), platform step-up/rate-limit gaps (#331), and a CI check that verifies an import rather than a guarded handler (#332). |
| 10-29 | I-63 delivered | `mission/I-63-ci-quality` @ `c9330a6`, merged as `4284b22` after a lockfile conflict with I-62 was resolved by regenerating from the merged manifests (both the overrides and the coverage toolchain are present; audit gate re-verified PASS). **Coverage measured for the first time: 80.92% lines / 78.78% branches / 89.25% functions.** Threshold set at the measured floor (80.9 / 78.5 / 89.0) with a ratchet note — **not** lowered to hide the gap and **not** set to 90, which would fail every PR today. Gap to the A bar: **2,228 lines**, with 13 files at 0%. |
| 10-29 | E2E job unverified by design | The `e2e` job (Supabase CLI 2.121.0, `supabase start`, migrate, seed, Playwright, `next build` + `/api/health` wait) is written but **could not run locally — this machine has no Docker**. The guard split is tested (17 tests: local loopback accepted only with `E2E_ALLOW_LOCAL_STACK=yes`; any remote host still requires the allowlist **and** `E2E_CONFIRM_PRODUCTION=yes`). Draft PR **#333** was opened specifically so the first real execution happens in CI instead of being claimed. |
| 10-29 | Coverage campaign | Split three ways by module area (I-73 assistant/jobs, I-74 growth/cycles, I-75 admin actions) with an explicit instruction to write behaviour-based tests only — no assertion-free execution to move a number — and to report untestable modules rather than refactor them. |
| 10-29 | I-68 delivered | `mission/I-68-a11y` @ `66752db`, merged as `7f8b47b`. axe-core 4.14 with the **whole default rule set** (no rule disabled) over login, dashboard shell, growth card, hardware page, chat widget and admin devices: **0 violations of any impact**. Found and fixed two real defects — a **serious** `list` violation (`<span>` inside `<ul>` in chat markdown) and a **critical** `aria-allowed-attr` (`aria-pressed` on a link). Plus `<label>` on the chat composer, `inert` on collapsed chat surfaces, Escape-to-close with focus return, and 4 keyboard-flow suites. Hiligaynon parity closed (19 sticker keys) with an `en`↔`hil` key-set + placeholder test; Tagalog left untouched pending #327, and the parity test now prints its 9.3% status on every run. |
| 10-29 | I-70 delivered | `mission/I-70-portability` @ `1e84ba5`, merged as `d4d5378`. Multi-stage Dockerfile, `.dockerignore`, compose, `docs/operations/environment-matrix.md`, and hard-coded `https://pakaonai.syntaxure.dev` replaced by an env-driven `NEXT_PUBLIC_SITE_URL` defaulting to the current value (10 tests). **The image has never been built — Docker is not installed here**, and `output: "standalone"` was deliberately not adopted to avoid changing the Vercel build. |
| 10-29 | CI proven, bugs found | Draft PR **#333** gave the new jobs their first execution. `audit` passed; `SBOM` and `gitleaks` both failed on real defects the workers could not see locally: the downloads were saved as `syft.tar.gz`/`gitleaks.tar.gz` while the checksum files name the versioned files, and the gitleaks allowlist did not cover the scrubber's fake-token fixtures (then used a rule ID that does not exist). All fixed; **audit, SBOM and gitleaks are now green**, quality still running. |
| 10-29 | I-73 + I-74 delivered | Coverage campaign A (`99eda28`, 121 tests over turn-context, catalog contracts and the job worker) and B (`19ded8a`, 90 tests over growth-plan-apply, biomass and reminders) merged. A reported defect was verified and fixed by the lead: `getAssistantActionDefinition` used a plain record lookup, so prototype keys returned a function instead of `null`; now `Object.hasOwn`-guarded with a regression test. |
| 10-29 | I-75 delivered | `mission/I-75-coverage-actions` @ `87c5f91`, merged as `ebdcb8f`. **286 tests** over 6 new files, including a runtime matrix over all 22 `admin.ts` exports and 98 gate tests over all 13 `superadmin.ts` exports: tenant guard, per-permission guards, platform admin (denied/revoked/expired/active), write access, step-up, reason length, self/last-admin protection and tenant scoping — each with allow **and** deny. |
| 10-29 | Coverage re-measured | After four campaigns: **87.97% lines** (80.92% at mission start), 83.18% branches, 93.5% functions. 2,998 lines remain uncovered; the 90% bar allows ~2,455, so **≥543 more lines** are needed. I-76 dispatched against the measured top-14 list rather than a guess. |
| 10-29 | I-75 findings filed | Three source defects raised instead of fixed inside a test task: a **medium TOCTOU** in `disablePlatformUser` that could ban the last two platform admins (#334), unvalidated display names in `updatePlatformUser` (#335), and authorization redirects flattened into generic errors (#336). |
| 10-29 | I-72 delivered | `mission/I-72-maintainability` @ `4c89488`, merged as `50d9153`. Knip 6.43 driven to **0 unused files / 0 unused dependencies / 0 unused exports / 0 unused types**: four dead files deleted, three dependencies removed, 30 exports and 38 re-exports narrowed, each suppression justified in `knip.jsonc`. Purpose-built complexity script over the TS compiler API (no second linter): 1,073 functions measured, budget function ≤ 100 / file ≤ 180 set just above today's worst. Six backfilled ADRs and an operations index that marks what is **unverified**. |
| 10-29 | I-76 delivered | `mission/I-76-coverage-final` @ `335c92f`, merged as `af902f4`. 236 behaviour tests across all 14 target modules. |
| 10-29 | Integration conflict resolved honestly | I-72 had narrowed four exports that I-75/I-76 tests import. Rather than blanket-reverting, the lead checked each: all four (`getSuperadminStats`, `getPlatformAdmins`, `loadPondProposalSettings`, `createDemoNotification`) have **no production call site**, so the exports were restored to keep the suite meaningful and their deletion filed as **#337**. The outbox case was resolved properly — the test now uses the canonical `removeOutboxItem` instead of the removed alias. |
| 10-29 | **A-level coverage met** | Final measured coverage after five campaigns: **92.42% lines / 92.42% statements / 94.85% functions / 84.95% branches**, up from 80.92% at mission start. The gate was raised from the old floor to **90 / 90 / 94.5 / 84.5**, so the A target is now enforced rather than merely achieved. |
| 10-29 | I-66 delivered | `mission/I-66-performance` @ `f350210`, merged as `310f360`. **Bundle sizes measured for all 56 routes** and validated byte-for-byte against a live `next start` (798.2 / 845.5 / 586.9 kB on the public pages; `/en/dashboard` worst at 1455.4 kB), budgets +2%, gate fails on regression and exits 2 on a missing build. **Lighthouse actually ran** (Chrome 156, 2 sessions × 3 runs × 4 URLs): a11y 0.90–0.94, best-practices 0.86–0.90, SEO 0.95, numeric budgets (LCP ≤ 5 s, CLS ≤ 0.02, script ≤ 285 kB, zero third-party requests). Latency measured with 100 samples/endpoint after warm-up; only stable endpoints gated, page renders deliberately left as evidence because they swung 43→119 ms under host load. Query audit is explicitly `[static]`/`[inferred]`, with EXPLAIN deferred until a database exists. |
| 10-29 | I-66 findings filed | Two index findings raised: no `(eventType, receivedAt)` index for the platform aggregate and the retention sweep — whose comment wrongly claims one exists (#338) — and no `pondId` index on `EnergyDevice` plus an N+1 in `markAllNotificationsRead` (#339). |
| 10-29 | I-67 dispatched | Cross-browser smoke on Chromium/Firefox/WebKit for the public pages, responsive assertions at three widths, and a supported matrix. The authenticated suite deliberately stays on Chromium only, to avoid tripling CI time. |
