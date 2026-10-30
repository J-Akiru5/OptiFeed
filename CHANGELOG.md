# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- `applyGrowthPlanForPond` is no longer a browser-callable server action that trusted the caller's `ownerId`; a static guard test prevents regressions.
- Device-token reveals are audited and rate limited.

## [Unreleased]

### Added

### Fixed

- #387 Feed Now is no longer hard-rejected at the 1,000 g request cap regardless of the pond configuration. The manual ceiling is now the lower of the pond/device per-meal dose, the remaining daily ceiling from the single daily-cap calculation, and the 1,000 g absolute safety ceiling. The dashboard, schedule and controller dialogs show the effective limit and the reason, refusals name the setting and every relevant number with a Settings > Pond hint, and the dashboard's scheduled dose is capped to the effective limit instead of failing. The 1,000 g hard ceiling is unchanged and was not raised.

### Changed

- #371 a failed pond settings save keeps every value the reader typed and restores an unsaved draft after leaving the page; errors render under their field and in a summary whose links move focus to the field. Device conflicts are resolved in the pond's favour: the daily ceiling can be set from the pond value (still bounded by the 500-5,000 g window and never above a platform or hopper ceiling), and a meal the relay window cannot run links to calibration with the fewest feeds that would fit. The per-meal dose is derived from the typed values before the schedule command validates it, so a save is no longer refused by a stale dose.


## [1.31.8] - 2026-10-30

### Changed

- Reconciles the GitHub Actions version bumps that landed on `staging` (dependabot targeted the default branch) back into `develop`: `checkout`, `setup-node`, `pnpm/action-setup`, `upload-artifact` and the rest of the group move from v4 to v7 across all nine workflows.
## [1.31.7] - 2026-10-30

### Fixed

- #382 the sidebar scrolled away with the page on the farmer dashboard (and in the admin and superadmin consoles). The shell was a `min-h-dvh` column whose document scrolled while the sidebar used `position: sticky`; the document scroll container won. All three shells are now fixed-height app frames: the document does not scroll, the sidebar is a full-height column, and only the main pane scrolls.
## [1.31.6] - 2026-10-30

### Changed

- #381 the offline indicator is no longer a large, undismissable card that read like an error toast. It is now a compact pill with a dismiss control and a polite live region; dismissing hides it for that outage only, and it returns after the connection recovers and drops again.
## [1.31.5] - 2026-10-30

### Security

- #329 platform audit rows recorded the left-most `X-Forwarded-For` entry, which is client-controlled, so an action could be attributed to a forged IP. Client-address derivation now lives in one helper that uses only the trusted edge hop, records `null` for a missing or malformed header, and is shared by the audit writer and the rate limiter.
- #330 `feed-command` and `schedule-sync` consumed the device rate-limit bucket using an unverified `device_id`, so anyone knowing a MAC could hold a unit at 429. Both routes now verify the token first and limit on the verified MAC; a 25-request unauthenticated flood no longer affects the real device.
- #331 platform `rotateDeviceToken` returned a plaintext token with no reveal limiter, and `updatePlatformUser` could change a legacy role without step-up. Rotation now uses the same 10/hour reveal bucket as the tenant path, and role changes run inside `withStepUp` with an audit row; display-name-only edits stay unprivileged.
- #364 `firmware/check` consumed its rate-limit bucket on an unverified `device_id`, so anyone knowing a MAC could hold a unit out of the OTA channel. It now verifies the token and approval first and limits on the verified MAC.

### Fixed

- #335 `updatePlatformUser` persisted blank, whitespace-only or over-long display names. It now applies the same trim/required/max-80 rule as the tenant `updateUser` and writes nothing on rejection.
- #324 the legal working note still described release 1.11.0 and "only v1.0.0" in its version snapshot; it now matches the current release and tag history.
- The CI performance job no longer waits out its 30-minute timeout: the latency harness signals the spawned Next server's process group, releases the child pipes and has a bounded exit.

## [1.31.3] - 2026-10-30

### Fixed

- The feeder Iso view now locks rotate and zoom, so the six component labels stay perfectly anchored instead of disappearing after a drag. Every other preset keeps orbit/zoom and shows no labels; this supersedes the 1.31.0 orbit-clears behavior.
- Mobile now renders the same six anchor dots and leaders as desktop, with compact 8/15/9 px callouts capped at `min(96px, 28%)` of the stage. The 2 x 3 status list is now `sr-only` at every width and remains the `aria-describedby` summary.
- Added a bottom hint stating that component labels appear only while the model is in the Isometric view.

## [1.31.2] - 2026-10-30

### Added

- #344 Pakoy can now perform the whole write surface the signed-in user is permitted to use: biomass update/delete, calendar item update/delete/reopen, pond archive/restore/delete, device move/unassign, member revocation, device-token reveal and rotation, platform remote feed/pause, platform user disable/enable and platform-admin grant/revoke. Every new action reuses the existing server action and its guards, and the proposal step surfaces `step_up_required` rather than executing.
- Refusals are specific ("Only a platform admin can...", "You need the manage_members permission...", "Re-enter your password...") and are produced by both the planner and Accept.
- The intent router understands the wider vocabulary and carries conversation history, so a short reply to Pakoy's own clarifying question continues the same action instead of falling through to chat.

### Security

- 21 new assistant actions were added with an allow **and** deny matrix (74 accept cases across all 37 kinds) and a guard-matrix test asserting each action satisfies the same guard as its UI counterpart. Password-bearing provisioning, hardware enrolment, calibration procedures and pond/cycle forms remain intentionally unavailable in chat.
- The assistant catalogue was split into per-surface modules so the complexity budget holds (worst file 79/180); function coverage is 95.08% against a 94.5% threshold.
## [1.31.1] - 2026-10-30

### Fixed

- #347 ABW and FCR now explain themselves: an info affordance on the dashboard, growth, history and calculator surfaces opens on hover **and** keyboard focus, is announced through `aria-describedby`, and describes the real math (average body weight = sample weight / fish weighed; FCR = kg feed per kg gained, lower is better).
- #348 the calendar's details sheet and editor name the item they act on, so a task no longer says "Edit pond event" or "Delete this pond event?"; every task label, toast and confirmation follows `itemKind`, while cycle milestones keep their event wording.
- #351 the admin settings page now has one consistent structure: a single labelled section per group, real heading hierarchy (h2 to h3), the shared 1/2/3 column grid, the pager bled to the card edges, a members table hidden below `md` (no more phone-width horizontal scroll), a corrected members total, and every control at least 44 px. The page is also covered by the axe gate.
## [1.31.0] - 2026-10-30

### Added

- The feeder 3D viewer now shows six component labels ? hopper, ultrasonic sensor, controller, motor, auger and outlet ? with statuses derived from the feeder status and hopper level. They appear only in the ISO preset, use fixed Solis-style callout slots with 1 px leaders and anchor dots, and fall back to a 2 x 3 semantic status list below `md`. The ISO stage is now the owner-approved front-left angle; manual orbit clears the labels and pressing ISO restores them. The card gains the PakaonAI navy product-stage glow and an orange active preset pill.
- The public landing hardware section now features the tape-calibrated feeder model as a transparent ISO poster, with a research-prototype caption and the existing six-row parts table below. The poster is 20.9 kB WebP and loads lazily; the 3D runtime is not added to the public page.

### Fixed

- The post top is 105 mm above the hopper/lid top: **615 mm**, down from 750 mm. Model asset **1.1.2**; service-worker cache **v8**.

## [1.30.3] - 2026-10-29

### Fixed

- Feeder layout amendments from the owner's photos: the black controller panel now touches the sticker with no gap, the 750 mm post sits against the jar's right side and the chassis with its arm parallel to the front, the jar is 20 mm shorter, and a vertical white plank supports the left edge of the hopper shelf. Model asset `feeder-v1.1.1.glb` (1,165,132 bytes, 38,284 triangles); service-worker cache **v7**.

## [1.30.2] - 2026-10-29

### Fixed

- #316 the dashboard header's `LAST SYNCED` label and its relative time are translated (`en`/`hil`/`tl`) with ICU plurals instead of hard-coded English, and the profile menu's device status uses the catalogue rather than the raw enum. A gate entry stops the literal from coming back.
- #320 `DeviceDailyCapForm` now uses the shared calibration field, so the daily ceiling is clearable, steps in 50 g units, reports range errors accessibly and lines up with the other calibration cards.
- #345 the account dropdown is readable in dark mode (Admin Panel 3.34:1 → 4.89:1, device offline 2.62 → 5.08, missing 3.03 → 9.96) and finally links to Account settings at `/dashboard/settings/profile`.
- The feeder 3D model is rebuilt from the tape measurements: a 340 × 450 mm base, a 145 × 450 × 315 mm chassis, one 400 mm PET jar on a 200 mm shelf, and a 50 mm auger tube with a 60 mm motor. The ultrasonic sensor now sits on the jar lid, the 750 mm post and short arm are a wire guide, and the model includes the red rubber motor coupling, the brown tube-end plug, the blue outlet with the red cap, and the two wood tube cradles. Model asset `feeder-v1.1.0.glb` (1.1 MB, 37,800 triangles); the service-worker cache moves to **v6** for the new URL.
- The viewer camera presets and orbit target are reframed for the smaller machine, and the dispensing auger/coupling now rotate around the tube axis instead of the vertical axis.

## [1.30.1] - 2026-10-29

### Fixed

- The pond switcher rendered as inert header text when a farm had exactly one ACTIVE pond, so the control looked like a label and nobody could tell it existed. It now always renders the dropdown trigger and opens a menu listing the single pond, already checked.

## [1.30.0] - 2026-10-29

### Security

- Production dependency audit: `critical` 2 → 0 and `high` 37 → 1 (one allowlisted build/CLI finding, expiring 2027-01-27). `dompurify`, `proxy-addr`, `browserslist`, `source-map-js` and `baseline-browser-mapping` are pinned to patched versions through `pnpm.overrides`; `zod` moves to `^4.6.6`. `shadcn` is a code-generation CLI and now lives in `devDependencies`, so the server stack it drags in is no longer counted as shipped. See `docs/security/supply-chain.md`.
- `pnpm audit --prod` now runs in CI as `.github/workflows/security.yml`: an unallowlisted `critical`/`high` fails the build, and every allowlist entry in `security/audit-allowlist.json` needs a written reason and an expiry of at most 90 days.
- `.github/dependabot.yml` adds weekly, grouped npm and GitHub Actions update pull requests. No auto-merge.

