# Mission 2026-10-29b (OpenCode lead): issues #303 and #304

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `9611434` (v1.26.0, 2026-10-29).
Integration branch: `integration/batch-2026-10-29b` (worktree `S:/Dev/Capstone/optifeed-worktrees/batch-29b`).

This document is the **single source of truth** for this batch: scope, decisions, verification and
history live here. Worker branches are listed with the commit that carries them.

## Scope

| ID | Issue | Branch | Worktree | Scope | Status |
|---|---|---|---|---|---|
| I-56 | #303 | `mission/I-56-pond-switcher` | `S:/Dev/Capstone/optifeed-worktrees/pond-switcher` | Dashboard has no pond context. Add a pond switcher to the dashboard top bar (only ponds the caller may read), persist the selection, and make existing ponds searchable in the global search so a pond can be found by name and switched to. Accessible, all three locales, empty state. | merged into integration @ `c21495f` (`3a95f31`) |
| I-57 | #304 | `mission/I-57-target-growth` | `S:/Dev/Capstone/optifeed-worktrees/target-growth` | Persist the feed-calculator result as the harvest **growth target**: a "Set as growth target" action, target biomass + gap on the Growth page, and a feeding recommendation derived from the saved target inside the existing 10%/15-day envelope. | merged into integration @ `3bcf38c` (`5ff7e31`) |
| I-58 | #307 | `mission/I-58-hopper-calibration` | `S:/Dev/Capstone/optifeed-worktrees/hopper-calibration` | Hopper calibration UX: a `0` in a distance field cannot be cleared and re-typed, the stepper only moves 0.1, and the layout wastes space. Make the field editable, step whole centimetres 1 → 2 → 3 → 4, lay the calibration cards out as a responsive 3-column grid, and normalise every numeric calibration field onto one shared control. | merged into integration @ `11dbc9d` (`25712cb`) |

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

## Outcome

Merged into `develop` as **`46ca268`** through PR **#311**, released as **v1.28.0** (MINOR). Post-merge
`develop` CI run for `46ca268` is **green**. #303, #304 and #307 were closed against that SHA.

| Item | Final state |
|---|---|
| Batch PR | #311, merged @ `46ca268` |
| Version | v1.28.0 — root and `apps/web` `package.json`, `LEGAL_APP_RELEASE`, changelog section |
| Issues | #303 closed, #304 closed, #307 closed |
| Gate | lint, typecheck, prisma validate, `api:check` 56/56, 239 files / 2453 tests, production build |
| Follow-on | `docs/missions/2026-10-29-opencode-batch-c.md` carries #309 (chat contrast), filed after this batch merged |

## Discussion log

