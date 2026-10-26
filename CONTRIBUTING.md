# Contributing to OptiFeed

This is the single source of truth for how code moves from a laptop to
production. It applies equally to every developer, on every device. If another
document disagrees with this one, this one wins — open a PR to fix the other
document.

Repository: <https://github.com/J-Akiru5/OptiFeed>

---

## 1. Branch model

| Branch | Purpose | Who integrates | Deploys? |
| --- | --- | --- | --- |
| `staging` | Release candidate and **preview** branch | Jeff merges release PRs from `develop` | **Yes — preview deployment, using production credentials** |
| `main` | Production source of truth | Jeff only, via an approved `staging` → `main` PR | **Yes — production deployment** |
| `develop` | Shared integration branch for both developers | PR from short-lived work branches | **No** — CI validation only |
| `feature/*`, `fix/*`, `refactor/*`, `docs/*`, `audit/*`, `chore/*` | One task, one developer, one branch | Open a PR into `develop` | No |

```
feature/* ──PR──▶ develop ──PR──▶ staging ──PR + Jeff's approval──▶ main
                                    │                                │
                             staging preview                production deploy
                         (production credentials)           (runs migrations)
```

> **Only `staging` and `main` deploy** (decision 2026-10-26, to reduce deployment
> cost). `develop` is validated by CI only; never deploy it by any route.
>
> **Warning:** the `staging` deployment runs against the **production** database
> with the project's production credentials, including the Supabase service-role
> key. `docs/deployment-workflow.md` section 6 records this exposure and the
> isolation steps needed to remove it. Treat the staging deployment as
> production, never as a safe review surface.

Rules that never change:

- **Never commit directly to `develop`, `staging`, or `main`.**
- **The two developers never share a working branch.** If two people need to
  touch the same area, use two branches and reconcile through `develop`.
- A feature branch starts from the latest `develop`, not from another feature
  branch, unless the task explicitly depends on unmerged work — in that case
  say so in the PR.
- Short-lived means short-lived: days, not weeks. Long branches are where
  merge conflicts and lost work come from.

---

## 2. One-time setup on a new device

```bash
git clone https://github.com/J-Akiru5/OptiFeed.git
cd OptiFeed
corepack enable
pnpm install --frozen-lockfile
```

Then:

1. Copy `apps/web/.env.example` to `apps/web/.env` and fill in your **own**
   development credentials. Never copy production credentials onto a laptop
   for feature work.
2. `pnpm prisma:generate`
3. `pnpm dev`
4. Configure Git identity so commits are attributable:
   ```bash
   git config user.name "Your Name"
   git config user.email "you@example.com"
   ```

Git hooks are installed by `pnpm install` (Husky) and enforce Conventional
Commits plus a block on committing `.env` files. Do not bypass them with
`--no-verify`.

---

## 3. Before starting any task

```bash
git status --short --branch        # must be clean, or knowingly preserved
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
git switch -c feature/your-task-name
```

- If `git status` shows uncommitted work that is not yours to discard, stop and
  finish or stash it before switching branches. **Never** let a branch switch
  overwrite work in progress.
- If `git pull --ff-only` fails, your local `develop` has diverged. Do not
  merge or reset blindly: inspect with `git log --oneline --graph develop
  origin/develop`, then fast-forward (`git reset --hard origin/develop` is only
  acceptable when you have confirmed you have no unpushed commits — otherwise
  ask).
- Branch naming: `feature/dashboard-analytics`, `fix/device-sync`,
  `refactor/data-access`, `docs/deployment-workflow`,
  `audit/phase-2-remediation`, `chore/ci-cleanup`.

---

## 4. While working

- **Scope:** one branch = one reviewable task. Unrelated cleanups go in their
  own PR.
- **Commits:** Conventional Commits (`feat:`, `fix`, `refactor:`, `docs:`,
  `test:`, `chore:`, `ci:`). The `commit-msg` hook enforces the format.
- **Secrets:** never commit `.env`, `.env.local`, tokens, service-role keys,
  device tokens, or production connection strings. The `pre-commit` hook blocks
  `.env` files; it cannot recognise a secret pasted into source, so do not do
  that either.
- **Local checks** as you go: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- **Database work:** you may run `prisma migrate dev` against your own local
  database. See section 8 for the rules that must never be broken.
- **Firmware:** changes under `firmware/` are not covered by CI; state
  explicitly in the PR how they were compiled/tested.

### Shared contracts — coordinate before you start

These files are touched by both developers often and are the usual source of
integration conflicts. If your task changes one, say so in the task thread
before writing code:

- `apps/web/prisma/schema.prisma` and anything under
  `apps/web/prisma/migrations/`
- `apps/web/lib/auth/*`, `apps/web/lib/actions/*`, `apps/web/proxy.ts`
- API request/response shapes under `apps/web/app/api/*`
- `package.json`, `pnpm-lock.yaml`, `biome.json`
- `.github/workflows/*`, `apps/web/vercel.json`, deployment configuration

Rule of thumb: if the other developer's branch would stop compiling or start
behaving differently after your change, it is a shared contract.

---

## 5. Before opening a pull request

