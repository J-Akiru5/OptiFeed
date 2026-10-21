# OptiFeed — Branch, CI and Deployment Workflow

Last verified: 2026-10-21.

This document is the operational contract for how code reaches staging and
production. `CONTRIBUTING.md` covers the day-to-day developer workflow; this
document covers the pipeline itself, what is verified, and what is still
blocked on manual action.

---

## 1. Branch and deployment matrix

| Branch | Role | CI validation | Application deployment | Database migrations |
| --- | --- | --- | --- | --- |
| `feature/*`, `fix/*`, `refactor/*`, `docs/*`, `audit/*`, `chore/*` | One task, one developer | PR checks | **No** | No |
| `develop` | Shared integration / reconciliation | Push + PR checks | **No** | No |
| `staging` | Default branch, release candidate, staging validation | Push + PR checks | **Yes — staging** | No (production schema only) |
| `main` | Production source of truth | Push + PR checks | **Yes — production** | **Yes** — production deploy only |

```
feature/* ──PR──▶ develop ──PR──▶ staging ──PR + Jeff──▶ main
                     │              │                     │
               validate only   staging deploy      production deploy
```

- `develop` is deliberately **not** a deployment branch: it is the place where
  two independent work streams are reconciled, so it is not a releasable
  artifact.
- `staging` is the default branch on GitHub, so a new contributor lands on the
  release candidate rather than on in-flight integration work.
- `main` is production and is only ever advanced by a reviewed promotion.

## 2. What actually triggers a deployment

There is exactly one deployment mechanism: **the Vercel Git integration**.

- Vercel project: `opti-feed-web` (`prj_yEDONYNBLSlRauAZtTDL4xNkAJTA`).
- Linked repository: `J-Akiru5/OptiFeed`.
- Root directory: `apps/web`.
- Production branch: `main`.
- Deploy hooks: none.
- GitHub Actions deploy workflow: none (the original `deploy.yml` was removed
  in commit `b1fc763`; CI never deploys).

Deployment eligibility is restricted in `apps/web/vercel.json`:

```json
{
	"git": {
		"deploymentEnabled": {
			"*": false,
			"**": false,
			"main": true,
			"staging": true
		}
	}
}
```

`*` and `**` are both set to `false` because Vercel matches branch names with
minimatch, where `*` does not cross `/`. Without `**`, a branch such as
`audit/phase-1-critical` would still be eligible.

Consequences:

- Pushes to `develop` and to every work branch create **no** Vercel deployment.
- Pull requests from work branches get **no** preview deployment. This is
  intentional: preview deployments currently inherit production credentials
  (section 6), so they are not a safe review surface. Re-enable them only after
  Preview-scoped credentials are isolated.
- Pushes to `staging` and `main` deploy.

Two honest caveats:

1. Vercel applies this configuration from the repository content, so it only
   takes effect for commits that contain `apps/web/vercel.json`. A long-lived
   branch that never merges this change remains deployable.
2. Enforcement is configured statically. The first real proof is the absence of
   a Vercel deployment for the first integration push to `develop` after this
   change lands. See section 10 for the verification record.

## 3. CI validation

Workflow: `.github/workflows/ci.yml`, single job `quality`.

Triggers:

- `push` to `develop`, `staging`, `main`
- `pull_request` targeting `develop`, `staging`, `main`
- manual `workflow_dispatch`

Steps: pnpm install (`--frozen-lockfile`) → Prisma client generation → Prisma
schema validation → Biome lint → TypeScript typecheck → Vitest unit tests →
API-route authentication gate → `next build` with dummy credentials.

Guarantees:

- CI never deploys.
- CI never uses a real database. `DATABASE_URL` and `DIRECT_URL` are dummy
  values; the build calls `next build` directly rather than `pnpm build`, and
  the build script itself now skips migrations unless `VERCEL_ENV=production`.
- CI holds `contents: read` only.
- Pull-request runs are cancelled when superseded; integration and deployment
  branch runs always finish so their result is a trustworthy gate.

