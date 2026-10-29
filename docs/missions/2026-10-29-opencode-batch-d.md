# Mission 2026-10-29d (OpenCode lead): owner decisions on #304 and #307

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `131d5c8` (v1.28.1, 2026-10-29).
Integration branch: `integration/batch-2026-10-29d`.

Follow-up to `docs/missions/2026-10-29-opencode-batch-b.md` and `-c.md`. Those batches shipped #303, #304, #307 and #309; this batch closes the product questions they left open.

## Owner decisions (Jeff, 2026-10-29)

| ID | Question | Decision |
|---|---|---|
| D-1 | Should saving a calculator target also write `CropCycle.targetHarvestWeightG`? | **Write both, pond wins.** The pond profile stays the plan's source of truth and the cycle field is mirrored so every screen shows one number. Removing the target clears the mirror. |
| D-2 | What happens when someone edits the cycle target while a saved calculator target exists? | **Warn and ask at edit time.** Replace the calculator target, keep it, or cancel. Enforced on the server, not just in the form. |
| D-3 | Legacy fractional centimetre values in hopper calibration? | **Allow one decimal for cm.** Steppers still move whole centimetres. |
| D-4 | Pond switch landing page? | **Stay in place** — confirms the shipped behaviour, no change. |
| D-5 | Page-level or field-level three-column calibration layout? | **Field-level** — confirms the shipped behaviour, no change. |

## Scope

| ID | Covers | Branch | Worktree | Status |
|---|---|---|---|---|
| I-60 | D-1 + D-2 | `mission/I-60-target-mirror` | `S:/Dev/Capstone/optifeed-worktrees/target-mirror` | merged @ `6f40863` (`b25bcc7`) |
| I-61 | D-3 | `mission/I-61-hopper-decimals` | `S:/Dev/Capstone/optifeed-worktrees/batch-29b` | merged @ `6f40863` (`06d2f34`) |
| — | D-4, D-5 | — | — | no code change: the shipped behaviour was confirmed |

## Implementation notes

**D-1.** `saveGrowthTargetForPond` runs one interactive transaction: owner-scoped pond read → active cycle read → pond target write → count-guarded cycle `updateMany` mirror. Any failure rolls back. `clearGrowthTargetForPond` removes the pond target and clears the mirror only while the target's cycle is still ACTIVE and belongs to the pond.

**D-2.** The cycle form compares the edited target with the saved target and the cycle's current value, and on a real edit renders a labelled `role="alertdialog"` with Replace / Keep / Cancel. `updateCropCycle` re-reads the saved target and **fails closed** if the target changed with no choice, so the guard does not depend on the UI. *Keep* restores the cycle mirror to the calculator target, which is the only reading consistent with D-1's one-number rule.

**D-3.** `fullRules`/`emptyRules` become `decimals: 1, step: 1`; `inputMode` becomes `decimal`. The server schema already accepted any finite number, so no validation change was needed.

## Rules held

- **No Prisma schema change, no migration, no new dependency, no lockfile change** in either branch.
- Scoping unchanged: pond + owner/tenant, with allow **and** deny tests on both new paths.
- The 10% / 15-day envelope, the device per-meal cap and the "never move harvest dates" rule are untouched.

## Verification plan

1. Worker branches: focused `biome check`, targeted `vitest` (85 and 29 tests respectively).
2. Integration: full gate on the merged tree — `pnpm lint`, `pnpm typecheck`, `prisma validate`, `pnpm api:check`, `pnpm test`, `pnpm build`. The typecheck here is authoritative because this worktree has a generated Prisma client, which the worker worktrees did not.
3. Version consistency: root = `apps/web` = `LEGAL_APP_RELEASE` = top changelog section = **1.29.0**.
4. One PR into `develop`; merge after `quality` is green.

## Known gaps and follow-ups

- **No backfill for targets saved before the mirror existed.** Read paths do not write, so a legacy target aligns on its next calculator save or a Replace choice. A migration is not permitted here; a one-off data fix would need a separate decision.
- **Harvested cycles keep their historical target** when a pond target is removed, deliberately.
- Other writers of `targetHarvestWeightG` (imports, assistant actions, admin bulk edits) do not go through the D-2 prompt; the D-2 guard covers the cycle form and its server action. Worth a reconciliation guard if more writers appear.

## Discussion log

| When (local) | Topic | What was agreed or done |
|---|---|---|
| 10-29 | Questions asked | The three open product questions from #304/#307 plus two UX confirmations were put to Jeff with options. |
| 10-29 | Decided | D-1 write both, D-2 warn and ask, D-3 one decimal for cm, D-4 stay in place, D-5 field-level grid. |
| 10-29 | Dispatch | I-60 (D-1+D-2, one worker because they share the write path) and I-61 (D-3, done by the lead in the worktree that already had dependencies installed). |
| 10-29 | Delivered | I-60 @ `b25bcc7`: transactional mirror, server-enforced conflict resolution, accessible confirmation dialog, 100 focused tests. I-61 @ `06d2f34`: `decimals: 1, step: 1`, `inputMode="decimal"`, regression test proving a stored 12.3 saves as 12.3. |
