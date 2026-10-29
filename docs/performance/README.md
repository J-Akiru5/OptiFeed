# Performance evidence (ISO 25010 readiness, W7)

Three budgets, each calibrated against a measurement recorded on this tree rather than a guessed
constant. Everything here is reproducible offline except the Lighthouse run, which needs Chrome but
no database.

| Budget | Artefact | Gate | Where it runs |
|---|---|---|---|
| First-load JS per route | [`perf/bundle-budget.json`](../../perf/bundle-budget.json) | `scripts/perf/bundle-budget.mjs` | `perf.yml` job `bundle-and-latency` |
| Lighthouse scores + resource sizes | [`lighthouserc.json`](../../lighthouserc.json) | `@lhci/cli assert` | `perf.yml` job `lighthouse` |
| API latency p50/p95 (+ page render evidence) | [`perf/baseline/api-latency.json`](../../perf/baseline/api-latency.json) | `scripts/perf/api-latency.mjs --baseline` | `perf.yml` job `bundle-and-latency` |
| Heaviest queries / index coverage | [`query-audit.md`](./query-audit.md) | reviewed document | n/a (static analysis) |
| Latency baseline detail + DB plan | [`api-latency.md`](./api-latency.md) | reviewed document | n/a |

No schema change, no migration, no deploy is part of this work.

## Reproduction

```bash
pnpm install --frozen-lockfile
pnpm --filter web prisma:generate

# `next build` directly, never `pnpm build` (that script runs `prisma migrate deploy`).
cd apps/web && npx next build && cd ../..

pnpm perf:bundle                     # first-load JS vs perf/bundle-budget.json
pnpm perf:latency -- --spawn         # starts its own `next start`, then stops it
pnpm perf:lighthouse                 # Chrome + @lhci/cli; starts and stops the server itself
```

The build and both harnesses read only dummy credentials, exactly like `ci.yml`:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/ci_dummy
DIRECT_URL=postgresql://user:pass@localhost:5432/ci_dummy
NEXT_PUBLIC_SUPABASE_URL=https://ci-dummy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy-anon-key
```

## First-load JS

### How it is measured

`next build` on Next 16 with Turbopack no longer prints the classic "Size / First Load JS" table, so
the numbers are derived from the build output:

```
first-load JS = buildManifest.rootMainFiles
              + every client chunk in the route's page_client-reference-manifest.js
