# Mission 2026-10-29c (OpenCode lead): issue #309

Owner: Jeff. Lead / integrator: OpenCode (`opencode-go/deepseek-v4.1-flash`).
Base: `origin/develop` @ `46ca268` (v1.28.0, 2026-10-29).
Worker: `mission/I-59-chat-contrast` (worktree `S:/Dev/Capstone/optifeed-worktrees/chat-contrast`).

Follow-on to `docs/missions/2026-10-29-opencode-batch-b.md`, which closed #303, #304 and #307.

## Scope

| ID | Issue | Branch | Worktree | Scope | Status |
|---|---|---|---|---|---|
| I-59 | #309 | `mission/I-59-chat-contrast` | `S:/Dev/Capstone/optifeed-worktrees/chat-contrast` | In dark mode the chat keeps light surfaces and light-optimised text, so it is unreadable. Make every chat state theme-aware in both modes, meet WCAG AA for body text, and add regression tests that fail on the current classes. | merged @ `d2d90ae` (`c85e268`) |

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
| 10-29 | Root cause | The chat shell predates the dashboard dark-mode pass (`5d0eb19`, 2026-08-04) and hard-coded light-only utilities; nothing forced light. The decisive defect was the composer: `bg-gray-100` with **no text colour**, so it inherited the near-white `.dark` foreground (`globals.css:136`, `:189-191`) — about **1.05:1**. Secondary AA failures: action-card Accept white on `#E85A2A` **3.54:1**, status colours reused in dark mode **3.67–3.72:1**, and the 11 px greeting label **3.54:1**. |
| 10-29 | Delivered | `mission/I-59-chat-contrast` @ `c85e268`: 9 files, no schema/lockfile/`globals.css` change. New `chat-theme.ts` tokens on the existing dashboard palette plus a documented `CHAT_CONTRAST` table; composer, panel, sheet, bubbles, chips, footer, toggle, action card and greeting made theme-aware. Regression test walks the components for light-only classes with no `dark:` sibling and checks every documented pair against WCAG AA. Proof it fails on the old code: **6 failed / 2 passed** with the component files reverted. |
| 10-29 | Full gate | lint clean (812 files), typecheck clean, prisma valid, `api:check` 56/56, **240 files / 2461 tests**, production build compiled. Release prep **v1.28.1** (PATCH) in both `package.json`, `LEGAL_APP_RELEASE` and the changelog section. |
| 10-29 | Merged | PR **#313** merged into `develop` as **`d2d90ae`**. Post-merge `develop` is v1.28.1; #309 closed against that SHA. Open issues and open PRs: **0**. Tagging and `main`/`staging` promotion remain with the release workflow and the owner. |
