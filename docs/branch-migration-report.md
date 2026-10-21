# Branch Migration and Repository Baseline Report

Date: 2026-10-21
Repository: `J-Akiru5/OptiFeed`
Performed by: engineering agent, on branch `chore/git-workflow-migration`
(worktree `S:\Dev\Capstone\optifeed-worktrees\git-workflow-migration`).

This document records the pre-change state, the evidence behind each
conclusion, the migration decisions, and what was changed. It is the audit
trail for the two-developer workflow migration.

---

## 1. Repository state before the migration

| Item | Value |
| --- | --- |
| GitHub default branch | `develop` (verified: `git ls-remote --symref origin HEAD` → `ref: refs/heads/develop HEAD`, and GitHub API `defaultBranchRef.name = develop`) |
| Local checkout | `main`, clean except one untracked file `docs/roadmap.html` (preserved, untouched) |
| Remote | `https://github.com/J-Akiru5/OptiFeed.git` |
| Local worktrees | `S:/Dev/Capstone/optifeed` (`main`), `S:/Dev/optifeed/optifeed-build-deployment-9a4973` (detached, clean) |
| Tags | `v1.0.0` (annotated, commit `e33ed71`) |
| Open PRs | #45 `docs/superadmin-multitenancy-plan` → `develop` (docs only, 2 files, mergeable) |

### Branch tips

| Branch | Tip | Date |
| --- | --- | --- |
| `develop` | `5f82a25` Merge PR #47 | 2026-10-19 |
| `main` | `2795bef` Merge PR #43 | 2026-10-14 |
| `staging` | `58b959b` Merge PR #19 | 2026-07-12 |
| `Karl` | `d366ca4` | 2026-10-18 |
| `audit/phase-1-critical` | `df84b53` | 2026-10-19 |
| `docs/superadmin-multitenancy-plan` | `4903618` | 2026-10-16 |
| `fix/schedule-pause-energy-device` | `124c7dd` | — |

## 2. Ancestry and divergence — verified

```
git merge-base origin/develop origin/staging   -> 58b959b   (= staging tip)
git merge-base origin/staging origin/main      -> 58b959b   (= staging tip)
git merge-base origin/main origin/develop      -> e47bcc0
```

| Comparison | Left-only | Right-only | Meaning |
| --- | --- | --- | --- |
| `develop...staging` | 98 | **0** | `staging` is a strict ancestor of `develop`; **zero unique staging commits** |
| `staging...main` | 0 | 99 | `main` contains all of `staging` |
| `main...develop` | 1 | 12 | `main`'s only unique commit is merge commit `2795bef` |

`git diff --stat e47bcc0 origin/main` is **empty**, so the tree of `main` is
identical to `develop` at the point it was promoted. `main` therefore contains
no content that is absent from `develop`.

Conclusion: the three branches have not genuinely diverged. `staging` is stale
(98 commits / 3 months behind), `main` is a clean earlier promotion of
`develop`, and promoting `develop` forward loses no work in either direction.

### Unique work outside the three main branches

| Branch | Unique commits | Status |
| --- | --- | --- |
| `Karl` | 0 | Fully merged into `develop`; stale, safe to keep as history |
| `fix/schedule-pause-energy-device` | 0 | Fully merged |
| `audit/phase-1-critical` | 9 | **Unmerged security work** (F-001, F-002, F-003, F-004, F-005, F-013, F-014, F-025, F-031) — must be reviewed, not discarded |
| `docs/superadmin-multitenancy-plan` | 2 | Open PR #45 |

No branch was deleted, renamed, or reset during this migration.

## 3. CI before the migration

Single workflow `.github/workflows/ci.yml`:

- `push` to `Karl` and `develop`; `pull_request` targeting `develop`.
- Steps: pnpm install, Prisma generate, Biome lint, typecheck, unit tests,
  API-route auth gate, `next build` with dummy database credentials.
- No deploy job. `deploy.yml` was deleted in commit `b1fc763`; it had used a
  `VERCEL_TOKEN` secret and duplicated the Vercel integration.

