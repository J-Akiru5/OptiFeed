# Mission 2026-10-29c (OpenCode lead): issue #309

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `46ca268` (v1.28.0, 2026-10-29).
Worker: `mission/I-59-chat-contrast` (worktree `S:/Dev/Capstone/optifeed-worktrees/chat-contrast`).

Follow-on to `docs/missions/2026-10-29-opencode-batch-b.md`, which closed #303, #304 and #307.

## Scope

| ID | Issue | Branch | Worktree | Scope | Status |
|---|---|---|---|---|---|
| I-59 | #309 | `mission/I-59-chat-contrast` | `S:/Dev/Capstone/optifeed-worktrees/chat-contrast` | In dark mode the chat keeps light surfaces and light-optimised text, so it is unreadable. Make every chat state theme-aware in both modes, meet WCAG AA for body text, and add regression tests that fail on the current classes. | running |

## Decisions

| ID | Decision |
|---|---|
| C1 | **Fix the cause, not the symptom.** The worker must name the actual offending colours/containers in its report rather than adding ad-hoc overrides. |
| C2 | **Scope stays inside chat/assistant.** No restyling of unrelated dashboard surfaces; the chat must match the existing dark palette instead of introducing a second one. |
| C3 | **All states, not the happy path.** Bubbles, markdown (code, links, inline code), timestamps, composer and placeholder, send/stop, disabled, action card, step-up, empty/greeting, errors, toggle and unread badge. |
| C4 | **Regression tests, not a screenshot claim.** Tests must fail on the pre-fix classes; WCAG AA (4.5:1) for normal text in both modes. |
| C5 | **No schema, migration, dependency or deployment.** Worker pushes its branch only; the lead runs the full gate and opens one PR. |

## Verification plan

1. Worker: `biome check` on touched files, focused `vitest`, `tsc --noEmit` where practical.
2. Lead: review the diff for scope, merge into an integration branch cut from current `develop`.
3. Full gate serially: `pnpm lint`, `pnpm typecheck`, `prisma validate`, `pnpm api:check`, `pnpm test`, `pnpm build`.
4. Version consistency: root = `apps/web` = `LEGAL_APP_RELEASE` = top changelog section (a PATCH bump if the fix ships alone).
5. One PR into `develop`; merge after `quality` is green; close #309 with the merge SHA.
6. Tagging and `main`/`staging` promotion remain owner/release-workflow decisions.

## Discussion log

| When (local) | Topic | What was agreed or done |
|---|---|---|
| 10-29 | Filed | #309 reported with a phone screenshot in dark mode (light chat on a dark app, light text) plus desktop light-mode references. |
| 10-29 | Dispatch | I-59 created from `origin/develop` `46ca268` and dispatched with the all-states brief and the requirement to report the real offending classes. |
