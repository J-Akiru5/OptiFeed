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

## Owner decisions (Jeff, 2026-10-29)

| ID | Decision |
|---|---|
| E1 | **First-party error capture.** No external service. Errors are persisted in our own database and surfaced in an admin view; alerting can reuse the planned Telegram channel later. |
| E2 | **E2E runs against a disposable Postgres service container in CI.** No production or staging credentials ever enter CI. |
| E3 | **Patch criticals and reachable highs, then gate at `high`** with a documented, expiring allowlist for unreachable transitive cases. No broad major-version upgrades. |
| E4 | **No production restore is executed by an agent.** The mission documents RPO/RTO and a runnable drill procedure; executing a restore against Supabase stays an owner action. |

## Workstreams

| ID | Workstream | Branch | Worktree | Depends on | Status |
|---|---|---|---|---|---|
| I-62 | **W1 Supply chain.** Triage the 93 findings, pin `pnpm.overrides`/targeted upgrades for the 2 criticals and reachable highs, add `.github/workflows/security.yml` (`pnpm audit --audit-level=high`) and `.github/dependabot.yml`. No broad majors. | `mission/I-62-supply-chain` | `iso-supply-chain` | — | running |
| I-63 | **W2+W3 Quality gates.** Coverage thresholds ratcheted at the current level (no drop allowed), and a Playwright E2E job in `.github/workflows/ci.yml` backed by a Postgres service container with `prisma migrate deploy` + seed. | `mission/I-63-ci-quality` | `iso-ci` | I-62 (to avoid concurrent heavy installs) | queued |
| I-64 | **W4 Reliability.** Additive `ErrorEvent` model + migration, `reportError()` persistence with dedupe and scrubbing, and an admin/superadmin error view. Additive only. | `mission/I-64-error-capture` | `iso-errors` | — | running |
| I-65 | **W5+W6 Governance.** `SECURITY.md` (disclosure policy), `CODEOWNERS`, RPO/RTO and retention policy, and a restore-drill runbook in `docs/`. | `mission/I-65-governance` | `iso-governance` | — | running |

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

- All four workstreams merged into `develop` through one PR.
- `pnpm audit` gated in CI, with a documented allowlist.
- E2E executing in CI against a disposable database.
- Coverage cannot regress below the recorded baseline.
- Production errors persisted and visible to an administrator.
- `SECURITY.md`, `CODEOWNERS`, RPO/RTO, retention and restore runbook present.
- Plan updated with final evidence; issues/PRs reflect reality; nothing claimed that was not run.

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
