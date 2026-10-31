# Maintainability gates: dead code and complexity

Two automated checks keep the repository from accumulating code that nothing
uses and functions that keep growing. Both run in
[`.github/workflows/maintainability.yml`](../../.github/workflows/maintainability.yml)
on pushes and pull requests to `develop`, `staging` and `main`.

This document records what each check measures, the measured baseline, what is
deliberately exempt and why, and how to change a budget without weakening the
gate.

## 1. Dead code: Knip

**Tool:** `knip` (dev dependency at the workspace root). It reports unused
files, unused exports and types, unused dependencies and dev dependencies,
unlisted imports, unresolved imports, binaries and duplicate exports.

```bash
pnpm dead-code          # the gate: exits non-zero on any finding
pnpm exec knip --fix    # optional: remove unused exports automatically, then review
```

### What was found and what changed

The first run is not a meaningful number: the workspace dependencies had not
been installed, so Knip could not load `playwright.config.ts` or
`vitest.config.ts` and every page, test and e2e file looked unused (270 files).
After a correct `pnpm install`, the real baseline was:

| Category | Before cleanup | After cleanup |
| --- | --- | --- |
| Unused files | 9 | **0** |
| Unused dependencies | 3 | **0** |
| Unused exports | 55 | **0** |
| Unused exported types | 21 | **0** |
| Duplicate exports | 1 | **0** |
| Unused devDependencies / unlisted / unresolved / binaries | 0 | **0** |

The 55 exports and 21 types are the numbers after `ignoreExportsUsedInFile`
(see section 1.3). Before that option, Knip reported 182 unused exports, of
which 127 were exported only for use inside their own file - a redundant
keyword, not dead code.

**Removed because nothing referenced them:**

- `apps/web/components/ImageWithFallback.tsx`
- `apps/web/components/landing/LandingNav.tsx`
- `apps/web/components/ui/button.tsx` - the only consumer of `@base-ui/react`
  and `class-variance-authority`
- `apps/web/lib/api/index.ts` - a barrel nobody imported; the leaf modules
  (`envelope`, `errors`, `instrumentation`, `request-context`) are still
  imported directly

**Removed dependencies** (verified with `rg` across `apps/web`, not only Knip):

- `@base-ui/react` - only `components/ui/button.tsx` imported it
- `class-variance-authority` - only the same deleted file imported it
- `@fullcalendar/core` - a direct dependency of `@fullcalendar/react`, which
  declares and installs it itself; no application file imported it

**Narrowed, implementation kept:** 30 `export` keywords were removed (for
example `getSuperadminStats`, `getPlatformAdmins`, `startNextCycle`,
`loadPondProposalSettings`, `listRegisteredProviders`, `requireRole`,
`isChartEmpty`, the feeder manifest constants, and test helpers). The code still
exists; only the public surface shrank. This is deliberate: deleting an
implementation that a parallel branch might still be writing is riskier than
removing the keyword, and a follow-up can delete the function once the branch
lands.