Gaps: no validation for PRs into `staging`/`main`, no validation of `main`
pushes, no concurrency control, no `permissions` declaration, no Prisma schema
validation.

## 4. Deployment mechanisms before the migration

There is one deployment path: the Vercel Git integration.

| Property | Value |
| --- | --- |
| Project | `opti-feed-web` (`prj_yEDONYNBLSlRauAZtTDL4xNkAJTA`) |
| Linked repo | `J-Akiru5/OptiFeed` |
| Production branch | `main` |
| Root directory | `apps/web` |
| Framework | Next.js |
| Deploy hooks | none |
| `createDeployments` | `enabled` |
| Git fork protection | enabled |
| Environments | `Preview`, `Production` (no protection rules) |
| Branch protection / rulesets | **none** on any branch |
| `vercel.json` before this change | **did not exist** |

Deployment history at audit time: 86 GitHub deployment records — 77 `Preview`
and 9 `Production`. Previews were created for every pushed branch (including
`audit/phase-1-critical`), which is both deployment-quota consumption and a
safety problem (see §5).

Build command came from `apps/web/package.json`:
`prisma generate && prisma migrate deploy && next build`.

## 5. Risks identified

| # | Severity | Risk |
| --- | --- | --- |
| R1 | Critical | Preview and production share the same `DATABASE_URL`, `DIRECT_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Every preview build and preview app had production database access. |
| R2 | Critical | `prisma migrate deploy` ran in **every** Vercel build, so a feature-branch preview could migrate the production schema before any review or merge. |
| R3 | High | No branch protection anywhere: direct pushes to `develop`, `staging`, `main` are possible and no checks are required. |
| R4 | High | `staging` is 98 commits behind and has never received the current application; making it the default branch before reconciliation would present three-month-old code as the project state. |
| R5 | Medium | CI did not validate PRs into `staging`/`main`, and `push` to `main`/`staging` was unvalidated. |
| R6 | Medium | `HANDOFF.md` documents a retired workflow (shared `Karl` branch, PR into `develop`, "protected" branches that were not protected) and a task list that is already complete. |
| R7 | Medium | Three repository secrets (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) remain configured although no workflow references them. |
| R8 | Low | `scripts/self-check.mjs` asserted the current branch is `Karl`, which hard-fails the check on any other branch. |

Note on R1/R2: two migrations exist on `develop` but not on `main`
(`20261017000000_add_platform_admin`, `20261017010000_bootstrap_tenant_orgs`).
Given R2, they were most likely already applied to the production database by
a preview build before reaching `main`. That is an inference from configuration
and deployment records; no production database was queried during this audit,
and none should be.

## 6. Migration decisions

| Decision | Rationale |
| --- | --- |
| Reconcile by promoting `develop` forward, never by resetting | `staging` is an ancestor and `main`'s tree is contained in `develop`; forward promotion loses nothing. Resets would still be destructive and unnecessary. |
| `staging` deploys, `develop` does not | `develop` is a reconciliation branch, not a releasable artifact; `staging` is the release candidate. |
| Disable preview deployments for work branches | They currently inherit production credentials and are not a safe review surface. CI still validates every PR. Re-enable only with isolated Preview credentials. |
| Gate migrations on `VERCEL_ENV=production` | Preserves the existing "migrations ship with the production deployment" mechanism while stopping staging/preview builds from mutating a shared schema. |
| Change the default branch only after the staging promotion and CI verification | Avoids presenting a three-month-old branch as the repository's current state. |
| Do not touch `main` | Production promotion requires Jeff's explicit approval; no production deployment was performed. |

### Deployment-scope decision

Jeff explicitly chose (2026-10-21) to enable both `staging` and `main` now,
accepting that the staging deployment uses the production database until a
separate staging Supabase project and Preview-scoped environment variables
exist. This is recorded as an open blocker in
`docs/deployment-workflow.md` §6; staging must be treated as read-only until it
is fixed.

## 7. Changes made

See section 8 for the commit list. Summary:

- `.github/workflows/ci.yml` — validation for `develop`, `staging`, `main`
  (push and PR); added `permissions`, concurrency, Prisma schema validation,
  job timeout; no deployment.
- `apps/web/vercel.json` — new; restricts Vercel deployments to `staging` and
  `main`.
- `apps/web/scripts/migrate-if-production.mjs` — new; migrations only when
  `VERCEL_ENV=production`.
- `apps/web/package.json` — build script now calls the migration guard.
- `CONTRIBUTING.md` — new; the authoritative two-developer workflow.
- `docs/deployment-workflow.md` — new; branch/deployment contract, release
  procedure, environment isolation blocker, verification record.
- `HANDOFF.md` — rewritten for the new workflow, keeping the database warning
  and application-specific guidance.
- `docs/vercel-deployment-checklist.md` — corrected Git integration section and
  added deployment restrictions.
- `README.md` — branch workflow section.
- `.github/pull_request_template.md` — new; PR requirements.
- `scripts/self-check.mjs` — branch check no longer requires `Karl`; added
  deployment-policy and CI-never-deploys checks.

## 8. Commit and verification record

Migration branch: `chore/git-workflow-migration`, merged through PR #50 into
`develop`.

| Commit | Change |
| --- | --- |
| `cbecf37` | `fix(build)`: Prisma migrations gated on `VERCEL_ENV=production` |
| `fdde468` | `ci`: validation for develop/staging/main, deployment-free |
| `57c3f2a` | `ci(vercel)`: deployments limited to staging/main |
| `fafe5f1` | `docs`: workflow, deployment contract, migration report, handoff |
| `c33e6b8` | `chore`: LF checkout normalisation and self-check updates |

| Step | Evidence | Result |
| --- | --- | --- |
| PR #50 `quality` check | Actions run 39536899545 | Pass, 1m7s |
| Local lint / typecheck / test | `biome check` 225 files; `tsc --noEmit`; Vitest | Pass — 31 files, 258 tests |
| Local production build | `pnpm build`, dummy env | Pass; log shows `[migrate] skipped (VERCEL_ENV=unset)` |
| Migration guard, preview context | `VERCEL_ENV=preview` | Skips, exit 0 |
| Migration guard, production context | `VERCEL_ENV=production`, unreachable dummy DB | Attempts migration, exits 1 (fail closed) |
| Merge to `develop` | tip `527b599`; CI run 39537076187 | Pass |
| Deployment for `develop@527b599` | Vercel deployment list after the merge | **None created** — restriction active |
| Promotion PR | #51, `quality` check | Pass |
| `staging` tip | `de5f5cc` (merge of #51) | 0 commits ahead of `develop` in content |
| Staging deployment | `dpl_FjPcvTakvD84kjR4qo7xCuRxFCMQ`, ref `staging` | `READY` |
| Staging build log | deployment events | `[migrate] skipped (VERCEL_ENV=preview)` |
| `staging` push CI | Actions run 39538117781 | Pass |
| Default branch | GitHub API and `git ls-remote --symref origin HEAD` | `staging` |
| Production promotion | — | **Not performed**; requires Jeff |

### Protection state (verified through the GitHub API)

| Branch | PR required | Approvals | Required check | Force push | Deletion | Enforce admins |
| --- | --- | --- | --- | --- | --- | --- |
| `develop` | Yes | 0 | `quality` | Blocked | Blocked | Yes |
| `staging` | Yes | 0 | `quality` | Blocked | Blocked | Yes |
| `main` | Yes | 1 | `quality` | Blocked | Blocked | Yes |

### Branch created during the migration

`origin/xtra` was pushed on 2026-10-21 from `develop@5f82a25` with one commit
(`09c5868`, biomass UI work), while this migration was in progress. It was not
created, modified, merged, or deleted here. Because it predates
`apps/web/vercel.json`, its preview deployment was still created; it becomes
subject to the restriction as soon as it merges or rebases onto a `develop`
that contains the configuration.