| When (local) | Topic | What was agreed or done |
|---|---|---|
| 10-29 | Batch start | Jeff asked for the incoming issues to be handled with multi-agent orchestration and for the plan of record to be updated. Inventory: #303 (pond switcher) and #304 (target growth) open, no open PRs, `develop` = `9611434` (v1.26.0). Worktrees and branches created from `origin/develop` before any work started. |
| 10-29 | Assignment | I-56 (#303) and I-57 (#304) dispatched to parallel workers in isolated worktrees. Neither branch touches the other's files. |
| 10-29 | I-56 delivered | `mission/I-56-pond-switcher` @ `3a95f31`: 14 files, no schema change, no new dependency. Active pond persisted as the existing httpOnly `optifeed:pondId` cookie, treated as a hint only — every read re-intersects it with the caller's own ACTIVE ponds via `resolveActivePond`, so a tampered id cannot select a foreign pond. `switchPond` re-validates server-side, fails closed when unauthenticated, rejects over-long ids and sets `secure` in production. Search already returned `switchPondId` for farmers from #270; the worker locked it with allow/deny RBAC tests instead of reimplementing it. Focused checks: biome clean on 14 files, 72 tests across 7 files, plus `tsc --noEmit` exit 0. Reviewed and merged into the integration branch as `c21495f`. |
| 10-29 | I-56 review | Diff is in scope (pond selector, header, dashboard layout, pond-selection/access, tests, three locales). No refactor of unrelated code. The only pre-existing gap noticed and deliberately left alone is the hard-coded English "LAST SYNCED" label in the header. |
| 10-29 | I-58 added | #307 arrived mid-batch: hopper calibration cannot clear a `0`, the stepper moves by 0.1, and the calibration layout wastes space. Added as I-58 on `mission/I-58-hopper-calibration`, cut from `origin/develop` @ `be86809` (v1.27.0) because `develop` had advanced past the batch base. The brief requires regression tests that fail before the fix and one shared numeric-field control rather than four divergent ones. |
| 10-29 | Base drift | `develop` moved to v1.27.0 (`be86809`) while the batch was running. I-56 and I-57 are based on `9611434`, I-58 on `be86809`; the integration branch is reconciled onto the latest `develop` before the full gate and the PR, and no worker is asked to rebase mid-flight. |
| 10-29 | I-57 delivered | `mission/I-57-target-growth` @ `5ff7e31`: 19 files. Target persisted at `Pond.notificationPrefs.profile.growthTarget` — **no schema change, no migration, no lockfile or package.json change** (verified by diff). `growth-target-store.ts` is deliberately not a `"use server"` module because its functions trust a passed `ownerId`; only the guarded actions in `lib/actions/growth-target.ts` call it, behind `requireWriteAccess()` plus `requirePermission("manage_crop_cycle")`. Reads and writes filter by `pondId` **and** `ownerId`, so a foreign pond behaves like a missing pond. A saved target is bound to the cycle it was set against, so a harvested cycle cannot leak into the next. Checks: biome clean across `apps/web` (793 files), `tsc --noEmit` clean, 165 focused tests before the merge and 136 after it. |
| 10-29 | I-57 review | Diff is in scope. The planner math was **extended, not forked**: `buildGrowthPlan` takes a `savedTarget` input and the same 10%/15-day envelope and device cap still apply. Harvest dates are never moved. Merged into the integration branch as `3bcf38c`, which also brought the branch's `develop` merge (v1.27.0) into the batch. |
| 10-29 | I-58 delivered | `mission/I-58-hopper-calibration` @ `25712cb`: 10 files, no schema/migration/lockfile change. Root cause of the trapped `0` was numeric state — `Number("")` is `0`, so the field re-rendered the zero; all calibration fields now hold raw text and parse on submit. One shared `CalibrationNumberField` (label, −/+, unit, help, announced error, `aria-describedby`) replaces four divergent controls, with `step={1}` and `inputMode="numeric"` for whole centimetres. Grid is 1 column on phones, 2 on tablets, 3 at `xl`. Focused checks: biome clean, 28 new/updated tests plus 87 across the settings, calibration and i18n suites. Merged as `11dbc9d`. |
| 10-29 | Gate — regression caught | The full suite failed on `lib/__tests__/pond-status-filter.test.ts`: I-56 changed `switchPond` to `getCurrentPondOwnerIdSafe` + `resolveActivePond`, but that file's mock did not export the new function and still asserted the removed `findFirst` query and the removed `/dashboard` redirect. Fixed by adding the missing mock export and re-pointing the two tests at the new behaviour, keeping the guard's intent: an archived/foreign pond is still refused and no cookie is set, and the switcher is asserted **not** to redirect. Not weakened, adapted. |
| 10-29 | Gate — flake isolated | `admin-pond-write-guards.test.tsx` timed out at the 5 s cap during the first two full runs and passed **4/4 in 1.4 s** in isolation; the same file is recorded as load-flaky in `2026-10-27` mission history. The complete suite then passed on the clean run. No code change made for it. |
| 10-29 | Full gate | On the integrated tree: `pnpm lint` clean (810 files), `pnpm typecheck` clean, `prisma validate` valid, `pnpm api:check` 56/56, `pnpm test` **239 files / 2453 tests passed**, `pnpm build` compiled successfully. Release prep: **v1.28.0** (MINOR) in root and `apps/web` `package.json`, `LEGAL_APP_RELEASE` and the new changelog section. |
| 10-29 | Reconcile + re-gate | `develop` shipped **v1.27.1** (`217be7a`) while the gate was running, so the integration branch was reconciled onto it (`29e80bb`): conflicts were only the four version/changelog files, resolved by keeping the batch at **1.28.0** and retaining both changelog sections. The whole gate was re-run on the merge result, not assumed: lint, typecheck, `api:check` 56/56, **239 files / 2453 tests**, and the production build all green. |
| 10-29 | Flake fixed, not re-rolled | `admin-pond-write-guards.test.tsx` timed out at the 5 s default in two separate full runs while passing 4/4 in ~1.4 s alone. Because it had already failed 2 of 3 full runs it was given an explicit 20 s timeout on the cold dynamic-import test — no assertion changed — and the suite then ran green. This is test stability for a load-sensitive import, not a weakened check. |
| 10-29 | Constraint recorded | #304 is bound by the no-schema-change rule in `growth-target-agent.md`; the JSON profile bridge is the persistence mechanism for this slice. |
