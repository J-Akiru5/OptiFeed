# ADR-0001: Two deployment branches and one production database

- **Status:** Accepted (reconfirmed by the owner 2026-11-04)
- **Date:** 2026-10-26 (staging/main-only deployment); shared database decided 2026-10-21
- **Deciders:** Jeff (owner)
- **Backfilled:** 2026-10-29
- **Related:** issue #323 (repository policy vs. global agent governance), [ADR-0005](./0005-release-automation.md)

## Context

OptiFeed is a Next.js monorepo (`apps/web`) deployed on Vercel as project
`opti-feed-web`, with the project root set to `apps/web`. The branch model is
`feature/*` -> `develop` -> `staging` -> `main`.

Three constraints shaped the deployment model:

1. **Deployment cost.** Every eligible branch push creates a Vercel deployment.
   The original configuration also deployed `develop`, which duplicated work on
   every integration.
2. **Preview deployments inherit production credentials.** The Vercel project
   has a single set of environment variables scoped to both `production` and
   `preview` (`docs/deployment-workflow.md` section 6). A pull-request preview
   would therefore read and write the production database, so previews are not a
   safe review surface.
3. **One database.** For the prototyping phase, `staging` and `main` share the
   same Supabase project. A separate staging database was deliberately not
   provisioned; imported data is accepted as disposable.

The decision was recorded as T20 in
[`docs/SUPERADMIN-MULTITENANCY-PLAN.md`](../SUPERADMIN-MULTITENANCY-PLAN.md)
("Only `staging` (preview) and `main` (production) deploy") and written into
[`docs/deployment-workflow.md`](../deployment-workflow.md) section 1.

**Owner reconfirmation (2026-11-04).** The owner reviewed the conflict with the
global OpenCode deployment-governance default (which allows `main` + `develop`
and excludes `staging`) and confirmed that **the repository is authoritative**:
OptiFeed deploys `main` + `staging`, `develop` is validation-only, and the
allowlist must not be changed to match the global default. The same review made
Vercel Deployment Protection for preview deployments a required control, because
`staging` previews run with production credentials.

## Decision

1. **Exactly two branches deploy**, through the Vercel Git integration only:
   - `staging` -> Vercel **Preview** environment;
   - `main` -> Vercel **Production** environment.
2. `develop` is the shared integration branch and is validated by CI only. It
   never deploys, by any route (Git integration, CLI, SHA deploy, deploy hook or
   GitHub Actions).
3. Every other branch, and every pull request from one, is ineligible. The
   allowlist is enforced in [`apps/web/vercel.json`](../../apps/web/vercel.json)
   with `"*": false` **and** `"**": false` (minimatch's `*` does not cross `/`),
   plus `main` and `staging` set to `true`.
4. **There is one deployment mechanism.** CI validates; it does not deploy. The
   original `deploy.yml` was removed. No deploy hooks exist.
5. **Migrations run only from the production deployment of `main`.**
   [`apps/web/scripts/migrate-if-production.mjs`](../../apps/web/scripts/migrate-if-production.mjs)
   applies `prisma migrate deploy` only when `VERCEL_ENV=production`; staging,
   previews, local builds and CI skip it.
6. Promotion is a reviewed pull request at every step. Only the owner merges
   `staging` -> `main`; `main` requires one approval and administrators are
   subject to the same protection.
7. **Preview deployments require Vercel Deployment Protection.** Because
   `staging` runs with production credentials and the production database,
   Preview deployments must be gated by Vercel Authentication (or an equivalent
   owner-approved mode): Project -> Settings -> Deployment Protection. Production
   (`main`) stays publicly reachable. This is a dashboard control; the repository
   cannot verify it, and the documentation must keep saying so
   ([`docs/deployment-workflow.md`](../deployment-workflow.md) section 2.1).

## Consequences

### Positive

- One deployment path, one place (Vercel) to look when a deploy is wrong.
- No preview deployment can mutate production data or the shared schema.
- `develop` can integrate continuously without spending deployments.
- CI is provably deployment-free: it holds `contents: read` and runs `next build`
  directly, never `pnpm build`.
- The allowlist is guarded inside the existing `quality` job by
  [`scripts/ops/deployment-policy.mjs`](../../scripts/ops/deployment-policy.mjs):
  it fails if `vercel.json` stops being exactly `main` + `staging`, or if
  `docs/deployment-workflow.md` documents a different set. No new required check
  is added.

### Negative / accepted costs

- **`staging` is not a sandbox.** It runs against the production database with
  production credentials. A smoke test that writes is a production write
  (`docs/deployment-workflow.md` section 6).
- **No pull-request previews.** Reviewers cannot click a deployed preview; the
  review surface is the diff plus CI.
- **Configuration is branch content.** `vercel.json` only takes effect for
  commits that contain it. A long-lived branch that never merged the allowlist
  remains deployable (recorded in `docs/deployment-workflow.md` section 2).
- **The repository rule overrides the global agent governance default.** The
  global rule allows `main` + `develop` deployments; this repository deploys
  `main` + `staging` and forbids `develop`. Mission decision D7 records the
  override, and the owner reconfirmed it on 2026-11-04. Issue #323 was resolved
  on 2026-10-31 (I-105) by aligning every repository document, the self-check
  assertion and mission guidance with this ADR; the repository policy is
  authoritative for this repository.
- **Deployment Protection is dashboard-only.** The control required by decision
  7 cannot be read from the repository or verified by CI. It can silently be
  disabled in Vercel without any failing check; the owner must verify it
  (section 2.1 of the deployment document).

### Follow-ups

- Isolate the staging database when real customer data, external users or paid
  tenants arrive, or when an incident window makes shared data unacceptable.
  The four-step isolation procedure is in `docs/deployment-workflow.md` section 6.
- Re-enable pull-request preview deployments only after Preview-scoped
  credentials exist; do not re-enable them by widening the branch allowlist.
  Deployment Protection is necessary but not a substitute for data isolation.
- Enable and verify Vercel Deployment Protection for Preview deployments
  (decision 7) and re-verify it after any Vercel project or plan change.
- Resolve #323 by aligning the governance text with this record, or by changing
  this decision deliberately. **Done 2026-10-31 (I-105):** all repository
  documents, `scripts/self-check.mjs` and mission guidance now match this ADR.
  **Reconfirmed 2026-11-04:** the owner kept the repository policy and added the
  Deployment Protection requirement.

## Links

- Implementation: [`apps/web/vercel.json`](../../apps/web/vercel.json),
  [`apps/web/scripts/migrate-if-production.mjs`](../../apps/web/scripts/migrate-if-production.mjs),
  [`scripts/ops/deployment-policy.mjs`](../../scripts/ops/deployment-policy.mjs),
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- Procedure: [`docs/deployment-workflow.md`](../deployment-workflow.md),
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md) section 10,
  [`docs/vercel-deployment-checklist.md`](../vercel-deployment-checklist.md)
- Container (non-Vercel) deployment: [`docs/operations/deployment.md`](../operations/deployment.md)
- Source of the decision: `docs/SUPERADMIN-MULTITENANCY-PLAN.md` section 1 T20
