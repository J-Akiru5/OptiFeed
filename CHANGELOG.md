# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