```

Units are uncompressed bytes / 1024, matching Next's own convention. Assertions run on raw bytes, so
the result does not depend on the compression settings of whatever serves the build.

`polyfillFiles` is excluded: Next emits that chunk with `noModule`, so current browsers never fetch
it. Including it would add about 110 kB to every route.

**Validation.** The derivation was cross-checked byte-for-byte against a running `next start` on
2026-10-29 by summing the non-`noModule` `<script src>` sizes in each document:

| Route | URL | Derived | Live HTML | Match |
|---|---|---|---|---|
| `/[locale]/page` | `/en` | 798.2 kB | 798.2 kB | yes |
| `/[locale]/login/page` | `/en/login` | 845.5 kB | 845.5 kB | yes |
| `/[locale]/privacy/page` | `/en/privacy` | 586.9 kB | 586.9 kB | yes |
| `/[locale]/terms/page` | `/en/terms` | 586.9 kB | 586.9 kB | yes |

The remaining 52 routes cannot be validated the same way because they are behind the auth guard,
which is why the manifest derivation (which works for all of them) is the gate.

### Measured baseline

Shared by every route (`rootMainFiles`): **432.4 kB**.

| Route | Measured | Budget (+2%) |
|---|---|---|
| `/[locale]/page` (landing) | 798.2 kB | 814.2 kB |
| `/[locale]/login/page` | 845.5 kB | 862.5 kB |
| `/[locale]/privacy/page` | 586.9 kB | 598.7 kB |
| `/[locale]/terms/page` | 586.9 kB | 598.7 kB |
| `/[locale]/(dashboard)/dashboard/page` | **1455.4 kB** | 1484.6 kB |
| `/[locale]/(dashboard)/dashboard/history/page` | 1432.6 kB | 1461.3 kB |
| `/[locale]/(dashboard)/dashboard/growth/history/page` | 1396.1 kB | 1424.1 kB |
| `/[locale]/(superadmin)/superadmin/operations/page` | 1346.6 kB | 1373.6 kB |
| `/[locale]/(superadmin)/superadmin/page` | 1342.3 kB | 1369.2 kB |
| `/[locale]/(dashboard)/dashboard/calendar/page` | 1200.7 kB | 1224.8 kB |
| `/[locale]/(dashboard)/dashboard/settings/hardware/page` | 1116.5 kB | 1138.9 kB |
| `/[locale]/(admin)/admin/page` | 1079.9 kB | 1101.5 kB |
| `/[locale]/(admin)/admin/audit/page` | 653.4 kB | 666.5 kB |
| `/[locale]/change-password/page` | 592.7 kB | 604.6 kB |

All 56 measured routes are in `perf/bundle-budget.json` with their own `budgetKb`.

### Gate semantics

- A route whose measured size exceeds its `budgetKb` fails the job (exit 1).
- A route that has no entry in the file is compared against `defaultMaxKb` (1484.6 kB = the largest
  measured route + 2%). A new page therefore cannot import a heavy library unnoticed, and inherits the
  current worst case until someone adds an explicit entry for it.
- The shared bootstrap chunks have their own ceiling (441.1 kB).
- A budget entry for a route that no longer exists is reported as a warning, not an error.
- A missing build output, a missing chunk on disk, or an unreadable budget file exits 2 — the script
  never reports success it did not measure.

**Raising a budget is a reviewed decision.** It must be argued in the PR that needs it; refreshing
the file is never a way to make a red job green.

```bash
# Regenerate every route budget from the current build (writes, does not print):
node scripts/perf/bundle-budget.mjs --write --out perf/bundle-budget.json
```

### What the numbers say

- The shared bootstrap is 432.4 kB uncompressed, about 3:1 compressible. On `/en` Lighthouse measures
  269 kB of script over the wire for 798 kB of first-load JS.
- The heaviest routes are the dashboard family at 1.40-1.46 MB. `recharts`, `jspdf`/`jspdf-autotable`,
  `jszip`, `papaparse` and `@fullcalendar/*` are all dependencies of pages in that group, and the
  dashboard is the most expensive single page.
- The landing page carries a large amount of client-side markup for a marketing page: the whole
  `app/[locale]/page.tsx` is a client component (`"use client"`), so its entire tree ships.

## Lighthouse

### How it runs

`lighthouserc.json` collects three runs per URL (LHCI asserts on the median run) against
`http://127.0.0.1:3111`, starting and stopping `pnpm --filter web start` itself. Mobile preset,
simulated throttling, headless Chrome. `@lhci/cli` is pinned to `0.15.1` in the workflow so a new
release cannot shift the scores a committed budget was calibrated against.

### Audited pages

| URL | Why it is in scope |
|---|---|
| `/en` | Public landing page, no session needed |
| `/en/login` | Public login page, no session needed |
| `/en/privacy` | Public legal page |
| `/en/terms` | Public legal page |

### Excluded pages and why

Every other route in the build output is marked dynamic (`ƒ`) and sits behind
`apps/web/lib/auth/navigation-guard.ts` via `proxy.ts`. Requesting one without a session cookie
returns a `307` to `/en/login`, so Lighthouse would score the redirect, not the page. Specifically:

| Excluded | Reason |
|---|---|
| `/en/dashboard` and the other 24 `(dashboard)` routes | `307` to login without a session; renders only with a database + Supabase session |
| `/en/admin/*` | `307` to login; requires an authenticated ADMIN |
| `/en/superadmin/*` | `307` to login; requires a `PlatformAdmin` row |
| `/en/change-password` | `307` to login |
| `/en/admin/devices/labels`, `/en/superadmin/devices/labels` | `307` to login (print views) |

Auditing them is a follow-up that needs a seeded database and a session fixture (see
[`api-latency.md`](./api-latency.md), which lists the same prerequisite for the DB-backed requests).

### Measured baseline (2026-10-29, three runs each)

Medians as LHCI reports them, with the full spread in brackets:

| URL | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/en` | 77 (61-81) | 93 | 93 | 100 |
| `/en/login` | 80 (74-83) | 96 | 89 | 66 |
| `/en/privacy` | 83 (76-89) | 97 | 93 | 100 |
| `/en/terms` | 91 (79-91) | 97 | 93 | 100 |

| Metric | `/en` | `/en/login` | `/en/privacy` | `/en/terms` |
|---|---|---|---|---|
| FCP (ms) | 1364-1786 | 1368-1390 | 1512-1604 | 1362-1377 |
| LCP (ms) | 4175-4557 | 4129-4493 | 3719-3858 | 3383-3838 |
| TBT (ms) | 227-891 | 182-373 | 63-487 | 45-387 |
| CLS | 0 | 0 | 0 | 0 |
| Transfer, script | 269,222 B | 270,836 B | 200,223 B | 200,223 B |
| Transfer, total | 495,837 B | 466,301 B | 408,810 B | 396,948 B |
| Third-party requests | 0 | 0 | 0 | 0 |

### Budgets

Category floors, each set two to three points under the **worst** of the three measured runs so that
the recorded spread cannot fail the job and a real regression still does:

| URL | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/en` | 0.58 | 0.90 | 0.90 | 0.95 |
| `/en/login` | 0.71 | 0.93 | 0.86 | *not asserted* |
| `/en/privacy` | 0.73 | 0.94 | 0.90 | 0.95 |
| `/en/terms` | 0.76 | 0.94 | 0.90 | 0.95 |

Numeric budgets, identical for every audited URL:

| Assertion | Budget | Measured worst |
|---|---|---|
| `first-contentful-paint` | 2500 ms | 1786 ms |
| `largest-contentful-paint` | 5000 ms | 4557 ms |
| `total-blocking-time` | 800 ms | 891 ms (single outlier run; median 233 ms) |
| `cumulative-layout-shift` | 0.02 | 0 |
| `speed-index` | 6000 ms | 5054 ms |
| `interactive` | 6000 ms | 5070 ms |
| `server-response-time` | 1000 ms | 299 ms |
| `resource-summary:script:size` | 285,000 B | 270,836 B |
| `resource-summary:total:size` | 520,000 B | 495,841 B |
| `resource-summary:third-party:count` | 0 | 0 |

`total-blocking-time` is the one budget above a measured value rather than at +10%: a single `/en` run
hit 891 ms while its median was 233 ms. Budgeting the outlier would make the gate meaningless;
budgeting 233 ms would make it flaky. 800 ms is above every recorded median and below every recorded
maximum, so it catches a genuine main-thread regression without tripping on a noisy run.

### Why two categories are capped where they are

**`/en/login` has no SEO budget.** Lighthouse's `is-crawlable` audit fails because the login page is
served with `noindex`, which is correct for an authentication page. Asserting a SEO floor there would
either force a wrong `noindex` removal or encode a false failure. SEO is asserted on the three pages
that are meant to be indexed.

**Best practices is 89-93, not 100, on every page.** The failing audits are
`errors-in-console` and `inspector-issues`, and both have one cause: the Vercel
`<Analytics />` / `<SpeedInsights />` components request `/_vercel/insights/script.js` and
`/_vercel/speed-insights/script.js`, which only exist when the app runs on Vercel. Locally those
requests 404, and the enforced CSP then refuses to execute the `text/plain` 404 body. The numbers are
therefore capped by a local environment artifact, not by an application defect. Re-measuring against
a deployed preview would remove the artifact.

### Findings worth acting on later (not fixed here)

- `/en` LCP is 4.2-4.6 s under mobile simulation, above the 2.5 s "good" threshold. The `unused-javascript`
  and `legacy-javascript` audits both fail: the route ships a full client component tree and the
  shared bootstrap includes code the landing page never uses.
- `color-contrast` fails on all four pages, and `label-content-name-mismatch` on `/en`, `/en/privacy`
  and `/en/terms` (`/en` also trips `aria-prohibited-attr`). These belong to the accessibility
  workstream (I-68), and they are why accessibility is 93/96/97 rather than 100.
- `dom-size` and `mainthread-work-breakdown` fail on `/en` (a single very large client component).
- `bf-cache` fails on all four pages. It is not part of the four asserted categories, so it does not
  fail the job.

## Known limits of this evidence

- Lighthouse ran locally (Chrome 156.0.8078.48, Windows 11, Node 24.14.0) and in `perf.yml` on
  `ubuntu-latest`. Numbers move between them; the budgets are set from the local run and have
  between 15% and 100% headroom on the numeric assertions.
- **The page-render latency numbers are evidence, not a gate.** The same four pages measured 24-31 ms
  p50 on a quiet machine and 43-119 ms p50 twenty minutes later with no code change, because other
  work was running on the host. Wall-clock gates are on the stable surfaces (the DB-free API pipeline,
  the auth guard redirect); the page-level gate is Lighthouse `server-response-time` ≤ 1000 ms. The
  full reasoning is in [`api-latency.md`](./api-latency.md).
- The bundle figures are uncompressed. The Lighthouse `resource-summary` figures are transfer sizes.
  They are different measurements of the same code and are budgeted separately.
- No database exists in this environment, so `/api/health` cannot report a healthy path and no
  DB-backed endpoint is in the latency baseline. See [`api-latency.md`](./api-latency.md) for the
  exact follow-up.
- `query-audit.md` is static analysis. No `EXPLAIN` was run because no database is reachable here.
