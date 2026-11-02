# #476 — mobile-native dashboard layout

Status: implementation in progress
Worktree: `S:\Dev\Capstone\optifeed-worktrees\mobile-476`
Branch: `feat/476-mobile-native-layout` (base `origin/staging` @ `bf921c3`)
Issue: <https://github.com/J-Akiru5/OptiFeed/issues/476>

## Problem

Issue #476: "Cards are selling the mobile view and PWA as an extension of the
web." Below the `xl` breakpoint the dashboard home is one flat column of **17
separately bordered and shadowed blocks** (`rounded-*`, `border`, `bg-white`,
`shadow-*`). The shell itself is already mobile (header band, 5-tab bottom bar,
quick menu); the content area is the part that still reads as a desktop page.

## Decision

Keep **one DOM tree** and make the chrome responsive. No duplicated
mobile/desktop component trees: duplicates break the single-instance
`data-help` / `data-onboard` anchors, screen-reader output, and the existing
source-string tests.

- Mobile means **below `xl` (1280 px)** — the same threshold at which the
  control-room grid activates today.
- Below `xl`: no floating cards. Full-bleed bands, 1 px hairlines, flat
  sections, native list rows, 44 px minimum touch targets.
- At `xl` and above: the existing control room is unchanged, class for class.

## Mobile grammar

| Token | Value |
| --- | --- |
| Band | `max-xl:border-b max-xl:border-[#E6ECE9] max-xl:bg-white max-xl:px-4 max-xl:py-4` |
| Band (dark) | `dark:max-xl:border-gray-800 dark:max-xl:bg-gray-900` |
| Flatten a card | `max-xl:rounded-none max-xl:border-0 max-xl:bg-transparent max-xl:p-0 max-xl:shadow-none` |
| List row | `max-xl:flex max-xl:min-h-11 max-xl:items-center max-xl:justify-between max-xl:gap-3 max-xl:border-b max-xl:border-[#E6ECE9] max-xl:px-0 max-xl:py-3 last:border-b-0` |
| Section title | keep the existing 11 px uppercase `ControlPanel` heading |
| Primary action | full width below `xl`, `min-h-12`, existing orange `#E85A2A` |

Rules:

1. Responsive classes only. Do not delete desktop classes and do not fork the
   component.
2. Never remove or duplicate `data-help` / `data-onboard` anchors.
3. Keep every class substring the tests pin (`flex w-full min-w-0 flex-col`,
   `ofd-chart-card`, `ofd-hero-strip`, `@sm:flex-row`, `min-h-14`,
   `pb-[env(safe-area-inset-bottom)]`, the `xl:overflow-*` set).
4. No `!important` except where an inline style must be neutralised
   (`PondOverview` pins).
5. No new dependencies. Tailwind v4, `motion`, `lucide-react` and the existing
   `cn()` merge already cover this layout (`cn` is `clsx` + `tailwind-merge`,
   so a later `max-xl:` utility wins over the base class).
6. Do not change copy, data, routes or i18n keys.

## Library evaluation

The issue invites installing a mobile template/UI library. Not done, on
purpose:

- The project already ships `motion` (animation), `lucide-react` (icons),
  `sonner` (toasts) and a hand-rolled accessible bottom sheet
  (`components/mobile/quick-menu.tsx`).
- `vaul` / `embla-carousel` / Radix drawers would duplicate that sheet and the
  design tokens, add bundle weight, and re-open the a11y work already done.
- The #476 problem is layout chrome, not missing primitives.
- Revisit `vaul` only if drag-to-dismiss on the quick menu is requested as its
  own issue.

## Component map

| Area | File | Change |
| --- | --- | --- |
| Section wrapper | `components/dashboard/control-room/control-room-shell.tsx` | mobile band token, flatten `ControlPanel`, bleed the page |
| Charts | `components/charts/chart-frame.tsx` | flatten frame below `xl`, hairline between charts |
| Device cards | `FeedLevelCard`, `WaterTempCard`, `EnergyControllerCard`, `TimeCalibrationForm`, `FeedingPredictionCard` | flatten chrome, rows for readouts |
| Hero / pond / CTA | `next-feeding-strip`, `pond-overview`, `FeedNowButton` | tinted hero band, pond canvas → list, full-width primary action |
| Rail panels | `control-room/rail-panels.tsx` | stat tiles → rows, native list rows |
| Page assembly | `app/[locale]/(dashboard)/dashboard/page.tsx` | apply bands to each order wrapper, mobile spacing |
| Shell | `mobile/mobile-header.tsx` | iOS standalone top safe area |

## Verification

Executed in the worktree:

1. `pnpm exec tsc --noEmit` — clean (after `prisma generate`).
2. `pnpm exec biome check` on all 14 changed files — clean.
3. Focused suites:
   - `mobile-shell`, `dashboard-fit`, `control-room-dashboard`,
     `dashboard-control-room-page` — **55/55 passed**.
   - new `mobile-476-layout` — **7/7 passed** (band, flat panel, stat row,
     hero, pond list with one label per feeder, hopper accent, chart frame).
4. Full suite — first run: 4,583 passed, 2 failed (worker-start timeouts on a
   memory-tight host); re-run with `--maxWorkers=2` is the triage run.
5. `next build` — deferred until the test re-run finishes (heavy job, one at a
   time on this host).

Not executed: authenticated browser check. The dashboard needs the Supabase
session, and the Playwright suite requires the local Supabase stack (or the
production e2e fixture) plus `apps/web/.env`, neither of which exists in this
worktree. CI and the preview path are the first full browser gate.

## Outcome so far

- 13 order wrappers now carry the mobile band; the page cancels the `main`
  padding and stacking gap below `xl` so the bands run edge to edge.
- `ControlPanel`, `ChartFrame`, the hopper/water/controller/calibration/
  prediction cards and the fallow panel lose radius, border, fill, shadow and
  padding below `xl`; desktop keeps every original class.
- The pond canvas becomes a stacked feeder list below `xl` in the same DOM: the
  SVG is hidden, the pins go static, and each label appears once.
- Stat tiles, pond meta, recent feedings, biomass rows and alerts become
  hairline-separated rows with 44 px minimum targets.
- The hero is a tinted full-bleed band; Feed Now is a full-width 48 px action.
- The mobile header now respects `env(safe-area-inset-top)` in iOS standalone.


## Out of scope

- Other dashboard routes (schedule, settings, growth, history) — they inherit
  the same shell but keep their current cards until their own issue.
- Translating the hard-coded English in `WaterTempCard` (pre-existing gap).
