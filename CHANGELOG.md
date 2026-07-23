# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
