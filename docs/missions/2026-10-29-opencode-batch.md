# Mission 2026-10-29 (OpenCode lead): issues #286–#289

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `3b1574f` (v1.23.0, 2026-10-29).
Integration branch: `integration/batch-2026-10-29a` (worktree `S:/Dev/optifeed/mission-I-08`).

## Parallel completion and reconciliation

#288 and #289 were filed while this batch was running and were completed by a parallel agent on
`feat/issues-288-289` (worktree `S:/Dev/Capstone/optifeed-worktrees/issues-288-289`). That agent
merged **PR #291** into `develop` as **`6c9d8d4`**; this lead did not duplicate or edit its work.
This lead verified the post-merge `develop` CI run **40805233910** (green), closed #288/#289 with
the merge SHA, and prepared the **v1.25.0** release + plan record in `release/v1.25.0`.

## Scope

| ID | Issue | Branch | Worktree | Scope | Status |
|---|---|---|---|---|---|
| I-52 | #286 | `mission/I-52-hopper-card-link` | `S:/Dev/optifeed/mission-I-01` | The desktop sidebar "Hopper level" card is static. Make the whole card a link to the hopper-level history chart at `/dashboard/history#hopper-level`, with keyboard focus and an accessible name. | merged @ `d8b5ee6`; 9 tests |
| I-53 | #287 | `mission/I-53-pakoy-chat-face` | `S:/Dev/optifeed/mission-I-02` | The floating chat toggle shows a generic message-square glyph. Show Pakoy's existing `head` art while closed; keep the `X` and accessible name while open. | merged @ `c0382fd`; 4 tests |
| I-54 | #288 | `feat/issues-288-289` | `S:/Dev/Capstone/optifeed-worktrees/issues-288-289` | Change-password needs a screen-level confirmation toast, and the confirmation pattern needs to be documented for every mutating action. | merged by parallel agent via PR #291 @ `6c9d8d4` |
| I-55 | #289 | `feat/issues-288-289` | `S:/Dev/Capstone/optifeed-worktrees/issues-288-289` | Add Tagalog as a third locale and turn the top-bar language control into a dropdown that switches the whole system. | merged by parallel agent via PR #291 @ `6c9d8d4` |

Both issues were unassigned and had no Claude branch when claimed. Claim comments were posted on
the issues; the branches were created and pushed from `origin/develop` before work started.

## Decisions

| ID | Decision |
|---|---|
| B1 | **Release `v1.24.0` (MINOR).** Both issues are filed and implemented as user-facing features; SemVer MINOR is the conservative, correct bump from v1.23.0. |
| B2 | **No schema change, no migration, no dependency install.** Both changes are presentation/navigation. |
| B3 | **No `main`/`staging` promotion and no tag.** The owner releases and promotes; merging this batch into `develop` is the normal automatic development deployment. |
| B4 | **No Claude work touched.** Claude's integration branch and worktrees remain out of scope. |
| B5 | **One batch PR into `develop`.** Worker branches merge into `integration/batch-2026-10-29a`, the release prep (version files + changelog) is committed there, and one PR carries the batch. |
| B6 | **Accessibility is part of done.** The hopper card gets a focus-visible ring and a real accessible name; the chat face is decorative inside a named button. |
| B7 | **Reconcile, do not duplicate.** #288/#289 were completed by the parallel agent; this lead verified the merged result, closed the issues and recorded the outcome instead of reimplementing them. |
| B8 | **Release `v1.25.0` (MINOR).** Tagalog + the language dropdown and the confirmation-toast standard are user-facing additions on top of v1.24.0. |

## Verification plan

1. Per branch: `pnpm exec biome check <touched files>`, focused `vitest`.
2. Integration: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm api:check`, Prisma validate with CI dummy env, `pnpm build`.
3. Confirm version consistency: root `package.json` = `apps/web/package.json` = `LEGAL_APP_RELEASE` = top changelog section.
4. Open the PR into `develop`; merge only after CI `quality` is green.
5. Close #286–#289 with the develop merge SHA; leave the tag to the owner.

## Discussion log

| When (local) | Topic | What was agreed or done |
|---|---|---|
| 10-29 09:40 | Mission start | Jeff asked for all new issues to be addressed at once and reconciled to `develop`. Inventory: #286 (hopper card clickable) and #287 (Pakoy face on chat bubble); both unclaimed, no Claude branch. Claimed as I-52/I-53. |
| 10-29 09:46 | Workers done | I-53 @ `c0382fd`: Pakoy head on the closed FAB, `X` open state, 4 focused tests. I-52 @ `d8b5ee6`: whole sidebar card links to `/dashboard/history#hopper-level`, anchor target + scroll margin, 9 focused tests. Both branches pushed and merged into `integration/batch-2026-10-29a`. |
| 10-29 09:48 | Release prep | **v1.24.0** (MINOR): root/web `package.json` and `LEGAL_APP_RELEASE` aligned; `Unreleased` moved to `[1.24.0] - 2026-10-29`. No schema, migration or dependency change. |
| 10-29 09:55 | Full gate | `lint`, `typecheck`, `api:check` (54 checks), Prisma schema validation and `pnpm build` pass. Full unit suite: **230 files / 2360 tests**. One transient collection failure in `admin-pond-write-guards.test.tsx` was isolated (4/4 green) and the complete rerun passed 2360/2360. |
| 10-29 10:06 | Batch merge | PR #290 merged into `develop` as **`9ff9514`**; post-merge CI run `40804339626` green; #286/#287 closed. |
| 10-29 10:15 | Parallel #288/#289 | The parallel agent merged PR #291 (`feat/issues-288-289`) as **`6c9d8d4`**: Tagalog + language dropdown, password toast, `docs/i18n.md`, `docs/ui-confirmations.md`. Post-merge CI run `40805233910` green. |
| 10-29 10:20 | Reconciliation + release | #288/#289 closed with `6c9d8d4`; no duplicate implementation. Prepared **v1.25.0** (MINOR): root/web `package.json`, `LEGAL_APP_RELEASE`, changelog and this plan record. |
