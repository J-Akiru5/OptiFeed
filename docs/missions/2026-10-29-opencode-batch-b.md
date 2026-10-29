# Mission 2026-10-29b (OpenCode lead): issues #303 and #304

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `9611434` (v1.26.0, 2026-10-29).
Integration branch: `integration/batch-2026-10-29b` (worktree `S:/Dev/Capstone/optifeed-worktrees/batch-29b`).

This document is the **single source of truth** for this batch: scope, decisions, verification and
history live here. Worker branches are listed with the commit that carries them.

## Scope

| ID | Issue | Branch | Worktree | Scope | Status |
|---|---|---|---|---|---|
| I-56 | #303 | `mission/I-56-pond-switcher` | `S:/Dev/Capstone/optifeed-worktrees/pond-switcher` | Dashboard has no pond context. Add a pond switcher to the dashboard top bar (only ponds the caller may read), persist the selection, and make existing ponds searchable in the global search so a pond can be found by name and switched to. Accessible, all three locales, empty state. | running |
| I-57 | #304 | `mission/I-57-target-growth` | `S:/Dev/Capstone/optifeed-worktrees/target-growth` | Persist the feed-calculator result as the harvest **growth target**: a "Set as growth target" action, target biomass + gap on the Growth page, and a feeding recommendation derived from the saved target inside the existing 10%/15-day envelope. | running |

Existing foundations the workers must extend rather than duplicate:

| Concern | Existing code |
|---|---|
| Growth planner (pure math) | `apps/web/lib/growth-plan.ts` |
| Growth apply / load | `apps/web/lib/growth-plan-apply.ts`, `growth-plan-loader.ts` |
| Pond profile JSON bridge | `apps/web/lib/pond-profile.ts` |
| Global search | `apps/web/components/search/global-search.tsx`, `apps/web/lib/search/catalogue.ts`, `apps/web/lib/actions/search.ts` |
| Pond selector | `apps/web/components/pond-selector.tsx` |

## Decisions

| ID | Decision |
|---|---|
| B1 | **Two workers, two branches, one batch.** One worktree and branch per issue; nothing is edited across worktrees. |
| B2 | **No schema change and no migration.** This inherits the hard constraint in `docs/missions/growth-target-agent.md`: preview deployments share the production database and migrations only run on a production deployment, so #304 persists through the existing `Pond.notificationPrefs` `profile` bridge. A worker that believes a column is unavoidable must stop and report instead of migrating. |
| B3 | **No new dependencies.** Both features are built from code already in the repository. |
| B4 | **Workers do not integrate.** They push their own branch only: no PR, no merge, no push to `develop`/`staging`/`main`, no deployment. The lead reviews, runs the full gate and opens one PR into `develop`. |
| B5 | **Heavy checks are serialised.** Workers run focused `biome check` and targeted `vitest` only; `lint`/`typecheck`/`test`/`api:check`/`build` run once, on the integrated result, to avoid competing builds on one machine. |
| B6 | **Release is a separate decision.** The version bump and changelog section are prepared in the integration branch; tagging and publishing are handled by `.github/workflows/release.yml` on the next `main` promotion, never by a worker. |
| B7 | **Scope discipline.** Each branch contains only its issue. No opportunistic refactors, no unrelated formatting, no touching other worktrees. |

## Verification plan

1. Per branch (worker): `pnpm exec biome check <touched files>` and focused `pnpm exec vitest run <files>`.
2. Integration (lead): review each diff, confirm the scope matches the issue, then merge both branches into
   `integration/batch-2026-10-29b`.
3. Full gate on the integrated tree, run serially: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm api:check`, Prisma schema validation with the CI dummy env, `pnpm build`.
4. Confirm version consistency: root `package.json` = `apps/web/package.json` = `LEGAL_APP_RELEASE` =
   top changelog section.
5. Open one PR into `develop`; merge only after the `quality` check is green.
6. Close #303 and #304 with the `develop` merge SHA. Leave tags and `main`/`staging` promotion to the owner
   and to the release workflow.

## Acceptance criteria

| Issue | Done when |
|---|---|
| #303 | A user with several ponds can switch the active pond from the dashboard top bar, the choice survives navigation/reload, only permitted ponds are listed (allow **and** deny tests), and searching a pond name finds it. |
| #304 | A saved growth target survives reload, is scoped per pond and tenant (allow **and** deny tests), the Growth page shows target biomass and the gap, and the recommendation is derived from the saved target via the existing planner — with no schema change. |

## Discussion log

| When (local) | Topic | What was agreed or done |
|---|---|---|
| 10-29 | Batch start | Jeff asked for the incoming issues to be handled with multi-agent orchestration and for the plan of record to be updated. Inventory: #303 (pond switcher) and #304 (target growth) open, no open PRs, `develop` = `9611434` (v1.26.0). Worktrees and branches created from `origin/develop` before any work started. |
| 10-29 | Assignment | I-56 (#303) and I-57 (#304) dispatched to parallel workers in isolated worktrees. Neither branch touches the other's files. |
| 10-29 | Constraint recorded | #304 is bound by the no-schema-change rule in `growth-target-agent.md`; the JSON profile bridge is the persistence mechanism for this slice. |