### Added

- Automated accessibility gate (ISO 25010 usability, W9): axe-core runs over the login page, the dashboard page shell, the growth plan card, the hardware calibration page, the chat widget and the admin devices console, and fails on any serious or critical violation. Keyboard flows — pond switcher, chat composer, calibration steppers and the harvest modal — are driven with real key presses and assert focus movement, not only that a handler ran.
- The chat closes on **Escape** from anywhere inside it, including the composer, and returns focus to the floating chat control.
- `en` ↔ `hil` message-catalogue parity is enforced by a test, and the 19 missing sticker strings are translated. Tagalog stays an English overlay at 9.3% complete and is reported, not gated, pending the owner's decision in #327.

- First-party error capture (ISO 25010 reliability): an additive `ErrorEvent` model stores failures with a sha256 fingerprint, increments instead of duplicating, scrubs tokens/JWTs/Supabase keys/e-mails **before** truncation, and never throws into the request path. Visible and resolvable at `/superadmin/operations/errors`, swept after 30 days by the existing `device-watch` cron.
- Automated tests now cover **92.42% of `apps/web/lib` lines** (from 80.92%), enforced by a coverage threshold that fails CI on regression.
- **E2E runs in CI** against a disposable local Supabase stack (Postgres + Auth + storage) with a CI-only guard mode; production credentials never enter CI and a remote database is still refused without the explicit acknowledgement.
- Cross-browser smoke on **Chromium, Firefox and WebKit** for the public pages and the language switch, plus responsive assertions at 390/834/1440 and a documented supported matrix in `docs/compatibility.md`.
- Performance evidence is measured and gated: a bundle budget for all 56 routes (validated against a live server), Lighthouse budgets, and an API latency baseline with only stable endpoints gated. See `docs/performance/`.
- **A restore drill that actually executed** in CI: migrate, seed, snapshot, dump, drop the whole public schema, restore, and verify 37 table counts, 9 schema-object counts, 18 invariants and 11 Prisma round-trips. Reports an artefact plus `docs/operations/restore-drill.md`. Scope is explicit: it proves our dump/restore, not the provider backups (#325) or `auth.users` (#322).
- Portability: multi-stage Dockerfile, compose, environment matrix, and the production host is env-driven (`NEXT_PUBLIC_SITE_URL`) instead of hard-coded.
- Maintainability: Knip reports zero unused files/dependencies/exports/types, a measured complexity budget is enforced, and six ADRs plus an operations index record the decisions and runbooks.
- `SECURITY.md` (private disclosure), `CODEOWNERS`, threat model, incident-response plan and a supply-chain policy document.

### Fixed

- Chat messages rendered list items as `<span>` inside `<ul>`/`<ol>`. The markup was invalid and screen readers would not announce the list; items are now `<li>`.
- The admin devices "needs attention" filter put `aria-pressed` on a link, which is not a valid ARIA attribute for that role (`aria-current` now marks the active filter).
- The collapsed chat panel and mobile sheet stayed in the tab order while `aria-hidden`, so a keyboard user could tab into a chat they could not see. Both are `inert` while closed.

## [1.29.0] - 2026-10-29

### Added

- #304 editing a crop cycle's target weight while the pond has a saved calculator target now asks first: **Replace** the calculator target, **Keep** it, or cancel. The choice is enforced on the server, not only in the form, so a request that edits the target without a choice is refused instead of silently letting one value win. No prompt appears when there is no saved target or when the target field was not edited, so calendar drag-and-reschedule still works.

### Changed

- #304 a saved calculator target is now mirrored into the active cycle's `targetHarvestWeightG`, so the Growth page, calendar, harvest and admin views show the same number instead of two. The pond profile stays the plan's source of truth. Removing the target clears the mirror, but a harvested cycle keeps its historical target.
- #307 hopper distances accept one decimal again (`12.3`), so values stored by the old 0.1 stepper no longer open with a validation error. The steppers still move a whole centimetre at a time.

## [1.28.1] - 2026-10-29

### Fixed

- #309 the chat assistant is readable in dark mode. The panel, sheet, message list, bubbles, markdown, suggestion chips, composer and action card now use the dashboard's dark palette instead of light-only surfaces. The composer had no text colour at all, so it inherited the near-white dark-mode foreground on a light field. Message, composer, placeholder and action-status pairs meet WCAG AA (4.5:1) in both themes, and a regression test fails on any light-only chat class that has no dark counterpart.

## [1.28.0] - 2026-10-29

### Added

- #303 the dashboard has pond context. A pond switcher in the header lists only the ponds the signed-in user may switch to, remembers the choice in an httpOnly cookie and re-validates it server-side on every read and write, so a tampered or foreign id falls back to the user's own pond instead of selecting another farm's. Ponds are searchable in the global search and selecting one switches pond in place rather than throwing the reader back to `/dashboard`. All three locales, keyboard operable, with an empty state for a user without ponds.
- #304 the feed calculator can save its result as the pond's growth target. The Growth page now shows the target biomass at harvest, the current/expected biomass and the remaining gap, and the feeding recommendation (including the AI feeder card) derives from the saved target inside the existing 10% / 15-day envelope and device per-meal cap. The target is stored in the pond profile JSON bridge, scoped per pond and tenant, and never moves the cycle's harvest date.

### Fixed

- #307 calibration number fields could not be cleared once they held `0`, so a full distance of zero could not be replaced with a real measurement. Every numeric calibration field now keeps the raw text and parses on submit, so a field can be emptied and re-typed. Hopper centimetre fields step 1 → 2 → 3 → 4 instead of 0.1, and all numeric calibration controls share one field pattern — label, steppers, unit, help text and an announced error — laid out in a responsive three-column grid (one column on phones, two on tablets, three on desktop).

## [1.27.1] - 2026-10-29

### Fixed

- The hardware **Settings → Live Monitoring** hero now renders the interactive 3D feeder viewer instead of the legacy SVG illustration, and the live status poll runs immediately on load.

## [1.27.0] - 2026-10-29

### Added

- #297 the desktop dashboard and admin sidebars are now retractable, with the collapsed state persisted and the benchmark notes in `docs/sidebar-benchmark.md`.

### Changed

- #296 the Admin Overview **Device activity** chart now states its inclusive 14-farm-day range (from/to dates, Asia/Manila) instead of leaving the window implicit.
- #298 the calendar now uses one shared full-viewport shell across the farmer, admin and superadmin views: the grid stays static and the side pane is the only scrolling surface. Architecture notes are in `docs/calendar-architecture.md`.

## [1.26.0] - 2026-10-29

### Added

- Feeder 3D viewer (plan v1.1.0): Blender-built `feeder-v1.0.0.glb` with a versioned manifest, a lazy React Three Fiber scene on `/dashboard/devices/[id]`, live hopper/status polling, camera presets, a no-WebGL illustrated fallback, dashboard and admin links, and a service-worker `v5` cache rule for `/models/`.

## [1.25.0] - 2026-10-29

### Added

- #289 Tagalog (`tl`) is now a third locale, selectable from a top-bar language dropdown (English / Hiligaynon / Tagalog) on the landing, dashboard, legal and mobile surfaces. The whole `[locale]` tree switches together; `tl.json` is a core-UI overlay that falls back to English for untranslated copy, so coverage can grow one key at a time. Documented in `docs/i18n.md`.
- #288 the change-password form now raises a top-right success toast and a top-right server-error toast, while keeping the existing inline messages. The confirmation standard for mutating actions is documented in `docs/ui-confirmations.md`.

## [1.24.0] - 2026-10-29

### Changed

- #286 the desktop sidebar's hopper card is one link to the hopper-level chart on the History page (`/dashboard/history#hopper-level`), with a hover state, a keyboard focus ring and an accessible name; the chart wrapper is an anchor target that clears the sticky header.
- #287 the floating chat button now shows Pakoy's head instead of a generic message-square glyph while the chat is closed; the open state keeps the close (X) control, and the button's accessible name is unchanged.

## [1.23.0] - 2026-10-29

### Added

- #270 global search in the top navbar (⌘K / Ctrl+K) across pages, ponds, devices, members and records, scoped to what the caller can read.

### Fixed

- #269 dashboard right rail no longer scrolls horizontally; the redundant floating help button is gone. The Time Calibration input/button row now follows the card's own width (container query) instead of the 640 px viewport breakpoint, so both controls fit in the 22 rem rail and the "Set Device Time" button is no longer clipped; the device/controller card no longer splits into two columns inside the rail. Help keeps one entry point: the header control is now on the mobile band too.
- `docs/audits/2026-10-28-calc-device.md` #1: a failed ultrasonic read (the firmware's `0 %` + `0 cm` timeout sentinel) is no longer stored as an empty hopper — the heartbeat still updates `lastSeenAt`, but the level, history row and low/critical alerts are skipped; a real empty hopper still alerts, and a heartbeat without `feed_level_cm` keeps the last known distance.
- `docs/audits/2026-10-28-calc-device.md` #3: days of feed remaining is computed by one helper with guards (`estimateDaysOfFeedRemaining`); a missing, zero or negative capacity, meal size or meals/day returns null instead of the old `99`-day sentinel, the card floors it for display and the ingest two-day warning compares the fraction.
- `docs/audits/2026-10-28-calc-device.md` #5: the drift detector walks the level against a baseline, so a rise of ≤ 5 points is ignored without raising it (70 → 75 → 60 now counts 10 points, not 15) while a larger rise starts a refill segment and keeps the earlier drop.
- `docs/audits/2026-10-28-calc-device.md` #6: the dashboard, hardware page and assistant load the drift inputs through one query that counts device output only, so imported `hand_fed` daily totals are no longer compared with the hopper drop.
- `docs/audits/2026-10-28-calc-device.md` #7: recalibration reminders page through every eligible device instead of silently stopping at 200.
- `docs/audits/2026-10-28-calc-device.md` #8: the feeder hero's next-feed time is covered by a regression test proving it resolves in Asia/Manila on a UTC host; current `develop` already uses the wall-clock helper, so no runtime change was needed.

## [1.22.0] - 2026-10-28

### Added

- #277 the farm-owner Admin Overview now shows feed dispensed per day, device activity and fleet-health charts, built on the existing shared Recharts components (no new dependency) and scoped to the caller's organization. When a series hits its 5,000-row cap the total is labelled as a lower bound and days that were not fetched are no longer zero-filled.
- #273 the farmer Audit Trail now covers every active pond on the farm instead of only the first one, resolves actor ids to human-readable names, surfaces the newest user touch, and shows each event's actor, role and bounded metadata in an expandable Details block. RBAC scoping is documented and tested: farmers see their own farm only, tenant admins use `/admin/audit`, platform admins use `/superadmin/operations/audit`. The industry comparison is in `docs/audits/2026-10-28-audit-trail-benchmark.md`.

### Fixed

- #274 Admin → Devices: "Print selected labels" submits no `id` when no device is ticked, so `/admin/devices/labels` called `notFound()` and showed a 404. A label sheet opened without `?id=` now prints every device in the caller's tenant scope (bounded by 40, newest first), an explicit selection still returns 404 when nothing in it is in scope, and an empty device registry renders an empty state instead of a not-found page. The Superadmin → Devices label sheet behaves the same way, behind the unchanged platform-admin gate.
- #275 the phone Schedule page no longer lets the sticky Save Changes bar cover the Sync Status card; a mobile-only spacer keeps the applied-at line, the schedule summary and Force Resync fully visible and tappable above the bar.
- #276 the admin, farmer and platform calendars accept a one-day range again: date-range validation counts inclusive days, so the Day view no longer fails with "Choose a date range between 1 and 400 days", and the 400-day limit is exact (400 accepted, 401 rejected).
- #272 calendar event chips, the "+N more" link, agenda rows and the more popover meet WCAG AA contrast in dark mode while keeping each event's colour identity, instead of saturated red-on-navy with white text.

## [1.21.2] - 2026-10-28

### Changed

- #259 the hopper card turns red and pulses at 30 % or below, with a "Low: refill soon" label and a reduced-motion fallback. The alert threshold (`OrgSetting.hopperLowPct`, default 20 %) is unchanged.

### Fixed

- #263 every hopper display reads the same live level; the firmware version stays current from the heartbeat; the Device ID shows the sticker MAC.

## [1.21.1] - 2026-10-28

### Fixed

- Firmware 1.6.1: the dispense calibration set on the dashboard was lost on every reboot: the ESP32 held `gramsPerSecond` only in RAM and fell back to the `4.0` compile-time default until the next successful poll, so a feed triggered in that window ran at the wrong rate and dispensed the wrong amount. The applied value is now mirrored into NVS (`cal_gps`) and restored at boot, written only when it actually changes so polling cannot wear the flash. Applied and refused values are logged with a `[CAL]` prefix, which makes the dashboard-to-device calibration path observable on serial for the first time.
- The dashboard no longer scrolls sideways on a phone. The content column is a shrinkable flex child (`min-w-0`) and the dashboard shell clips horizontal overflow, so only vertical scrolling remains.

## [1.21.0] - 2026-10-28

### Added

- Daily feed ceiling per device (`EnergyDevice.dailyCapG`): 2,000 g/day by default, configurable by the farmer (App & Hardware) and by an admin (pond detail), and never above the 5,000 g emergency guard the firmware enforces. Amendment A-001; contract `docs/feeding-single-source-plan.md`.
- Firmware 1.6.0 (I-41) fail-safe model: a shutdown handler that opens the relay on every software reset, panic, OTA reboot and `ESP.restart()`; an independent relay-overrun trip (expected dose + 2 s) checked at every network boundary; one dispense gate for every source (10 s minimum gap, six doses per rolling hour, daily gram cap, `MAX_DISPENSE_MS`); a 60 s no-dispense hold after a brownout reset; and reset-reason accounting in NVS.
- Firmware 1.6.0 safe mode: three brownout/panic/watchdog resets within ten minutes lock the relay OFF, refuse every trigger with reason `safe_mode`, report `safe_mode` and `last_reset_reasons` in the heartbeat, postpone OTA, and clear after 30 quiet minutes or on a Wi-Fi/factory reset hold. A normal power-on clears the history.
- Firmware 1.6.0 hopper and probe plausibility: five samples with range rejection, median, EMA, a three-cycle persistence rule, hysteresis (low at 20 %, refill above 30 %) and a ten-minute state hold; an invalid cycle omits the level instead of reporting 0 %. The DS18B20 rejects its -127/85 sentinels and anything outside 0..50 C.
- Firmware 1.6.0 network hygiene: per-event-type token buckets, a bounded offline queue that drops its oldest entry and counts it, and non-blocking HTTP retries with exponential backoff and ±20 % jitter capped at five minutes.
- Firmware 1.6.0 noisy-button guard: more than five rejected glitches in a minute disable the feed button for ten minutes and report `button_disabled`; 1.5.3's 50 ms confirmation, quiet window and 30 s cooldown are unchanged.
- `firmware/firmware-main/safety.h` and `filters.h`: Arduino-free, header-only safety/filter logic, plus a PlatformIO `[env:native]` Unity suite (`pio test -d firmware -e native`, 27 tests) covering spike rejection, persistence, hysteresis, the gap/hourly/daily caps, safe-mode entry and exit, the button disable, token buckets and retry backoff.
- A web test proving the ingest schema still accepts a 1.6.0 heartbeat with the new diagnostic keys and every new `feed_refused` reason (no server change).

### Changed

- Every feeding read now goes through one pond-scoped reader (`lib/feeding/source.ts`). A pond's population is returned as `null` when it is not set, and the phantom 5,000-fish fallback is removed from the dashboard, PDF, growth plan, prediction, chat and sampling preview: the UI asks for the fish count instead of inventing one.
- Every settings-driven dose is written by one function (`deriveDeviceDose`). The growth-plan adjustment now writes `Pond.feedingRatePct` and re-derives the device dose, so the formula and the feeder cannot diverge after an adjustment.
- Next-feed time is computed only in Asia/Manila (`computeNextFeedingSlot`); the server-local `setHours` variant was deleted. Device poll responses now carry `server_time_utc` and `farm_offset_minutes` so the firmware can link the RTC to UTC (firmware consumption is a later, reflash-required step).
- Every daily-cap check now calls one resolver (`resolveDailyCapG`), so the platform `dailyCapFactor` applies identically to schedule saves, manual feeds, calibration doses, pond edits and the AI advisor. Two paths previously ignored the factor.
- The advisor's per-meal bound derives from the device's ceiling instead of the flat 5,000 g maximum: 1,000 g at two meals and 500 g at four under the new default.
- Firmware heartbeat now carries `safe_mode`, `last_reset_reasons` and a nested `diag` object (fw, reset counts, button state, overruns, invalid sensors, queue drops, uptime, limits, refusals by reason). Ingest strips the new keys, so they are diagnostic until a server change stores them.
- `firmware/README.md`: new **Firmware 1.6.0 fail-safe model**, **Safety model** and **Safe mode** sections, the refusal-reason table, the native-test instructions and bench checks 21-31.

### Fixed

- The FCR feed calculator understated the suggested feeding rate by exactly 5,000x (it divided by `DEFAULT_FISH_COUNT` twice), treated "current biomass" as a per-fish weight, labelled per-fish feed as a total, and read the first active pond instead of the pond on screen. It now takes the pond and the fish count explicitly, reports true totals, and returns a per-meal dose when meals/day is known.
- Firmware 1.5.x reported `feed_level_percent: 0` when the HC-SR04 echo was implausible; it now reports "unknown" and keeps the last valid level.
- Firmware 1.5.x accepted the DS18B20's -127 C / 85 C sentinel values as real temperatures; they are now treated as "unknown".
- Firmware 1.5.x could leave the relay energized past the end of a short dose while `loop()` was blocked in an HTTPS call; the relay is now opened at the first network boundary.
- Firmware 1.5.x would deep-sleep during a dispense; it now refuses to sleep while the relay is on and opens it before sleeping.

## [1.20.1] - 2026-10-28

### Fixed

- Firmware 1.5.3: the feed button needs a 50 ms press, is ignored during and 2 s after a dispense, and is limited to one dispense per 30 s (phantom button feeds on the CICT unit).

## [1.20.0] - 2026-10-28

### Changed

- #247 Biomass Log and Schedule use the full width on large screens: the sample form sits beside a sticky Live Preview with a short "How it's calculated" panel, and the schedule editor sits beside a sticky status/Feed Now/offline rail. Saved sampling batches show three or four across on wide screens. Below `xl` the stacked layout and the mobile sticky action bar are unchanged.
- The same centred page width now applies to Notifications, Audit, Growth, Growth history and the sampling-batch log, which were each capped at a narrow left-aligned column.
- #248 Calendar and Harvest are one page (Calendar & Harvest); the old Harvest link redirects.

### Fixed

- #248 upcoming events were empty on the Harvest page.

## [1.19.2] - 2026-10-28

### Changed

- Firmware 1.5.2 (#252): the setup portal is branded (PakaonAI fish mark, wordmark, tagline "Sakto nga pakaon, sakto nga oras.") and fills its network list with an asynchronous 2.4 GHz scan with a **Rescan** button, signal bars, a lock icon for secured networks and deduplication by SSID. The footer shows the unit's Device ID and AP name.
- Firmware 1.5.2 (#252): submitting the portal form now tests the network first. The setup AP stays up, the status page shows `Connecting…` and then `Connected to <SSID> · IP · signal` or a failure reason, and only a working link is saved (restart after 5 s).

### Fixed

- Firmware 1.5.2 (#252): the setup portal's network scan reported 0 networks when the portal started right after a failed join, because the station was still connecting (`esp_wifi_scan_start` returns `ESP_ERR_WIFI_STATE`, which the old code printed as "0 network(s)"). The scan now settles the station first, runs after `WIFI_AP_STA` is set and asynchronously, logs the real return value and retries once after 2 s.
- Firmware 1.5.2 (#252): a failed join no longer saves the credentials. The old NVS values are left untouched and the form returns with the reason (wrong password / network not found / no IP) so it can be retried.

## [1.19.1] - 2026-10-28

### Changed

- Firmware pin map now matches the hardwired CICT Building A board: feed button GPIO 27 → 23, DS18B20 GPIO 26 → 32, HC-SR04 TRIG GPIO 32 → 12, ECHO GPIO 33 → 14. The relay default stays on GPIO 25 and the CICT unit stays on GPIO 5, built with `-e esp32dev-relay5`: GPIO 5 straps only SDIO slave timing, so it does not need rewiring. Units still on the old map need the matching build flags or a rewire.
- The firmware README's reset-button table had the Wi-Fi and factory reset pins swapped (16/17) relative to the code; corrected.

### Fixed

- #244 clickable controls show a hand cursor (login Back to home and app-wide).

## [1.19.0] - 2026-10-28

### Added

- Pakoy, the PakaonAI mascot, in the chat, dashboard greeting, alerts, empty states, onboarding and offline/error pages (#193, #232, #221).

## [1.18.2] - 2026-10-28

### Fixed

- Day buckets in the pond charts (feed per day, water temperature, hopper) put readings from 00:00–08:00 Manila on the previous day: the `timestamp` columns hold UTC and were converted with a single `AT TIME ZONE`. Every bucket query now converts UTC → Asia/Manila (verified against the database).
- #236 feed figures: the History page's "Recent Feed Dispensed" card added up whatever happened to be on the first page of the event log, mixing machine dispenses (at most 1,000 g each) with imported `hand_fed` daily totals, so 20 rows could read as one 19 kg dispense. It is replaced by "Last feed" (newest machine dispense, with its source and time), "Dispensed today" (every source, current Asia/Manila farm day) and "Last 7 days" (every source, with a daily average), each state its window and uses grams below 1,000 g and kilograms with two decimals at or above it. "By source" now counts the chart's 30-day window and marks hand-fed entries as daily totals, the feed chart is titled "Feed per day" and says hand-fed rows are daily totals, the event log, dashboard, PDF report and feeder hero use the same unit rule,  and the calibration drift check no longer treats hand-fed daily totals as device output.

## [1.18.1] - 2026-10-28

### Fixed

- Dashboard cards, the growth history dates, the sample form actions and the stuck-request banner keep consistent colours in dark mode (Karl, #235).

## [1.18.0] - 2026-10-28

### Added

- Specific Growth Rate (SGR, %/day) on the Growth page (latest interval and overall) and per sampling in growth history, using the standard ln formula (capstone objective).

### Changed

- Firmware 1.5.1: the relay pin is a build flag (`-DRELAY_PIN`, default GPIO 25), with an `esp32dev-relay5` build for the CICT Building A unit wired to GPIO 5. The relay is driven OFF as the very first step of boot, and boot logs the relay pin.

## [1.17.2] - 2026-10-28

### Added

- Allow + deny tests for the admin pond write pages (I-27).

## [1.17.1] - 2026-10-28

### Fixed

- Admin → Ponds no longer loads each device's plaintext provisioning token (or token hash) and the owner's full account row with the pond list; the page now selects only the fields it renders.
- Admin → Users now shows the member's organization role and updates it immediately after a role change, instead of the legacy account role.
- Admin → Users, Ponds and the member-permissions page hide create/archive/edit actions the caller's permissions do not allow, and a direct URL renders a not-found or "view only" notice instead of an error page.
- Admin → Devices lists pending feeders in the approval queue only, so the numbered pager and the table describe the same rows and pending units on later pages are no longer unreachable.
- The admin audit log and the overview's Recent Activity table translate device event types and sources instead of printing raw keys; the pond detail "Overview" heading is translated.
- The sticker print page uses the farm's Asia/Manila calendar date for "measured on" instead of the browser's UTC date.
- The admin calendar keeps every active grow-out cycle in the all-ponds view; only completed/historical cycles keep the 30-row cap.
- Deleting a user now also deletes their organization membership and permission overrides, so the org no longer shows a ghost member or re-granted role.
- A revoked or expired platform-admin grant no longer hides the account from tenant management forever.
- Creating a farmer and pond from the admin form reports a validation or transport failure instead of leaving the button spinning.

### Security

- Admin → Ponds no longer returns device credentials in bulk through the list action; credentials stay behind the audited, rate-limited single-device reveal.

## [1.17.0] - 2026-10-28

### Added

- Feeder hero on the pond detail and feeder (hardware settings) pages (E29): a dark device-style panel with the feeder drawn in the middle, glassy callouts with thin leader lines to the hopper, spout, housing and water line (hopper level with the shared offline "Last known N%" treatment, grams dispensed today, next scheduled feed with its day or "Schedule paused", water temperature, online/offline with last seen, reported firmware), a status pill and the AI Feed Advisor's one-line summary linking to the full card. Jeff's photo loads from `public/images/feeder/feeder-hero.webp` over a drawn illustration; a missing photo costs at most one request per browser session, and adding the file needs no code change (see the folder's README). Below 768 px the image comes first and the callouts become a 2×3 grid without leader lines. Presentation only — no guards, actions or schema touched.

### Fixed

- The AI chat assistant and the action planner no longer answer a slow-but-valid provider response with `504 TIMEOUT`; the request budget now matches the provider budget, and a provider outage falls back to the keyword assistant instead of an error.
- `GET /api/schedule-sync` re-sends a schedule command that the feeder has not acknowledged yet, so a lost response no longer leaves a change unapplied, and it no longer writes a `command_sent` audit row on every poll.
- A single heartbeat can no longer queue two hopper notifications: the days-remaining warning is skipped when a low-hopper alert is already outstanding (the two used to alternate `CRITICAL`/`WARNING` on every heartbeat until one was acknowledged).
- A scheduled feeding refusal now dedupes per farm calendar day (Asia/Manila) instead of per UTC day, which reset at 08:00 local and could alert twice on one day.
- CSV and PDF exports report a missing pond or feeder as `404` instead of `500`, reject an unknown or empty dataset selection with `400`, are served with `Cache-Control: private, no-store`, and are named by the farm calendar day instead of the UTC day.
- The PDF report uses the same active pond as the rest of the app (it could pick an archived pond), prints dates and feeding times in Asia/Manila rather than the server timezone, and derives the download filename from a sanitised pond name.
- A CSV import with an unparseable date or a non-numeric feeding amount reports the offending row as `400` instead of failing with an opaque `500`, and all import endpoints share the same 5 MB payload ceiling.
- The background-job queue metrics shown to a farm admin are scoped to that farm instead of the whole platform.
- The device-watch cron scans the most recently stale feeders first, so once 100 devices had raised an offline alert no newly-offline device could be detected.

- Farm-facing dates and times render in the farm's timezone (Asia/Manila) instead of the server runtime's, so the dashboard, history, growth, sampling-batch, hardware and farmer audit screens no longer read eight hours behind (or a day early) on a UTC host.
- The dashboard's next feeding time is computed from the farm wall clock, so an overnight schedule and an evening visit no longer report a feed that already happened.
- A feeder that has never reported a hopper level shows "—" instead of a made-up 0 %, and Feed Now no longer raises a critical-hopper warning for it.
- The dashboard's low-hopper alert uses the org's configured threshold instead of the built-in 20 % default.
- Saving the hopper shape calibration refreshes the Hardware settings page that shows the result (it refreshed a legacy redirect stub instead).
- Hard-deleting a pond whose only remaining record is a legacy `Device` row now reports the device as a blocker instead of failing on the foreign key.
- The assistant counts "today's feedings" from the Asia/Manila day, and its replies and AI context describe samples and dispenses on the farm clock instead of the server's timezone.
- The pause/resume switch on the schedule page reverts with the reason when the server refuses the write, instead of showing the wrong state.
- The schedule sync and stuck-request panels are translated (en/hil) and show device timestamps on the farm clock; "Check device" keeps the active locale and opens Hardware.
- The offline sync panel shows the last sync and failed-sample times on the farm clock.
- Notification preferences are hidden on the profile page when the farmer has no pond, instead of failing every toggle with "Pond not found".
- A corrupt device timestamp degrades to a plain label instead of throwing and breaking the page render.

### Security

- Read-only view-as is fail-closed: when the session cannot be verified (a database error), tenant writes are refused instead of being treated as a normal signed-in session.
- Invitation and reminder e-mails reject SMTP recipient-list separators and strip line breaks from tenant-controlled names before they reach the subject, so a crafted address or pond name cannot add a recipient or a header.
- The admin job-metrics endpoint filters by the caller's farm tenant before returning queue counts.

- Hopper shape calibration is validated on the server: a zero or non-finite hopper capacity, an inverted empty/full distance pair or an out-of-range value is rejected before it reaches the database. A zero capacity used to raise the device's daily feed cap to the hard maximum.

## [1.16.0] - 2026-10-27

### Changed

- Mobile app shell (E26): every console now has a PakaonAI-branded header band below `lg` (page title, search, "+" quick menu), the farmer bottom bar is a five-tab bar (Overview, Schedule, Biomass log, Alerts, Me) with the active tab in the brand colour, and the tenant admin and platform consoles are five tabs too (four primary sections plus "More"): the platform console had grown to nine sections, which leaves under 44 px per target at 375 px. "More" opens the same quick menu as the header band, so every page that left a bar — the farmer calendar, history, growth, harvest, audit and settings, and every role-aware quick action (add pond/feeder, scan sticker, pond location, log a sample, register a feeder) — is one tap away.
- Mobile lists (E26): the tenant Ponds and Devices lists gained a tappable All / Online / Alarm / Offline summary strip, an "order by" and "needs attention" chips row, and large cards with a status dot and three key metrics; the strip, chips and the ordering are URL parameters, so they survive navigation and the numbered pagination.
- Mobile layout pass (E26): user-facing page titles move into the header band below `lg` (the `h1` stays in the markup for assistive tech), farmer and console mains use `dvh` with bottom padding that clears the fixed bar and the device safe area, and the biomass, schedule, pond-settings and pond create/edit forms pin their primary action above the bar on a phone.

### Fixed

- Notifications (#219): "Mark as Read" now clears every pending alert of the signed-in owner across all of their ponds instead of only the active pond's loaded page, and it stamps the acknowledgement so the rows stop offering "Acknowledge". The bell drops to 0 immediately and re-syncs with the server; a single "Acknowledge" now decrements the badge at once and rolls back on failure. No schema change.

## [1.15.0] - 2026-10-27

### Added

- Full calendar parity for tenant admins and farmers (#212): the admin calendar can now create, edit, move and delete organization events on any pond in the organization, while the farmer gets a dedicated `/dashboard/calendar` page with its own nav entry and the same month, week, day and agenda views, drag/resize, events vs tasks, colours, recurrence, reminders and filters as the Harvest page. Farmers see org-wide events read-only and keep write access to their own farm's ponds; the API returns per-event editability and the shared server actions enforce the same farm/organization boundary. Agenda is the default view below 640 px. The Harvest page keeps its embedded calendar.

### Fixed

- Devices list (#213): the remote-control panel no longer sits inside the Actions cell. A compact trigger opens it in a full-width row under the device, so the tenant and platform device lists (list and card views) stay inside their card at every width; the caps sentence wraps anywhere and the grams box and Feed button stack on narrow screens. Feeding behaviour, guards and server caps are unchanged.
- Help panel (#214): the sheet is now viewport height with a fixed header and a scrolling body, instead of growing past the bottom of the screen. Wheel and touch scrolling stay inside the panel (`overscroll-contain`), the footer respects the safe-area inset, and "Show me" still closes the sheet or navigates exactly as before.

## [1.14.0] - 2026-10-27

### Added

- Superadmin Operations section (E16.4, #185 batch): a **system health** page with background-job counts, the oldest queued job, the latest 20 failures, jobs/failures per day, inferred cron freshness (with the inference explained) and a sortable last-ingest table with offline highlighting; a **firmware fleet** page showing each device's reported version from its latest OTA lifecycle event, the recent OTA events and the signed stable channel, with "unknown" shown honestly; an **audit log explorer** with action/actor/organization/target/date filters, shared numbered pagination, a before/after detail page and a CSV export of the filtered set (streamed, capped at 5000 rows, formula-safe); and **announcements**, a platform-wide dismissible banner stored in `PlatformSetting` (`announcement.current`) with an optional end date, published and cleared through audited platform actions. No schema change.
- Control-room dashboard (E14, #186/#188): above 1280 px the farmer dashboard fills one viewport with no page scroll. The left column holds the compact next-feeding strip (still the first thing seen), an illustrated pond overview with one pin per feeder (online/offline, last-known hopper level, next feed time, water temperature) and a row of feed-per-day, hopper-level and water-temperature charts. Only the right rail scrolls; it carries the pond summary, Feed Now, the device/hopper card, alerts (offline, low hopper, recalibration due, detected calibration drift), the AI advisor summary, the grow-out strip, recent feedings, recent biomass samples and the stat tiles. Below 1280 px the same blocks stack into the previous scrolling dashboard. Presentation only: the existing loaders and server actions are reused, and the tour and help-centre anchors still resolve.

### Changed

- Firmware 1.5.0 (I-17): the setup AP name now follows the stored Device ID when it parses as a MAC (last four hex digits), falling back to the chip eFuse MAC before provisioning or for a non-MAC ID. The boot log prints both IDs and the resulting AP name.
- Firmware 1.5.0 (I-17): the setup page scans nearby 2.4 GHz networks once at portal start, lists them strongest-first in a picker with a "type it manually" option, and notes that Wi-Fi names are case-sensitive.
- Firmware 1.5.0 (I-17): relay polarity is a build flag (`-DRELAY_ACTIVE_LOW=0|1`, default active HIGH). Boot still forces the relay OFF in both modes.

### Fixed

- Firmware 1.5.0 (I-17): a short feed-button press is captured by a falling-edge interrupt (250 ms debounce, one pending press, 5 s boot grace) instead of a loop poll, so it is no longer lost during a blocking HTTPS call.
- Firmware 1.5.0 (I-17): the 5 s network cycle feeds the 30 s task watchdog between every call and around each dispense, with explicit 8 s connect/read and handshake timeouts, so a slow link no longer resets the board with `task_wdt`.

### Security

- Firmware 1.5.0 (I-17): removed the compile-time placeholder Device ID and device token from the public firmware image. An unprovisioned unit logs `[IDENTITY] not provisioned - API disabled`, runs only the setup portal and keeps feeding locally, and sends no ingest, feed-command, schedule-sync or OTA request until an identity is provisioned.

## [1.13.0] - 2026-10-27

### Added

- Profile pictures (#198): an optional picture a user uploads, replaces or removes in Profile settings. The browser centre-crops it to a square and re-encodes a 512 px WebP, and the server re-checks the magic bytes, the 2 MB limit and the pixel size before storing it in the private `avatars` bucket under a random key with no name, e-mail or farm id. Pictures are served to signed-in viewers through 1 h signed URLs in one batched Storage call per page, and every avatar falls back to initials. The signed-in user is always the target, and the Privacy Policy data-category and retention tables list the optional photo.
- Full pond management on dedicated pages (#202): the pond list links to a detail page with every pond field, the active grow-out cycle, the latest biomass sample and FCR, all devices with online/last-known hopper level and approval status, and ownership history. Create and edit are their own pages (owner selection inside the caller's org, org-default feeding rate, optional stocking date that starts a cycle). Editing the schedule/feeding fields queues the new schedule to every feeder on the pond under the same daily-cap and relay-time limits, and re-syncs dispensed grams. A pond can hold several feeders: add through the existing Add feeder flow with the pond preselected, move a feeder between ponds in the same org, or unassign it. Permanent deletion is limited to a pond with no history or devices, requires the typed pond name and a step-up; otherwise the page directs the admin to archive.

### Fixed

- Superadmin donut charts (Fleet status, Alerts by type) no longer truncate their legend labels in narrow cards; the legend sits under the chart and wraps (#211).

## [1.12.1] - 2026-10-27

### Added

- `hand_fed` feeding source: precision-feeding records that were fed by hand and imported from a data sheet show as "Precision feeding (hand-fed, data sheet)" in History, the dashboard and the feed-per-day chart.

### Fixed

- History and the dashboard showed any unknown feeding source as "Dashboard". Unknown sources now show as "Other", never as a device source.
- Firmware 1.4.1 (#206): the setup portal no longer reboots after ~30 s (task watchdog), and every event now carries a valid RTC timestamp (an uninitialized buffer made the server reject heartbeats and acks with 422).

## [1.12.0] - 2026-10-27

### Added

- Installable PWA shell for the dashboard: web app manifest, service-worker static-asset caching, an offline fallback page with the last saved dashboard snapshot, and an offline status banner. Authenticated HTML/RSC and API responses are not cached; feed commands stay disabled offline, and the snapshot is cleared on sign-out and login. The ESP32 RTC schedule remains the authoritative offline feeding path.
- Multi-page offline snapshots: Dashboard, Schedule, Growth, Harvest and History write compact per-pond snapshots to IndexedDB (localStorage fallback), and the offline shell renders them as tabs with a last-synced age and stale warning. Cache version moved to `pakaonai-static-v2`.
- Offline biomass outbox: the offline shell and the online Log Sample form queue biomass samples in IndexedDB/localStorage, replay them through `saveBiomassLog` when online, and use a client event id as the `BiomassLog` primary key so a duplicate replay cannot create a second sample. Queued samples are per user/pond and cleared on logout/login.
- API regulation adoption (`API_REGULATION.md`): a single `{ data, meta }` / `{ error }` envelope, the documented status map, and a project-specific decision table. ESP32 firmware, the uptime probe, file downloads and SSE are documented exemptions.
- `withApi()` request pipeline for every API route: `Server-Timing` (`total`, `db`, `app`, `auth`, `queries`) and `X-Request-Id` on success, 4xx, 5xx and timeouts; `WARN SLOW` / `ERROR VIOLATION` logs with the route template; absolute 2 s guard returning `504 TIMEOUT`.
- Data-layer query counting through a Prisma `$allOperations` extension and `AsyncLocalStorage`, so query count and DB time cannot silently measure zero.
- Versioned `/api/v1/*` tree, dual-served by a `beforeFiles` rewrite to the legacy handlers. Legacy responses carry `Deprecation`/`Sunset` with a recorded removal date (2027-06-30).
- `scripts/api/conformance-check.mjs` (static CI gate) and `scripts/api/live-check.mjs` (contract + latency suites with warn/fail modes, coverage accounting and a mandatory credential). New root scripts `api:check` and `api:live`.
- Browser API client `lib/api-client.ts`: one call path, envelope unwrapping, error mapping, 1 s read timeout, bounded retries for idempotent requests, raw mode for SSE/files.
- `docs/API_REGULATION_v1.2_PROPOSAL.md` (22 amendments) and `docs/api-regulation-backlog.md` (ranked burn-down with evidence).
- A read-only `nextjs-supabase-benchmark` subagent and `nextjs-supabase-audit.mjs` harness for auditing other Next.js + Supabase apps.
- Auth fast path: `auth.getClaims()` verifies the JWT locally when the project uses asymmetric signing keys, with a 30 s verified-session cache and a 60 s `supabaseId → farmId` binding. A cache hit makes no Supabase call and no DB lookup.
- Background jobs: `BackgroundJob`/`JobArtifact` tables, `POST /api/v1/export-jobs` (CSV/ZIP/PDF) and `POST /api/v1/import-jobs` returning `202` + `Location`, owner-scoped status/download endpoints, a `GET /api/v1/jobs/metrics` queue-health endpoint, and a `GET /api/v1/cron/jobs` worker that claims with `FOR UPDATE SKIP LOCKED`. The dashboard export, PDF and import flows poll the job and download the artifact; none of them run in the request path. `docs/sql/cron-jobs.sql` schedules the worker.
- Grow-out cycles (`CropCycle`): one active cycle per pond with stocking date/count, grow-out days, auto-calculated editable harvest date, target weight, expected survival, and actual harvest weight/count/final FCR. A partial unique index enforces the one-active-cycle invariant.
- Harvest calendar (`PondEvent` + FullCalendar v7): month/week/list views, harvest/stocking/sampling/manual/feeding/device events, filters, all-ponds toggle, drag-to-reschedule for planned events, and a Harvest page in the sidebar and mobile nav.
- Fallow-pond safety: harvesting or cancelling a cycle pauses the paired feeder and sets `Pond.isFallow`; feed, resume, and schedule changes are blocked until the next cycle starts.
- Cycle-aware AI advice: the feed advisor and chat prompt receive grow-out day, days to harvest, target weight, projected biomass, and fallow state. The formula and safety clamps remain authoritative.
- Open Graph and Twitter card metadata now serve a 1200×630 PakaonAI preview image at `/og.png`, using the current logo kit and updated capstone credits.
- DPA/IRR-aligned Privacy Policy and Terms of Service at `/privacy` and `/terms`, with data-category, cookie/local-storage, subprocessor and retention tables; a research information and informed consent package for the 20 farmer and 10 IT professional respondents; and legal footer/login/profile links. The documents are published as version 1.0, effective 26 October 2026, with sitemap entries and indexable pages.
- Pre-publication review PDFs for the University Legal Office: Privacy Policy, Terms of Service, and the research information and consent form.
- Feed-rate calibration target check (#191): dispense a target dose through the normal feed path (daily cap, offline block, `MAX_DISPENSE_MS`), weigh it, and correct g/s from the error; pass at ±5 %, re-test otherwise. Every rate test and target check is a `CalibrationRun` with a session and attempt number, shown as a history table. Per-device recalibration interval with an overdue banner and a deduped reminder, and a rule-based drift detector (dispensed grams vs hopper drop, >15 %) surfaced on Hardware and in the AI chat context.
- Numbered pagination on every list (#187), with one app-wide page size (default 20) set by the superadmin under Settings → Lists (audited). "Load more" is removed.
- Org settings (#190): default feeding rate for new ponds; notification settings (hopper-low %, offline-alert delay, missed-feeding alerts, alert roles); and device registration (admin approval or self-register) with an "Add feeder" flow and a pending-approval queue. Device API routes refuse non-approved feeders with 403.
- Google-Calendar-style calendar (#195, #196): drag to create/move/resize, Event vs Task, colours, daily/weekly/monthly recurrence, and 1 h / 1 day reminders (in-app + email).
- Sticker rating override on the print page (#197): V/Hz/A/VA with live preview, per-print override in the URL, and a platform-admin default (`PlatformSetting` `sticker.rating`, audited).
- Member permissions open on a dedicated page instead of a modal (#189).
- Schema (additive, applied with `migrate deploy` after JSON backups): `PlatformSetting`, `OrgSetting`, `CalibrationRun`, `WaterTempLog`, `AssistantAction`, `EnergyDevice.approvalStatus/lastCalibratedAt/recalibrationIntervalDays`, and calendar fields on `PondEvent`. RLS deny-by-default on every new table.
- `recharts` for interactive charts.
- Pond charts (#188): feed dispensed per day over the last 30 days stacked by scheduled/dashboard/button, hopper level over 7 or 30 days on History, an average body-weight trend per sampling batch on Biomass Log, and a 24 h / 7 d water-temperature trend on the dashboard. Series are aggregated in PostgreSQL and scoped to the active pond's devices, rendered with the shared `components/charts` components (dark mode, `aria-label` summary, visually hidden data table, explicit empty state).
- Superadmin configuration centre (I-14): the sectioned `/superadmin/settings` page now covers lists, sticker rating, AI providers, email/invite readiness (presence only, never a secret), feeding safety caps, defaults for new organizations, firmware/OTA status and feature flags. Every write is a platform action with a required reason and a `PlatformAuditLog` row stored in `PlatformSetting` (no schema change). Feeding caps can only be lowered below the hard-coded maxima and readers clamp with `min(setting, hardMax)`; organization defaults apply when an org has no settings row.
- Assistant actions with Accept/Reject (#194): the model can only propose, through a server-defined tool catalogue, feeding changes (grams, meals/day, rate, pause/resume), Feed Now, records (biomass sample, calendar event/task, grow-out cycle, mark a task done), member invitations/roles/permissions, and platform suspend/restore or view-as. Every proposal is a 10-minute `AssistantAction` row with a zod-validated payload; Accept re-checks the caller, permissions and step-up, then runs the same server action the UI button uses (same caps, offline/fallow blocks and audit). Nothing runs without Accept. The tool list is filtered by role and permission.
- Assistant guidance (#194): "take me to X" resolves only from the caller's help-centre destinations and highlights the real control with the help "Show me" engine, and the first message introduces the assistant by role (farmer, farm owner, platform admin). The mascot lives in one `components/assistant/mascot.tsx` slot with a placeholder pending Jeff's art (#193).
- Power-rating sticker for every feeder (#174): 95 × 66 mm, 8 per A4, English only, with an SSID-only Wi-Fi QR (`PakaonAI-XXXX` from the chip eFuse MAC). It never contains a device token.
- Superadmin device registry (#179, #183): register a feeder onto an org pond, rotate its token, print labels, and remote feed within the safety caps.
- Superadmin god mode (#183): read-only view-as with a signed session and red banner; manage any org's members and permissions; step-up re-authentication for dangerous actions; reversible user disable.
- Tenant RBAC in Admin → Settings (#183): invite members, change roles, grant or revoke per-member permissions, with last-owner protection.
- Email invites through Resend from `invite@syntaxure.dev` (#183).
- Remote firmware updates (#183): `/api/firmware/check` with ECDSA P-256 signed manifests in a private `firmware` bucket, `scripts/ota/sign-release.mjs`, and a firmware OTA client with rollback health check, a 10:00–15:00 window at least 20 min from feeds, and feed-button abort.
- Firmware 1.4.0: Wi-Fi reset on GPIO 17 (5 s) and factory reset on GPIO 16 (10 s); server URLs on `pakaonai.syntaxure.dev`; `FW_VERSION` reported; zero sketch warnings on Arduino core 2.0.17.
- Production E2E suite with isolated `e2e-` fixtures, guarded seed/cleanup scripts, and specs for auth, sticker print, registry, RBAC, view-as, remote-feed caps and offline PWA.

### Changed

- Every user-facing "Batch / Batches / Saved Batches" is now "Sampling batch / Sampling batches" (#200), in English and in the Hiligaynon draft (term still needs native review). Labels only: the `batchLabel` column, the `/dashboard/log-sample/batches` route and the `batchLabel` CSV export header are unchanged.
- The sitemap now uses the production domain and includes `/privacy` and `/terms` only after the legal documents are approved.
- Platform admins land in the platform console, not on a farmer dashboard (#199): any `/dashboard*` route sends a platform admin who is not in an active view-as session to `/superadmin`, the profile menu shows "Platform admin" instead of "Pond Operator", and farmer pond chrome (pond name/selector, last synced, hopper widget) is hidden outside view-as. A platform admin who is also an active tenant member keeps a working farm dashboard through an "Open my farm dashboard" link in the console; read-only view-as is unchanged.
- The web app renders the PakaonAI logo kit (fish-and-ring mark plus wordmark) in the landing header/footer and the admin and dashboard headers, replacing the inline SVG mark and the split `Opti`/`Feed` text lockup. `OptiFeedLogo` now takes a `variant` (`ondark`, `color`, `color-light`, `white`, `navy`) and serves the kit's PNG marks.
- The login page is rebuilt as a focused split layout with a PakaonAI brand panel, remembered farm IDs, password reveal, inline validation, a language switch and dark mode. The field is now a normal password instead of a numeric-only PIN; legacy PINs still work once before the forced password change.
- The landing page is rebuilt as a product-led SaaS page: a dark hero with an illustrative dashboard preview, a fixed-timer vs PakaonAI comparison, a scroll-driven feeding-loop explainer, wave transitions around the offline section, research and ISO/IEC 25010 cards, and a closing study-access CTA. Public copy now matches what the firmware and app actually do, with no SGR, L298N, power-reset or enforced feeding-window claims. PakaonAI branding now also covers the login, superadmin, chat assistant, onboarding tour and PDF/export labels.
- `withAuth`/`withCronAuth` now return the error envelope and record their own `auth` timing.
- `/api/user-role` returns `{ role, email, displayName }` with `private, max-age=60` and an ETag; the dashboard layout now resolves the user server-side and passes it to the header, so the header makes no client round-trip at all.
- The dashboard import/export and prediction components use the shared API client and unwrap the envelope.
- The AI advisor is surfaced on the Dashboard home as well as Growth, and shows the grow-out timeline or a start-cycle/fallow call to action.
- Device Telegram alerts in `/api/ingest` are scheduled after the response with `after()` instead of blocking the device request.
- Device list lookups in the export routes are bounded with `take: 100`.
- The farmer dashboard leads with the feeding schedule; the AI Feed Advisor follows it (#186). Onboarding tour cards are centred and stay inside the viewport (#185).
- Farmer Settings pages use the full content width (#190).
- UI/UX pass on admin, dashboard, superadmin and settings (responsive at 375 / 1280 px, AA contrast, 44 px targets); superadmin strings translated (Hiligaynon is a draft); offline PWA hardening (exactly-once replay, visible conflicts, feed commands never queued, cleared on sign-out).
- Deployments: only `staging` (preview) and `main` (production) deploy; `develop` is never deployed (#182).

### Fixed

- Tenant console access is now gated by an active OWNER/ADMIN `Membership` in an `ACTIVE` organization, not the legacy global `User.role` flag. `updateUser` no longer changes `User.role`, closing a role-escalation path, and the profile menu shows **Admin Panel** only for tenant admins and **Platform Console** only for active platform administrators (#146).
- ETags are computed over `data + cacheable meta`, so `request_id` no longer makes every conditional request miss.
- The dashboard no longer renders a second back button on nested pages that already show a contextual parent link (Biomass Log batches and Growth history) (#147).
- Device time calibration now shows and sends the browser's local time instead of UTC, and the ESP32 applies a manual calibration (or corrects RTC drift from `server_time`) on its next 5-second poll (#149).
- The forced password change is now enforced inside the shared tenant, platform, write and permission guards, so a flagged account cannot call a server action directly before changing its password.
- The error normaliser reads a clone, so a conformant error body is not consumed before the client sees it.
- Timeout errors are logged once and carry the specific `504 TIMEOUT` message; passthrough routes return a plain 504 body.
- Offline feeders show their last-known hopper level, greyed, with the reading time, consistently on every screen, instead of a live-looking value or 0 % (#192).
- Dashboard home, Schedule and Hardware settings checked the deprecated `Device` table, so ponds registered through the superadmin registry showed "No pond is assigned yet"; they now use `EnergyDevice`.
- The missing `manage_crop_cycle` permission label (#189).
- A double submit of the same calibration dose no longer compounds the g/s correction.
- E2E cleanup keeps append-only platform audit rows and removes the rate-limit buckets the suite creates.
- The dashboard hopper widget rests at 0% behind an "Offline" badge when the ESP32 stops checking in, instead of freezing on the last reported level (#100).
- Dashboard cards keep their natural height instead of being stretched to match the tallest card in their row (#95).
- The Biomass Sample History card hides its secondary columns below `lg`, so a phone no longer needs a horizontal scrollbar to read it (#94).
- The help and chat floating buttons keep their raised anchor until the bottom navigation is hidden at `lg`, so they no longer sit on top of the nav between 768px and 1023px (#93).

### Security

- Password authentication replaces numeric PIN login. Existing accounts are forced to set a permanent password on next login; `password123` is accepted only as a temporary initial credential. Permanent passwords require 8+ characters with a letter and number, and a weak/medium/strong meter is shown on password-setting forms. Users can change their own password from Profile Settings.
- Added `Strict-Transport-Security` (one year, subdomains included) and the missing `FcrReport(pondId, periodEnd)` / `ScheduleCommand(deviceId, appliedAt)` composite indexes from the August 2026 system audit. The finding-by-finding disposition is recorded in `docs/AUDIT-REMEDIATION-2026-10-26.md`.

## [1.11.0] - 2026-10-22

### Added

- Device-hosted WiFi provisioning: the ESP32 exposes `OptiFeed-XXXX` with a setup page at `192.168.4.1`, stores credentials in NVS, and reopens the portal after a 5-second button hold at boot. The hardware settings page now explains this flow instead of showing fake fields.
- Device identity provisioning in the same portal: Device ID (MAC) and Device Token are written to NVS, so one firmware image works for every unit. Admins can reveal a device token on demand from Admin → Devices; it is never included in list responses.
- `MembershipPermission` enforcement: tenant actions now check the permission table, with role defaults as a compatibility bridge. `control_feeder` is revocable per membership, including for an owner.
- AI feeding prediction on the Growth page: deterministic baseline refined by the AI provider, explicit "apply" action, and the same ±50% deviation veto as biomass auto-adjust.
- Growth history page with feed-level, growth and biomass tabs; server-side pagination, date-range filters, search and shareable URLs. The Growth page cards are now compact previews.
- Biomass log provenance (`source`) with import and seed badges.
- A static test that every API route uses `withAuth`/`withCronAuth`, is a device-token route, or is the allowlisted health route.
- Loading and error boundaries for the admin and platform consoles.

### Changed

- AI provider is now OpenCode Go: `OPENCODE_GO_API_KEY`, `OPENCODE_GO_MODEL` and `OPENCODE_GO_REASONING_EFFORT`. Gemini and OpenRouter variables are retired.
- Tablets (768–1023 px) now use the bottom navigation instead of having no navigation at all; the admin and platform consoles gained a mobile bottom bar too.
- Profile and hardware settings no longer show fake values or dead buttons; unavailable actions are disabled with an explanation.
- The Growth page now routes its remaining strings through next-intl (English + Hiligaynon).

### Fixed

- Dark-mode contrast on the dashboard, growth, history, notifications, audit and error/404 surfaces.
- Locale is preserved when navigating notification filters, audit "load more", growth links and history pagination.
- Empty states for the dashboard's recent feedings and the admin users table; the FCR tile shows "—" instead of claiming an optimal trend when no report exists.
- Duplicate `acknowledge` key in `hil.json` that failed the lint gate.
- `/api/health` now returns only `{status}` (200/503) without database error detail.
- Platform-admin users are excluded from tenant admin counts and hierarchies consistently.
- Removed the unused `getUserById` action that returned the full user row to tenant admins.

### Security

- Notification acknowledge/mark-read/demo-create now require write access, and the demo notification tier is validated.
- Tenant admins can no longer edit or delete platform administrators.
- `getDevices` no longer returns device tokens; `deleteUserSubtree` is no longer callable as a server action.
- Organizations with a non-ACTIVE status no longer grant tenant scope.
- The last active platform administrator cannot be revoked, and self-revoke is blocked.
- `/api/export-pdf` now uses `withAuth`.
- Tenant actions are gated by `MembershipPermission`; a revoked `control_feeder` blocks manual feeds and pause even for an owner.
- Device tokens are revealed only on demand to an org admin, one device at a time, and are never listed or logged.

## [1.10.0] - 2026-07-22

### Added
- **Feed Level Monitoring (HC-SR04 Ultrasonic Sensor)**
  - Added `FeedLevelLog` model and 6 new fields to `EnergyDevice` (`feedLevelPercent`, `feedLevelCm`, `feedLevelUpdatedAt`, `hopperEmptyCm`, `hopperFullCm`, `hopperCapacityG`) for hopper level tracking.
  - Extended ESP32 firmware with HC-SR04 support: median-of-3 ultrasonic readings, linear distance-to-level conversion for cylindrical 10L bottle, and piggyback on existing heartbeat payload.
  - Extended `POST /api/ingest` heartbeat handler to ingest `feed_level_percent` and `feed_level_cm`, update `EnergyDevice`, log to `FeedLevelLog` (30-min or >5% delta), and create tiered notifications (≤5% CRITICAL, ≤20% WARNING, ≤2 days remaining WARNING) reusing the "pellet" category.
  - Extended `GET /api/feed-command` and `GET /api/schedule-sync` to return `hopper_empty_cm` and `hopper_full_cm` calibration values — ESP32 receives dynamic calibration on every poll cycle.
  - Added `FeedLevelCard` dashboard component showing level percent, color-coded progress bar, days-remaining estimate, and last-updated timestamp.
  - Added `HopperCalibrationForm` client component and `saveHopperCalibration()` server action for per-device empty/full distance and capacity settings in App & Hardware Settings.
  - Added feed level trend sparkline (SVG) and history table to Growth & FCR page.
  - Added feed level stat card to History page (3-column grid).
  - Added i18n strings (English + Hiligaynon) for all new feed level UI.
  - Updated seed data with `EnergyDevice` calibration values and 10 historical `FeedLevelLog` entries showing gradual decline from 95% to 82%.

### Changed
- Dashboard home renders `FeedLevelCard` alongside `EnergyControllerCard` in a 2-column grid.
- `EnergyDevice` Prisma query on dashboard home, history, growth, and app-settings pages now selects feed level fields.
- App-settings page fetches `EnergyDevice` alongside legacy `Device` for calibration form.
- History page grid expanded from 2-col to 3-col to accommodate feed level stat card.

## [1.9.0] - 2026-07-12

### Added
- **Phase 0 — Device state & command event model foundation.**
  - Added `DeviceStateEvent` model — unified event log recording every device write (commands) and every device read (state events). Single source of truth for audit trail, notifications, and schedule sync.
  - Added `ScheduleCommand` model — schedule edits are queued commands with status lifecycle (`pending` → `sent` → `acked` → `applied` / `failed`), never written directly to `Pond`.
  - Added `buttonFeedGrams` field to `EnergyDevice` — configurable remote button dose, pushed via poll response. No OTA needed to change.
  - Extended `Notification` with `category`, `acknowledgedAt`, `acknowledgedBy`, `autoCleared` fields.
  - Extended `FeedEvent` to accept `schedule_acked` event type with `commandId` link.
  - Extended `FeedRequest.status` with `fulfilled_by_other_trigger` — used by reconciliation when a late-arriving button/scheduled event fulfills a previously-expired dashboard request.
  - Deprecated `FeedingEvent` and `Device` models — kept for backward-compat seed data; all new code uses `DeviceStateEvent` and `EnergyDevice`.
- **Phase 0b — Backend reconciliation + schedule sync.**
  - Gap 1 fix: `POST /api/ingest` runs reconciliation on late `feed_dispensed` events — finds orphaned expired/pending FeedRequests within 4-hour lookback, updates status to `fulfilled_by_other_trigger`, creates `feed_reconciled` DeviceStateEvent.
  - Added `GET /api/schedule-sync` endpoint — ESP32 polls for pending schedule commands. Returns `schedule_start`, `schedule_end`, `feeds_per_day`, `grams_per_feeding`, `button_feed_grams`.
  - `GET /api/feed-command` response extended with `button_feed_grams`.
  - Heartbeat handling auto-creates `connected` / `disconnected` DeviceStateEvents on state transitions. Offline threshold: 15 minutes.
  - Device reconnection auto-clears stale `connectivity` notifications (`autoCleared = true`, `read = true`).
- **Phase 0c — Firmware (ESP32) updates.**
  - `pollScheduleCommand()` fetches schedule from backend, dynamically rebuilds `feedTimes[]` (up to 24 slots) from `schedule_start`, `schedule_end`, `feeds_per_day`.
  - Button dose (`cachedButtonFeedGrams`) read from backend poll response instead of compile-time `#define`.
  - `postScheduleAck()` sends `schedule_acked` event back to confirm application.
  - Default schedule (06:00, 19:00) on boot if backend unreachable.
- **Phase 1 — Audit trail.**
  - New `/dashboard/audit` page with filterable timeline of all `DeviceStateEvent` entries. Filter tabs: All / Feeding / Connectivity / Schedule / Commands.
  - Dual-timestamp display: device RTC time + server receipt time.
  - Shows reconciliation events (`feed_reconciled`) with link to original expired request.
  - Paginated with "Load more" cursor.
- **Phase 2 — Notification accuracy.**
  - Notification center `/dashboard/notifications` reworked: tier filter tabs (All / Critical / Warning / Info / Success), category filter tabs, per-row Acknowledge button, "Mark all read" button.
  - Removed the "intentionally static" disclaimer — live data from Phase 0 state events.
- **Phase 4 — Editable schedule.**
  - Schedule page `/dashboard/schedule` converted from read-only to editable via `ScheduleEditor` component.
  - Time picker inputs for schedule start/end, plus feeds-per-day and feeding rate.
  - Sync status card showing "Pending device sync" vs. "Applied at [time]" per field, reusing the dual-timestamp pattern from Phase 0.
  - "Force Resync" button re-queues current values as a new ScheduleCommand.
  - `PondSettingsForm` routes through `updateScheduleCommand()` instead of direct `Pond.update()`.
- **Session-end hardening (Gap 4 + Gap 2 repeat detection).**
  - `requestFeed()` now expires stale `dispatched` FeedRequests >10min before creating new ones. Fallback uses `gramsPerFeeding` (150g) instead of `buttonFeedGrams` (80g) — remote farmers get the real dose.
  - `updateScheduleCommand()` expires stale `sent` ScheduleCommands >10min before creating new ones.
  - New `StuckRequestBanner` component on the schedule page with 4 states:
    1. **Device offline** — collapses feed + schedule into one root-cause message.
    2. **Single stuck feed** — dispatched but never confirmed. Retry button.
    3. **Repeat feed failure (≥2)** — escalated message showing count + earliest timestamp. Indicates likely hardware (relay) problem, not network.
    4. **Stuck schedule** — sent but never acked. Force Resync button.
  - Feed + schedule banners stack vertically when both exist offline trumps all.
- Added Hiligaynon translations for all new i18n keys (audit trail, schedule editor, stuck banner, notification center).
- Added "Audit Trail" link sidebar navigation.

### Changed
- `requestFeed()` fallback dose: `buttonFeedGrams` → `gramsPerFeeding` (80g → 150g). Remote "Feed Now" carries the real scheduled dose.
- Schedule data flow: farmer edits → `ScheduleCommand` (pending) → device polls `/api/schedule-sync` → status `sent` → device acks → status `applied`. No direct `Pond` writes.
- Ingest route now creates `DeviceStateEvent` entries for all event types, enabling the unified audit trail.
- Notification center no longer declares itself "intentionally static."

### Fixed
- Gap 1 (reconciliation on late button events): orphaned expired FeedRequests are corrected to `fulfilled_by_other_trigger` when the late event arrives, with a `feed_reconciled` audit entry.
- Gap 4 (stuck dispatched/sent states on dead devices): lazy expiry in server actions marks them expired/failed after 10 minutes, triggered on next user action — no cron needed.
- Gap 2 repeat detection: ≥2 consecutive stuck dispatched feeds escalates the banner from "retry" to "hardware problem — inspect."

### Added
- Added `hopperLevelPct` prop to `FeedNowButton` — the confirm modal now shows a red critical warning when hopper is below 10% and an amber warning below 25%.
- Added offline awareness to `FeedNowButton` — a red `AlertTriangle` banner appears in the confirm modal when the ESP32 has not sent a heartbeat within the offline threshold.
- Added `"Awaiting device…"` label state to `FeedNowButton` while the feed request is in-flight, replacing the static button label during `dispensing`.
- Added distinct `toast.info("Feed already queued — awaiting device")` when a duplicate "Feed Now" click is detected (suppressed silently before).
- Added live `Notification` row creation in `/api/ingest` on every `feed_dispensed` event — the Notification Center now receives real data, not only seeded rows.
- Added `requestFeed` duplicate-request guard in `lib/actions/energy.ts` — returns `{ success: true, message: "Feed already pending" }` instead of creating duplicate `FeedRequest` rows.
- Added `EnergyControllerCard` offline banner prop (`isOffline`) with red `AlertTriangle` alert and updated status badge to show `"Offline"` state in red.
- Added `event_id` deduplication to `/api/ingest` — firmware retries with the same `event_id` are safely ignored via `FeedEvent.eventId @unique` and `P2002` error handling.
- Added lazy-expiry logic to `/api/feed-command` — pending `FeedRequest` rows older than 60 seconds are marked `"expired"` before dispatching, preventing an offline device from firing a backlog of stale commands on reconnect.
- Added `@@index([pondId, recordedAt])` to `BiomassLog` to speed up the latest-sample query on every dashboard load.
- Added `docs/audit-report.html` and `optifeed-feed-request-roadmap.html` — visual audit report and interactive roadmap tracking the feed request flow implementation status.

### Fixed
- Fixed success toast wording in `FeedNowButton` from an implied "done" message to `"Feed request sent — device will dispense within 5s"` to accurately reflect that the DB write succeeded, not the physical dispense.
- Fixed `EnergyControllerCard` status badge — now correctly renders `"Offline"` with a red dot (previously only showed `"Feeding..."` or `"Idle"`).
- Fixed `FeedEvent.createdAt` renamed to `receivedAt` for semantic clarity (server receipt time, not device event time).

### Changed
- Renamed `apps/web/middleware.ts` → `proxy.ts` to avoid conflict with Next.js middleware conventions.
- `FeedNowButton` and `ScheduleControls` now call `requestFeed` from `lib/actions/energy.ts` (the `FeedRequest` polling path the ESP32 reads) instead of the legacy `triggerManualFeed` from `lib/actions/schedule.ts` (which only wrote a `FeedingEvent` log row and never reached the hardware).
- Updated migration `20260711000001_audit_fixes` — adds `FeedEvent.eventId` unique column, `BiomassLog` index, and `FeedRequest.status` expiry support.

## [1.8.7] - 2026-07-11

### Added
- Integrated Google Gemini API (`gemini-2.0-flash`) into the OptiFeed Assistant chatbot for AI-powered responses.
- Created `lib/gemini.ts` service module with `askGemini()` and `isGeminiEnabled()` helpers.
- Added `GEMINI_API_KEY` environment variable — just paste your key in `.env` to enable the AI assistant.
- Chat now fetches real pond context (schedule, FCR, device status, biomass, feeding events) and passes it to Gemini as a system prompt.
- Gemini responds in the user's selected locale (English or Hiligaynon) with data-aware answers.

### Changed
- Refactored `lib/actions/chat.ts` to use Gemini when `GEMINI_API_KEY` is set, with keyword-based fallback when it is not.
- Installed `@google/generative-ai` package.

## [1.8.6] - 2026-07-11

### Added
- Added Profile Settings page (`/dashboard/profile-settings`) with profile information, security (change PIN), and notification preferences (missed feeding, device offline, hopper low alerts).
- Added App & Hardware Settings page (`/dashboard/app-settings`) with device status display, network settings (WiFi SSID, password, server URL), and device actions (sync, restart).
- Wired "Profile settings" and "App & hardware settings" buttons in the header profile dropdown to navigate to their respective pages.

### Fixed
- Fixed large white gap in the sidebar by removing `justify-between` from the aside element and using `mt-auto` on the hopper widget.
- Fixed sidebar not sitting flush against the left edge by removing `mx-auto max-w-[1600px]` from the dashboard content container.

### Changed
- Added i18n translations (English + Hiligaynon) for the new Profile Settings and App & Hardware Settings pages.
- Fixed all Biome lint errors across new and existing files (label associations, SVG accessibility, button types, self-closing elements, type safety).

## --- KARL'S PROGRESS (Branch) ---

## [1.8.5] - 2026-07-10

### Added
- Added a highly responsive swipeable Bottom Navigation bar (`components/bottom-nav.tsx`) specifically for mobile devices.
- Refactored `layout.tsx` to automatically hide desktop top-nav links and adjust layout padding to accommodate the new mobile bottom nav without overlap.
- Added intelligent vertical shifting to the floating Chat Bubble assistant so it seamlessly stacks above the new bottom nav on mobile screens.

### Fixed
- Fixed a `NaN` bug on the History page's "Recent Feed Dispensed" metric caused by mapping to an incorrect database property (`amountG` vs `dispensedVolumeG`).

## [1.8.4] - 2026-07-10

### Fixed
- Fixed `next-intl` formatting crashes by replacing `dangerouslySetInnerHTML` string replacements with native `t.rich()` React node parsing for `<bold>` tags across all UI components.

## [1.8.3] - 2026-07-10

### Added
- Localized the Chat Bubble assistant (`chat-bubble.tsx`) to support both English and Hiligaynon.
- Upgraded the `submitChatMessage` server action to accept locale parameters and route natural language intents natively using localized keywords.

## [1.8.2] - 2026-07-10

### Fixed
- Fixed remaining hardcoded English strings in Hiligaynon view.
- Added a `formatDateTimeLocal` helper to translate `Intl.DateTimeFormat` date outputs (e.g. converting "Jul 8" to "Hul 8" and "Tue" to "Mar" for Martes).
- Intercepted and mapped database-seeded English notification strings to their corresponding localized `next-intl` values.
- Fixed the dashboard feeding logs section title hardcoding.

## [1.8.1] - 2026-07-10

### Added
- Integrated the secure ESP32 Node Auth login page (`/login`) from the Capstone prototype.
- Re-implemented client-side validation and navigation routing via `next-intl` to transition to the Dashboard upon successful login.

## [1.8.0] - 2026-07-10

### Changed
- **Major UI Redesign:** Fully integrated the new Figma prototype aesthetics into the application.
- Overhauled the `/en` Landing Page with a new Hero section, value propositions, and an interactive FAQ accordion.
- Redesigned the Dashboard (`/dashboard`) into a modern, responsive Bento Grid layout.
- Integrated real Prisma data (`pond`, `feedsPerDay`, `fcrReports`) directly into the new Dashboard layout.
- Replaced the standard dashboard "Feed Now" button with a dedicated interactive client component (`FeedNowButton.tsx`) containing a confirmation modal and live visual states.

### Added
- Integrated the `sonner` package for robust, beautiful toast notifications across the dashboard.
- Created new custom UI components: `OptiFeedLogo` and `ImageWithFallback` to match prototype specifications.
- Added comprehensive SVG titles and accessible `type="button"` attributes to ensure full WCAG/Biome compliance on the new UI.

## [1.7.2] - 2026-07-09

### Fixed
- Completed real Hiligaynon (Ilonggo) translations in `hil.json`, replacing all English placeholders
- Wired up navigation links and buttons to next-intl translation messages
- Wrapped dashboard layout Prisma queries in try/catch to prevent silent 404 page crashes on database errors
- Standardized FeedingEvent status casing to lowercase to ensure consistency across seeds, schedule actions, history filters, and chat intents
- Made Log Sample redirects locale-aware by utilizing the i18n router
- Wired up notification bell to navigate to the notifications page and mark unread items as read in the database
- Built out the notifications page with real data fetching, status badges, and timestamps


## [1.7.0] - 2026-07-09

### Added
- Implemented Settings page to manage pond configuration (Feeding Rate & Feeds Per Day)
- Added Server Action to update Pond database records
- Wired up LocaleSwitcher to seamlessly toggle between English and Hiligaynon using `next-intl`
- Added secure Sign Out functionality via Supabase Auth


## [1.6.0] - 2026-07-08

### Added
- Implemented rule-based Chat Bubble assistant UI
- Added `submitChatMessage` Server Action to parse intents (Next Feed, Log Sample, FCR, Missed Feedings) and return live database data


## [1.5.0] - 2026-07-08

### Added
- Implemented global Realtime Notifications via Supabase WebSocket subscriptions
- Added sticky banners for `CRITICAL` alerts and toast notifications for `WARNING`/`SUCCESS` alerts
- Wired up the navigation bell to instantly reflect live unread counts


## [1.4.0] - 2026-07-08

### Added
- Implemented Schedule screen with Server Actions for pause/resume and manual override (Feed Now)
- Added `isPaused` field to `Device` model in Prisma schema

## [1.3.0] - 2026-07-08

### Added
- Implemented Feeding History screen with recent activity stats and events log
- Implemented Growth & FCR screen with custom SVG/CSS charts and biomass history table

## [1.2.0] - 2026-07-07

### Added
- Created Biomass Log Sample form with live volume calculation preview
- Added `saveBiomassLog` Server Action and `calculateNextFeeding` math utility

## --- MAIN PROGRESS (origin/main) ---

## [1.1.0] - 2026-07-07

### Added
- Wired Dashboard Home (Hero, FCR sparkline, and secondary metrics cards) to live Prisma data

## [1.0.1] - 2026-07-07

### Added
- Added Prisma seed data for local development

## [0.1.0] - 2026-07-05

### Added
- Initial project scaffold: Next.js App Router, Supabase, Prisma schema + migration, next-intl (en/hil), Tailwind design tokens, Husky + Biome, GitHub Actions CI/CD, base docs.