Follow-up (#337, I-102): `getSuperadminStats`, `getPlatformAdmins`,
`loadPondProposalSettings`, `createDemoNotification` and their internal
`pondSettings` helper were deleted with the tests that were their only callers,
because no production code ever called them. `pnpm dead-code` reports zero
unused exports with no new exemptions.

Four exported types were narrowed the same way (`AnnouncementInput`,
`MachineFeedSource`, `JobStatus`, `PondDetail`), and two re-exports were trimmed
(`OtaEventType`, `CalendarCapability`).

**Barrel cleanup:** 38 re-export entries in
`apps/web/components/charts/index.ts` were unused. The barrel now exports only
what its importers use (`ChartLabels`, `ChartPoint`, `StackedSeries`,
`CHART_COLORS`, `Donut`, `LineTrend`, `MultiLineTrend`, `Sparkline`,
`StackedBars`). Consumers import chart data helpers from
`components/charts/chart-data` directly.

**Duplicate:** `discardOutboxItem` was an alias of `removeOutboxItem`; the alias
was deleted.

### 1.3 Configuration and exemptions

`knip.jsonc` is the whole configuration. It contains only things Knip cannot
infer:

| Setting | What it covers | Why it is not a suppression |
| --- | --- | --- |
| `entry: scripts/ota/sign-release.mjs` | Offline OTA release signer | Run by hand per `docs/firmware-ota-plan.md` and exercised by `firmware-sign-release.test.ts`; a CLI has no importer |
| `entry: e2e/global-setup.ts` | Playwright global setup | Loaded by path from `playwright.config.ts` |
| `entry: scripts/e2e/seed-e2e.ts` | E2E fixture seed | Run by name from CI and `docs/e2e-on-production.md` |
| `entry: scripts/provision-demo-user.ts` | Demo account provisioning | Run by hand per `docs/password-auth-plan.md` |
| `ignoreFiles: public/sw.js` | Service worker | Registered at runtime from `components/pwa/pwa-register.tsx`; not an ES module and has no importer |
| `ignoreExportsUsedInFile: true` | Exports used inside their own file | Those symbols are used; only the `export` keyword is redundant. Real unused exports are still reported |

There are no `ignoreDependencies`, `ignore` globs or `ignoreIssues` entries.
Anything added there needs a written reason in the same change.

### 1.4 What Knip cannot see

- A module loaded by a string path at runtime (the service worker is the known
  case; it is listed above). Add an `entry`, do not delete the file.
- Next.js entry points are covered by the Next plugin (`page`, `layout`,
  `route`, `error`, `sitemap`, `robots`, middleware/proxy, metadata images).
  A new convention file that the plugin does not know needs an explicit entry.
- A consumer outside this repository. The app is private and has none; if that
  changes, the exported surface is a deliberate API and belongs in `entry` or
  should be documented here.

## 2. Complexity: a purpose-built script

**Tool:** [`apps/web/scripts/check-complexity.mjs`](../../apps/web/scripts/check-complexity.mjs),
using the TypeScript compiler API already installed as a dev dependency. No
second linter, no ESLint config, no new dependency.

```bash
pnpm complexity                    # enforce the budget
node apps/web/scripts/check-complexity.mjs --report   # print the distribution only
```

**Metric:** cyclomatic complexity per function = 1 + decision points (`if`,
`case`, ternary, `for`, `for-in`, `for-of`, `while`, `do`, `catch`, `&&`, `||`,
`??`). Nested functions are scored separately, so a helper inside a function
does not inflate the parent.

**Scope:** `apps/web/lib/**/*.ts` and `*.tsx`, excluding `__tests__` and
`*.test.*`. That directory holds the planners, actions and domain rules where
branching accumulates. React components are excluded: their branches are
render-shape decisions, and a per-function budget over JSX produces noise
rather than insight.

**Measured baseline (2026-10-29, v1.29.0, commit `8eb6ce4`):** 213 files, 1,073
functions.

| Complexity | Functions |
| --- | --- |
| 1-5 | 819 |
| 6-10 | 163 |
| 11-15 | 57 |
| 16-20 | 16 |
| 21-25 | 12 |
| 26-40 | 3 |
| 41+ | 3 |

Worst offenders:

| Function | File | Complexity |
| --- | --- | --- |
| `buildGrowthPlan` | `lib/growth-plan.ts` | 98 |
| `loadCalendarEventSources` | `lib/calendar/event-sources.ts` | 62 |
| `runFallbackIntent` | `lib/chat/fallback.ts` | 43 |
| `buildChatContext` | `lib/chat/context.ts` | 37 |
| `buildSystemPrompt` | `lib/chat/prompt.ts` | 36 |

| File | Functions | Total |
| --- | --- | --- |
| `lib/actions/admin.ts` | 30 | 174 |
| `lib/assistant/catalog.ts` | 43 | 142 |
| `lib/crop-cycle/reminders.ts` | 27 | 142 |
| `lib/prediction.ts` | 27 | 132 |
| `lib/actions/superadmin.ts` | 23 | 130 |

**Budget** in [`apps/web/scripts/complexity-budget.json`](../../apps/web/scripts/complexity-budget.json):

- **function <= 100** (measured worst 98): a function cannot grow past the
  current worst offender;
- **file <= 180** (measured worst 174): a file cannot accumulate more total
  complexity than the current worst.

The zero-violation rule is the point: no new function may cross 100 and no file
may cross 180, so the worst case cannot get worse. The existing offenders are
recorded, not exempted - they still have to fit under the same limit.

**Why not a Biome/ESLint rule:** Biome 1.9 (the linter already in the repo) has
no per-function cyclomatic-complexity rule. Adding ESLint would mean a second
linter, a second config surface and a second CI install for one metric. The
TypeScript compiler is already a dependency, and the metric is simple enough to
keep correct in one readable file.

**Why not a raw line limit:** `lib/actions/admin.ts` is already over 1,700
lines. A line budget set just above it would ratify a large file; a lower one
would fail today. Cyclomatic complexity measures the thing that makes a function
hard to test and change, and the per-file total catches a new file assembled
from many medium functions.

### Changing a budget

Do not raise a limit to make a change pass. If a function genuinely needs to
grow, split it (extract the branch into a named helper with its own tests). If
the budget itself is wrong, change it in its own reviewed commit with the new
measurement pasted into the description, and update the baseline block in
`complexity-budget.json`. A budget change buried in a feature PR is a weakened
gate, even when the new number is defensible.

## 3. CI

Both checks are separate jobs so a failure names the problem:

| Job | Command | Fails when |
| --- | --- | --- |
| `dead-code` | `pnpm dead-code` | Any unused file, export, type, dependency, duplicate, unlisted or unresolved import |
| `complexity` | `pnpm complexity` | A function above 100 or a file above 180 in `apps/web/lib` |

The workflow holds `contents: read`, installs with `--frozen-lockfile` and never
deploys. It is intentionally separate from `ci.yml`: a maintainability failure
should not look like a failing test or a broken build.

## 4. Verification record

Run in the `mission/I-72-maintainability` worktree, based on `origin/develop`
`8eb6ce4`, on 2026-10-29:

| Check | Command | Result |
| --- | --- | --- |
| Lint and format | `pnpm lint` | 812 files, no findings |
| Types | `pnpm --filter web typecheck` | exit 0 |
| Unit tests | `pnpm test` | 241 files, 2,480 tests passed |
| Dead code | `pnpm dead-code` | exit 0, no findings in any category |
| Complexity | `pnpm complexity` | exit 0, budget satisfied |
| Production build | `npx next build` (dummy database and Supabase values) | succeeded; `BUILD_ID` written |

The build ran with the CI values, not production credentials, and the build
script's migration step is skipped outside `VERCEL_ENV=production`. The new
workflow's first run is the evidence for CI itself; it cannot be claimed from a
local shell.

## 5. Related

- [Operations index](./README.md)
- [ADR index](../adr/README.md)
- Coverage gate: `docs/e2e.md` and `apps/web/vitest.config.ts`
