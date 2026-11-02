# OptiFeed — Developer Handoff

This document orients a developer joining the OptiFeed codebase and points to
the authoritative rules. The workflow rules live in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and the deployment model lives in
[`docs/deployment-workflow.md`](./docs/deployment-workflow.md). Read both
before your first commit.

> **CRITICAL — NEVER run `prisma migrate reset` against production.**
> It drops the entire database and recreates it from scratch, destroying every
> pond, device, biomass log, and feeding event. This project has already lost
> production data that way once.
>
> - Production migrations: `prisma migrate deploy` only, through the release
>   process.
> - Local development: `prisma migrate dev` against your own local database.
> - If you cannot name the exact database a command will hit, do not run it.

---

## 1. Where we are

OptiFeed is a live application, not a scaffold:

- Production: <https://pakaonai.syntaxure.dev> (Vercel project `opti-feed-web`,
  root directory `apps/web`).
- Application: Next.js 16 (App Router), Supabase (Postgres + Auth), Prisma,
  next-intl (English + Hiligaynon), Tailwind 4, pnpm workspace.
- Production is deployed from `main`. `develop` is the shared integration
  branch. `staging` is the default branch and release-candidate branch.

## 2. Branch rules — the short version

| Branch | You push to it? | How work gets there |
| --- | --- | --- |
| your `feature/*`, `fix/*`, `refactor/*`, `docs/*`, `audit/*`, `chore/*` branch | Yes | You create it from the latest `develop` |
| `develop` | **No** | PR from your branch, reviewed and merged |
| `staging` | **No** | PR from `develop`, opened by Jeff |
| `main` | **No** | PR from `staging`, approved and merged by Jeff only |

The old instruction to work on a shared `Karl` branch is retired. That branch
still exists for history, is fully merged into `develop`, and must not be used
as a working branch. Every task gets its own short-lived branch.

Start every task with:

```bash
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
git switch -c fix/device-sync
```

Open every PR **into `develop`**.

### Runtime and types

CI runs **Node 22**; the package supports Node `>=22.5`. Keep `@types/node` on the
runtime's major (`^22`, or `^24` only after CI moves). A future major (`26.x`) is
held even when the typecheck is green (#513).

## 3. Definition of done

A change is done when:

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass locally, and you have
  pasted the actual output into the PR.
- CI (`quality`) is green on the PR.
- The PR description covers the problem, the change, the verification, any
  schema/migration impact, and any configuration impact.
- Nothing half-finished is left on `develop` — it is always a valid base for
  the next branch.

`pnpm build` runs Prisma migrations when `VERCEL_ENV=production`, and skips
them everywhere else (including your laptop and CI). Do not set
`VERCEL_ENV=production` locally.

## 4. Local environment

```bash
corepack enable
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env   # fill in your own dev credentials
pnpm prisma:generate
pnpm dev
```

Use your **own** Supabase development project. Never put production
credentials in a local `.env`, and never commit `.env` — the pre-commit hook
blocks it and `scripts/self-check.mjs` re-checks it.

Reference material:

- `docs/vercel-deployment-checklist.md` — environment variables and build
  behaviour.
- `docs/runbook.md` — incident triage (feeder runaway, device offline, database
  outage, backup restore).
- `docs/audit-report.html`, `docs/remediation-report.html` — security audit
  history and open remediation items.

## 5. Database work

- Schema lives in `apps/web/prisma/schema.prisma`; migrations in
  `apps/web/prisma/migrations/`.
- Migrations are **additive by default**. `DROP`, `TRUNCATE`, or a destructive
  `ALTER` needs Jeff's explicit approval, a verified backup, and its own PR.
- Run `scripts/self-check.mjs` before a migration PR; it flags destructive SQL
  in new migrations.
- Migrations are applied to production only by the production deployment of
  `main`. Staging and preview deployments intentionally skip them.

## 6. Deployments

- `main` → production deployment.
- `staging` → staging deployment.
- `develop` and all work branches → validation only, never a deployment.
- There is no GitHub Actions deploy job. Do not add one; do not run
  `vercel deploy` by hand.

**Shared database (accepted):** the Vercel project uses one set of environment
variables for both Production and Preview, so the staging deployment talks to
the production database. That is intentional during prototyping — there is no
separate staging database. Do not run destructive tests (bulk deletes, resets,
load tests) against staging; use a local database. See
`docs/deployment-workflow.md` §6.

**WiFi provisioning:** a new device is provisioned from its own access point
(`PakaonAI-XXXX` at `http://192.168.4.1`; units flashed before the rename still show
`OptiFeed-XXXX` until reflashed), not from the dashboard. The hardware
settings page only shows the AP name and instructions; WiFi credentials are
never sent to or stored on the server. See `docs/wifi-provisioning-plan.md`.

**Registering devices:** only platform admins register units, at
`/superadmin/devices` (plan v2, T15): chip MAC from the boot log, label, org and
pond, reason. The token is shown once; the sticker never carries it. Procedure:
`firmware/README.md` → "Registering a new unit". Never test registration or
token rotation on a preview: previews write to the production database.

## 7. Working alongside another developer

- One task, one branch, one owner. Never share a working branch.
- Announce changes to shared contracts before implementing them: Prisma schema
  and migrations, `lib/auth/*`, `lib/actions/*`, API request/response shapes,
  `proxy.ts`, `package.json` / `pnpm-lock.yaml`, workflow and Vercel config.
- Keep branches short-lived. Merge `origin/develop` into your branch regularly
  rather than letting it drift.
- Resolve conflicts by intended behaviour, not by "accept theirs". If the right
  answer is unclear, ask before merging.

## 8. Escalation

- Production release or production hotfix: Jeff.
- Destructive migration or production data change: Jeff, in writing, after a
  backup.
- Vercel project settings, domains, environment variables, Supabase project
  access: Jeff.
- Security finding: raise it as an `audit/*` branch PR, do not commit a fix
  straight to `develop`.
