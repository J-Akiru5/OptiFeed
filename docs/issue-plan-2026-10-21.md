# Issue plan — 2026-10-21

Scope: the two open GitHub issues at the time of writing.

| Issue | Title | Type |
| --- | --- | --- |
| #48 | bug: contrast | UI defect |
| #49 | feat: Growth page improvement | UI/UX feature |

Both were opened on 2026-10-21 with screenshots. This document records the
diagnosis, the intended change, the assumptions made while Jeff is away, and
what still needs a human decision.

---

## #48 — Dark-mode contrast

### Diagnosis from the report and the code

The screenshots show dark mode with the page chrome dark and the content cards
still white. Inside those white cards several values are nearly invisible
(`82%`, the water-temperature reading, `CICT Building A Feeder`, the feed-amount
input, `32.7 cm`, and the disabled **Feed Now** button).

Three separate causes:

1. **Undefined design token.** Eighteen elements use
   `text-[var(--ofd-base-deep)]`, but `--ofd-base-deep` is not defined anywhere
   in `globals.css`. An unresolved `var()` makes the declaration invalid, so the
   text inherits `color: var(--foreground)` — which is near-white in dark mode —
   on a white card. That is the invisible `82%` and the temperature dash.
2. **White surfaces that never adapted to the theme.** `FeedLevelCard`,
   `WaterTempCard`, `EnergyControllerCard`, and the growth-page cards hardcode
   `bg-white` without a `dark:` counterpart, while the dashboard's newer
   sections use `bg-white dark:bg-gray-900`. Inherited text therefore becomes
   light on light.
3. **Disabled state by opacity.** The Feed Now button uses
   `disabled:opacity-50`, which turns the blue button pale while keeping white
   text — low contrast, and it still looks enabled.

### Intended change

- Define `--ofd-base-deep` per theme (brand navy in light, brand light blue in
  dark), so every existing usage resolves.
- Make the affected cards theme-aware (`bg-white dark:bg-gray-900`,
  `border-gray-100 dark:border-gray-700/50`, matching text and sub-surface
  colours) instead of forcing dark text onto permanent white.
- Give the Feed Now button an explicit disabled style
  (`disabled:bg-gray-200 disabled:text-gray-500`) rather than transparency.
- Add a static test that every `var(--ofd-*)` referenced in the app is defined
  in `globals.css`, so an undefined token cannot silently reintroduce this.

### Out of scope

The wider sweep of every `bg-white` in the app (superadmin, admin, settings).
Those screens have the same pattern but are not in the report; converting them
in one change would be a large, risky diff. They are listed as follow-up.

---

## #49 — Growth page improvement

### What the issue asks for

1. Feed Level History should show only the most recent 5–10 records so the card
   is compact.
2. A "View more" action that opens the full history with industry-grade
   pagination, filters, and search.
3. The same treatment for every card that grows too long.

### Current state

- The growth page has three unbounded lists: **Feed Level History**
  (`FeedLevelLogTable`, cursor "load more" with 30 per batch), **Growth
  Summary** (renders every biomass sample), and **Biomass Sample History**
  (renders every sample).
- The dashboard's recent-feeding card is already limited to 5 with a link to
  `/dashboard/history`, so it already follows the pattern.
- The existing `PaginatedSearchTable` is a cursor/load-more list with a search
  box. There is no numbered pagination component and no date-range filter.

### Intended change

- Growth page cards show a fixed preview: 5 rows for feed level, 6 for growth
  summary, 5 for biomass samples, each with a "View all" link.
- New route `/[locale]/dashboard/growth/history` with three tabs:
  `feed` (feed-level readings), `growth` (period-over-period gains), and
  `biomass` (sample log). One URL contract:
  `?tab=<feed|growth|biomass>&page=<n>&from=YYYY-MM-DD&to=YYYY-MM-DD&q=<text>`.
- Server-side offset pagination, 10 rows per page, with numbered pages,
  previous/next, first/last, and a "showing X–Y of Z" summary.
- Date-range filter plus the existing free-text search (a date string or a
  source token where the dataset has one). Filters and page live in the URL, so
  the view is shareable and works without client JavaScript.
- Reusable `Pagination` component and pure helpers (`parsePage`,
  `parseDateRange`, `buildPageWindow`) with unit tests.
- All new surfaces dark-mode aware from the start.

### Assumptions (reversible)

- 5 rows for the compact previews (the low end of "5–10") to keep the page
  short; configurable in one constant.
- 10 rows per full-history page.
- Tabs on one route instead of three routes: less navigation chrome, one
  filter implementation, and the three datasets are related views of the same
  pond.
- No schema, migration, or API change. Reads only.

### Questions for Jeff (non-blocking)

1. Should the full history live under the existing **History** navigation item
   (which currently shows feeding events) instead of under **Growth**?
2. Should the filters include a device/source selector, or is date + search
   enough for the current single-device setup?
3. Is 10 rows per page right, or would 20 suit the table density better?

The implementation answers these with reversible defaults; changing them later
is a small edit, not a rewrite.

---

## Verification plan

| Check | Method |
| --- | --- |
| Types and lint | `pnpm lint`, `pnpm typecheck` |
| Unit tests | `pnpm test` including new pagination and design-token tests |
| Production build | `pnpm build` with dummy credentials |
| Pagination maths | Unit tests for windows, bounds, and date parsing |
| No database writes | Only `findMany`/`count` reads are added |
| Deployment | PR into `develop`, CI `quality`, then promotion to `staging` |

A browser screenshot comparison is not possible in this environment: the app
requires Supabase credentials, and the staging deployment is behind Vercel SSO.
The contrast fix is therefore verified by class inspection and the token test,
not by a rendered pixel diff.

---

## Status

| Item | Status |
| --- | --- |
| Plan recorded | Done |
| #48 implemented | Done (PR #58) |
| #48 integrated into `develop` | Done |
| #49 implemented | Done (this change) |
| #49 integrated into `develop` | Pending merge |
| Promoted to `staging` | Pending |
| Production promotion | Not performed — Jeff only |
