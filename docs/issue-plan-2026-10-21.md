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
| #49 implemented | Done (PR #59) |
| #49 integrated into `develop` | Done |
| Promoted to `staging` | Done (PR #60, `94297a3`) |
| Production promotion | **Awaiting Jeff's approval** |

---

# Reconciliation review — 2026-10-21 (pre-production)

## Branch state

| Branch | Tip | Relationship to `main` | Notes |
| --- | --- | --- | --- |
| `main` | `2795bef` | production | last production deployment; no release since 2026-10-14 |
| `staging` | `94297a3` | 44 commits ahead | content-identical to `develop`; staging deployment `READY` |
| `develop` | `0940a45` | 40 commits ahead | content-identical to `staging` |
| `xtra` | `f8de64b` | 5 unique commits | open PR #55, **conflicting**, based on pre-migration `5f82a25` |
| `Karl` | `d366ca4` | merged | stale history, no unique commits |
| `fix/schedule-pause-energy-device` | `124c7dd` | merged | stale history, no unique commits |

`git diff origin/develop origin/staging` is empty. `staging` is ahead of `main`
by 44 commits and 108 files (+9932 / −1433).

## PR #55 (`xtra`) — reconcile separately, not in this release

`xtra` contains five commits against the pre-migration base `5f82a25`:

| Commit | Content | Verdict |
| --- | --- | --- |
| `09c5868` | biomass source badges, history filters, dashboard card, form layout | **unique** — additive |
| `b999458` | separate dark-mode contrast audit (fixes #48) | duplicate of PR #58, broader file set |
| `32e4b74` | separate growth compact/history implementation (closes #49) | duplicate of PR #59, different routes |
| `9a66bd9` | AI provider switch Gemini → OpenRouter DeepSeek | **unique**, breaking env change |
| `f8de64b` | AI smart feeding prediction with advisory apply | **unique** |

Risks if merged as-is:

1. **Security regression.** `xtra` predates the audit merge. Its
   `app/api/chat/route.ts` uses manual Supabase auth and its
   `app/api/import/confirm/route.ts` lacks the `withAuth` / atomic-import
   guards from F-002–F-005. A naive merge would revert those fixes.
2. **Duplicate implementations.** Two independent solutions for #48 and #49
   now conflict on the growth page, history page, log-sample page, the cards,
   and `paginated-search-table.tsx`.
3. **New required configuration.** The AI switch retires `GEMINI_*` and needs
   `OPENROUTER_API_KEY` (plus optional `OPENROUTER_MODEL`,
   `OPENROUTER_REASONING_EFFORT`). Vercel currently has no OpenRouter key, so
   chat would fall back to rule-based answers.
4. **Preview consumption.** `xtra` predates `apps/web/vercel.json`, so it still
   creates Vercel preview deployments on every push.

Recommended reconciliation (after the production release):

1. Branch `feat/xtra-reconciled` from `origin/develop`.
2. Cherry-pick only `09c5868`, `9a66bd9`, `f8de64b`; **do not** replay
   `b999458` or `32e4b74`.
3. Resolve conflicts by keeping `develop`'s auth scaffolding (`withAuth`,
   `requireWriteAccess`, atomic import) and applying only the AI/biomass
   changes on top. Add `OPENROUTER_API_KEY` to Vercel before that PR reaches
   production.
4. Port the broader dark-mode coverage from `b999458` (audit, settings,
   notifications) separately if it is still wanted.
5. Keep `xtra` untouched for its author; the replacement PR supersedes #55.

**Status: implemented on `feat/xtra-reconciled` (PR #64).** Deviations from the
steps above, for review:

- `b999458` and `32e4b74` were not replayed; the merged #58/#59 versions win.
- The new `predict-feeding` route was converted from manual Supabase auth to
  `withAuth` to match the audit standard.
- `BiomassLogTable` (a client-side table with its own filters) was removed as
  dead code; its source badges were added to the server-paginated biomass
  history table instead.
- The additive migration `20261021000000_add_biomass_log_source` ships with the
  branch and applies only on a production deployment.
- The AI switch retires `GEMINI_*`; set `OPENROUTER_API_KEY` in Vercel before
  this branch is promoted to production.

This is not part of the release candidate below.

## Release candidate

- Source: `staging@94297a3` → target `main@2795bef`.
- Contains: audit phase-1 security fixes, Next 16.4.2, superadmin/multitenancy,
  the branch/CI/deployment migration, and issues #48/#49.
- Migrations (production only, applied by the `main` deployment):
  - `20261017000000_add_platform_admin` — additive (enums, tables, indexes,
    trigger, idempotent insert).
  - `20261017010000_bootstrap_tenant_orgs` — additive backfill for existing
    ponds.
- No new environment variables (`apps/web/.env.example` is unchanged vs
  `main`).
- `apps/web/vercel.json` becomes active on `main` after promotion, which also
  satisfies the team rule "confirm the allowlist is active on `main`".
- Verification: CI green on `staging@94297a3` and `develop@0940a45`; staging
  deployment `READY`; build log shows migrations skipped for preview. A backup
  is recommended before the production deployment because it applies
  migrations.

## Protocol note

`team-development.md` took effect during this task. From now on agents do not
push `staging` or `main`: promotions are PRs that the human merges. The
`main+develop` allowlist in the global instruction conflicts with this
repository's explicit `staging+main` decision; the repository policy is kept
unless Jeff changes it.

