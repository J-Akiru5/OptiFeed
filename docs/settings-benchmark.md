# Settings benchmark — device settings layout

Issue: [#403](https://github.com/J-Akiru5/optifeed/issues/403). Scope: the device settings page
(`app/[locale]/(dashboard)/dashboard/settings/hardware/page.tsx`, reached from Settings and from
`/dashboard/app-settings`). Proposal only; no application code changes in this PR. The visual
proposal is [`settings-gui-proposal.html`](./settings-gui-proposal.html).

## The three complaints, checked against the code

| # | Complaint | What the code does today |
| --- | --- | --- |
| 1 | Page is too long to scroll | One server page stacks the 3D feeder hero plus 9 `DashboardSection`s: Device Status, WiFi setup, Daily feed ceiling, Hopper Calibration, Feed Rate Calibration, Recalibration schedule, Temperature Calibration, Calibration history, Device Actions. |
| 2 | No device selector | The page loads `getActivePond()` and then `prisma.energyDevice.findFirst({ where: { pondId }, orderBy: { createdAt: "asc" } })`. A second feeder on the same pond can never be configured here; another pond's feeder needs the pond switcher (#303) first. |
| 3 | Saving sends the user to the dashboard | Not reproduced in code. Every form on this page (`DeviceDailyCapForm`, `HopperCalibrationForm`, `DurationCalibrationForm`, `RecalibrationIntervalForm`, `TemperatureCalibrationForm`, `PondSettingsForm`) shows a sonner toast or inline message and calls `router.refresh()`; none navigates. The only `router.push("/dashboard")` in a form is `LogSampleForm`. **Needs Jeff to name the screen where it happens.** |

## What production systems do

"Verified" = confirmed from the cited source during this benchmark. "Unverified" = press coverage,
memory or inference.

| System | Navigation | Which device/entity | Save model | Mobile |
| --- | --- | --- | --- | --- |
| [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings) | Left sidebar of sections (verified) | Team + project chosen before Settings; fixed in URL/header (verified) | Save per section card, page stays (unverified) | Sidebar collapses (unverified) |
| [GitHub repo settings](https://docs.github.com/en/enterprise-server@3.0/pages/getting-started-with-github-pages/creating-a-github-pages-site) | Settings tab, then left sidebar (verified) | Repo in URL and header | [Primer](https://primer.style/ui-patterns/saving): one Save per form, `beforeunload` guard, inline success when not redirecting (verified) | Unverified |
| [Stripe Apps SettingsView](https://docs.stripe.com/stripe-apps/components/settingsview) | Single view | n/a | Save button; "saved" status in header; user stays (verified) | n/a |
| [Home Assistant](https://www.home-assistant.io/docs/configuration/customizing-devices/) | Device page of cards (unverified) | Device list, then device page | Explicit **Update** per dialog (verified) | Responsive (unverified) |
| [Google Home](https://support.google.com/googlehome/answer/7071794) | Device tile → gear → one long list (verified) | Picked per device; settings repeat per device (verified) | Toggles apply immediately (unverified) | Native app |
| [Shelly](https://asia.shelly.com/blogs/documentation/shelly-1-web-interface-guide) | Device detail → sections | Device list | "Save Device" button (verified) | Native app |
| Particle console | Device list → device view (unofficial, [forum](https://community.particle.io/t/particle-tools-changelog/26943/28)) | Row in device list | Function calls run immediately | Unverified |
| Petlibro, Tuya, SmartThings, Eufy | Device card → device page → gear (inference; [Petlibro review](https://www.podfeet.com/blog/2023/08/petlibro-cat-feeder/)) | Home-screen device list/carousel | Toggles autosave, schedules explicit Save (inference) | Native apps |

Not reachable during the benchmark: the shadcn `/examples/forms` page (404 on the v4 site), UniFi
and Home Assistant device-page docs, Linear save behaviour.

## Design guidance (verified)

- [NN/g, Tabs, Used Right](https://www.nngroup.com/articles/tabs-used-right/): few tabs, one row,
  directly above the panel, 1–2 word labels, most-used tab first and default; no tabs when users
  must compare across them; accordions often better on mobile.
- [Material](https://m2.material.io/go/design-tabs): at most 4 fixed tabs, otherwise scrollable
  tabs. [Apple HIG](https://developer-mdn.apple.com/design/human-interface-guidelines/components/selection-and-input/segmented-controls):
  about 5 segments on iPhone.
- [Primer saving](https://primer.style/ui-patterns/saving): never mix explicit and automatic save in
  one form; toggles may save instantly, inputs/selects explicit; warn on unsaved changes.
- [Radix Tabs](https://www.radix-ui.com/primitives/docs/components/tabs) implements the WAI-ARIA
  tabs pattern (arrows, Home/End) with controlled `value`, which allows `?tab=` URL sync.
  [shadcn Tabs](https://ui.shadcn.com/docs/components/tabs) wraps it.

## Proposal for OptiFeed

1. **Four URL-synced tabs: Overview · Feeding · Calibration · Network.** Within Material's 4-tab
   limit and NN/g's "few tabs". `?tab=` keeps refresh, back and deep links working, so the
   dashboard's low-hopper or weak-signal alerts can link straight to `?tab=calibration` or
   `?tab=network`.
   - Overview (default): 3D feeder hero, device status, device actions.
   - Feeding: daily feed ceiling (the setting changed most often).
   - Calibration: hopper, feed rate, temperature, recalibration schedule; calibration history
     collapsed at the bottom.
   - Network: WiFi setup and signal reading.
2. **Device switcher in the page header, above the tabs.** Lists every feeder the user can see
   (label, pond, online dot), grouped by pond. Selection goes in the URL
   (`?device=<id>&tab=…`), not a new route, so existing links keep working; the server
   re-checks that the device belongs to an allowed pond (same scope as `listSelectablePonds`).
   Switching keeps the current tab. Hidden when the user has one feeder.
3. **Save stays on the page.** Each card keeps its own Save (Primer's one Save per form, already
   how the forms behave), success is a toast plus inline "Saved", never a redirect.
4. **Unsaved-changes guard.** A dirty form puts a dot on its tab; switching tab or device while
   dirty opens a Save / Discard / Cancel dialog; `beforeunload` covers refresh and close. The App
   Router has no route-change event, so the tab and switcher handlers check the dirty state
   themselves.
5. **Mobile.** Tab list scrolls horizontally with 44 px targets and the active tab scrolled into
   view; four short labels fit a 375 px screen without scrolling in the mockup.

## Decisions needed from Jeff

1. Approve the four-tab grouping (or move a section).
2. Device in the query string (`?device=`) vs. a new `/dashboard/devices/[id]/settings` route.
   Recommendation: query string — smaller change, no broken links.
3. Tabs implementation: the repo has no `@radix-ui/*` dependency and `components/ui` holds no
   Tabs. Options: add `@radix-ui/react-tabs` (shadcn Tabs) or hand-roll a WAI-ARIA tabs component
   like `pond-selector.tsx` already hand-rolls its menu. Recommendation: hand-roll, to match the
   existing pattern and stay inside the bundle budget check.
4. Which screen sends you to the dashboard after saving (complaint 3)?
