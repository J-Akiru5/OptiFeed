# Browser and responsive compatibility

ISO/IEC 25010:2011 compatibility criterion for PakaonAI: the public product
pages and the responsive shell must work on the browsers our users actually
have — not only on Chromium.

This document is the supported matrix, the evidence behind it, and an honest
statement of what is **not** covered.

## Summary

| | |
| --- | --- |
| Engines exercised in CI | Chromium, Firefox, WebKit |
| Surface exercised on all three | the unauthenticated smoke (landing, login, privacy, terms) |
| Auth surface exercised | Chromium only |
| Responsive widths | 390 (phone), 834 (tablet), 1440 (desktop) |
| Mobile testing | emulated viewport, never a physical device |
| Snapshot testing | none — layout is asserted with invariants, not pixels |

## Supported browsers

"Supported" means we accept bug reports against it and the public smoke is a
release gate. Version floors are policy; the tested column is what CI actually
executed.

| Browser | Supported versions | Support | Tested in CI | Evidence |
| --- | --- | --- | --- | --- |
| Chrome (desktop) | 140+ (current and previous stable) | Yes | Yes — smoke + authenticated suite | Chromium 151.0.7922.34: 18/18 smoke, Chromium authenticated suite |
| Microsoft Edge (desktop) | 140+ | Yes | Indirect — same Chromium engine | Chromium project; no separate Edge channel |
| Firefox (desktop) | 145+ | Yes | Smoke only | Firefox 153.0: 18/18 smoke |
| Safari (macOS) | 18.4+ | Yes | Smoke only, via Playwright WebKit | WebKit 26.5: 18/18 smoke |
| Safari (iOS/iPadOS) | 18.4+ | Yes, emulated layout only | No physical device | WebKit engine at 390/834 px viewports |
| Chrome (Android) | current | Yes, emulated layout only | No physical device | Chromium engine at 390/834 px viewports |
| Chromium derivatives (Opera, Brave, Vivaldi) | current | Best effort | No | Engine-compatible with Chromium, not separately verified |
| Samsung Internet | current | Best effort | No | Chromium-based, not separately verified |

### Why these floors

- The app is a Next.js 16 / React 19 client with ES2022 output, `dvh`,
  `:has()`, container queries, `oklch` colours from Tailwind 4 and a service
  worker. Those features landed in Chromium 105–111, Firefox 110–121 and
  Safari 15.4–16.4. The floors above leave a wide safety margin.
- Safari 18.4 is the oldest Safari that still receives security updates at the
  time of writing; older Safari is best effort and untested.
- Playwright 1.62.1 ships Chromium 151, Firefox 153 and WebKit 26.5. Those are
  the exact engines behind every "tested" claim in this document.

## Explicitly unsupported

| Target | Status | Reason |
| --- | --- | --- |
| Internet Explorer 11 | Unsupported | No ES modules, no CSS grid/gap, no service worker |
| Legacy Edge (EdgeHTML) | Unsupported | Engine retired; no ES2022 output |
| Safari 15 and older | Unsupported | Missing `:has()`, `dvh`, modern colour functions |
| Firefox ESR 115 and older | Unsupported | Below the policy floor |
| Opera Mini | Unsupported | Server-side rendering proxy; no client app runtime |
| Browsers with JavaScript disabled | Unsupported | The app is a client-rendered SPA behind server-rendered shells |
| Native mobile apps | Not applicable | There is no native client; the PWA is the mobile surface |
| Physical phones/tablets | Not tested in CI | No device farm. Layout is emulated; touch, DPR, mobile UA, iOS Safari chrome and virtual keyboards are **not** covered |

WebKit from Playwright is **not** Apple Safari. It is the same engine family
built for Windows/Linux CI. A pass there is strong evidence the WebKit engine
renders the app; it is not a certificate for a specific macOS or iOS build.

## Test split

The authenticated suite (`apps/web/e2e/*.spec.ts`) runs on **Chromium only**.
A small public smoke (`apps/web/e2e/smoke/public.spec.ts`) runs on **all three
engines**.

Why not multiply the whole suite:

- it is serial (`workers: 1`) because logins are limited to 5 attempts/60 s and
  device/RBAC specs mutate shared fixture state — three times the wall clock and
  three times the rate-limit pressure;
- it needs Supabase Auth plus the production `e2e-` fixture, so it cannot run in
  a credential-free CI job;
