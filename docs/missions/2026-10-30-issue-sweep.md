# Mission 2026-10-30: open-issue sweep, reconciliation and promotion

Owner: Jeff. Lead / integrator: OpenCode.
Base at start of the final consolidation: `origin/develop` @ `7d0a653` (v1.31.3).
Consolidation branch: `integration/final-sweep`.

This document is the single source of truth for the sweep. It records what was fixed, what was closed by
decision, and what remains open.

## Objective

1. Resolve or close every open issue with evidence.
2. Merge every open PR.
3. Reconcile into `develop`.
4. Promote `staging` and `main` on the owner's instruction.

## Decisions applied (owner, 2026-10-29/30)

| Issue | Decision |
|---|---|
| #325 | Supabase provider backups are **not** relied on. Superseded by #353 (admin/superadmin SQL export). |
| #326 | `@Karlcalimotan` confirmed as a real contributor; `CODEOWNERS` handle valid. |
| #344 | Pakoy performs everything the caller is permitted to do, with the same guards; step-up surfaced, never bypassed. |
| #319 | Pre-mirror growth targets are left **self-healing** (align on next save or Replace). No data backfill. |
| #327 | Tagalog remains a reported gap pending a translation decision; parity gate covers `en`↔`hil`. |
| #328 | Dev-only advisories accepted for now; a vitest 4 major is a separate, dedicated PR. |
| #322 | Exports omitting `auth.users` documented as a re-link procedure; identity inclusion is part of #353. |
| #323 | Repository deployment policy (`staging` + `main`) is authoritative; the governance conflict is recorded. |

## Fixed and shipped in this sweep

| Issue | Fix | Version |
|---|---|---|
| #316 | Header `LAST SYNCED` translated with ICU plurals; device status via catalogue | 1.30.2 |
| #320 | `DeviceDailyCapForm` on the shared calibration field | 1.30.2 |
| #345 | Account dropdown contrast + Account settings link | 1.30.2 |
| #347 | ABW/FCR explained via `TermInfo` (hover **and** keyboard focus) | 1.31.1 |
| #348 | Calendar names tasks as tasks, events as events | 1.31.1 |
| #351 | Admin settings rebuilt on one structure; axe-clean | 1.31.1 |
| #344 | Pakoy's full permitted write surface, 21 actions, same guards | 1.31.2 |
| #329 | Audit client IP from the trusted edge hop only | 1.31.5 |
| #330 | Device rate limit after token verification | 1.31.5 |
| #331 | Platform reveal limiter + step-up on role change | 1.31.5 |
| #364 | `firmware/check` rate limit after verification | 1.31.5 |
| #335 | Platform display-name validation | 1.31.5 |
| #324 | Legal README version snapshot corrected | 1.31.5 |

## Closed by decision (no code change)

| Issue | Reason |
|---|---|
| #325 | Superseded by #353 |
| #326 | Handle confirmed by the owner |

## Still open

| Issue | Why it is still open |
|---|---|
| #334 | TOCTOU in `disablePlatformUser`; needs a transactional count+update |
| #336 | Guard redirects flattened into generic errors |
| #332 | CI auth check asserts an import, not a guarded handler |
| #337 | Four exports used only by their own tests; wire or delete |
| #338 / #339 | Missing indexes + N+1; needs an additive migration and an EXPLAIN check |
| #318 | Other `targetHarvestWeightG` writers bypass the Replace/Keep guard |
| #321 | Step-up dialog has no dark palette |
| #353 | Admin/superadmin SQL export (feature) |
| #327 / #328 / #319 / #322 / #323 | Decisions recorded above; work is either deferred by decision or tracked downstream |
| #365 / #370 / #371 | Filed after the sweep began; not yet triaged |

## Verification used

- Per-PR: focused `vitest`, `biome check`, `tsc --noEmit`.
- Per-PR CI: `quality` (lint, typecheck, coverage ≥90/94.5, tests, build), `e2e` on a disposable Supabase stack,
  cross-browser smoke, SBOM, gitleaks, audit gate, dead-code, complexity, perf budgets.
- Known CI quirk: the `Performance` job can report **CANCELLED** because its concurrency group cancels the
  previous run for the same ref. A cancelled perf job is not evidence of a regression; the required gate is
  `quality`.

## Notes

- Merges target `develop`, which is **not** the repository's default branch (`staging`), so GitHub does not
  auto-close issues from PR bodies. Issues are closed manually with the merge SHA.
- The sub-agent provider hit `Go usage limit exceeded` during wave 4; the remaining fixes were made directly
  by the lead.