Not covered by CI (run manually when relevant): Playwright end-to-end specs
(need a database and a running server), firmware compilation (`firmware/`),
Vercel project configuration.

Required check context: job name `quality` (displayed as `CI / quality` in the
pull-request checks list).

## 4. Migrations during a build

`apps/web/package.json`:

```
prisma generate && node scripts/migrate-if-production.mjs && next build
```

`apps/web/scripts/migrate-if-production.mjs` runs `prisma migrate deploy` **only
when `VERCEL_ENV=production`**, i.e. only for the production deployment of
`main`. Every other context skips:

| Context | `VERCEL_ENV` | Migrations |
| --- | --- | --- |
| `main` deployment | `production` | Applied |
| `staging` deployment | `preview` | Skipped |
| any preview | `preview` | Skipped |
| local `pnpm build` | unset | Skipped |
| GitHub Actions | unset | Skipped |

This preserves the established production release mechanism (a merged
migration reaches production with the production deployment) while stopping
staging and preview builds from mutating the production schema. A failed
production migration fails the deployment instead of shipping an app against an
unmigrated schema.

## 5. Release procedure

### 5.1 Feature → `develop`

1. Branch from the latest `develop`: `git switch -c feature/<task>`.
2. Implement, keeping the branch scoped to one task.
3. Run `pnpm lint && pnpm typecheck && pnpm test`.
4. Push and open a PR **into `develop`** using the PR template.
5. The other developer reviews. Merge only with `quality` green.
6. Delete the branch after merge.

### 5.2 `develop` → `staging` (release candidate)

Preconditions — all of them, not a subset:

- No intended PR is still open against `develop`.
- `git log --oneline origin/staging..origin/develop` contains only intended
  work.
- CI is green on `develop`'s tip.
- Migrations and environment changes are described in the PR.
- The candidate SHA is recorded in the PR body.

```bash
git fetch origin --prune
gh pr create --base staging --head develop \
  --title "release: promote develop to staging" \
  --body "Candidate: <sha> ..."
```

Merge only after the PR's `quality` check passes. The merge to `staging`
triggers the staging deployment. Record the deployed SHA, then run the smoke
test in section 7.

### 5.3 `staging` → `main` (production)

Preconditions:

- Staging deployment of the candidate SHA built successfully.
- Smoke tests pass against staging.
- `git diff origin/main...origin/staging` contains only the intended release.
- A database backup exists if the release contains migrations.
- Jeff approves.

Only Jeff merges this PR. The merge triggers the production deployment and, for
`main` only, `prisma migrate deploy`.

### 5.4 Hotfix

Branch from `main`, PR into `main`, Jeff approves and merges, deploy and verify.
Then open a separate reconciliation PR from that fix branch (or `main`) into
`develop`. Never rely on an automatic back-merge, and never assume `main` and
`staging` are identical after a hotfix.

## 6. Environment isolation — open blocker

The Vercel project has a single set of environment variables scoped to both
`production` and `preview`:

| Variable | Scope today | Intended scope |
| --- | --- | --- |
| `DATABASE_URL` | production + preview | production; separate staging value for preview |
| `DIRECT_URL` | production + preview | production; separate staging value for preview |
| `NEXT_PUBLIC_SUPABASE_URL` | production + preview | production; separate staging value for preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production + preview | production; separate staging value for preview |
| `SUPABASE_SERVICE_ROLE_KEY` | production + preview | production only |
| `DEVICE_TOKEN` | production + preview | production; separate staging value |
| `GEMINI_API_KEY` | production + preview | production; separate staging value |

Consequence: **the staging deployment currently reads and writes the production
database with service-role privileges.** Any data created, edited, or deleted
while smoke-testing staging is production data.

Until this is fixed:

- Treat the staging URL as a read-only preview.
- Do not smoke-test flows that write (log sample, feed now, create user, create
  pond, admin actions).
