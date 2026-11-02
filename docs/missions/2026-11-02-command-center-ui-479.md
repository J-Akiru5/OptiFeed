# Mission 2026-11-02 — Command Center monitor board (#479, M3C.8)

Built on the #477 theme foundation (PR #517) with two builder subagents on separate component
layers, then assembled here. Scope: the reusable visual layer and the `/superadmin` overview wiring.
Data layers, thresholds and the other command-center pages stay owned by the #479 slices.

## Levels

**Level 1 — primitives** (`apps/web/components/superadmin/monitor/primitives/`)

- `MonitorPanel` / `PanelGrid`: the console panel (title, description, meta, action) on the shared
  light/dark `CARD` token; a responsive grid that degrades 3 → 2 → 1.
- `KpiTile`: label, value, delta pill (arrow + text + accessible label), hint, optional sparkline.
- `Sparkline`: dependency-free SVG polyline with `role="img"` and a caller-supplied label.
- `StatusMix`: dependency-free SVG donut plus a legend and a visually hidden list; status is never
  colour alone.
- `AttentionList` / `ActivityFeed`: semantic queues with severity icons and empty states.

**Level 2 — composition** (`monitor/sections/command-center-layout.tsx`)

- `CommandCenterLayout`: header (title, description, range switcher), status-bands slot, KPI grid,
  trend slot (a pre-framed chart avoids a card inside a card), optional status mix, optional extra
  chart row, optional attention/activity row and a footer slot.
- Props-only: no i18n import, no hooks, no data access, so the page still renders under
  `renderToStaticMarkup`.

**Level 3 — assembly (this agent)**

- `/superadmin` now uses the layout: eight KPI tiles, the signups `LineTrend` as the trend slot, the
  fleet `StatusMix` built from the existing online/offline split, the feeds/alerts/kg charts in the
  extra row, and the four existing attention cards in the footer (their detail and links are kept).
- Delta pills carry the short percentage; the full "25% up on the previous period" sentence stays in
  the accessible name, so the existing overview assertions still hold.

## Guardrails

- Every visible string arrives as a prop; the seven presentational basenames are in the console
  i18n test's `PROPS_ONLY` set.
- No client components, no new dependency, no schema or API change.
- `superadmin-theme.test.tsx` still passes: no light-only utility without its `dark:` variant.
- `superadmin-overview-page.test.tsx` passes unchanged (one h1, all five chart titles, KPI values,
  trend sentence, attention copy).

## Verification

- Focused: overview + primitives + sections + console i18n + theme + ui — 49/49.
- Full suite: 4,554 passed; four workbook/server-action tests failed under parallel memory pressure
  and all 82 passed when rerun together in 5.4 s.
- `pnpm lint` clean, `pnpm typecheck` passes.