- most specs assert business flows, not rendering. Engine-specific breakage
  shows up on first paint, which the public smoke already covers.

What the smoke asserts on every engine:

1. `/en`, `/en/login`, `/en/privacy`, `/en/terms` return 200, render their
   `h1`, and produce no console errors or uncaught exceptions;
2. at 390, 834 and 1440 px: no horizontal page overflow, the top-bar nav vs the
   mobile menu button switch at the `lg` breakpoint, the language switcher moves
   into the mobile menu on phones, header/footer "back" links swap on login,
   the wide legal tables scroll inside their container instead of the page, and
   the landing hero's dashboard preview stays inside the viewport;
3. the language switch changes URL, `<html lang>` and the rendered bundle
   (English → Hiligaynon and back; English → Tagalog on the landing page).

The authenticated responsive spec (`apps/web/e2e/responsive.dashboard.spec.ts`)
adds the dashboard shell at the same three widths: no horizontal overflow, the
chat toggle fully inside the viewport, and no overlap with the bottom navigation
below `lg`. It is part of the Chromium suite because `/dashboard` needs a
session.

### Known console noise the smoke ignores

Two messages are environment noise, not defects, and the filter matches only
these exact cases:

- Vercel Analytics / Speed Insights scripts (`/_vercel/insights/*`,
  `/_vercel/speed-insights/*`) are served by the Vercel edge and 404 locally;
- the app ships a `Content-Security-Policy-Report-Only` header without a
  `report-to` endpoint, so every engine logs Next.js's inline bootstrap script
  as a report-only violation. Nothing is blocked; the enforced policy does not
  use this directive.

Any other console error fails the smoke.

## How to run

```powershell
cd apps/web
pnpm exec playwright install firefox webkit   # once per machine
pnpm test:e2e:smoke                            # builds must exist; starts `next start -p 3100`
```

To target an already running instance:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3000"
pnpm test:e2e:smoke
```

CI runs `.github/workflows/e2e-smoke.yml` on every push and pull request to
`develop`, `staging` and `main`: it builds with dummy env, installs all three
browsers and runs the smoke. It needs no database or Supabase project. The
authenticated suite remains a separate, fixture-gated job (see
[`docs/e2e-on-production.md`](./e2e-on-production.md)).

## Evidence (2026-10-29, worker I-67)

Environment: Windows 11, Node 24.14.0, pnpm 10.33.3, Playwright 1.62.1,
`next build` + `next start -p 3100` with dummy `DATABASE_URL` and dummy
`NEXT_PUBLIC_SUPABASE_*` (no Supabase project, no database).

| Command | Result |
| --- | --- |
| `playwright test --config=playwright.smoke.config.ts --project=chromium` | **18 passed** (45.1 s) |
| `playwright test --config=playwright.smoke.config.ts --project=firefox` | **18 passed** (1.2 min) |
| `playwright test --config=playwright.smoke.config.ts --project=webkit` | **18 passed** (50.5 s) |
| all three projects together | **54 passed** (1.4 min) |

Per-page layout result at 390 / 834 / 1440 px: `scrollWidth == clientWidth` for
`/en`, `/en/login`, `/en/privacy`, `/en/terms` on all three engines. The
privacy/terms section tables (42rem minimum) scroll inside their own container
on phones and fit on tablets; neither pushes the document wider.

Not executed here:

| Check | Why not | Where it runs |
| --- | --- | --- |
| `e2e/responsive.dashboard.spec.ts` | Needs Supabase Auth and the `e2e-` fixture; Docker is not installed in this worker environment | Chromium authenticated suite |
| The authenticated suite as a whole | Same reason | Chromium authenticated suite |
| `e2e/offline-pwa.spec.ts` (offline behaviour) | Same reason | Chromium authenticated suite |

No cross-browser defect was found, so no application code changed in this
workstream.

## Maintenance

- Bumping `@playwright/test` changes the bundled engines: run
  `pnpm exec playwright install firefox webkit`, re-run the smoke and update the
  versions in this table (and the floors if a browser drops a feature).
- Adding a public route: add it to `PUBLIC_PAGES` in
  `apps/web/e2e/smoke/public.spec.ts`; the responsive loop picks it up.
- Adding an authenticated surface with a floating control or a width-sensitive
  layout: extend `e2e/responsive.dashboard.spec.ts`, not the smoke.
- When a real device is tested manually, record the device, OS version and date
  here. Until then the matrix says "emulated", not "verified on device".
