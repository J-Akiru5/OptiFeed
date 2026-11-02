# Mission 2026-11-02 — Superadmin light/dark toggle (#477)

Requested by Jeff (issue #477): "Please add the light and dark mode toggle on the top bar and then
there is a layout issue where dark cards appeared on light layout." The second half shipped earlier
(PR #497); the toggle was blocked on a scope decision. Owner decision recorded on the issue on
2026-11-02: the console becomes theme-aware, following the shared `optifeed:theme` preference.

This is also the dependency of M3C.8 (visual system) in the Platform Command Center (#479).

## What was built

- **Toggle in the console header.** The shared `DarkModeToggle` is mounted twice in
  `app/[locale]/(superadmin)/superadmin/layout.tsx`: in `MobileHeader` children and in the desktop
  action bar. It reads and writes the existing `optifeed:theme` preference through `ThemeProvider`
  (mounted in the locale layout), so the choice matches the farmer dashboard.
- **Dark palette.** Page `#0B1220`, surface `#111A2C`, raised `#162238`, border `#24304A`; primary
  text `slate-100`, muted `slate-400`. The brand orange stays the accent, but the console action
  button and accent badge use the AA-safe `#C2410C` (5.18:1 against white); dark mode uses
  `#FF8A5C` with `#0B1220` text (8.06:1).
- **Retrofit.** 44 files under `components/superadmin` and `app/[locale]/(superadmin)`: cards,
  fields, tables, tabs, dialogs, badges, empty/loading/error states, hover states, warning and
  error callouts. `ui.tsx` owns the shared tokens; `dialog-theme.ts` already had dark pairs.
- **Guards.**
  - `superadmin-theme.test.tsx` asserts WCAG AA (4.5:1) for seven light/dark text pairs
    (`CONSOLE_CONTRAST` in `ui.tsx`), asserts the toggle is mounted on both header paths, and fails
    if a console file gains `bg-white`, `bg-[#F4F7F6]`, `text-[#0A3D62]`, `text-[#3D5568]` or
    `border-gray-200` without a `dark:` counterpart.
  - The status-band icons and badges keep their existing status roles; status is never colour alone.

## Verification

- `pnpm lint` clean; `pnpm typecheck` passes.
- `pnpm test`: 360 files, 4,533 tests; one load-flaky xlsx test failed in the batch run and passes
  in isolation (it is a known parallel-load flake, unrelated to this change).
- Focused: theme, console i18n, dialog contrast and AI-provider page tests — 22/22.

## Deployment note

No schema, API or environment change. The console follows the user's stored theme; users who never
toggled keep the OS preference through `system`.