Run, from the repository root, and paste the real results into the PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Then a production build. **On a laptop this runs `prisma migrate deploy`
against whatever `DATABASE_URL` is in `apps/web/.env`** — so either point it at
a disposable database, or skip `pnpm build` and rely on CI's dummy-environment
build. Never point `DATABASE_URL` at production to satisfy a local check.

Push and open the PR **into `develop`**:

```bash
git push -u origin feature/your-task-name
gh pr create --base develop --fill
```

The PR template asks for: problem, changes, verification evidence, database
and migration impact, configuration impact, known limitations. Fill it in.
A PR with no stated verification will be sent back.

---

## 6. Keeping a feature branch up to date

When `develop` moves while you work:

```bash
git fetch origin --prune
git switch feature/your-task-name
git merge origin/develop      # preferred: keeps history intact
# resolve conflicts, run checks
git push
```

Rebasing is allowed **only** on a branch nobody else has based work on, and a
rewrite must use `--force-with-lease`, never bare `--force`:

```bash
git rebase origin/develop
git push --force-with-lease
```

Never force-push `develop`, `staging`, `main`, or any branch another person is
using. If you are unsure whether someone else has your branch, use merge.

### Resolving conflicts

1. Read both sides. Understand what each change was trying to achieve.
2. Resolve according to the intended behaviour — use the tests, the PR
   descriptions, and the schema to decide.
3. Never resolve a conflict by accepting "ours" or "theirs" across whole files.
4. If the correct outcome is not clear, stop and ask the other developer. A
   wrong merge that compiles is more expensive than a delayed merge.
5. After resolving, run the full local check set again and inspect
   `git diff origin/develop...HEAD` before pushing.

---

## 7. Review and merge rules

- A PR needs a review from the other developer before merge, unless it is a
  documentation/CI-only change explicitly waived by Jeff.
- The author does not merge their own PR into `develop` while any required
  check is red.
- `develop` must always compile, lint, typecheck, and pass unit tests. If it
  breaks, fixing it is the top priority: revert or raise a `fix/*` PR. Do not
  build new work on a broken `develop`.
- Rebase/squash choices: merge commits are the repository norm; squashing is
  fine for a noisy branch as long as the final message is Conventional.

---

## 8. Database rules (non-negotiable)

> **NEVER run `prisma migrate reset` against production.**
> It drops the database and recreates it, destroying all data. This has already
> cost this project its production data once.

- `prisma migrate dev` → local development only.
- `prisma migrate deploy` → the only command that applies migrations to a
  shared environment, and only through the documented release process.
- Migrations are **additive by default**. A migration containing `DROP`,
  `TRUNCATE`, or a destructive `ALTER` needs Jeff's explicit approval, a
  verified backup, and its own PR.
- Before adding a migration, confirm the target database. If you cannot say
  which database a command will hit, do not run it.
- A successful application build is **not** evidence that a migration is safe.

---

## 9. Release process

Development → integration:

```
feature/* --PR--> develop
```

Release candidate:

```
develop --PR--> staging     (opened by Jeff, or by a developer for Jeff to merge)
```

Production promotion:

```
staging --PR--> main        (Jeff only)
```

Before promoting `develop` → `staging`:

1. All intended PRs are merged; nothing half-finished is on `develop`.
2. `gh pr list --base develop` shows no open work that belongs in the release.
3. The combined diff has been reviewed: `git diff origin/staging...origin/develop`.
4. CI is green on `develop`'s tip.
5. Migration and environment impact is written down in the PR.
6. The candidate commit SHA is recorded in the PR.

Before promoting `staging` → `main`:

1. The `staging` deployment built successfully from the exact candidate SHA.
2. Smoke tests were run against `staging` (login, dashboard, log sample, device
   polling, one feed command in a safe state).
3. `git diff origin/main...origin/staging` contains only the intended release.
4. A backup exists if the release contains migrations.
5. Jeff approves the PR.

After a production deployment: verify the deployment in Vercel, check the
health endpoint (`/api/health`), spot-check login and dashboard data, and write
the deployed SHA plus any follow-up work into the release PR.

If production requires an urgent fix, branch from `main`, PR into `main` with
Jeff's approval, then **reconcile it back into `develop` with a separate PR**.
Do not merge `main` into `develop` as a routine step and do not assume the
branches stay identical.

---

## 10. Deployments

Only two branches deploy:

| Branch | Environment | Trigger |
| --- | --- | --- |
| `staging` | Staging | Push to `staging` |
| `main` | Production | Push to `main` |

`develop` and every work branch run **CI validation only** — no application
deployment, no database migration, no production credentials.

Deployment is performed by the Vercel Git integration; there is no GitHub
Actions deploy workflow. Do not add a second deployment path (CLI deploys,
deploy hooks, workflow deploys) without an explicit decision recorded in
`docs/deployment-workflow.md`.

---

## 11. Quick reference

```bash
# start a task
git fetch origin --prune && git switch develop && git pull --ff-only origin develop
git switch -c fix/device-sync

# check before pushing
pnpm lint && pnpm typecheck && pnpm test

# publish and open the PR
git push -u origin fix/device-sync
gh pr create --base develop --fill

# refresh from develop mid-task
git fetch origin && git merge origin/develop
```

If you are ever unsure which branch you are on, run `git status -sb` before
typing anything else. If you are unsure whether a command is safe, stop and
ask — the cost of asking is a minute, the cost of a wrong database command is
the company's data.
