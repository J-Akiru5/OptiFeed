# OptiFeed — Branch, CI and Deployment Workflow

Last verified: 2026-10-22.

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

Not covered by the `quality` job (run manually when relevant): Playwright
end-to-end specs (need a database and a running server) and Vercel project
configuration. Firmware compilation has its own `Firmware` workflow
(`.github/workflows/firmware.yml`): it runs on `firmware/**` changes, compiles
the ESP32 sketch with `arduino-cli`, and never flashes or deploys a device.

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

### 5.4 Release pull request

The `staging` → `main` pull request is opened by
`.github/workflows/release-pr.yml` on manual `workflow_dispatch`. The workflow
runs as `github-actions[bot]` with the repository `GITHUB_TOKEN`, creates the PR
(or exits if one is already open), and does nothing else: it never approves,
merges, tags or deploys.

Why the bot: GitHub does not allow a pull-request author to approve their own
PR, and `main` requires one approving review with administrators enforced
(section 9). A bot-authored PR lets Jeff review and approve a promotion he
opened without weakening the gate. To let the bot create the PR, the repository
setting **Allow GitHub Actions to create and approve pull requests** is enabled;
the approval half of that setting is unused.

The human gate is unchanged: `quality` must pass, the bot cannot approve or
merge, and only Jeff merges `main`. The current release is PR #79.

### 5.5 Hotfix

Branch from `main`, PR into `main`, Jeff approves and merges, deploy and verify.
Then open a separate reconciliation PR from that fix branch (or `main`) into
`develop`. Never rely on an automatic back-merge, and never assume `main` and
`staging` are identical after a hotfix.

## 6. Shared staging/production database — accepted decision

Decision (2026-10-21): OptiFeed is still in the prototyping stage, so staging
and production intentionally use the same Supabase project and the same Vercel
environment variables. No separate staging database is provisioned. Imported
data is accepted as disposable for this phase.

The Vercel project has one set of variables scoped to both `production` and
`preview`:

| Variable | Scope |
| --- | --- |
| `DATABASE_URL` | production + preview |
| `DIRECT_URL` | production + preview |
| `NEXT_PUBLIC_SUPABASE_URL` | production + preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production + preview |
| `SUPABASE_SERVICE_ROLE_KEY` | production + preview |
| `DEVICE_TOKEN` | production + preview |
| `OPENCODE_GO_API_KEY` | production + preview |

Consequences:

- The staging deployment reads and writes production data. A smoke test that
  logs a sample, creates a user, or sends a feed command changes real records.
- Migrations are still gated: only the production deployment of `main` runs
  `prisma migrate deploy`. Staging builds skip migrations, so a staging build
  cannot change the schema.
- Preview deployments remain disabled (`apps/web/vercel.json`). If they are
  re-enabled, they inherit the same production access.

Rules while this decision stands:

- Do not run destructive tests (bulk deletes, resets, load tests) against
  staging. Use a local database for that.
- Never run `prisma migrate reset` anywhere except a local database.
- Treat every staging data change as a production data change.

Revisit this decision when real customer data, external users, paid tenants, or
a production incident window makes shared data unacceptable. The isolation
steps, when needed, are:

1. Create a separate Supabase project for staging.
2. Apply migrations to it from a trusted machine.
3. Add **Preview-only** values for the variables above in Vercel, keeping the
   current values scoped to **Production only**.
4. Redeploy `staging` and confirm a record created there does not appear in
   production.

## 7. Staging smoke test

Run against the staging deployment of the candidate SHA. Because staging shares
the production database (section 6), every write step below changes production
data — use a disposable account/pond and do not run these steps while
production users are active.

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

| Claim | Status | Evidence |
| --- | --- | --- |
| Default branch is `staging` | Verified on GitHub | API `default_branch = staging`; `ls-remote --symref origin HEAD` → `refs/heads/staging` |
| `develop` does not deploy | Verified | Merge `527b599` produced no Vercel deployment |
| `staging` deploys | Verified | Deployment for `6d858d6` (PR #78) reached `success` in the Vercel `Preview` environment |
| Staging build skips migrations | Verified | Deployment log: `[migrate] skipped (VERCEL_ENV=preview)` |
| `main` deploys | Configured and previously observed | Vercel production branch `main`; production deployment for `2795bef` exists |
| Production approval gate | Configured on GitHub | `main` protection: PR required, 1 approval, `quality`, admins enforced |
| CI validates PRs into `develop`/`staging`/`main` | Verified | PR #50 `quality` pass; PR #51 `quality` pass |
| CI validates pushes to `develop`/`staging` | Verified | Runs 39537076187 and 39538117781, both pass |
| Firmware compiles | Verified | `Firmware` workflow `compile` success on `aa88ef2` and `6d858d6` |
| Release PR is bot-authored | Verified | PR #79 author `app/github-actions`, `REVIEW_REQUIRED`, `quality` + `Firmware` + Vercel green |
| `staging` matches `develop` | Verified | `git diff origin/staging origin/develop` empty; `staging@6d858d6`, `develop@aa88ef2` |
| Database migrations | Verified | `prisma migrate status`: 28/28 applied and schema up to date; production `migrate deploy` is a no-op |
| `develop`/`staging` protection | Configured on GitHub | PR + `quality`, no force push, no deletion, admins enforced |
| Staging database | Shared with production **by decision** (section 6) |
| Production deploy executed | **Not performed** | `main` is at `2795bef`; release PR #79 awaits Jeff's approval |

## 11. Manual actions that remain with Jeff

1. Review and merge release PR #79 into `main`; agents must not do this.
2. Confirm GitHub plan/permissions for required reviewers, if enforcement of a
   second human approval on `main` is required beyond the current settings.
3. Revisit the shared staging/production database decision when real customer
   data, external users, or paid tenants arrive (section 6).

Completed on 2026-10-21: the three unused CI secrets
(`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) were deleted; the `audit/phase-1-critical`
fixes and PR #45 were merged through the normal PR flow.