- Do not point users, demos, or the ESP32 at staging.

Remediation (Jeff, in Vercel and Supabase):

1. Create a separate Supabase project for staging.
2. Apply migrations to it from a trusted machine:
   `DIRECT_URL=<staging direct url> pnpm --filter web exec prisma migrate deploy`.
3. In Vercel → `opti-feed-web` → Settings → Environment Variables, add
   **Preview-only** values for `DATABASE_URL`, `DIRECT_URL`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DEVICE_TOKEN`, `GEMINI_API_KEY`.
4. Keep the existing values scoped to **Production only**.
5. Redeploy `staging` and confirm the app talks to the staging database (check
   a record created in staging does not appear in production).
6. Seed staging data if needed — never copy production data into staging.

Only after step 6 should the staging URL be used for write-path smoke tests.

## 7. Staging smoke test

Run against the staging deployment of the candidate SHA:

- [ ] Login with a staging account; session persists across a refresh.
- [ ] Dashboard loads pond, device status, and next feeding time.
- [ ] Log Sample writes a biomass log and shows the volume preview.
- [ ] Growth/FCR page renders the new log.
- [ ] Schedule pause/resume reflects on the device record.
- [ ] `/api/health` returns a healthy response.
- [ ] No `[obs]` error burst in the Vercel function logs.

Record the results in the promotion PR. A build that deployed is not a smoke
test.

## 8. Rollback

- **Application:** Vercel → Deployments → previous production deployment →
  Instant Rollback. This changes the served build only.
- **Migrations:** rollback does **not** revert schema changes. If a migration
  is the problem, write a forward fix migration; do not hand-edit the
  production schema or restore a backup without Jeff's explicit decision.
- **Staging:** promote the previous known-good SHA or roll back the deployment,
  then fix forward on `develop`.

## 9. Branch protection

Configured after the branch reconciliation, on `develop`, `staging`, and
`main`:

| Setting | `develop` | `staging` | `main` |
| --- | --- | --- | --- |
| Require pull request | Yes | Yes | Yes |
| Required approvals | 0 (author may merge with green CI) | 0 | 1 |
| Dismiss stale approvals | — | — | Yes |
| Require `quality` check | Yes | Yes | Yes |
| Require branch up to date | No | No | No |
| No force pushes | Yes | Yes | Yes |
| No deletions | Yes | Yes | Yes |
| Enforce for admins | Yes | Yes | Yes |

`main` additionally requires one approval and is merged only by Jeff. GitHub
cannot express "Jeff specifically must approve" without a second reviewer, so
the human rule stands: only Jeff merges `main`.

## 10. Verification record

| Claim | Status |
| --- | --- |
| Default branch is `staging` | Verified via GitHub API after the change |
| `develop` no longer deploys | Configured statically; verified against the next integration deployment record |
| `staging` deploys | Verified from the Vercel/GitHub deployment record of the staging merge |
| `main` deploys | Pre-existing behaviour; production branch `main` confirmed in Vercel |
| Production approval gate | Branch protection on `main`; merge performed by Jeff only |
| CI runs on PRs into `develop`/`staging`/`main` | Verified from the GitHub Actions run for this PR |
| Staging uses isolated credentials | **Blocked** — section 6 |
| Production deploy executed | **Not performed** — requires an authorised release |

## 11. Manual actions that remain with Jeff

1. Provision the staging Supabase project and Preview-scoped env vars
   (section 6).
2. Review and merge any promotion into `main`; agents must not do this.
3. Confirm GitHub plan/permissions for required reviewers, if enforcement of a
   second human approval on `main` is required beyond the current settings.
4. Delete the three CI secrets that no workflow uses (`DATABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) if they are not
   needed elsewhere. They hold database/API credentials for a project whose CI
   no longer references them.
5. Decide the fate of the unmerged security branch `audit/phase-1-critical`
   (9 commits) and open PR #45 (`docs/superadmin-multitenancy-plan`).
