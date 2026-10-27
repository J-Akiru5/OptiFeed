# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- `applyGrowthPlanForPond` is no longer a browser-callable server action that trusted the caller's `ownerId`; a static guard test prevents regressions.
- Device-token reveals are audited and rate limited.

## [Unreleased]

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
