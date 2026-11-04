# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- `applyGrowthPlanForPond` is no longer a browser-callable server action that trusted the caller's `ownerId`; a static guard test prevents regressions.
- Device-token reveals are audited and rate limited.

## [Unreleased]

### Changed

- **Device surfaces poll adaptively instead of on a fixed interval (#731).** The browser used to re-read a device on one hard-coded interval per component (the 3D viewer and the large screen every 15 s, the dashboard's server-rendered device cards every 30 s), whether or not anything was waiting on the unit. A single policy in `apps/web/lib/live/poll-policy.ts` now decides the cadence: 5 s while the tab is visible **and** a feed request is still pending or dispatched, 30 s when the tab is visible and idle, and no timer at all while the tab is hidden — coming back to the tab re-reads immediately. An open viewer therefore drops from 240 to 120 device-state requests per hour at idle, while a feed in flight polls four times faster than before so the dispense and the new hopper level appear without a manual refresh. The firmware poll (two endpoints every 5 s) is unchanged: no protocol change, no firmware change, no new dependency. See `docs/performance/device-polling-scale-plan.md` §9.
### Fixed

- **Revoking a member no longer hides the organization's ponds (#808).** A pond's only ownership stamp is `Pond.ownerId`/`Pond.farmId`, and the admin scope is derived from the farms of *active* members, so revoking the member whose farm held them silently removed those ponds from every remaining admin's console while the revoked account kept write access to them. Revocation now reassigns them — in the same transaction, on both the tenant `revokeMember` and the platform `revokeOrgMembership` paths — to the organization's anchor farm: its highest-role other active member, longest-standing membership first (in practice the primary owner). No schema change: the existing ownership stamp carries the transfer and the `record_pond_ownership_event` trigger records it as `TRANSFERRED`. The revoked member keeps their own login and farm (#765) but no longer owns, or can write, the moved ponds. Archived ponds move too, and nothing moves when no other member remains.

## [1.56.0] - 2026-11-04

### Added

- **A dedicated tenant role and fail-closed RLS policies (#711, phases 1 and 2).** `optifeed_app` is created `NOBYPASSRLS` with table and sequence grants, and the policies on the tenant tables key off a per-transaction context (`app.farm_ids`, `app.pond_ids`, `app.user_id`, `app.supabase_id`, `app.org_id`). An unset setting compares as NULL, so the role sees **no rows** rather than every row - a deliberate fail-closed default.

  Phase 1 is safe to apply before the switch: the running app still uses the privileged `postgres` connection, every policy applies only to `optifeed_app`, and the migration contains no data change. Switching `DATABASE_URL` to the new role is a separate maintenance-window action and is **not** part of this release; until then tenant isolation remains application-level, exactly as before.

### Security

- **A dedicated tenant database role and core RLS policies are prepared (#711).** Phase 1 migration `20261104150000_tenant_app_role_phase1` creates `optifeed_app` with `NOBYPASSRLS`, grants table/sequence access, and adds `optifeed_app`-only policies for `Farm`, `Pond`, `User`, `Membership`, `Organization`, `EnergyDevice`, `FeedEvent`, `Notification`, `FeedRequest`, `WaterTempLog`, `FeedLevelLog` and `DeviceStateEvent`. It contains no `DELETE`, `TRUNCATE`, `DROP TABLE`, column change or data backfill. The current app keeps using `postgres`, so this is inert until the Phase 2 `withTenant` context and the `DATABASE_URL` switch; the app-side context and the switch are not in this migration.
- **The tenant context helper and the remaining tenant policies are prepared (#711).** `apps/web/lib/db/tenant-context.ts` sets `app.farm_ids`, `app.pond_ids`, `app.user_id`, `app.supabase_id` and `app.org_ids` with transaction-local `set_config`. Phase 2 migration `20261104160000_tenant_app_role_phase2` adds policies for the remaining tenant tables and switches `Membership`/`Organization` to the multi-org list. Platform-only tables stay default-deny for `optifeed_app`; platform-admin paths keep the privileged connection. `scripts/security/tenant-isolation-proof.mjs` is the read-only two-tenant gate for the staging copy. The app is still not switched.

## [1.55.1] - 2026-11-04

### Fixed

- **The hopper level is rounded instead of printed as a raw float (#848).** The 3D viewer showed `71.25105%` in both the ISO label and the hero callout, straight from the stored value. Both sites round to a whole percent, and a test asserts a fractional level renders `71%` and never the raw number.
- **The public footer shows the published firmware version, not a hardcoded one (#845).** It printed `v1.4.2` from a literal in all three locales while the fleet ran 1.9.0. The landing page now reads the stable channel's manifest through `getFirmwareStatus()` and renders that version, omitting the line entirely when the channel cannot be read rather than showing a stale number.

### Fixed

- **The landing footer's firmware version comes from the published channel, not a hardcoded string (#845).** It read "Firmware v1.4.2" in all three locales while the fleet was on 1.9.0 and the repository's `FW_VERSION` was already 1.10.0. The page now reads `getFirmwareStatus()` — the signed manifest in the private `firmware` bucket, the same source as the superadmin firmware console — and renders that version through a `{version}` placeholder; when the channel cannot be read the line is omitted rather than showing a stale number. The page body moved to a client component so the server wrapper can supply the value; a five-minute ISR window keeps it static between releases.

## [1.55.0] - 2026-11-04

### Added

- **The grow-out cycle cascades its dates and tolerates empty input (#826).** Editing the stocking date no longer moves the harvest date; the period re-derives from the pair and is clamped to the 30-365 rails, snapping back on blur and on save so the field can never show a value that will not be saved. Empty text falls back to the pair, then the last usable value, then the documented 135 default - never `NaN`, never a date derived from an empty string. This also fixes a live crash: clearing the stocking date called `daysBetween("")`, which threw.

### Fixed

- **Forms no longer lose typed values on the 30-second refresh (#825, #830, #831).** `DashboardLiveRefresh` replaces server props with new arrays and objects every 30 seconds by design. The growth-cycle and harvest forms now key their reset effects on a stable identity, the calendar keeps the operator's pond/type selection instead of re-hydrating from stale URL parameters, and the live hopper distance adopts the server snapshot by **timestamp** rather than object identity, so a polled reading and a captured calibration value survive the refresh. Each carries a test that fails when the fix is reverted.
- **Every organization in the feed-dispensed treemap has its own colour (#835).** The fill was read from Recharts' `node.index`/`tooltipIndex`, which made every organization's first pond resolve to palette slot 0 - all orange. The colour is now stamped on the datum from its top-level position and inherited by its ponds, with an explicit override supported.


### Changed

- **The redundant superadmin scope banner is gone (#834).** The sticky `GLOBAL SUPERADMIN` strip duplicated the sidebar and the page heading; it and its URL-crumb helper, CSS and locale strings are removed. The sidebar active item, page `<h1>`, mobile header band and skip link remain.
- **The project-layer agent rules are tracked in git (#821)** with an explicit precedence table, and the deployment allowlist is enforced by `scripts/ops/deployment-policy.mjs` inside `quality`.

### Fixed

- **Each organization in the "Feed dispensed by organization" treemap now gets its own colour (#835).** Tile fill was derived from Recharts' internal node index and tooltip path, so a node at depth 1, or a leaf whose path lookup missed, resolved to palette slot 0 — orange — and a multi-organization chart could paint entirely in that one colour. Colour is now stamped onto the datum from its top-level position (palette per theme), inherited by its ponds, and an explicit `color` overrides it; the renderer no longer reads Recharts internals. No data or schema change.
### Removed

- **The superadmin console no longer opens with a redundant sticky scope strip (#834).** The `GLOBAL SUPERADMIN` / `GLOBAL SUPERADMIN → ORG` banner repeated the sidebar's active item and the page heading while occupying a sticky row on every console page. The banner component, its layout and organization-page mounts, its URL-crumb helper, the `.ofd-console-scope` rule and the three `superadmin.shell.scope.*` strings are gone from English, Hiligaynon and Tagalog. The sidebar highlight, the page heading and the mobile header band still name where the operator is. No data or schema change.

## [1.54.0] - 2026-11-04

### Added

- **Telemetry and PII now have a retention policy, and organisation deletion purges (#726).** A documented retention window drives a purge job, and deleting an organisation removes its rows instead of leaving them orphaned. Previously the append-only tables grew without bound and a deleted tenant left data behind.

### Fixed

- **An offline or faulted ultrasonic sensor no longer reports a reading (#810).** The viewer shows the sensor as offline and keeps the hopper's last known level, instead of presenting a stale distance as current.

### Changed

- **Membership revocation semantics are documented and pinned (#765).** Revoking a membership ends organisation access and write authority but not the person's own farm, because the dashboard reads `Pond.ownerId` rather than membership. The policy is in `docs/rbac-permissions.md`, the admin UI says what revocation does and does not do, and tests fail if the behaviour drifts.
- **The deployment policy is recorded as enforced, not advisory (#805).** `scripts/ops/deployment-policy.mjs` runs inside `quality` and fails if `apps/web/vercel.json` or the documented `main` + `staging` allowlist drifts. Deployment Protection remains a dashboard setting and is explicitly unverified from the repository.
- **Release QA e2e is now part of CI (#816), and the dashboard bundle budget is re-baselined with accessibility coverage (#730/#818).**

### Added

- **Bounded retention for telemetry and personal data (#726).** `lib/retention.ts` now prunes `WaterTempLog` and `FeedLevelLog` after 365 days, closed `Notification` rows 180 days after resolution, `CalibrationRun` after 730 days, `AssistantAction` after 180 days, resolved `IssueReport` rows 365 days after resolution, `ReminderLog` after 180 days and `PlatformAuditLog` after 730 days. Each sweep removes at most one 5,000-row batch per device-watch run; an open alert or an open report is never deleted. Additive migration `20261104140000_retention_indexes` adds the global `recordedAt`/`sentAt` indexes the sweeps need.

### Changed

- **Retention, PII and erasure are documented, including the unimplemented organization purge (#726).** `docs/privacy/retention.md` records the schedule, the PII inventory (`User.contactEmail`, `IssueReport.email`, `PlatformAuditLog.ip`/`userAgent`) and the owner-mediated access/erasure path. Organization deletion remains a manual owner process: `PENDING_DELETION` and `purgeAfter` exist in the schema but no action sets them and no purge worker exists, so a purge flow (or removal of the unused fields) remains an owner decision. The document also records that the public policy's 90-day audit-log wording does not match the 730-day code window.
- **Release QA E2E coverage is now part of CI.** The suite covers the critical authenticated flows from the 2026-11-04 pass and axe checks on the public pages and dashboard, including the QA-20 contrast regression. `pnpm test:e2e:qa` runs the focused pair; the normal `pnpm test:e2e` and its CI job include them.

### Changed

- **The dashboard bundle budget is re-baselined (#730).** Develop CI run `41745118084` measured `/dashboard` at **1062.8 kB** first-load JS on 2026-11-04. Its committed budget is now **1116.0 kB**, a deliberate +5% rather than the usual +2%, so the busiest authenticated screen has real headroom while its measurement is recorded; every other route budget is unchanged.
- **The real dashboard page is now in the axe gate (#730).** `a11y-pages.test.tsx` renders `/dashboard` with a pond and a feeder and asserts zero serious/critical violations, instead of testing only the shared shell. The stat-tile term-info trigger now sits outside the tile link (it was a nested interactive control); that fix is what lets the page pass the gate. The authenticated Lighthouse gate for the whole console remains a follow-up.
- **Deployment policy is recorded as `main` + `staging` and guarded against drift (D7).** The promotion chain remains `develop` → `staging` → `main`; `develop` is validation-only, matching `apps/web/vercel.json`, and the global `main` + `develop` deployment default does not apply to this repository. Vercel Deployment Protection is now documented as a required control for preview deployments, and `scripts/ops/deployment-policy.mjs` (run inside the existing `quality` job) fails if the config, the deployment document and the documented allowlist diverge.
- **Membership revocation is documented as an organization-access change (#765).** The revoke confirmation now says that removing a member ends their organization access while their own farm and login remain; account deletion or disable is the separate operation that ends those. A regression test pins the post-revocation behavior: empty org scope, denied writes, and own-farm reads still available. The org-pond ownership edge case is tracked in #808.

## [1.53.1] - 2026-11-04

### Fixed

- **A job artifact no longer has to fit in memory, and a timed-out job actually stops (#728).** Downloads stream in 1 MiB chunks instead of buffering the whole blob, and a job that exceeds its budget receives a cancellation signal rather than being left to run while the worker reports it failed. The previous behaviour could exhaust the worker on a large export and then continue writing after the failure was recorded.

## [1.53.0] - 2026-11-04

### Fixed

- **Recovery links work, and a login returns you where you were going (#741, #760).** A reset link now redeems the hashed token server-side and establishes the session before redirecting, and login honours the requested deep link after validating it as same-origin with loop and backslash guards.
- **Revoked permissions actually disable the controls (#750).** Write capability is the AND of write authority and the held permission, so the schedule page, control room and hardware settings no longer offer actions the server would refuse.
- **Farm-facing dates are Manila time, not UTC or the runtime's local time (#753).** Filters and labels derive from the existing Manila day helper instead of the browser clock.
- **An empty growth dataset no longer renders 0.00 FCR and a downward trend (#752).** No data reads as no data.
- **Notifications behave** — inbox rows keep their stored link and every category has a label (#746), episode escalations appear in realtime (#747), pond alert settings are presented as the owner/admin control they are (#748), a later outage is no longer suppressed after a reconnect (#767), and the reminder email no longer goes to the synthetic pond address (#742).
- **Imports cannot write into the wrong pond, and a failed job cannot commit (#743, #758, #774, #781).** The target pond is pinned at request time, the transaction rolls back before the job is marked failed, and the audit events are export-only.
- **Deleting or demoting a member no longer strands their farm's ponds (#765 follow-up).**
- **The session cookie is Secure, SameSite=Lax and 30 days, not 400 (#717).**
- **Revealing a device token requires step-up (#720).** The action returns a typed `step_up_required` and the UI opens the existing dialog.
- **Public pages** — placeholder copy and mojibake corrected, a localized 404 added (#761), the report dialog can be cancelled while sending (#759), and white-on-brand CTAs moved onto the AA-safe orange (#756).
- **A11y** — dialogs and notification surfaces announce via proper dialog and live-region semantics (#757).
- **Jobs** — exports keep the newest rows and empty CSVs are usable (#755).
- **Hiligaynon is declared a partial locale with a coverage gate (#762)** rather than silently rendering English.
- **A zero-length feeding window is rejected and unsaved edits warn (#763).**
- **The controller's Feed Now asks for confirmation and is disabled on a fallow pond (#749).**
- **The demo seed no longer contradicts itself (#709, #779).**
- **Cron schedules are provisioned as code with heartbeats (#725, #796).**

### Changed

- **The admin user badge reads the membership role, not the legacy column (#754).**
- **`import` pins its target pond and the audit trail stops duplicating import events (#743, #744).**

### Security

- **Device-token reveals now require a fresh step-up check (#720).** `revealDeviceToken` wraps the scoped read and its audit row in `withStepUp`, so a stolen tenant-admin session cannot drain every device credential without re-entering the password. The action returns the typed `step_up_required` code and the devices UI opens the shared `StepUpDialog` then retries the same call. `lib/supabase/admin.ts` now imports `server-only` (new `server-only` dependency) so a client import fails at build time instead of shipping a service-role path. Tokens are still stored in plaintext and only a hash is used for lookup; encryption-at-rest remains open on #720.
- **Session cookies are Secure and expire after 30 days instead of 400 (#717).** `sessionCookieOptions()` now drives both the server and browser Supabase clients, so a refresh by either one writes the same flags: `Secure` in production, `SameSite=Lax`, `path=/` and a 30-day `maxAge`. `HttpOnly` is deliberately still absent because `createBrowserClient` reads `document.cookie` for Realtime and client sign-out; setting it now would silently break those flows. The CSP still allows inline scripts. Both remaining halves need the staged work described on #717.
### Fixed

- Mortality is validated against the live count before insert, and harvest defaults to the live count (#764).
- An empty growth page shows no FCR or ABW value and claims no trend until two reports exist (#752).
- Farm-facing times and history day filters use Asia/Manila (#753).
- The import transaction aborts before the 12 s job limit, so a failed job cannot commit later (#758).
- Demo seeds no longer create contradictory FCR rows, and seed/import telemetry is labelled by dataSource; device registration stamps Farm.id (#709).
- Crop reminder email gains a plain-text part and PakaonAI branding; the stale invite comment is corrected (#742).
- Imports now write to the pond captured at request time and reject rows whose pondId/deviceId belongs elsewhere (#743).
- **A reconnect no longer suppresses the next offline alert or clears the whole pond (#745).** `/api/ingest` wrote a `disconnected` event after advancing `lastSeenAt`, and `device-watch` treats any `disconnected` event newer than `lastSeenAt` as "already alerted", so a feeder that reconnected once and dropped again never alerted. Reconnect now records only the `connected` event, and recovery closes the per-device `offline:<deviceId>` episode instead of a pond-wide clear.
- Exports keep the newest rows, empty CSVs have headers and a BOM, and the PDF shows the newest FCR reports (#755).

- **Login returns to the page that asked for it (#760).** The proxy now appends the intercepted page as `/login?next=…`, the login form forwards it to `loginWithPassword`, and the action redirects there after authentication. `sanitizePostLoginPath` accepts only a same-origin absolute path (rejecting absolute/protocol-relative URLs, backslashes and the login page itself), and a forced password change still wins over the requested page. Locale prefixes are stripped before `redirect()` re-adds them.

### Security

- Audit events are now export-only, so caller-supplied source, actor and timestamps cannot be imported (#744).

### Added

- Cron schedules are provisioned from environment values and every run writes a CronHeartbeat read by /api/health/cron (#725).

## [1.52.0] - 2026-11-04

### Fixed

- **A password reset no longer requires a farm-wide lockout, and recovery needs proof (#718, #721, #732).** The reset flow demanded a proof the user could not obtain and, when it failed, locked the whole farm rather than the account. The proof is now checked against the request that created it, and the lockout is scoped to the account that failed.
- **A pending feed and a device event id are scoped correctly (#724, #727).** Pending feed requests were being dropped in a race, and event ids were compared across devices instead of per device, which could suppress a legitimate event.
- **An import cannot commit after its job is marked failed (#723, #728).** The import writes and the job status now agree: a failed job leaves no committed rows, and artifact memory is bounded so a large import cannot exhaust the worker.

### Changed

- **CI pins its actions, moves pnpm overrides to where pnpm reads them, and verifies the Docker build (#710, #713, #714, #715, #722).** The workflow matrix was relying on resolution that pnpm 10 no longer applies; the Docker build is now exercised rather than assumed.

### Security

- **Audit events can no longer be imported, so their provenance cannot be forged (#744).** The CSV/workbook import accepted `audit_events` and wrote the caller's `source`, `actorId`, `metadata` and `createdAt` straight into `DeviceStateEvent`, letting a tenant writer insert a backdated system or token event attributed to another user. `audit_events` is now export-only: the prepare, prepare-template and import-job routes reject it, the import dialog no longer offers it, and `confirmImport` refuses it before opening a transaction. Reviewing the audit trail by export is unchanged.
- **A password reset now needs the proof carried by the recovery link (#718).** `completePasswordReset` previously accepted any authenticated session, so a stolen or shared session could set a permanent password without knowing the current one. The reset request now mints a 15-minute HMAC-SHA256 proof whose `jti` is stored in a new additive `PasswordResetToken` table, puts it in the Supabase recovery `redirectTo`, and the action verifies the signature, expiry and user binding before atomically consuming the proof. A missing, forged, expired, replayed or other-user proof returns `reset_link` and does not touch the password.
- **A farm-wide failure burst no longer locks every farmer out (#721).** The per-(farm, IP) five-attempt hard lock is unchanged. The farm-wide counter still raises one security notification at ten failures in fifteen minutes, but it no longer writes or reads a farm-wide lock, so two source IPs cannot hold a farm offline. The accepted tradeoff is that distributed guessing below the per-pair lock is not stopped by a farm-wide gate.
- **Client-IP trust and reset-link origins now fail closed (#732).** `TRUSTED_PROXY_HOPS` (default 1, clamped to 1..10) selects the address that many entries from the right; a shorter chain or invalid selected entry returns `null` instead of trusting a client-written value. Password-reset audit rows now use that parser, and a non-production deployment with neither `NEXT_PUBLIC_BASE_URL` nor `NEXT_PUBLIC_SITE_URL` mints no link and sends no email instead of pointing at production. The reset request still returns the same anti-enumeration answer and records the configuration failure.
- **A recovery link now establishes the session before the reset form (#741).** The emailed URL targets `/{locale}/auth/confirm`, which redeems Supabase's `hashed_token` server-side with `verifyOtp`, writes the `@supabase/ssr` cookies and then redirects to `/reset-password` carrying the #718 proof. A non-recovery hash, a failed redemption, a missing proof or an unknown locale lands on the existing expired state and never forwards a usable proof. The reset form still requires the signed single-use proof; no database change.

### Changed

- **The shared fallback password is retired in the manual-testing documentation (#712).** `docs/password-auth-plan.md` now records that `password123` must not be used for any account, that `superadmin`, `independent-farmer` and `test` still need owner action in Supabase Auth, and that per-account random temporary passwords are required. The accounts are not claimed as fixed.

### Added

- **CI builds the container image (#714).** `.github/workflows/docker.yml` runs `docker build` with the Dockerfile's default arguments when the Dockerfile, compose file, lockfile, manifests or the workflow change. It never pushes or deploys, and the first run is pending; the runtime container path remains unverified.
- **The security overrides are checked on every install (#713).** `scripts/security/check-overrides.mjs` (run as `pnpm security:overrides` in CI) fails when package.json regains the ignored `pnpm` field, when the workspace or lockfile override set drifts, or when a resolved dompurify/minimatch/uuid/browserslist/proxy-addr/source-map-js/baseline-browser-mapping version falls below its floor.

### Changed

- **pnpm security overrides moved to `pnpm-workspace.yaml` (#713).** pnpm 10 ignores `pnpm.overrides` in package.json and warned on every command; the same pins now live in the settings file pnpm actually reads, and the dead field is gone. The lockfile already records the same overrides, so `--frozen-lockfile` remains valid.
- **`pnpm install` generates the Prisma client when the schema is present (#715).** The guarded root `postinstall` skips cleanly in the Docker deps stage, where only manifests are copied, so a fresh clone or a pull that changes the schema no longer fails `typecheck` until someone runs the generator by hand. `DEMO_SUPABASE_ID` is now documented in `apps/web/.env.example` for the demo seed.
- **GitHub Actions are pinned to commit SHAs (#722).** Every `uses:` in `.github/workflows/*.yml` now names a 40-character commit with the version tag in a trailing comment, so a moved tag cannot change what CI executes. The `pnpm dlx @lhci/cli` invocation is unchanged and recorded as a follow-up; workflow permissions are unchanged.
- **The Lighthouse transfer budget is 535,000 B (#710).** The old 525,000 B ceiling failed on samples of 526,268 / 526,263 / 526,263 B at `09d4234` and 526,595 / 527,664 / 527,654 B on develop at `d7ff4518` (0.24–0.51 % over) on every branch. The new ceiling keeps 1.4 % headroom over the worst measured sample; the performance score floors are unchanged, and `docs/ci-required-checks.md` records the decision plus the owner action for making the security, SBOM, E2E and Lighthouse checks required.

### Fixed

- **Controls follow their action's permission gate (#750).** The schedule page, dashboard control room and hardware settings now pass `control_feeder` / `manage_schedule` capabilities (write authority AND the held permission) to the client controls, matching the server's `requireWriteAccess` + `requirePermission` order. A revoked permission disables the affected controls instead of leaving an enabled button that the action refuses. `view_dashboard` / `view_reports` are not enforced here; that read-surface decision needs the legacy-account question answered first.
- **A repeated import confirm no longer imports the dataset twice (#723).** The synchronous route accepts an `Idempotency-Key` header and the queued `import_confirm` job carries it; without one, a stable sha256 of `type + csvData` is used so existing clients are protected too. A replay returns the first result, a failed import leaves the key unconsumed for a retry, and two concurrent confirms resolve to one winner. Adds the additive migration `20261104110000_import_idempotency` (one new table, no data change).
- **Export artifacts are capped at 25 MB and downloads no longer make a second copy (#728).** A job whose generated file exceeds the cap now fails with a readable message instead of risking an out-of-memory kill, and the download route returns 413 for an oversized stored artifact before loading it. The route serves the stored bytes directly and reports `Content-Length` from those bytes.
- **A failed device poll now returns 503 instead of a fake 200 idle (#724).** `GET /api/feed-command` and `GET /api/schedule-sync` answered 200 with `feed_requested: false` / a default schedule whenever the database or a handler threw. The ESP32 read that as a successful poll and stopped retrying, so a pending feed expired undelivered while monitoring reported a healthy device. Both catches now return `503` with `Retry-After: 5`, which the firmware already retries on its 5 s loop; a genuinely empty queue still returns 200. The feed-command route also builds its firmware config before claiming the request, so a failure cannot mark a real feed `dispatched` and lose it.
- **Feed event ids are unique per device, not globally (#727).** `FeedEvent.eventId` was globally unique, but the firmware mints ids per unit, so a second device (or a reflashed unit restarting its counter) could collide and have a real dispense answered `204` and dropped. The Prisma model is now `@@unique([deviceId, eventId])` and migration `20261104100000_feed_event_device_unique` replaces the old global index with the compound one. The 204 replay guard remains for the same device + event id; the same id from two devices now stores two rows. **This migration drops an existing index, so it is a schema relaxation - no rows are deleted, but it needs the owner's approval and a verified backup before it reaches production.**

## [1.51.0] - 2026-11-03

### Added

- **The command center renders the charts it was built for (#707).** The six primitives, the shared 7d/30d/90d/custom range and the lazy entry points were shipped in #629 but no page imported them, so the console still showed the old three charts. The sections now read from the real growth, feed-breakdown, heatmap, freshness and fault models, with explicit empty, single-point, error and permission-denied states. Found by an independent QA pass, not by the unit tests - the components were only ever tested in isolation.

### Fixed

- **Six console contrast and layout defects from that QA pass (#631).** Dark-mode hover text went from 1.41:1 to the tested `console-content` pair; white on brand orange (3.54:1) moved to the accent pair at 5.18:1 light and 8.06:1 dark; five error banners and the "BEST" chip no longer sit light inside dark chrome; the navy chart series (1.54:1 on dark) got a dark palette where the darkest is 6.20:1; five tables stop rendering as both table and cards at 390 px; and the connectivity chart's 9 px viewBox labels no longer scale to ~4 px on a phone.

### Added

- **The command center renders the chart layer it already shipped (#707).** #629 built six primitives, the shared range control and four platform read models, but no page imported any of them, so the console a platform admin sees was unchanged. `/superadmin` now draws sections C–G from the real queries: registrations per day (`getGrowthSeries`), feed by organization → pond sized by mass (`getFeedBreakdown`), the day × hour feeding grid (`getFeedHeatmap`), telemetry freshness and current fault distribution (`getFleetMonitor` plus the zero-query summaries), and a newest-first activity rail built from the failed-job and pending-approval rows the page already loaded. The shared `ChartRangeProvider`/`ChartRangeControl` wraps the page: choosing 7/30/90 writes `?range=`, so the queries re-run rather than only the plot, and a custom window narrows the widest loaded window in the browser because `parseAnalyticsRange` has no custom spelling. Each read is isolated with `Promise.allSettled`: a failing section renders its own "could not load" panel (the fleet monitor's `sourceError` does the same) instead of an empty axis, while an auth redirect raised inside a loader is re-thrown so a non-admin never gets the console. The range filter is anchored to the newest bucket the server returned, which stops the newest day from disappearing when the browser's day boundary lags the Asia/Manila one. `superadmin-command-center-wiring.test.ts` asserts the imports themselves, which is the part the isolated component suites could not see.

### Changed

- **Recharts is out of every route's first load.** Splitting only the command center's charts left Turbopack holding a sync and an async copy of the chart library: every route that still imported `@/components/charts` statically grew ~+74 kB. The five remaining static consumers (`/admin`, `/dashboard`, `/dashboard/history`, `/dashboard/growth/history`, `/superadmin/operations`) now import the same `charts/lazy` entry points, which removes the duplicate copy and takes the library off their critical path too. Measured with `scripts/perf/bundle-budget.mjs` on the same build: `/superadmin` 1374.4 → 974.9 kB, `/dashboard` 1471.8 → 1058.1, `/dashboard/history` 1447.3 → 1033.4, `/dashboard/growth/history` 1404.2 → 990.3, `/superadmin/operations` 1380.3 → 965.7, `/admin` 1106.0 → 691.4. Those six entries in `perf/bundle-budget.json` are regenerated from that build, so the gate now holds the lower numbers rather than the pre-split ceiling.

### Fixed

- **The console's dark hover states, light panels, chart series and mobile tables now follow the token layer (#631).** The independent QA run on #631 found the shell themed but the page bodies still carrying light-only decisions; all six P2 defects are fixed without a new literal in a converted file:
  - Hover text: the six `hover:text-[#0A3D62]` sites (`ops-nav`, `config-centre`, `user-actions`, `new-account-form`, `operations/errors`, `org-members`) were 1.41–1.66:1 in dark mode and now use `text-console-content` / `hover:bg-console-surface-raised`; the active tabs use the same AA-safe accent pair as the sidebar.
  - White on the brand orange (3.54:1) is gone from the settings "Open backup" button, the active user filter and the account-menu avatar; all three use `console-accent` with `console-accent-foreground` (5.18:1 light, 8.06:1 dark).
  - The error banners on fleet, incidents (list and detail) and tenants, the "BEST" comparison chip and the route skeleton now paint from `console-critical-surface` / `console-ok-surface` / `console-border-strong`, so no light panel is stranded in dark mode.
  - `SERIES_COLORS` gained a `DARK_SERIES_COLORS` counterpart: navy `#0A3D62` was 1.54:1 on the dark card, so the second stacked-bar/donut series disappeared. Every dark series is now ≥6:1 on `#111A2C`, and the contrast suite asserts both palettes at the 3:1 graphical-object threshold from the tokens in `globals.css`.
  - The five list pages (fleet, incidents ×2 tables, tenants, tenants/compare) hide the 64 rem table below `md`, matching the sibling pages, so a phone no longer renders the table and the same rows as cards.
  - The connectivity trend's 720×168 viewBox scaled its 9 px axis labels to ~4 px at 390 px; the labels are now HTML at a fixed 10 px beside a horizontally stretched plot, so the chart stays readable at every width.
  No route, dependency, query or authorization check changed; `bundle budget + latency` stays green (all 71 routes within budget, 3/3 gated endpoints within their p50/p95 limits).

## [1.50.0] - 2026-11-03

### Added

- **The physical button's feed amount is now writable from the dashboard (#658).** It and its tuning were overlaid from the device but nothing in the app could set them; they now go through the existing device-config path, with the firmware's own bounds mirrored in the input and the device-reported value shown back.
- **Hopper calibration is no longer blind (#659).** The raw ultrasonic reading and its timestamp are rendered where calibration happens, so the distance moves while someone waves a hand under the sensor, and the hopper filter is settable from the same surface instead of firmware-only.

### Changed

- **The console shell runs on one palette (#628).** 25 `--console-*` tokens replace every colour literal in the shell, sidebar, bottom nav, monitor primitives and dialogs, so there is no `dark:` pair left to forget. Three pre-existing contrast failures were fixed on the way: the active sidebar item and the `PLATFORM` pill were white on `#E85A2A` at 3.54:1 (now 5.18:1 and 8.06:1) and the warning badge moved 4.60 -> 5.43:1. Breakpoint composition is asserted at 1920/1440/1280/1024/768/390, which surfaced two real layout bugs: an orphaned donut between 1024 and 1279 and a dead third column in the work-queue grid at 1280 and above.
- **Firmware tuning constants have one source of truth (#662).** Duplicated values between `firmware-main/config.h` and the web mirror are collapsed, with a parity test that fails if they drift. No device behaviour changed; native tests 69/69 and the GPIO5 build still succeed.

### Added

- **The hopper filter can be tuned per device, and calibration shows the live raw distance (#659).** The seven ultrasonic filter keys (`hopper_refill_margin_pct`, `hopper_reject_below_cm`, `hopper_reject_above_margin_cm`, `hopper_ema_alpha`, `hopper_jump_pct`, `hopper_persist_cycles`, `hopper_state_hold_s`) were firmware-only constants - `editable: false` and never overlaid onto the poll response - so a bouncing or noisy sensor could only be adapted with a new build. Device settings -> Calibration now has **Hopper sensor filter**: the values are stored per device (seven nullable `EnergyDevice` columns, additive migration, no new table), written by `saveHopperFilterSettings` with write access plus the revocable `manage_schedule` permission and a `hopper_filter_changed` audit row in the same transaction, and overlaid onto the poll response's `config` object. Every bound and default comes from the shared `FIRMWARE_FIELDS` table that a test pins to `firmware/firmware-main/config.h`, so the form, the server schema and the device cannot drift. A null column sends nothing and the card says how many values still run on the firmware default. The card also shows the unit's own echo (`config_rev` / `config_source` from `diag`, compared with the last recorded change) because a write is only a promise until the unit polls. Separately, calibration was blind: `feedLevelCm` was ingested and stored but no screen rendered it, so an operator setting the full/empty references had to measure the tank externally. The hopper form now shows the raw distance and its timestamp, refreshing every few seconds while the tab is visible, with capture buttons that write the reading on screen into the full or empty field. The value comes from the existing authenticated live endpoint (`GET /api/devices/{id}/state`, now carrying `feedLevelCm`), so there is no new route and no new dependency; a failed poll keeps the last reading. Copy is in English, Hiligaynon and Tagalog (machine-drafted, queued for review).

- **The physical button's dose can be set from the device settings page (#658).** `EnergyDevice.buttonFeedGrams` was already overlaid into the poll response as `button_feed_grams`, but nothing in the dashboard wrote it, so every unit dispensed the 80 g schema default on a button press. Device settings → Feeding now has **Button feed amount** beside the daily ceiling: it saves through the existing settings server action (`updateDeviceButtonFeed`), guarded by the revocable `control_feeder` permission, and writes the device update plus a `button_feed_changed` `DeviceStateEvent` in one transaction. The input accepts only the firmware's own 1-500 g `button_feed_grams` envelope (`firmware/firmware-main/config.h`, mirrored by the shared field table and the server schema), so an out-of-range value is refused before any request. Because a write is only a promise until the unit polls, the card also shows what the device reported: the last physical-button press and its dispensed weight, with a change marked **not confirmed** until a later press reports the stored dose. A failed or unreadable report is labelled as such instead of being shown as "no press". Copy is in English, Hiligaynon and Tagalog (machine-drafted, queued for review); no schema change and no new dependency.

### Changed

- **The superadmin console paints from one token layer, in both themes (#628).** The shell, the console primitives, the monitor panels and the shared console dialog no longer carry hex literals or raw Tailwind colours: every surface, border and status colour is a `--console-*` custom property declared once in `apps/web/app/globals.css`, with a light value and a dark value behind the same `bg-console-*` / `border-console-*` / `text-console-*` utility. A component can no longer be half-themed by forgetting a `dark:` variant, and the contrast suite now reads the palette out of the stylesheet instead of a second copy of the hex values, so it checks what actually renders. Three colours moved to meet WCAG: the active sidebar item and the "PLATFORM" header pill were white on the decorative brand orange (3.54:1) and are now the AA-safe accent (5.2:1 light, 8.1:1 dark), the warning badge text went from 4.60:1 to 5.43:1, and field outlines now meet the 3:1 non-text threshold. The console pane has its own three-step padding scale (16 / 24 / 32 px) that the breadcrumb banner reads, so its bleed can no longer drift from the pane; the analytics row now splits in two from 1024 px instead of stacking one chart above an orphaned donut, and the two work-queue panels keep two columns at 1280 px instead of leaving a third empty. No page gained a route, a dependency or a client component, and no API call, query or authorization check changed.

## [1.49.0] - 2026-11-03

### Added

- **The feed calculator takes either kilograms or grams (#683).** A labelled unit control switches every weight field and result, converting what is already typed (1.5 kg <-> 1500 g) without drift. The server still receives kilograms and `gramsPerFeeding` stays in grams, so the device contract is unchanged.
- **The OTA rollout policy is visible and editable from the console (#660).** Ten fields generated from the firmware field table, written through the existing platform settings path with an audit row and a guard against an inverted rollout window. The card also reports each unit's state - applied, pending, reported, never reported - by comparing the echoed `config_rev`, so an unsaved value never looks applied.

### Fixed

- **A sample queued offline no longer waits for an `online` transition (#665).** The outbox drains on mount, on a 30-second timer, on visibility change and on a new queued item. Per-item claims with a two-minute expiry make a double drain safe, per-pond order is preserved, and an item that fails three times is surfaced instead of retried forever. The replay engine is lazy-loaded, so the dashboard chunk did not grow.
- **The dashboard bar no longer claims to be sticky when it never was (#572).** The shell already keeps it permanently visible as a flex sibling of the single scroll pane, so `sticky top-0` was decorative; it is removed, the height stays 64 px because the control-room and calendar chrome subtract it, and separation is an inset hairline. CSS only.

### Added

- **The feed calculator accepts weights in kilograms or grams (#683).** A labelled **Weight unit** control re-expresses the current and target weights when it is switched (`1.5 kg` <-> `1500 g`), so a farmer weighing fingerlings can type grams instead of `0.015`. Every weight field and result on the card follows the selected unit; the per-meal dose stays in grams because the feeder firmware works in grams. The server contract is unchanged: values are converted to kilograms at the UI boundary before `calculateFcrFeed` receives `currentWeightKg` / `targetWeightKg`. Copy is in English, Hiligaynon and Tagalog; blank or malformed input is rejected rather than sent as `NaN`.
- **The OTA rollout policy has a dashboard surface and a report-back view (#660).** The ten `ota_*` keys (check interval, uptime and signal floors, near-feed guard, quiet window, heap floor and the download and health-check timeouts) were settable on the device but had no input anywhere, so every unit stayed on the compile-time values. Superadmin → Settings → **OTA rollout policy** now edits all ten through `setFirmwareOtaPolicy`, which writes the same `firmware.gates` row (no new table), refuses any id outside the ten, refuses a quiet window whose start is not before its end instead of letting the reader repair it to the defaults, and records one `platform.settings.firmware_ota_policy` audit row with the before/after values and the required reason. The same section shows what the fleet reports back: firmware 1.7.0+ echoes one `config_rev` for the whole config plus `config_source`, so each unit is shown as applied, pending, reported or never reported by comparing its newest `config_applied` row with the last recorded policy change. Per-key device values are not shown because the firmware never sends them. Copy is in English, Hiligaynon and Tagalog (machine-drafted, queued for review); no new dependency and no schema change.
- **The device page reports how far the clock had drifted (#662).** The firmware corrected RTC drift from the server clock but only ever logged it to Serial, so an operator could see `rtc_ok` and nothing about accuracy. The heartbeat's `diag` now carries `rtc_drift_s`, the signed seconds the last correction removed (positive = the clock was behind, negative = ahead, `0` = no correction needed this boot); ingest stores it with the rest of the sanitised diagnostics and the device panel already renders every `diag` key. The correction stays automatic and unconfigurable - there is no offset for a technician to set.

### Changed

- **The calibration caps and the heartbeat cadence have one source instead of copies (#662).** `firmware/firmware-main/config.h` stays authoritative, and the app now keeps its mirror in one place: `apps/web/lib/limits-core.ts` holds `CALIBRATION_MAX_GRAMS` / `CALIBRATION_MAX_DISPENSE_MS`, `limits.ts` derives the test window and weighed-output caps from them instead of restating `600` / `5000`, and `FIRMWARE_HEARTBEAT_INTERVAL_S` is the single exported cadence the connectivity rollup sizes its gap threshold from. `firmware-config.test.ts` parses the header and fails if any of those values, or the relay and daily caps beside them, drifts from the firmware envelope. No value changes today, so this is a pure refactor; the values that stay deliberately fixed (probe plausibility, RTC correction, heartbeat interval) are recorded in `docs/firmware-dashboard-config.md`.

### Fixed

- **A sample queued while offline is replayed without waiting for an `online` event (#665).** The outbox is drained on mount/rehydration, whenever it changes, when the tab becomes visible and on a 30-second timer, in addition to the browser's `online` event. Each queued item is claimed before it is sent and removed only after the server accepts it, so overlapping drains (or a second tab) cannot submit the same sample twice, and a pond's samples keep their order. An item that uses all three automatic attempts is parked as `failed` and stays in the sync panel with a manual retry instead of being retried forever.
- **The farmer dashboard's top bar no longer claims a sticky position it never had (#572).** The shell is a fixed-height frame and the content pane is its only scroller, so the bar is already pinned by sitting outside the scroller — `position: sticky` could never engage. The bar is now plain markup in the server layout with a constant inset hairline instead of a heavy shadow; no client JavaScript, height, border or padding changed, so nothing shifts. The mobile band keeps its `env(safe-area-inset-top)` padding, and the pane keeps reserving the bottom bar plus `env(safe-area-inset-bottom)`.

## [1.48.1] - 2026-11-03

### Changed

- **Dependencies moved to their next major where the full suite proves it.** `sonner` 1.7 -> 2.0 (toasts; 20 call sites use only `success` / `error` / `info` / `warning` and the single `<Toaster>` mount, verified against a jsdom render) and `@commitlint/cli` 19 -> 21 (the commit-msg hook still blocks a malformed message and accepts a conventional one). Both were tested on throwaway branches before merge: full unit suite 439 files / 5,252 tests, typecheck and lint clean, `pnpm install --frozen-lockfile` accepted.

### Notes

- `@commitlint/cli` 21 requires **Node 22.12 or newer**. CI already uses Node 22; local setups below 22.12 will install fine and then fail on the first commit. The README now says so.

## [1.48.0] - 2026-11-03

### Added

- **A platform admin can email a password-reset link from the console (#608).** The account action sends the reset through Supabase rather than setting a password by hand, so the operator never sees or transmits a credential.
- **Critical alerts and a daily digest can go out by email (#609).** Critical notifications and a once-daily warning summary are delivered to the address on the account, alongside the existing in-app bell.
- **Pakoy's settings actions are owner-scoped and can propose a daily feed cap (#610).** The assistant only offers settings changes the caller is allowed to make, and a proposed daily cap lands as a reviewable change rather than a silent write.

### Fixed

- **Deleting a user can no longer leave a row with no working login (#686).** The Supabase login is revoked after the delete transaction commits instead of inside it. The external call could not be rolled back, so a later statement failing used to leave the user record intact with its login already gone. If the cleanup fails after the commit, the account still cannot reach the app and the orphaned login is logged for follow-up.

## [1.47.1] - 2026-11-03

- **A platform administrator can email a password-reset link, instead of only issuing a temporary password.** The superadmin account actions gain **Send link**: it mints a single-use recovery link for the account's login address (Supabase `generateLink`) and delivers it through Resend to the contact email on file, with the same step-up, reason and audit rules as every other platform mutation. The link itself is never returned, logged or written to the audit row; the row records only whether delivery succeeded. When the account has no contact email, or the deployment cannot send mail, the action refuses with a typed reason and tells the administrator to add an address or use the existing temporary-password reset. The profile page now shows a prominent "no email on file" notice, because password reset by email is unavailable until an administrator adds one. The superadmin configuration centre also reports whether the password-reset sender is configured, separately from invites and reminders.

- **The platform console separates registered from active devices and shows a stored 90-day connectivity trend (#479, M3C.10).** `/superadmin` now answers three questions with the existing monitor primitives: how many devices are registered, how many were active in the last 30 days, and what share of the fleet was reachable each day. A device is active when it has a heartbeat (`lastSeenAt`) **or** any feed event in the window, so an imported `hand_fed` daily total counts, and the query counts each device once (decision O22). The trend comes only from a new per-device daily rollup, `DeviceConnectivityDaily` (additive migration `20261102180000_add_device_connectivity_daily`, deny-by-default RLS, unique `(deviceId, day)`, 90-day retention), written by the existing `device-watch` cron **before** the 7-day heartbeat sweep: it recomputes the previous completed UTC day once behind a `connectivity.rollup` marker and replaces that day in one transaction (decision O24). Online minutes are the measured heartbeat span minus, per gap, the silence beyond the configured gap threshold — the `device.status` offline window, floored at the 5-minute stored-row cadence, plus two firmware beats of slack — using the configured `heartbeat_interval_s`; nothing is extrapolated to a day boundary. A day with no stored heartbeat has no row and renders no bar, never a zero. Copy is in English, Hiligaynon and Tagalog, the table is in the export allow-list, and there is no new dependency, no client polling and no schema change outside this slice.
- **The incident queue now has a stored lifecycle, not only derived conditions (#479, plan M3C.6).** Two additive tables (`PlatformIncident`, `PlatformIncidentEvent`) carry New → Acknowledged → Investigating → Resolved plus Escalated, with a stable dedupe key per condition. The device watch upserts `device_offline:<deviceId>`, `safe_mode:<deviceId>`, `fault:<deviceId>:<fault>` and `failed_job:<jobId>`, refreshes an open incident instead of opening a second one, auto-resolves only when the owning source actually reported, and reopens the same row when the condition returns. Operators get Acknowledge, Investigate, Resolve and Escalate on a detail page with the full timeline; each transition writes a timeline event and one `PlatformAuditLog` row (an escalation also records the in-app notification event), and an illegal transition is refused in the pure rules and the action. Escalation is in-app only: it assigns a named platform-admin owner, sets a 30-minute acknowledgement target and announces the incident to the platform-admin role in the console, with no email, chat or pager. Both tables have RLS enabled (deny-by-default, the platform pattern) and are in the backup allow-list. **The migration `20261102160000_add_platform_incidents` is additive; taking a full platform backup first is still required when it is applied to a hosted database.** No new dependency; the derived M3C.5 queue is unchanged and remains on the same page.
### Fixed

- **A backup dump can no longer be altered through the request reason (#671).** The operator-supplied reason was concatenated into the dump statement, so a newline in the text could start a new statement. It is now passed as data, and a regression test covers both a newline and a quote.
- **A manual feed command can no longer be dispatched twice (#670).** The dispatch path read the request and then updated it; it now claims the request atomically before dispatching, so two concurrent workers cannot both send the same dose.

### Changed

- Dependency updates within their existing majors: driver.js, `jspdf-autotable`, `jszip`, `papaparse`, `resend`, and the GitHub Actions group (#544, #541).

## [1.47.0] - 2026-11-03

### Added

- **The PDF reports now carry the PakaonAI mark and a headline card row (#625).** Every growth, SGR and FCR report opens with the brand mark beside the title, the three headline figures as labelled cards, a rule above the footer, and the remaining figures in the compact table underneath. The mark is embedded as a 6 KB PNG instead of being read from `public/` at runtime: public assets are served by the CDN and are not traced into a serverless function, so the logo would work locally and disappear in production. No schema change, no new dependency.
- **A calibration coverage matrix for every device setting, with the gaps filed (#617).** `docs/audits/2026-11-03-calibration-coverage.md` maps all 46 firmware config keys and 14 device columns to the surface that changes them: 7 editable in the console, 10 settable through a device/org/platform surface, 1 overlaid but unreachable (`button_feed_grams`), and 28 firmware-only. It records the one genuinely guided calibration (the weighed auger rate test), resolves the two named unknowns - RTC drift is corrected automatically by the firmware above 60 s, and the ultrasonic references are settable but blind because the live distance is never shown - and files five gaps as #658-#662 with severity. Docs only; no code change.
- **The feeder model has a real underside, so the bottom view shows a chassis pan instead of one flat cap (#623).** The change is additive in `tools/feeder-model/dimensions.json`: the base plate keeps its 340 × 450 × 10 mm slab and every tape value above it is untouched. Four 44 mm feet stand the unit **18 mm off the deck** and each carries a 7 mm deck-screw hole counterbored 16 × 6 mm through the plate; two more 16 mm counterbored mounting holes sit on the front/rear centre line. Five ribs stiffen the pan, one recessed raceway with two rails and four straps carries the DS18B20 cable from the front clip, and the probe cable and motor leads meet at a 22 × 14 mm rubber grommet through the plate into the chassis, with a strain-relief boot at the clip and a clamp on the motor leads. The plate's downward normals are recomputed after every boolean cut and the build log reports the underside area. Model asset **`feeder-v1.3.0.glb`** (1,585,320 bytes / 48,000 triangles, dimensions revision `tape-2026-10-29-post-underside`); `feeder-v1.2.0.glb` is untouched, the manifest points at the new file, `FEEDER_MODEL_VERSION` follows it, and the build script's preview set now includes a `bottom` view. The preview images under `docs/feeder/` still show the previous model. The viewer-facing `model-manifest.json` now carries only `version`, `contract` and `file` — the keys `feeder-parts.ts` reads — because every key in that file is bundled into the device-detail first-load JS, which sits at its 999.5 kB budget; the sha256, byte count, triangle count, generator, dimensions revision, build time and node list moved to `tools/feeder-model/model-build.json`, which the app does not import.
### Fixed

- **Two overlapping device polls can no longer dispatch the same feed request (#670).** The poll selected the head pending request and then updated it by id, so two concurrent polls with the same valid token could both read it and both be told to dispense. The claim is now a compare-and-set (`updateMany` guarded by `status: "pending"`), and only the poll whose update changed a row receives the request; a lost race looks for the next pending row instead of stopping. The existing 60-second expiry sweep is unchanged. No schema change.
- **A newline in a backup reason can no longer inject SQL into the dump (#671).** Both export routes now reject control characters in the reason instead of only trimming it, and the SQL header neutralises any control character in the reason, actor or organization names to a space. A value such as `ok\nDROP TABLE "User"; --` stays inside the `--` comment, so restoring the file cannot execute it. The validation is shared in `lib/backup/reason.ts`, with tests for both the optional tenant reason and the mandatory platform reason. No schema change.
- **A production-readiness register with a P0, six P1s and 36 P2s, all with file:line evidence (#618).** `docs/audits/2026-11-03-production-readiness.md` reconciles OP4's earlier register with the current tree: it records the six findings already fixed (RLS containment, the device-health fallback, legacy write authority, job retries, ingest dedupe, landing-page budget) and adds a fresh backend and frontend pass. The P0 is that staging shares the production database and credentials by decision; the P1s cover offline sample replay, the kiosk's frozen status, `deleteUser` deleting the login inside the DB transaction, the feed-command double-dispatch race, SQL injection through the backup reason, and an unverified provider recovery point. Seven issues were filed (#665, #666, #668-#672). Read-only audit; no code change in this PR.
### Fixed

- **The large-screen view has one live status and a scene that fills the display (#666).** The header printed the device status captured at server render while the viewer beneath polled every 15 s, so a feeder that went offline could show "Idle" above an "Offline" badge indefinitely. The static line is gone; the viewer's polled badge is the single source. The scene and its skeleton now share one height (`calc(100dvh - 11rem)`) with no 780 px cap, so a wall display fills the viewport and the image no longer shifts when the scene replaces the skeleton.

## [1.46.0] - 2026-11-03

### Added

- **A full-bleed large-screen view, with every live sensor on the 3D strip (#616).** `/large-screen/{deviceId}` renders the feeder outside the dashboard chrome - no sidebar, header or bottom bar - with the scene at `min(70dvh, 780px)`, larger readings and a back link. It uses the same guarded `getDeviceDetail` read, so a device outside the caller's scope is a 404 rather than a blank display. The strip now also carries the fresh Wi-Fi signal (dropped by the existing freshness rule when it is older than the offline window) and the firmware version reported in the heartbeat diagnostics, and the hopper level is labelled stale with its age when that reading is old. The device page links to it with "Open large screen", and the chosen simple view now reads live health state again rather than the initial props it was left on after the #620/#626 merge. Copy is in English, Hiligaynon and Tagalog; no schema change, no new dependency.

## [1.45.1] - 2026-11-03

### Fixed

- **The chat panel no longer camouflages in the system header (#602).** The Pakoy panel header used the same navy as the app chrome and opened directly beneath it, so the two bars read as one surface and the panel looked headerless. It now uses the chat layer's own brand-orange token (`chatHeader`), with the tagline and close control raised to solid white so the smaller text still clears WCAG AA on the new background. The pair is recorded in `CHAT_CONTRAST`, so the existing contrast test covers the header too.
- **Saving an AI provider key or its settings now confirms with a toast (#568).** The console only updated an inline notice inside the provider card, which is easy to miss after a long form - the reported "the key change is silent" case. Every action on the AI Providers page (config save, key save, key clear, provider add, provider removal, chain reset) now raises a success toast, and a validation or server failure raises an error toast, while the inline notices keep their detail (test latency, key last-4). Copy for the new "provider removed" line is in English, Hiligaynon and Tagalog.

## [1.45.0] - 2026-11-03

### Added

- **The 3D feeder view now uses real camera controls (#623).** `OrbitControls` is replaced with drei `CameraControls`: right-drag pans instead of orbiting, a lock button keeps the camera fixed by default and remembers the choice, touch devices get pinch and two-finger pan, movement is bounded so the camera cannot leave the scene, and a reset returns to the default view. No dependency was added.

- **The superadmin console's chart layer gains the six visualizations the command center needs, on one shared date range (#629).** `components/charts/` now has a heatmap (activity by day Ã— hour), a timeline (incidents and device events on a time rail), a treemap (org â†’ ponds â†’ devices), a radial gauge (bounded health and utilisation percentages), a stacked area (cumulative consumption by source) and the KPI sparkline, which moved out of `superadmin/monitor/primitives` so there is one implementation rather than two. Every primitive handles both themes, an empty dataset, a single point, a loading skeleton and an error state, and keeps the visually hidden data table the existing charts already publish. A `ChartRangeProvider` and `ChartRangeControl` give a page 7d/30d/90d/custom and filter the temporal charts on the client: `LineTrend`, `MultiLineTrend`, `StackedBars` and `StackedArea` opt in with `temporal`, and a filtered stack recomputes its legend totals so the legend describes what is plotted. Legends are native buttons with `aria-pressed`, the cartesian charts set Recharts' `accessibilityLayer`, and `charts/lazy.tsx` splits every Recharts-backed chart into its own chunk so chart code stays out of the initial health-panel bundle. No new dependency, no schema change.
### Fixed

- **The 3D viewer's water-probe and RTC health now refresh with the 15-second poll (#620).** The poll DTO omitted the water probe entirely and carried the RTC bit only on the server render, so both stayed frozen for as long as the tab was open: a probe that failed at 02:00 still read healthy at 08:00, with nothing on screen saying the value was static. `toStatePayload` now projects every health field (`waterTempOk`, `waterTempC`, `waterTempUpdatedAt`, `rtcOk`, `lastSeenAt`) from the same `getDeviceDetail` read the page uses, and the viewer merges them into its state on each poll. A reading older than the device's offline window - the platform `device.status` setting, five minutes by default - renders as "Stale" with its age instead of being repeated as current, and a never-reported probe stays "Not reported" rather than turning into a fault. `lib/feeder/reading-freshness.ts` holds the age and staleness rules with boundary tests, and a live test drives the poll and asserts the rendered health changes.
- **The water-temperature offset is applied once, on the device, so every surface shows the same number (#622).** The firmware adds the stored offset before it transmits and ingest stores that value verbatim, but the hardware page, the dashboard card and the calibration form each added `tempOffsetC` again: a -0.7 °C offset displayed 26.4 °C for water the device had already calibrated to 27.1 °C, and the under-temperature warning (evaluated against the once-applied value) disagreed with the number beside it. The dashboard card and the hardware page now render `waterTempC` as stored, and the calibration form derives the sensor's true raw value by removing the stored offset and previews the next reading by adding the draft one, so an operator's correction takes effect once per cycle instead of compounding. `lib/calibration/water-temp.ts` holds the single definition, with tests for negative, positive and missing readings; the form's "Raw reading" is now genuinely raw.

### Fixed

- **Choosing the simple view on the feeder no longer strands the operator (#626).** The 3D viewer's "Simple view" replaced the scene with the illustrated fallback and never rendered a way back, so the only exit was a page reload. The fallback now carries a "Back to 3D view" control when - and only when - the simple view was the operator's own choice on a WebGL-capable device; the forced fallbacks (no WebGL, or a scene that crashed) stay button-free because there is nothing to return to. Copy is in English, Hiligaynon and Tagalog.

### Fixed

- **A saved temperature calibration now appears in the hardware page's calibration history (#613).** `saveTemperatureCalibration` already wrote a `temperature_calibrated` device event, but the history read only `CalibrationRun` (the hopper rate tests), so the save was invisible afterwards. The history now lists the ten most recent temperature calibrations - date, signed offset and the pond's feeding minimum - from that event stream, reading the JSON metadata defensively so an older or malformed row renders an em dash instead of breaking the page. The rate-test table, its sessions and its pagination are unchanged; no schema change.

## [1.44.1] - 2026-11-03

### Security

- **Row-level security is now on for every remaining public table (#593).** Nineteen tables that still had it disabled - `BackgroundJob`, `Membership`, `PlatformAdmin`, `PlatformAuditLog`, `IssueReport` and the rest - now enable it with no permissive policy, so the Supabase `anon` and `authenticated` roles are denied by default. The Prisma app connects as `postgres`, which owns the tables and has `BYPASSRLS`, so application queries are unchanged. `PondOwnershipHistory` - the only table those public roles could read - loses its grants outright. The migration also adds the missing list indexes (`Notification (pondId, createdAt)`, `Notification (farmId, createdAt)`, `PlatformAuditLog (createdAt)`) and a batched `DeviceStateEvent` retention sweep that rides the existing device-watch housekeeping pass. The service-role-only boundary is documented in `docs/database-rls-retention.md`.

## [1.44.0] - 2026-11-02

### Added

- **The platform console separates registered from active devices and shows a stored 90-day connectivity trend (#479, M3C.10).** `/superadmin` now answers three questions with the existing monitor primitives: how many devices are registered, how many were active in the last 30 days, and what share of the fleet was reachable each day. A device is active when it has a heartbeat (`lastSeenAt`) **or** any feed event in the window, so an imported `hand_fed` daily total counts, and the query counts each device once (decision O22). The trend comes only from a new per-device daily rollup, `DeviceConnectivityDaily` (additive migration `20261102180000_add_device_connectivity_daily`, deny-by-default RLS, unique `(deviceId, day)`, 90-day retention), written by the existing `device-watch` cron **before** the 7-day heartbeat sweep: it recomputes the previous completed UTC day once behind a `connectivity.rollup` marker and replaces that day in one transaction (decision O24). Online minutes are the measured heartbeat span minus, per gap, the silence beyond the configured gap threshold â€” the `device.status` offline window, floored at the 5-minute stored-row cadence, plus two firmware beats of slack â€” using the configured `heartbeat_interval_s`; nothing is extrapolated to a day boundary. A day with no stored heartbeat has no row and renders no bar, never a zero. Copy is in English, Hiligaynon and Tagalog, the table is in the export allow-list, and there is no new dependency, no client polling and no schema change outside this slice.
- **The incident queue now has a stored lifecycle, not only derived conditions (#479, plan M3C.6).** Two additive tables (`PlatformIncident`, `PlatformIncidentEvent`) carry New â†’ Acknowledged â†’ Investigating â†’ Resolved plus Escalated, with a stable dedupe key per condition. The device watch upserts `device_offline:<deviceId>`, `safe_mode:<deviceId>`, `fault:<deviceId>:<fault>` and `failed_job:<jobId>`, refreshes an open incident instead of opening a second one, auto-resolves only when the owning source actually reported, and reopens the same row when the condition returns. Operators get Acknowledge, Investigate, Resolve and Escalate on a detail page with the full timeline; each transition writes a timeline event and one `PlatformAuditLog` row (an escalation also records the in-app notification event), and an illegal transition is refused in the pure rules and the action. Escalation is in-app only: it assigns a named platform-admin owner, sets a 30-minute acknowledgement target and announces the incident to the platform-admin role in the console, with no email, chat or pager. Both tables have RLS enabled (deny-by-default, the platform pattern) and are in the backup allow-list. **The migration `20261102160000_add_platform_incidents` is additive; taking a full platform backup first is still required when it is applied to a hosted database.** No new dependency; the derived M3C.5 queue is unchanged and remains on the same page.

### Changed

- **The biomass sample form, the water-temperature card and the account menus are translated, so a Hiligaynon or Tagalog operator no longer reads English mid-flow (#591).** The form was the worst case: about forty sentences â€” validation errors, the success screen, the eight device-status messages, the mode switch, the batch and average fields, every individual-fish row and the live feed preview â€” were written in English inside the component, so the page around them changed language and the form did not. They now come from `dashboard.logSample.*`, the card from `dashboard.waterTemp.*`, and the three header menus (pond operator, language, device, close profile menu) from `account.menu.*`, each present in English, Hiligaynon and Tagalog (the Tagalog is a machine draft, queued for review). The card translates on the server, so none of its strings enter the client bundle, and a test renders the whole form in Hiligaynon and asserts no English label survives.
- **The tenant health, fleet monitor and incident queue pages are reachable from the console navigation (#479).** `/superadmin/tenants`, `/superadmin/fleet` and `/superadmin/incidents` shipped but the sidebar's Command Center group still held only Overview and the platform quick menu stopped at the nine older sections. Command Center now lists Overview, Tenants, Fleet and Incidents in that order, the mobile quick menu carries the same three destinations, and each page marks its own link current (the tenants compare page highlights Tenants). The mobile header band and the console scope banner now name the section too (`Fleet`, not the fallback `Overview`), with `/superadmin/tenants/compare` staying under Tenants. No existing URL changed. Strings are in English, Hiligaynon and Tagalog (the Tagalog is a machine draft, queued for review).
- **A firmware change can no longer merge with a failing host test suite (#455).** The `Firmware` workflow now runs `pio test -d firmware -e native` after the PlatformIO setup and before it compiles the ESP32 targets, so the Unity safety and config tests gate every pull request and push that touches `firmware/**` or the workflow itself. The step is host-only: no board, no network, no secrets. Triggers, path filters, the compile matrix and the `compile` check name are unchanged.

### Fixed

- **Password-reset email no longer depends on an environment variable that production does not set.** `NEXT_PUBLIC_BASE_URL` is scoped to Preview/staging in the Vercel project, so `isResetEmailConfigured()` returned false in production even with `RESEND_API_KEY` and a sender present, and every reset email was skipped silently. The reset link target now falls back to the canonical site URL (the same fallback `requestPasswordReset` already used), so the key and the sender alone decide whether the mail can be sent, and a preview deployment can still override the host.
- **A failed device-health read now shows "cannot verify", not a healthy feeder (#624).** The dashboard and the schedule page share one treatment: when `getDeviceHealthSafe` cannot read the unit, the notice says the state cannot be verified, names the failed check time, and shows the last successful read when this process has seen one, instead of falling back to the healthy view. The state is text plus an amber surface in both themes, and a test asserts that a thrown read never renders the healthy view.
- **The current-password field on every password-change screen is always masked and can no longer be revealed (#607).** A browser password manager can autofill the saved credential into that field, so the shared show/hide toggle printed the account's real password on screen â€” including on a shared farm device. The toggle now exists only on the new and confirmation fields, so the current password stays masked; the server never sends it (Supabase stores only the hash). The fix covers Profile Settings, the forced-change screen and the platform admin's account page, which all use the same form.
- **Background jobs stop retrying forever and no longer block the queue (#590).** A failing job now retries at most five times with a 30 s â†’ 1 â†’ 2 â†’ 4 min backoff (capped at 15 min), then becomes a terminal `failed` row with the scrubbed operator detail in `lastError`; the attempt cap is part of the claim query, so a capped job can never be claimed again. Claim ordering is eligibility FIFO (`nextAttemptAt`, then `createdAt`), so a poison job backs off behind fresh work and a retry is never starved either. An import is never retried â€” its transaction may have committed â€” and a 4xx or unknown type is terminal on the first attempt. Each job runs under a declared per-type time limit (10 s exports, 15 s PDF, 12 s import); the worker releases a claim rather than starting a job that does not fit the route envelope. Completion and failure writes are fenced to the owning lease, and `/superadmin/operations/jobs` lists the dead-lettered jobs with type, farm, attempts and last error.
- **The release workflow now fails when `main` moves past the tag for its current version (#586).** `Release` compares `HEAD` with `v<package.json version>`, validates the root and `apps/web` versions, `LEGAL_APP_RELEASE`, the `CHANGELOG.md` section and the tag as one set, and reports the exact range (for example `v1.43.0..HEAD`, 19 commits) with the bump-and-release fix. Only a `chore(release): x.y.z` commit, a revert of a failed release, or a release-preparation merge is exempt, and every exemption is printed. The check is a step inside the existing `release` job, so the required check name is unchanged; it does not tag, deploy or publish anything by itself. `node --test scripts/ops/__tests__/release-drift.test.mjs` proves both directions.
- **A demoted VIEWER can no longer write through the server actions (#583).** `requireWriteAccess()` and `canWrite()` resolve authority from the caller's `Membership.role` in an ACTIVE organization instead of the legacy `User.role` column. Demotion only updates the membership, so a member demoted to VIEWER kept `User.role = OPERATOR` and every guarded write still accepted their calls even though the UI had hidden the buttons. Membership now wins; a revoked membership, or one whose organization is suspended, denies rather than falling back, and the legacy column is consulted only for accounts with no membership row at all (the pre-membership farmers the 2026-10-17 backfill did not cover). The column is marked legacy in the Prisma schema. VIEWER keeps its read paths and view-as stays read-only.
- **A tenant ADMIN can no longer delete an OWNER or strip an owner's permissions (#584).** `deleteUser` and `setUserPermission` never called the shared `member-rules.ts` guard that `changeMemberRole` and `revokeMember` already used: `deleteUser` checked the caller's scope but not the target's role, and `setUserPermission` would revoke an owner's `manage_members` or `control_feeder`, which is a demotion in effect. Both now apply the hierarchy rule â€” `revokeMemberError` for deletion, which also carries the last-owner rule, and a new `permissionEditError` for permissions â€” and re-check it inside a `SELECT ... FOR UPDATE` transaction, so a concurrent promotion to OWNER cannot slip between the check and the write. The Supabase login deletion moved inside that transaction, matching the platform-admin disable path, so a failed auth delete rolls back with both stores intact.
- **A rolled-back heartbeat no longer leaves an alert episode behind, and one feed request cannot be counted twice (#588, #589).** The heartbeat's episode and alert writes now run inside the same `prisma.$transaction` as the rest of the heartbeat, and the organization-settings reads use that transaction client; a later unique-constraint failure rolls everything back before the route's 204. A partial unique index on `FeedEvent ("feedRequestId")` for `feed_dispensed` rows closes the check-then-insert race, and the route answers 204 on the losing insert. No history is deleted.
- **Concurrent ingest can no longer open duplicate alert episodes (#585).** `openEpisode()` now has a partial unique index behind its insert and a loser of the race re-reads the winner and updates that row instead of throwing or opening a second episode. Migration `20261102200000_alert_episode_dedup` first folds the existing duplicate open rows per `episodeKey` â€” keeping the newest live row, recording `Notification.resolutionReason`, and never deleting history â€” then creates `Notification_one_open_per_episode` on `episodeKey` where `resolvedAt IS NULL AND autoCleared = FALSE AND supersededById IS NULL`. The cleanup/verification SQL is in `docs/sql/alert-episode-dedup-verify.sql`; applying the migration to a hosted database still requires the usual backup and is an owner-run step.
- **The biomass sample form and the mobile quick menu are now usable with a keyboard and a screen reader (#592).** The individual-fish weight and length inputs were labelled only by their placeholder, so they came through as unlabelled edit fields once a value replaced the hint, and the remove control was an icon with no accessible name at all; both now carry a translated label. The average/individual switch reported its state with colour alone and now sets `aria-pressed`. The quick menu declares `aria-modal`, which promises the page behind it is inert, but Tab walked straight out of the sheet into the header and bottom bar; focus now cycles inside the open sheet and still returns to the trigger on Escape, which is pinned by a keyboard test alongside the new trap.
- **A firmware image can no longer be installed on the wrong relay wiring (#582).** The relay pin belongs to the physical unit, but the OTA manifest only named the board, so a GPIO 25 build could install on the GPIO 5 field unit and silently report feeds that never dispensed. Every build now names its hardware variant (`esp32dev-gpio5` / `esp32dev-gpio25`; the unqualified `esp32dev` environment is gone), the sketch refuses to compile without an explicit pin and `static_assert`s that the variant maps to it, and the signed manifest carries `variant` plus `relay_gpio`. The device refuses a manifest whose pair does not match its provisioned variant, reports `ota_state=refused_variant` and `diag.ota_refusal=variant_mismatch` on the device page, and includes `hw_variant`, `relay_gpio`, `provisioned_hw_variant` and `hw_variant_ok` in every heartbeat. A USB flash of the other variant no longer overwrites the provisioned value: it locks the relay off, refuses every dose with `hardware_variant_mismatch`, and blocks OTA until the correct image is flashed (a factory reset clears the variant for a deliberate rewire). The release signer verifies the named PlatformIO environment before signing, the check endpoint refuses to offer an image without a matching device variant, and the runbook/hardware pin map now agree on GPIO 5 for the CICT unit and GPIO 25 for the reference build. **Ships as firmware 1.10.0**; a pre-1.10.0 unit sends no variant, so it is bootstrapped over USB once before OTA resumes.
- **An unreported safety trip survives leaving safe mode and a reboot (#455).** The trip id is resumed from NVS whenever it is still pending, not only while `safe_mode` is active, so the 30-minute quiet window or a reset hold can no longer make the incident unreportable. The rare report path now logs whether it is waiting on Wi-Fi, heartbeat spacing or retry backoff, and whether the connection failed, instead of failing silently.

## [1.43.0] - 2026-11-02


### Fixed

- **The farmer dashboard fits a 1366x768 laptop at 100% browser zoom again.** Browser chrome leaves that screen about 657 CSS px of viewport, which the old tiers did not cover; the chart legend could also grow with a long translated label and push the pond row into a clipped strip. A new short-viewport tier steps the pane padding and plot height down, the room's height now subtracts the same padding token the pane applies, and the legend is one single-line row per source, so its height no longer depends on the language (#475).
- **The farmer dashboard no longer ellipsizes its own labels at 100% zoom.** The hero printed the pond as `Demo Pâ€¦`: the pond block shared the row with the clock, the two stat figures and the update button and lost the width contest, so its name was cut to seven characters. It now wraps to at most two lines instead of ellipsizing, and on wide screens holds a minimum column. The volume and rate figures keep their unit on the same line (`2110.06 g`, never a lone `g` drifting onto a second line), and the rail's pond summary wraps its values rather than cutting `Wala sang aktibo nga siklo` down to `Wala sang aktibo nga â€¦` (#475).
- **The feeding schedule now reads frequency â†’ first/last feed â†’ the resulting times.** Feeds per day comes first, and the two window fields sit next to the per-meal chips they produce, labelled "First feed time" and "Last feed time" with the spacing rule as their hint. The applied line shows the active window instead of a raw `2 feeds/day` that looked like a second suggestion. The model is unchanged: the feeder still spaces meals evenly between the first and last feed, so the two fields can express every schedule the device supports (#483).
- **The dashboard now shows the live fish count and the mortality rate, not the stocked count.** It reads the same derived count as Growth (stocked minus mortality), so the pond card cannot disagree with the growth page again. The pond summary shows dead and percentage; the population tile links to Growth. Pond settings now labels the field "Stocked fish count", explains that mortality is subtracted, and shows an "Unsaved changes" banner so a restored draft is not mistaken for a save. The form also refreshes after a successful save (#430, #452).

### Added

- **A safe-mode lockout is now an audit event, accepted and stored once per trip (#455).** `POST /api/ingest` takes `event_type: "safety_trip"` with a unit-generated `trip_id` plus optional abnormal-reset count, reset reasons, the reset that tripped it, whether the unit tripped at boot or while running, quiet time and uptime, and stores one `safety_trip` row with the reported version. `DeviceStateEvent` has no unique event id, so ingest reads the device's newest `safety_trip` row and returns 204 without writing when the `trip_id` matches: a retried report never becomes a second incident, a new id always does. It creates no notification and no `FeedEvent`, because the `device_health` state row already raises the CRITICAL safe-mode alert and a second one would double-alert a single lockout. History lists it as **Safety Trip (safe mode)** under the Feeding filter. No schema change.
- **Firmware 1.9.0 emits the safe-mode trip once per lockout (#455).** `enterSafeMode()` creates one trip id and persists it in NVS (`safe_trip_id`, `safe_trip_sent`, `safe_trip_at`), then `serviceSafetyTripReport()` sends `safety_trip` from `loop()` once identity and Wi-Fi exist, because the lockout runs during `setup()` before the radio. The payload carries the abnormal-reset count, reset reasons, the reset that tripped it, entry phase, quiet time, uptime and firmware version. A 2xx marks it sent; a 422 from an older server is permanent; 429, 5xx and transport failures retry with the existing 5 s to 5 min backoff, so a trip that happens offline lands exactly once after reconnect. The relay path is unchanged; the heartbeat and the CRITICAL `device_health` alert still behave as before.
- **The platform console has an account menu and a real mobile sign-out (#560).** The avatar in both console headers is now a button that opens the signed-in admin's identity, profile, platform settings and sign out. A platform admin without a farm membership previously saw a non-clickable avatar and, below `lg`, had no sign-out at all because the sidebar is hidden there. `/superadmin/account` now carries that account's profile, avatar upload and password change, and signing out clears cached chat, offline and dashboard state first.
- **The fleet monitor shows each unit's telemetry, not only each tenant's counts (#479).** `/superadmin/fleet` now lists every feeder worst first with its last heartbeat, the reported Wi-Fi signal as bars plus dBm, firmware version, the last successful feed, hopper-level and water-temperature freshness, faults and safe mode. Missing and timed-out values keep their own words - Not reported, Unknown, Never - instead of a zero or a healthy colour, and reading freshness uses the configured `device.status` window (offline plus grace) rather than a new threshold. Firmware comes from the heartbeat's `diag.fw` when the unit sends it (#454) and from the newest version event otherwise; the last feed is the newest machine dispense, never an imported `hand_fed` daily total. Safe mode and faults are icon plus words, so status colours stay reserved for status. Read-only: the loader is bounded, selects no token column, and there is no schema change, no client polling and no new dependency. Strings are in English, Hiligaynon and Tagalog.
- **Anyone can report a problem from the public site, and Pakoy can escalate one.** The landing footer carries a "Report an issue" box (category, message, optional email) that posts to an unauthenticated, per-IP rate-limited and honeypot-guarded route; reports land in a new superadmin Operations â†’ Reports queue where a platform admin can resolve them with an audited action. When a request is outside Pakoy's tool catalogue â€” a bug, a broken screen, a missing feature, an accessibility problem or something only a platform admin can change â€” the assistant files the same kind of report instead of dead-ending with "I can't do that" (#487).
- **A feeder now warns at the organization's own hopper threshold, not a fixed 20 %.** The device poll sends `OrgSetting.hopperLowPct` (5â€“50 %, set in the organization's settings and already used by the low-hopper alert) as the firmware's `hopper_low_pct`, which 1.7.0 units apply through the hopper filter. The value is resolved per device through pond â†’ farm owner â†’ active organization and cached for 60 s, so a poll every 5 s does not re-run the chain; an unassigned unit or an unreadable settings row keeps the 20 % default, and an older firmware ignores the field. No firmware change and no schema change are required (#456).
- **Pakoy is available on the tenant-admin and superadmin shells, not only the farmer dashboard.** The assistant mounts in `/admin` as the organization owner and in `/superadmin` as the platform admin; its role is still resolved on the server from the session, and every action stays gated by the caller's permissions and step-up rules. The single source of truth plan records this as decision D5 (#518).
- **Calendar requests can carry a colour.** Pakoy can now add or change a calendar item's `#RRGGBB` colour instead of answering "I don't have calendar access" when the user asks for one; the planner also proposes the closest supported action when a requested detail is not a tool field (#365).
- **The platform console says where you are, and its sidebar is in three groups.** A scope banner under the top bar shows the path (`GLOBAL SUPERADMIN Ã¢â€ â€™ DEVICES`, or `GLOBAL SUPERADMIN Ã¢â€ â€™ ORGANIZATION ALPHA` on an organization page) and stays in view while the page scrolls. It uses the brand navy and orange with an icon per level, so it never reads as a status colour and stays distinct from the red view-as banner. The sidebar now groups the same nine links under Command Center, Ecosystem Management and Platform Control; no URL changed. Strings are in English, Hiligaynon and Tagalog (the Tagalog is a machine draft, queued for review). First slice of the Platform Command Center (#479, plan M3C.1).
- **3D overview health readings.** The Feeder 3D panel now shows water-temperature sensor health and RTC health next to hopper level, last fed and model, in both the WebGL viewer and the low-tier fallback. A probe that has never reported reads "Not reported" instead of a false fault, and the state is text plus a dot rather than colour alone (#482).
- **A light/dark toggle for the platform console, with a dark palette on every surface.** The superadmin top bar now carries the same theme toggle as the farmer dashboard (desktop and mobile), and the console honours the shared `optifeed:theme` preference instead of staying light-only. Cards, fields, tables, tabs, dialogs, badges and the empty/loading/error states all have dark counterparts on the page (#0B1220), surface (#111A2C) and raised (#162238) palette, with #24304A borders. Status colours stay reserved for status and the console action orange moves to the AA-safe #C2410C; a contrast test asserts every text pair against WCAG AA (4.5:1) in both themes, and a source guard keeps a light-only utility from returning without its `dark:` variant. This is the visual-system dependency of the Platform Command Center (#477, plan M3C.8).
- **The platform overview is now a monitor board.** A reusable set of console components (`MonitorPanel`, `PanelGrid`, `KpiTile`, `Sparkline`, `StatusMix`, `ActivityFeed`, `AttentionList`) composes the Command Center: the status bands lead, eight KPI tiles follow with direction pills, accessible delta labels and a signups sparkline, then the signups trend and the fleet status mix sit side by side, with the remaining charts and the attention queues below. Everything is server-rendered from the existing `getPlatformAnalytics` and `getStatusBands` data, every string still comes from the catalogue, and the layout degrades to one column on phones. No new dependency, no schema change (#479, plan M3C.8).
- **A pond can set a minimum water temperature for feeding (#486).** Under Dashboard â†’ Settings â†’ Hardware â†’ Calibration, the temperature form now takes an optional minimum feeding temperature next to the sensor offset. When the calibrated reading drops below it, the dashboard card says so instead of a plain OK. The limit is per device, is never applied retroactively, and never blocks a feed â€” leaving the field empty removes the warning. Additive nullable column (`EnergyDevice.minFeedTempC`), no backfill.
- **Superadmins can compare two to four organizations side by side (#479).** Picking organizations on `/superadmin/tenants/compare` ranks them worst first on the tenant table's own scale and marks the best measured value per metric, with fleet counts, offline share, last heartbeat, open alerts and account status in one row. A metric with no defensible direction (ponds, members, device count) carries no winner, a value that was never reported is not a zero and never wins, and an organization with nothing to measure reads Unknown rather than healthy. A failed read renders an explicit error instead of an empty comparison. No schema change.
- **Operations â†’ Security lists every destructive platform action with the credential it demands (#479).** The panel renders one catalog of the command-center actions that can reach a tenant's fleet, people or data, marks the ones that require step-up and states why the others only need a written reason and an audit entry, then shows the last 20 audit rows for those actions with whether a step-up credential was present. A test asserts the catalog against the server-action source in both directions, so an action cannot be gated without being listed and cannot be listed without its guard. No schema change.
- **Recurring alerts are episodes, not rows (#534).** A low hopper, an offline device and water below the feeding minimum now open one notification, update it in place when it escalates, and close it when the condition clears. A day that used to collect 150+ near-identical alerts holds one per condition, and a Telegram push follows the episode instead of every heartbeat.
- **The calendar day pane (#534).** Clicking a day, or the "+N more" link on a busy day, opens a retracting side panel that lists that day's events grouped by type with counts, and offers Add event for users who can edit. The old day-click jump straight into the event editor is replaced by this pane.

### Changed

- Hopper alerts no longer repeat every six hours while the level stays low, and acknowledging an alert can no longer re-arm it on the next heartbeat (#412, #534).
- **Data migration `20261102150000_alert_episodes` (#534).** Adds `episodeKey`, `resolvedAt` and `supersededById` to `Notification`, folds existing duplicate alerts into their earliest row per pond, category, message and day, and stamps the surviving rows with their condition key. Folded rows are kept for audit and hidden from the bell, the list and the day pane; nothing is deleted.

## [1.42.1] - 2026-11-01

### Added

- **A feeder in safe mode or reporting a fault now says so where the farmer works.** The safe-mode and fault panel from 1.42.0 only appeared on the admin pond page, while the in-app alert links to the hardware page, so a farmer who followed the alert saw nothing. The panel now sits at the top of the hardware overview, the dashboard and the schedule page, in the page's own light or dark palette. It renders nothing while the unit is healthy. On the dashboard and schedule it is an extra: a failed health read is logged and reads as healthy instead of taking the page down.

### Fixed

- **A calibration test dose the unit refused no longer blocks the next test.** The firmware reports it as a refusal with source `calibration`, which ingest rejected with a 422, so nothing was recorded and the calibration request stayed `dispatched`. Ingest now accepts the source and closes the dispatched calibration request as `refused`; the calibration screen treats that as ended, so the test can be retried.

## [1.42.0] - 2026-11-01

### Added

- **The dashboard now shows a feeder's faults and safe mode (#454, #455 server side).** The firmware has reported `safe_mode`, the reset reasons and the fault masks on every heartbeat since 1.6.0, but ingest stripped them, so a feeder whose relay was locked off after repeated brownouts looked online and healthy. Ingest now records one `device_health` event per change (including the clear), the feeder panel shows safe mode in words, the active faults with what to check and the last refused dose with its reason, and a new safe mode raises a CRITICAL in-app alert (a new fault a WARNING) that follows the pond's device-offline switches. No migration. A unit on older firmware reports nothing and writes nothing.

### Changed

- **Feed now is refused up front while the feeder is in safe mode,** with a message that says why and how it clears (30 quiet minutes, or a 5 s Wi-Fi reset hold), instead of queueing a dose the unit will refuse.

### Fixed

- **A dashboard feed the unit refused no longer blocks the next attempt.** The request sat at `dispatched` for ten minutes and the next try was refused as "a feed is already in progress". The refusal now closes it as `refused`.
- **The AI provider base-URL guard is stricter (#432 follow-up).** A host whose DNS record points at a private or metadata address is refused when the provider is saved and again before every call, a redirect from the provider is refused so the API key cannot follow it, and the hex form of an IPv4-mapped IPv6 address (`[::ffff:127.0.0.1]`, which `new URL` rewrites) is read by the private-address check. A DNS answer that changes between the check and the call is a documented remaining window.

## [1.41.0] - 2026-11-01

### Added

- **Provider keys and OpenAI-compatible providers from the console.** `/superadmin/ai-providers` can set, rotate and clear a provider API key. Keys are tested with a live call before they are accepted, encrypted at rest with AES-256-GCM (`AI_SECRET_KEY`, versioned for rotation), shown only as a masked last four, and every mutation requires a password step-up plus a reason in the platform audit log. A new "Add provider" form creates any OpenAI-compatible endpoint (Groq, OpenAI, DeepSeek, Kimi, GLM, OpenRouterÃ¢â‚¬Â¦) with an https-only, SSRF-guarded base URL. Environment variables remain the fallback when no key is stored (#432).
- **Password reset by email, and admins can edit an account's contact email (#449).** The forgot-password page now asks for an email address; a Farm ID still works in the same box, so accounts with no email recorded yet are not locked out. A new nullable, unique `User.contactEmail` holds the deliverable address, and the synthetic login address (`<farmId>@pond.optifeed.local`) is never edited, because sign-in derives it from the Farm ID. Tenant admins edit the contact email inline in the Members table (an ADMIN cannot change an OWNER's address, and an account that also belongs to an organization the caller does not administer is refused); platform admins edit it from the user dialog, which needs a reason and a fresh step-up and audits the before and after values. Addresses are validated as a single mailbox, and reset stays anti-enumeration. Additive migration `20261101010000_add_user_contact_email`.

### Changed

- **The HC-SR04 TRIG moves from GPIO 12 to GPIO 27 (firmware, needs a reflash).** GPIO 12 is the ESP32 flash-voltage strapping pin, so a trigger wired there needed a 10 kÃŽÂ© pull-down just to boot reliably. GPIO 27 is not a strapping pin and is quiet at boot, so the pull-down is now optional. ECHO stays on GPIO 14 behind its 1 kÃŽÂ© / 2 kÃŽÂ© divider. Move the TRIG wire to GPIO 27 and reflash together: a unit flashed with this build but still wired to GPIO 12, or the reverse, reads no echo and reports 0 % / 0 cm. The firmware README pin table and the CICT pin-map note are updated to match.

### Fixed

- **A feeder is never told to dispense a dose it cannot run (#430).** The dose per meal is derived from the pond settings, the fish count and the latest biomass sample, and the write paths checked the dose that was *stored* before writing the newly *derived* one Ã¢â‚¬â€ so a meal the ESP32 cannot finish in one relay window still reached it. On the Demo Pond that left the feeder holding 2,110 g per meal against a 1,200 g window (4 g/s for 300 s), and every later pond-settings edit was refused because the saved plan was already impossible: the form reported "one meal is longer than the relay window" for the reader's own edit, while the dashboard kept the old fish count. The schedule save, the admin pond edit, the biomass auto-adjust and the growth-plan apply now all check the dose they are about to write, and the single writer (`lib/feeding/derive.ts`) refuses to store one that breaks the relay window or the daily ceiling. The pond settings form also says when the *saved* plan was already over the limit, so a stale plan no longer looks like the reader's mistake.

## [1.40.0] - 2026-10-31

### Added

- Firmware 1.8.0 machine status interface: four panel LEDs as wired on the bench (blue WI-FI on GPIO 26 and yellow FAULT on GPIO 18 with series resistors; white POWER on the 5 V rail and green FEEDING as a tap on the relay control line, neither a firmware output). A 12 V NPN-driven lamp panel stays possible with `-D<NAME>_LED_PIN` overrides. Blue is solid only once the unit has joined its saved network and blinks in the setup portal; Wi-Fi loss is not a fault. A central `fw::FaultManager` (`firmware/firmware-main/status.h`, native-tested) latches HC-SR04 no-echo, DS3231 missing/silent on I2C, relay overrun and safe mode; a tap on the Wi-Fi reset button (GPIO 17, under 5 s) acknowledges faults whose cause is gone. No fault adds a feeding refusal and acknowledgement never resumes a dose. The heartbeat adds diagnostic `diag.faults_latched`, `diag.faults_present` and `diag.last_fault` (stripped by ingest; no server change).
- **Tabbed device settings with a feeder switcher.** The hardware settings page is now four tabs synced to `?tab=` (Overview, Feeding, Calibration, Network) with WAI-ARIA keyboard support; panels stay mounted, so an edit survives a tab switch. A `?device=` switcher grouped by pond lets a second feeder on the same pond be configured and is hidden when the farm has only one feeder. An unsaved-changes guard marks a tab with pending edits, asks before switching feeder and covers reload, and dashboard alerts plus the old `#anchor` links open the tab that holds the section. The design comes from the settings benchmark in `docs/settings-benchmark.md` (#403, #405, #407).
- Password recovery from the sign-in page: a **Forgot password?** link opens `/forgot-password` (farm ID), which mints a Supabase recovery link in code (`auth.admin.generateLink`, type `recovery`) and emails it through **Resend** from the verified domain Ã¢â‚¬â€ Supabase's own SMTP is not used, because login addresses are internal pond mailboxes Ã¢â‚¬â€ and `/reset-password` sets a new password from that link's session, clearing the forced-change flag and revoking other sessions. Requests are rate limited (3 per 10 minutes per IP, fail-closed) and never reveal whether a farm ID exists; every request for a real account is recorded in the platform audit log (`platform.user.password_reset_requested`, actor `self-service`, with `emailSent` and no link in the row), and the confirmation tells the user to ask an administrator when the mailbox cannot be opened. The reliable path is also included: the superadmin console's new per-account **Reset password** action (reason + step-up + audit, one-time temporary password shown once, change forced at the next sign-in), alongside the unchanged `pnpm manage-user reset-password` CLI.

- **Hopper capacity from the tank diameter.** Calibration now takes the tank's inner diameter and the feed bulk density, so the capacity in grams is computed from the cylinder between the full and empty marks (Ãâ‚¬rÃ‚Â²h Ãƒâ€” density) instead of typed in as a guess. The form previews the volume and the resulting grams, the server recomputes them on save, and devices calibrated before this keep their stored capacity until a diameter is entered (#415).
- **The water temperature probe is part of the 3D feeder model (v1.2.0, #400).** The probe now clips to the front edge of the base plate and hangs below it (a thin cable, a blue connector and a stainless body with the real DS18B20 proportions), crossing the assumed pond surface, with no anchor line. The `1.1.2` model file is kept; the manifest points at `feeder-v1.2.0.glb`, and a test reads the exported GLB to check the nodes, bounds, materials and that the probe sits inside the default camera frame. The preview images under `docs/feeder/` still show the previous model.
- #418 **Tenant B demo seed.** `pnpm --filter web seed:tenant-b` fills the second tenant with a presentable dataset so the organization model can be shown in a demo. The `tenant2-admin` account (owner of the "Tenant B Fisheries" organization) gets its own farm, two ponds with active grow-out cycles and calendar events, three feeders, and enough history Ã¢â‚¬â€ feeding, feed level, water temperature, biomass, FCR, device activity, schedule commands, calibration runs and notifications Ã¢â‚¬â€ for every chart on the dashboard and in the tenant console to have data. A second member (`tenant2-operator`) makes the members list and the per-member permission override visible. The script is idempotent, only ever writes rows owned by the demo accounts, ponds and feeders (never an unscoped delete), reuses the existing admin's Supabase identity, and refuses to write to a non-loopback database unless `SEED_TENANT_B_CONFIRM=yes` is set.

### Changed

- **Mark as read sits above the notification list (#416).** The button moved from below the whole feed to a right-aligned row above it, so the reader no longer scrolls past every notification to reach it. Behaviour, wording and the 44 px target are unchanged.

### Removed

- **The Telegram channel is gone (ADR-0007).** The platform does not use Telegram: the bot-token helper (`lib/notify/telegram.ts`), the CRITICAL-alert fan-out in the device ingest route and the device-watch cron, and the `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` variables in `.env.example`, the environment matrix and the deployment checklist are all removed. No bot token was ever configured, so alerts were already in-app only Ã¢â‚¬â€ this makes the code match what the privacy policy has always said. The link helper that only existed to build Telegram message links went with it. A CI test fails the build if a Telegram reference or variable reappears. The cost is explicit: nobody is paged Ã¢â‚¬â€ a CRITICAL alert waits in the dashboard until someone opens it, which remains the most consequential operational gap (an e-mail alert channel would be a new decision, not an extension of this one).

### Fixed

- **A disconnected feeder is now marked offline after five minutes (#419).** The platform device-connectivity policy shipped with 15 minutes of silence plus a 2-minute grace, so an unplugged ESP32 stayed on "weak signal" for 17 minutes before the badge flipped. The defaults are now 4 minutes of weak signal, 5 minutes to offline and no grace Ã¢â‚¬â€ five minutes of silence is sixty missed heartbeats at the firmware's five-second beat, and the hysteresis already stops the badge from flapping, so the grace is no longer needed to absorb a single late beat. Every surface (header badge, sidebar, dashboard, feeder hero, admin and superadmin device lists, the offline-alert cron, the assistant context and the PWA snapshot) reads the one shared rule in `lib/device-status.ts`, so the new default applies everywhere at once. A platform admin can still move the windows in Superadmin Ã¢â€ â€™ Settings Ã¢â€ â€™ Device connectivity, and a stored `PlatformSetting` row always wins over the default. The firmware's connectivity diagnostic (`weak_after_min` / `offline_after_min`) now reports the same 4 / 5 minutes.
- **The schedule page now lists the feeding times for the frequency you choose (#431).** The only summary was the last command the device had applied, so raising feeds per day from 2 to 3 still read "2 feeds/day" until the device reconnected and no list of times existed to show the third meal. A "Feeding times" card now derives the slots from the window and frequency on every change, and the pending and applied commands each list their own times.
- **Feeding schedules now run on the farm's own clock, and the daily cap survives a reboot (#409).** The firmware compared schedule slots against UTC and reset the daily budget at UTC midnight, so a 06:00 slot fired at the wrong local hour and a restart could hand the feeder a fresh cap mid-day. Slots, the daily-cap reset and the OTA quiet-hours guards now use the farm's UTC offset, and the schedule position and daily total are saved to flash and restored on boot (firmware 1.8.1, needs a reflash; it is a patch on the 1.8.0 status-lamp build).
- **Acknowledging a low-hopper warning no longer brings it straight back (#412).** The 6-hour window between pellet warnings was only checked against unacknowledged notifications, so tapping Acknowledge or Mark all as read let the next heartbeat (at most five seconds later) create an identical warning, and every further acknowledgement re-armed it. The window is now measured from the latest pellet notification whatever its acknowledgement: acknowledging silences the stream, the reminder returns at most six hours after the last warning, and a WARNING/CRITICAL tier change still fires at once. The days-remaining warning shared the same gate and is fixed with it. The dashboard rail and Pakoy's reminder also used a strict `<` against the low-hopper threshold while the server warns at `<=`; both now use one inclusive `hopperIsLow()` helper, so at exactly the threshold the bell and the dashboard agree.

### Security

- The recovery-link flow discloses nothing about account existence (an unknown farm ID answers exactly like a known one) and never claims an email was delivered; the recovery link appears only in the email payload and the one-time admin-issued password is returned to the console once Ã¢â‚¬â€ neither is persisted, logged or written to a platform audit row.

## [1.39.0] - 2026-10-31

### Added

- **XLSX export and import, PDF reports.** The export dialog now offers CSV/ZIP, an Excel workbook (one sheet per data type, header row kept for an empty type so the sheet doubles as a template) or a PDF report. The feeding schedule joins the seven dataset types as a derived sheet (one row per meal: time, grams, enabled). PDF reports are export only: the existing pond summary plus growth, SGR and FCR reports that draw a line chart and the table behind it from the same helpers the dashboard uses (`lib/sgr.ts`, the stored FCR reports).
- **Import by upload with column mapping.** `POST /api/v1/import-prepare` reads a `.csv` or `.xlsx` upload, maps its headers onto the schema (case, spaces and unit hints such as "(kg)" never matter), coerces every cell to its type and returns a typed preview, the per-row issues and the canonical CSV the existing import job reads, so CSV and workbook share one validation path and one writer. A header that did not match can be mapped by hand in the dialog and the preview re-runs. `GET /api/v1/import-template` serves a CSV or XLSX template per type with note lines and an example row.
- **Feeding schedule import.** A schedule sheet is accepted only when its times are the even spacing of some window (the feeder spaces meals evenly); the window and meal count are applied through `updateScheduleCommand`, so the daily gram cap, the relay-time guard, the fallow check and the audit event all apply, and the feeding rate and button feed amount are kept. The preview shows the daily total against the cap before the user confirms.
- 35 new keys in English, Hiligaynon and Tagalog (the Hiligaynon and Tagalog strings are drafts for native review; the Tagalog keys are in `tl.draft-keys.json`).

### Security

- Workbook uploads are guarded before any XML is parsed: `.xlsx` only (macro, ActiveX and external-link parts and `.xls`/`.xlsm`/`.xlsb` are refused), encrypted workbooks are refused by magic bytes, the upload is capped at 5 MB, and the ZIP central directory is read by hand to cap entry count, unpacked size and expansion ratio, so a zip bomb never reaches the parser. Formulas are never evaluated (a formula cell contributes its cached value). Exports prefix a text cell that starts with `=`, `+`, `-` or `@` so it cannot run as a formula when the file is opened, and the import strips that prefix again.

### Fixed

- The CSV import read the text `false` as `true` for `read`, `autoCleared`, `rtcOk` and `feederActive` (`Boolean("false")`); flags now read TRUE/FALSE, 1/0 and yes/no, an empty cell stays empty and an unreadable value is a 400 naming the row.

## [1.38.0] - 2026-10-31

### Added

- #353 the admin and superadmin consoles gain a **Backup page** that downloads a SQL export of the database with a recorded audit entry. A tenant admin gets only their own organizations' rows (the same `resolveOrgScope()` chain as the rest of the console); a platform admin gets every allowed table behind a fresh step-up check and a mandatory reason. Each export is rate limited (5 per hour per user), streamed server-side with a 250,000-row pre-flight cap, a 64 MB streaming cap and a 120 s budget, and writes one `PlatformAuditLog` row Ã¢â‚¬â€ who, scope, row counts, size, SHA-256 and outcome, never row data Ã¢â‚¬â€ that also feeds the Backup page history and the audit trail. The file is standard `INSERT` SQL in foreign-key-safe order, has no schema DDL, and its trailer carries the SHA-256 of the payload. A per-table, per-column allow-list (`lib/backup/tables.ts`) is the only thing that can leave the database, and a test compares it with the Prisma data model so a new column fails until someone exports, redacts, omits or excludes it. Device tokens are written as a non-usable `redacted:<id>` placeholder (so a restored row satisfies its unique NOT NULL column) and token hashes, session data, limiter state and job artefacts are excluded.
- #322 the SQL export carries an **auth identity manifest**: one JSON comment line per exported user with `id`, `supabaseId`, `email`, `farmId`, role and organization links Ã¢â‚¬â€ the minimum a restore needs to recreate the Supabase Auth identities and re-link `User` rows. It never carries a credential. The restore order and the known `PondOwnershipHistory` trigger re-fire are documented in `docs/operations/backup-and-recovery.md` Ã‚Â§7.5.
- `scripts/ops/restore-check.mjs` is a read-only dry run for an exported file: it verifies the checksum and byte count, the allow-list, the absence of credential columns, foreign-key integrity inside the file, identity-manifest coverage and primary-key uniqueness, and it has a `--self-test` that the restore-drill workflow runs. The restore drill and backup docs link it.
- The Backup page and the settings entry points are translated in English, Hiligaynon and Tagalog (the Hiligaynon and Tagalog strings are drafts for native review; the 83 Tagalog keys are listed in `tl.draft-keys.json`), with a sensitive-data warning on both pages, an accessible history table in UTC and a checksum an operator can compare with the downloaded file.

### Fixed

- The Pond Settings form clears its "saved" banner timer on unmount, so a test or a fast navigation no longer sets state on a form that is gone (an uncaught `window is not defined` in a loaded run).
- #323 the deployment policy is stated once and pointed at from everywhere: only `staging` (Vercel Preview) and `main` (Production) deploy, `develop` never deploys by any route, and each `develop` -> `staging` -> `main` promotion is a separate reviewed command from Jeff or from the OpenCode lead under a standing authorization recorded in `docs/missions/`. No deployment behaviour, workflow or branch protection changed; `scripts/self-check.mjs` now asserts the actual `vercel.json` allowlist (`staging` + `main`, never `develop`).

## [1.37.0] - 2026-10-31

### Fixed

- #334 `disablePlatformUser` now locks the active platform-admin grants (`SELECT Ã¢â‚¬Â¦ FOR UPDATE`) and performs the last-admin count, the Supabase ban and the revoking writes in one transaction. Two concurrent disables (A disables B while B disables A) can no longer both pass the check and leave the platform with zero active admins; the refusal happens before its ban.
- #336 the four guarded writes that wrap their body in a catch (`adminUpdateDeviceDailyCap` and `updateNotificationPrefs` / `updatePondSettings` / `updateDeviceDailyCap` in `lib/actions/settings.ts`) now return the specific authorization outcome Ã¢â‚¬â€ not signed in, password change pending, wrong role, suspended organization, read-only view-as or step-up required Ã¢â‚¬â€ with a stable `code` in the action result. A guard `redirect()` is rethrown instead of being flattened into the generic failure sentence, and no reason exposes a role list, id or org name.
- #399 the farmer dashboard now fits one screen at 100 % zoom on laptop viewports (1366x768, 1440x900, 1536x864, 1920x1080): the control room takes its height from `100dvh` minus the header and the `main` pane padding, both held as tokens (`--ofd-topbar-h`, `--ofd-main-pad-y`), and steps down its density on short screens (chart plot area, gaps, hero padding/time, legend size). Only the right-hand rail scrolls internally; nothing is hidden or clipped, and below `lg` the stacked scrolling dashboard is unchanged. The chart plot area is now sized in CSS (`ofd-plot`), so a chart can no longer report a taller height than its card reserves. The page also stopped carrying a phantom scroll range: the shell and the rail are now positioned, so their 1 px `.sr-only` helpers are clipped by the room instead of being positioned against `main`.
- #321 the superadmin step-up dialog now follows the theme: the shared console dialog shell, header, password field, validation message and both actions carry dark tokens from the design system, with every documented colour pair at WCAG AA (4.5:1) in light and dark. The confirm action uses the AA-safe `#C2410C` (white on the brand orange was 3.54:1).

### Changed

- #332 `pnpm api:check` now also runs `scripts/api/auth-check.mjs`, which asserts that every non-public API route calls its guard inside the exported handler (`withAuth`, `withCronAuth`, `verifyDeviceToken`, or the platform session plus `isCurrentPlatformAdmin`) rather than merely importing one. The public, device-token and platform-admin allow-lists are explicit, reason-carrying and tested; the old import-only "Check API route auth" CI step is removed.

### Removed

- #337 removed `getSuperadminStats`, `getPlatformAdmins`, `loadPondProposalSettings`, `createDemoNotification` and their now-unused `pondSettings` helper, together with the tests that were their only callers. None had a production call site; `pnpm dead-code` stays green with no new suppressions.
## [1.36.0] - 2026-10-31

### Added

- #327 the Tagalog catalogue (`apps/web/messages/tl.json`) is complete: all 3,511 keys carry a Tagalog string, with the same ICU placeholders, plural branches and rich-text tags as English. The strings are machine-drafted, so `apps/web/messages/tl.draft-keys.json` lists the 3,180 keys still awaiting human review, and the language menu labels the locale "Tagalog (draft)". The 331 strings that existed before the pass are human-reviewed and unchanged. Domain terms and style live in `docs/i18n/tagalog-glossary.md`; Mozilla Firefox Tagalog terminology (MPL-2.0) and Unicode CLDR locale data are attributed in `THIRD_PARTY.md`.
- #327 the EnglishÃ¢â€ â€Hiligaynon parity test now also gates Tagalog for key parity, placeholders, plural branches, rich-text tags and blank values. New tests cover the Tagalog overlay fallback (`i18n/merge-messages.ts`) and CLDR `fil` formatting: month/day labels, number grouping, relative time and the `one`/`other` plural categories.

## [1.35.0] - 2026-10-31

### Added

- I-100 firmware 1.7.0 takes a versioned `config` object from the existing feed-command poll, so the daily ceiling, dose amounts, calibration, hopper geometry/thresholds, safe-mode thresholds, button guard, poll interval, OTA pre-flight and calibration limits are dashboard-driven instead of compile-time. Every field is validated against an absolute safety envelope in `firmware/firmware-main/config.h`: a missing, malformed, out-of-range or impossible object is ignored whole and the last-good copy (NVS `cfg_json` / `cfg_rev`, new keys only) or the compile-time defaults stay in force, so a bad config can never raise a bound or disable a guard. The firmware echoes `config_rev` in the heartbeat and the ingest route records one `config_applied` state event per change (no schema change). Old firmware ignores the unknown field and new firmware drives from defaults against an old server. The superadmin configuration centre gains "Firmware safety gates" (min dispense gap, doses per hour, brownout hold, safe-mode window/threshold/quiet/healthy-clear) with min/max validation, a required reason, an audit row and an English/Hiligaynon UI. Contract and inventory: `firmware/README.md` and `docs/firmware-dashboard-config.md`.
- I-100 E38: the firmware no longer refuses a dose above 1,000 g. The per-dose ceiling is derived as `min(daily ceiling, relay envelope seconds Ãƒâ€” grams per second)`; the relay-time guard still refuses an over-long dose. Needs a reflash (1.6.2 units keep the 1,000 g refusal until then).
- #338 the additive migration `20261031010000_add_feed_event_event_type_received_at_index` adds `FeedEvent(eventType, receivedAt)`, serving the platform feed aggregate and the heartbeat retention sweep. The misleading `(deviceId, receivedAt)` comment in `lib/retention.ts` now names the correct index, and `docs/performance/query-audit.md` records the change. No `CONCURRENTLY`: the table-size lock risk is documented because no database was available to measure it.
- #339 the additive migration `20261031020000_add_energy_device_pond_id_index` adds `EnergyDevice(pondId)`, which the dashboard's first read, the calendar lookup, global search and notification acknowledgement all filter on.
- #317 a CI-only e2e preflight (`scripts/e2e/check-ci-target.ts`) runs before `prisma migrate deploy`. With `CI=true` it accepts only the disposable local Supabase stack, so a misconfigured `DATABASE_URL` pointing at a real project fails before any DDL; the production acknowledgement still never makes a remote host eligible in CI.

### Changed

- #339 `markAllNotificationsRead` is no longer an N+1: it issues one `updateMany`, one batched `EnergyDevice` lookup and one `deviceStateEvent.createMany`, keeping one audit row per pond and the same owner scoping.
- #318 every writer of `CropCycle.targetHarvestWeightG` now goes through `lib/crop-cycle/target-write.ts`: the cycle edit uses the Replace/Keep decision, new cycles use the range guard, and the calculator save/clear use the same count-guarded writers. A static guard test fails if another module writes the mirror directly, and `cycleTargetDrift` reports drift from scripted data.

## [1.34.1] - 2026-10-31

### Fixed

- Dead-code gate: `MAX_ACCEPTED_FEED_GRAMS` is a literal (5,000 g, equal to the daily hard guard) instead of an alias of `MAX_FEED_GRAMS_PER_DAY_PER_DEVICE`, which knip reported as a duplicate export.

## [1.34.0] - 2026-10-30

### Changed

- The device daily ceiling is now the only gram cap for Feed Now, scheduled meals and prediction apply. The 1,000 g per-request ceiling from #387 and the pond per-meal dose clamp are removed; a 5,000 g schema sanity bound (the daily hard guard) still rejects malformed input. Refusals name the grams left of the daily ceiling and where to change it, and the Feed Now input is capped to the remaining daily grams. The relay-time guard and the daily-cap calculation are unchanged.
- I-97 offline alerts now follow the platform device connectivity policy (offline window plus grace) instead of the per-organization `offlineAfterMin` delay, so the alert and the badge cannot disagree. The organization column and setting are kept for compatibility and marked deprecated in the UI; nothing is dropped.

### Added

- I-97 feeders now report their Wi-Fi signal (`wifi_rssi`, firmware 1.6.2) and the app stores it in two additive, nullable columns (`EnergyDevice.wifiRssiDbm`, `wifiRssiUpdatedAt`, no backfill). A plausible, fresh low reading turns a reachable unit into "weak signal" and the device screens show the dBm value with a bars icon and text, never colour alone. Old firmware that reports no signal keeps the timing-only rule.
- #371 unsaved pond settings drafts are now stored in the database (`PondSettingsDraft`, one row per pond and user) instead of only `sessionStorage`, so typed values survive a closed browser and are never visible to another member of the farm. The form restores a draft only when it is newer than the saved settings and actually differs from them, shows the restore time with a Discard button, clears the draft after a successful save, and keeps `sessionStorage` only as the offline fallback. The device-watch cron prunes drafts untouched for 30 days. Additive migration `20261030120000_add_pond_settings_draft` (new table only).

## [1.33.0] - 2026-10-30

### Fixed

- Bundle budget: Feed Now, schedule and pond-settings client components import the zod-free `lib/limits-core` instead of `lib/limits`, which removes the first-load JS regression introduced in 1.32.0.

### Fixed

- #388 device connectivity is now one three-state rule (online / weak signal / offline) shared by the header indicator, sidebar, dashboard, feeder hero, admin and superadmin lists, alerts, assistant context and PWA snapshot. A late heartbeat shows "weak signal" instead of flipping the screen to offline; offline starts only after the platform-configured window plus a grace, with hysteresis so it cannot flap. The weak-signal window, offline window and grace are editable by a platform admin in Settings Ã¢â€ â€™ Device connectivity (stored in `PlatformSetting` key `device.status`; no schema change), and feed/calibration commands keep the stricter no-grace safety check. A command that is being delivered keeps the device out of the offline state, and the service worker retries a navigation twice before showing the offline shell so a slow link no longer lands readers on the offline dashboard after a single failed request.

## [1.32.0] - 2026-10-30

### Added

- #370 global search (Ã¢Å’ËœK / Ctrl+K) finds settings (daily feed ceiling, per-meal ceiling, calibration, hopper capacity and thresholds, schedule) in English and Hiligaynon, only for roles allowed to open them, and jumps to and highlights the field.

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
- #345 the account dropdown is readable in dark mode (Admin Panel 3.34:1 Ã¢â€ â€™ 4.89:1, device offline 2.62 Ã¢â€ â€™ 5.08, missing 3.03 Ã¢â€ â€™ 9.96) and finally links to Account settings at `/dashboard/settings/profile`.
- The feeder 3D model is rebuilt from the tape measurements: a 340 Ãƒâ€” 450 mm base, a 145 Ãƒâ€” 450 Ãƒâ€” 315 mm chassis, one 400 mm PET jar on a 200 mm shelf, and a 50 mm auger tube with a 60 mm motor. The ultrasonic sensor now sits on the jar lid, the 750 mm post and short arm are a wire guide, and the model includes the red rubber motor coupling, the brown tube-end plug, the blue outlet with the red cap, and the two wood tube cradles. Model asset `feeder-v1.1.0.glb` (1.1 MB, 37,800 triangles); the service-worker cache moves to **v6** for the new URL.
- The viewer camera presets and orbit target are reframed for the smaller machine, and the dispensing auger/coupling now rotate around the tube axis instead of the vertical axis.

## [1.30.1] - 2026-10-29

### Fixed

- The pond switcher rendered as inert header text when a farm had exactly one ACTIVE pond, so the control looked like a label and nobody could tell it existed. It now always renders the dropdown trigger and opens a menu listing the single pond, already checked.

## [1.30.0] - 2026-10-29

### Security

- Production dependency audit: `critical` 2 Ã¢â€ â€™ 0 and `high` 37 Ã¢â€ â€™ 1 (one allowlisted build/CLI finding, expiring 2027-01-27). `dompurify`, `proxy-addr`, `browserslist`, `source-map-js` and `baseline-browser-mapping` are pinned to patched versions through `pnpm.overrides`; `zod` moves to `^4.6.6`. `shadcn` is a code-generation CLI and now lives in `devDependencies`, so the server stack it drags in is no longer counted as shipped. See `docs/security/supply-chain.md`.
- `pnpm audit --prod` now runs in CI as `.github/workflows/security.yml`: an unallowlisted `critical`/`high` fails the build, and every allowlist entry in `security/audit-allowlist.json` needs a written reason and an expiry of at most 90 days.
- `.github/dependabot.yml` adds weekly, grouped npm and GitHub Actions update pull requests. No auto-merge.

### Added

- Automated accessibility gate (ISO 25010 usability, W9): axe-core runs over the login page, the dashboard page shell, the growth plan card, the hardware calibration page, the chat widget and the admin devices console, and fails on any serious or critical violation. Keyboard flows Ã¢â‚¬â€ pond switcher, chat composer, calibration steppers and the harvest modal Ã¢â‚¬â€ are driven with real key presses and assert focus movement, not only that a handler ran.
- The chat closes on **Escape** from anywhere inside it, including the composer, and returns focus to the floating chat control.
- `en` Ã¢â€ â€ `hil` message-catalogue parity is enforced by a test, and the 19 missing sticker strings are translated. Tagalog stays an English overlay at 9.3% complete and is reported, not gated, pending the owner's decision in #327.

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

- #307 calibration number fields could not be cleared once they held `0`, so a full distance of zero could not be replaced with a real measurement. Every numeric calibration field now keeps the raw text and parses on submit, so a field can be emptied and re-typed. Hopper centimetre fields step 1 Ã¢â€ â€™ 2 Ã¢â€ â€™ 3 Ã¢â€ â€™ 4 instead of 0.1, and all numeric calibration controls share one field pattern Ã¢â‚¬â€ label, steppers, unit, help text and an announced error Ã¢â‚¬â€ laid out in a responsive three-column grid (one column on phones, two on tablets, three on desktop).

## [1.27.1] - 2026-10-29

### Fixed

- The hardware **Settings Ã¢â€ â€™ Live Monitoring** hero now renders the interactive 3D feeder viewer instead of the legacy SVG illustration, and the live status poll runs immediately on load.

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

- #270 global search in the top navbar (Ã¢Å’ËœK / Ctrl+K) across pages, ponds, devices, members and records, scoped to what the caller can read.

### Fixed

- #269 dashboard right rail no longer scrolls horizontally; the redundant floating help button is gone. The Time Calibration input/button row now follows the card's own width (container query) instead of the 640 px viewport breakpoint, so both controls fit in the 22 rem rail and the "Set Device Time" button is no longer clipped; the device/controller card no longer splits into two columns inside the rail. Help keeps one entry point: the header control is now on the mobile band too.
- `docs/audits/2026-10-28-calc-device.md` #1: a failed ultrasonic read (the firmware's `0 %` + `0 cm` timeout sentinel) is no longer stored as an empty hopper Ã¢â‚¬â€ the heartbeat still updates `lastSeenAt`, but the level, history row and low/critical alerts are skipped; a real empty hopper still alerts, and a heartbeat without `feed_level_cm` keeps the last known distance.
- `docs/audits/2026-10-28-calc-device.md` #3: days of feed remaining is computed by one helper with guards (`estimateDaysOfFeedRemaining`); a missing, zero or negative capacity, meal size or meals/day returns null instead of the old `99`-day sentinel, the card floors it for display and the ingest two-day warning compares the fraction.
- `docs/audits/2026-10-28-calc-device.md` #5: the drift detector walks the level against a baseline, so a rise of Ã¢â€°Â¤ 5 points is ignored without raising it (70 Ã¢â€ â€™ 75 Ã¢â€ â€™ 60 now counts 10 points, not 15) while a larger rise starts a refill segment and keeps the earlier drop.
- `docs/audits/2026-10-28-calc-device.md` #6: the dashboard, hardware page and assistant load the drift inputs through one query that counts device output only, so imported `hand_fed` daily totals are no longer compared with the hopper drop.
- `docs/audits/2026-10-28-calc-device.md` #7: recalibration reminders page through every eligible device instead of silently stopping at 200.
- `docs/audits/2026-10-28-calc-device.md` #8: the feeder hero's next-feed time is covered by a regression test proving it resolves in Asia/Manila on a UTC host; current `develop` already uses the wall-clock helper, so no runtime change was needed.

## [1.22.0] - 2026-10-28

### Added

- #277 the farm-owner Admin Overview now shows feed dispensed per day, device activity and fleet-health charts, built on the existing shared Recharts components (no new dependency) and scoped to the caller's organization. When a series hits its 5,000-row cap the total is labelled as a lower bound and days that were not fetched are no longer zero-filled.
- #273 the farmer Audit Trail now covers every active pond on the farm instead of only the first one, resolves actor ids to human-readable names, surfaces the newest user touch, and shows each event's actor, role and bounded metadata in an expandable Details block. RBAC scoping is documented and tested: farmers see their own farm only, tenant admins use `/admin/audit`, platform admins use `/superadmin/operations/audit`. The industry comparison is in `docs/audits/2026-10-28-audit-trail-benchmark.md`.

### Fixed

- #274 Admin Ã¢â€ â€™ Devices: "Print selected labels" submits no `id` when no device is ticked, so `/admin/devices/labels` called `notFound()` and showed a 404. A label sheet opened without `?id=` now prints every device in the caller's tenant scope (bounded by 40, newest first), an explicit selection still returns 404 when nothing in it is in scope, and an empty device registry renders an empty state instead of a not-found page. The Superadmin Ã¢â€ â€™ Devices label sheet behaves the same way, behind the unchanged platform-admin gate.
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
- Firmware 1.6.0 network hygiene: per-event-type token buckets, a bounded offline queue that drops its oldest entry and counts it, and non-blocking HTTP retries with exponential backoff and Ã‚Â±20 % jitter capped at five minutes.
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
- Firmware 1.5.2 (#252): submitting the portal form now tests the network first. The setup AP stays up, the status page shows `ConnectingÃ¢â‚¬Â¦` and then `Connected to <SSID> Ã‚Â· IP Ã‚Â· signal` or a failure reason, and only a working link is saved (restart after 5 s).

### Fixed

- Firmware 1.5.2 (#252): the setup portal's network scan reported 0 networks when the portal started right after a failed join, because the station was still connecting (`esp_wifi_scan_start` returns `ESP_ERR_WIFI_STATE`, which the old code printed as "0 network(s)"). The scan now settles the station first, runs after `WIFI_AP_STA` is set and asynchronously, logs the real return value and retries once after 2 s.
- Firmware 1.5.2 (#252): a failed join no longer saves the credentials. The old NVS values are left untouched and the form returns with the reason (wrong password / network not found / no IP) so it can be retried.

## [1.19.1] - 2026-10-28

### Changed

- Firmware pin map now matches the hardwired CICT Building A board: feed button GPIO 27 Ã¢â€ â€™ 23, DS18B20 GPIO 26 Ã¢â€ â€™ 32, HC-SR04 TRIG GPIO 32 Ã¢â€ â€™ 12, ECHO GPIO 33 Ã¢â€ â€™ 14. The relay default stays on GPIO 25 and the CICT unit stays on GPIO 5, built with `-e esp32dev-relay5`: GPIO 5 straps only SDIO slave timing, so it does not need rewiring. Units still on the old map need the matching build flags or a rewire.
- The firmware README's reset-button table had the Wi-Fi and factory reset pins swapped (16/17) relative to the code; corrected.

### Fixed

- #244 clickable controls show a hand cursor (login Back to home and app-wide).

## [1.19.0] - 2026-10-28

### Added

- Pakoy, the PakaonAI mascot, in the chat, dashboard greeting, alerts, empty states, onboarding and offline/error pages (#193, #232, #221).

## [1.18.2] - 2026-10-28

### Fixed

- Day buckets in the pond charts (feed per day, water temperature, hopper) put readings from 00:00Ã¢â‚¬â€œ08:00 Manila on the previous day: the `timestamp` columns hold UTC and were converted with a single `AT TIME ZONE`. Every bucket query now converts UTC Ã¢â€ â€™ Asia/Manila (verified against the database).
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

- Admin Ã¢â€ â€™ Ponds no longer loads each device's plaintext provisioning token (or token hash) and the owner's full account row with the pond list; the page now selects only the fields it renders.
- Admin Ã¢â€ â€™ Users now shows the member's organization role and updates it immediately after a role change, instead of the legacy account role.
- Admin Ã¢â€ â€™ Users, Ponds and the member-permissions page hide create/archive/edit actions the caller's permissions do not allow, and a direct URL renders a not-found or "view only" notice instead of an error page.
- Admin Ã¢â€ â€™ Devices lists pending feeders in the approval queue only, so the numbered pager and the table describe the same rows and pending units on later pages are no longer unreachable.
- The admin audit log and the overview's Recent Activity table translate device event types and sources instead of printing raw keys; the pond detail "Overview" heading is translated.
- The sticker print page uses the farm's Asia/Manila calendar date for "measured on" instead of the browser's UTC date.
- The admin calendar keeps every active grow-out cycle in the all-ponds view; only completed/historical cycles keep the 30-row cap.
- Deleting a user now also deletes their organization membership and permission overrides, so the org no longer shows a ghost member or re-granted role.
- A revoked or expired platform-admin grant no longer hides the account from tenant management forever.
- Creating a farmer and pond from the admin form reports a validation or transport failure instead of leaving the button spinning.

### Security

- Admin Ã¢â€ â€™ Ponds no longer returns device credentials in bulk through the list action; credentials stay behind the audited, rate-limited single-device reveal.

## [1.17.0] - 2026-10-28

### Added

- Feeder hero on the pond detail and feeder (hardware settings) pages (E29): a dark device-style panel with the feeder drawn in the middle, glassy callouts with thin leader lines to the hopper, spout, housing and water line (hopper level with the shared offline "Last known N%" treatment, grams dispensed today, next scheduled feed with its day or "Schedule paused", water temperature, online/offline with last seen, reported firmware), a status pill and the AI Feed Advisor's one-line summary linking to the full card. Jeff's photo loads from `public/images/feeder/feeder-hero.webp` over a drawn illustration; a missing photo costs at most one request per browser session, and adding the file needs no code change (see the folder's README). Below 768 px the image comes first and the callouts become a 2Ãƒâ€”3 grid without leader lines. Presentation only Ã¢â‚¬â€ no guards, actions or schema touched.

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
- A feeder that has never reported a hopper level shows "Ã¢â‚¬â€" instead of a made-up 0 %, and Feed Now no longer raises a critical-hopper warning for it.
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

- Mobile app shell (E26): every console now has a PakaonAI-branded header band below `lg` (page title, search, "+" quick menu), the farmer bottom bar is a five-tab bar (Overview, Schedule, Biomass log, Alerts, Me) with the active tab in the brand colour, and the tenant admin and platform consoles are five tabs too (four primary sections plus "More"): the platform console had grown to nine sections, which leaves under 44 px per target at 375 px. "More" opens the same quick menu as the header band, so every page that left a bar Ã¢â‚¬â€ the farmer calendar, history, growth, harvest, audit and settings, and every role-aware quick action (add pond/feeder, scan sticker, pond location, log a sample, register a feeder) Ã¢â‚¬â€ is one tap away.
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
- Auth fast path: `auth.getClaims()` verifies the JWT locally when the project uses asymmetric signing keys, with a 30 s verified-session cache and a 60 s `supabaseId Ã¢â€ â€™ farmId` binding. A cache hit makes no Supabase call and no DB lookup.
- Background jobs: `BackgroundJob`/`JobArtifact` tables, `POST /api/v1/export-jobs` (CSV/ZIP/PDF) and `POST /api/v1/import-jobs` returning `202` + `Location`, owner-scoped status/download endpoints, a `GET /api/v1/jobs/metrics` queue-health endpoint, and a `GET /api/v1/cron/jobs` worker that claims with `FOR UPDATE SKIP LOCKED`. The dashboard export, PDF and import flows poll the job and download the artifact; none of them run in the request path. `docs/sql/cron-jobs.sql` schedules the worker.
- Grow-out cycles (`CropCycle`): one active cycle per pond with stocking date/count, grow-out days, auto-calculated editable harvest date, target weight, expected survival, and actual harvest weight/count/final FCR. A partial unique index enforces the one-active-cycle invariant.
- Harvest calendar (`PondEvent` + FullCalendar v7): month/week/list views, harvest/stocking/sampling/manual/feeding/device events, filters, all-ponds toggle, drag-to-reschedule for planned events, and a Harvest page in the sidebar and mobile nav.
- Fallow-pond safety: harvesting or cancelling a cycle pauses the paired feeder and sets `Pond.isFallow`; feed, resume, and schedule changes are blocked until the next cycle starts.
- Cycle-aware AI advice: the feed advisor and chat prompt receive grow-out day, days to harvest, target weight, projected biomass, and fallow state. The formula and safety clamps remain authoritative.
- Open Graph and Twitter card metadata now serve a 1200Ãƒâ€”630 PakaonAI preview image at `/og.png`, using the current logo kit and updated capstone credits.
- DPA/IRR-aligned Privacy Policy and Terms of Service at `/privacy` and `/terms`, with data-category, cookie/local-storage, subprocessor and retention tables; a research information and informed consent package for the 20 farmer and 10 IT professional respondents; and legal footer/login/profile links. The documents are published as version 1.0, effective 26 October 2026, with sitemap entries and indexable pages.
- Pre-publication review PDFs for the University Legal Office: Privacy Policy, Terms of Service, and the research information and consent form.
- Feed-rate calibration target check (#191): dispense a target dose through the normal feed path (daily cap, offline block, `MAX_DISPENSE_MS`), weigh it, and correct g/s from the error; pass at Ã‚Â±5 %, re-test otherwise. Every rate test and target check is a `CalibrationRun` with a session and attempt number, shown as a history table. Per-device recalibration interval with an overdue banner and a deduped reminder, and a rule-based drift detector (dispensed grams vs hopper drop, >15 %) surfaced on Hardware and in the AI chat context.
- Numbered pagination on every list (#187), with one app-wide page size (default 20) set by the superadmin under Settings Ã¢â€ â€™ Lists (audited). "Load more" is removed.
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
- Power-rating sticker for every feeder (#174): 95 Ãƒâ€” 66 mm, 8 per A4, English only, with an SSID-only Wi-Fi QR (`PakaonAI-XXXX` from the chip eFuse MAC). It never contains a device token.
- Superadmin device registry (#179, #183): register a feeder onto an org pond, rotate its token, print labels, and remote feed within the safety caps.
- Superadmin god mode (#183): read-only view-as with a signed session and red banner; manage any org's members and permissions; step-up re-authentication for dangerous actions; reversible user disable.
- Tenant RBAC in Admin Ã¢â€ â€™ Settings (#183): invite members, change roles, grant or revoke per-member permissions, with last-owner protection.
- Email invites through Resend from `invite@syntaxure.dev` (#183).
- Remote firmware updates (#183): `/api/firmware/check` with ECDSA P-256 signed manifests in a private `firmware` bucket, `scripts/ota/sign-release.mjs`, and a firmware OTA client with rollback health check, a 10:00Ã¢â‚¬â€œ15:00 window at least 20 min from feeds, and feed-button abort.
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
- Device identity provisioning in the same portal: Device ID (MAC) and Device Token are written to NVS, so one firmware image works for every unit. Admins can reveal a device token on demand from Admin Ã¢â€ â€™ Devices; it is never included in list responses.
- `MembershipPermission` enforcement: tenant actions now check the permission table, with role defaults as a compatibility bridge. `control_feeder` is revocable per membership, including for an owner.
- AI feeding prediction on the Growth page: deterministic baseline refined by the AI provider, explicit "apply" action, and the same Ã‚Â±50% deviation veto as biomass auto-adjust.
- Growth history page with feed-level, growth and biomass tabs; server-side pagination, date-range filters, search and shareable URLs. The Growth page cards are now compact previews.
- Biomass log provenance (`source`) with import and seed badges.
- A static test that every API route uses `withAuth`/`withCronAuth`, is a device-token route, or is the allowlisted health route.
- Loading and error boundaries for the admin and platform consoles.

### Changed

- AI provider is now OpenCode Go: `OPENCODE_GO_API_KEY`, `OPENCODE_GO_MODEL` and `OPENCODE_GO_REASONING_EFFORT`. Gemini and OpenRouter variables are retired.
- Tablets (768Ã¢â‚¬â€œ1023 px) now use the bottom navigation instead of having no navigation at all; the admin and platform consoles gained a mobile bottom bar too.
- Profile and hardware settings no longer show fake values or dead buttons; unavailable actions are disabled with an explanation.
- The Growth page now routes its remaining strings through next-intl (English + Hiligaynon).

### Fixed

- Dark-mode contrast on the dashboard, growth, history, notifications, audit and error/404 surfaces.
- Locale is preserved when navigating notification filters, audit "load more", growth links and history pagination.
- Empty states for the dashboard's recent feedings and the admin users table; the FCR tile shows "Ã¢â‚¬â€" instead of claiming an optimal trend when no report exists.
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
  - Extended `POST /api/ingest` heartbeat handler to ingest `feed_level_percent` and `feed_level_cm`, update `EnergyDevice`, log to `FeedLevelLog` (30-min or >5% delta), and create tiered notifications (Ã¢â€°Â¤5% CRITICAL, Ã¢â€°Â¤20% WARNING, Ã¢â€°Â¤2 days remaining WARNING) reusing the "pellet" category.
  - Extended `GET /api/feed-command` and `GET /api/schedule-sync` to return `hopper_empty_cm` and `hopper_full_cm` calibration values Ã¢â‚¬â€ ESP32 receives dynamic calibration on every poll cycle.
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
- **Phase 0 Ã¢â‚¬â€ Device state & command event model foundation.**
  - Added `DeviceStateEvent` model Ã¢â‚¬â€ unified event log recording every device write (commands) and every device read (state events). Single source of truth for audit trail, notifications, and schedule sync.
  - Added `ScheduleCommand` model Ã¢â‚¬â€ schedule edits are queued commands with status lifecycle (`pending` Ã¢â€ â€™ `sent` Ã¢â€ â€™ `acked` Ã¢â€ â€™ `applied` / `failed`), never written directly to `Pond`.
  - Added `buttonFeedGrams` field to `EnergyDevice` Ã¢â‚¬â€ configurable remote button dose, pushed via poll response. No OTA needed to change.
  - Extended `Notification` with `category`, `acknowledgedAt`, `acknowledgedBy`, `autoCleared` fields.
  - Extended `FeedEvent` to accept `schedule_acked` event type with `commandId` link.
  - Extended `FeedRequest.status` with `fulfilled_by_other_trigger` Ã¢â‚¬â€ used by reconciliation when a late-arriving button/scheduled event fulfills a previously-expired dashboard request.
  - Deprecated `FeedingEvent` and `Device` models Ã¢â‚¬â€ kept for backward-compat seed data; all new code uses `DeviceStateEvent` and `EnergyDevice`.
- **Phase 0b Ã¢â‚¬â€ Backend reconciliation + schedule sync.**
  - Gap 1 fix: `POST /api/ingest` runs reconciliation on late `feed_dispensed` events Ã¢â‚¬â€ finds orphaned expired/pending FeedRequests within 4-hour lookback, updates status to `fulfilled_by_other_trigger`, creates `feed_reconciled` DeviceStateEvent.
  - Added `GET /api/schedule-sync` endpoint Ã¢â‚¬â€ ESP32 polls for pending schedule commands. Returns `schedule_start`, `schedule_end`, `feeds_per_day`, `grams_per_feeding`, `button_feed_grams`.
  - `GET /api/feed-command` response extended with `button_feed_grams`.
  - Heartbeat handling auto-creates `connected` / `disconnected` DeviceStateEvents on state transitions. Offline threshold: 15 minutes.
  - Device reconnection auto-clears stale `connectivity` notifications (`autoCleared = true`, `read = true`).
- **Phase 0c Ã¢â‚¬â€ Firmware (ESP32) updates.**
  - `pollScheduleCommand()` fetches schedule from backend, dynamically rebuilds `feedTimes[]` (up to 24 slots) from `schedule_start`, `schedule_end`, `feeds_per_day`.
  - Button dose (`cachedButtonFeedGrams`) read from backend poll response instead of compile-time `#define`.
  - `postScheduleAck()` sends `schedule_acked` event back to confirm application.
  - Default schedule (06:00, 19:00) on boot if backend unreachable.
- **Phase 1 Ã¢â‚¬â€ Audit trail.**
  - New `/dashboard/audit` page with filterable timeline of all `DeviceStateEvent` entries. Filter tabs: All / Feeding / Connectivity / Schedule / Commands.
  - Dual-timestamp display: device RTC time + server receipt time.
  - Shows reconciliation events (`feed_reconciled`) with link to original expired request.
  - Paginated with "Load more" cursor.
- **Phase 2 Ã¢â‚¬â€ Notification accuracy.**
  - Notification center `/dashboard/notifications` reworked: tier filter tabs (All / Critical / Warning / Info / Success), category filter tabs, per-row Acknowledge button, "Mark all read" button.
  - Removed the "intentionally static" disclaimer Ã¢â‚¬â€ live data from Phase 0 state events.
- **Phase 4 Ã¢â‚¬â€ Editable schedule.**
  - Schedule page `/dashboard/schedule` converted from read-only to editable via `ScheduleEditor` component.
  - Time picker inputs for schedule start/end, plus feeds-per-day and feeding rate.
  - Sync status card showing "Pending device sync" vs. "Applied at [time]" per field, reusing the dual-timestamp pattern from Phase 0.
  - "Force Resync" button re-queues current values as a new ScheduleCommand.
  - `PondSettingsForm` routes through `updateScheduleCommand()` instead of direct `Pond.update()`.
- **Session-end hardening (Gap 4 + Gap 2 repeat detection).**
  - `requestFeed()` now expires stale `dispatched` FeedRequests >10min before creating new ones. Fallback uses `gramsPerFeeding` (150g) instead of `buttonFeedGrams` (80g) Ã¢â‚¬â€ remote farmers get the real dose.
  - `updateScheduleCommand()` expires stale `sent` ScheduleCommands >10min before creating new ones.
  - New `StuckRequestBanner` component on the schedule page with 4 states:
    1. **Device offline** Ã¢â‚¬â€ collapses feed + schedule into one root-cause message.
    2. **Single stuck feed** Ã¢â‚¬â€ dispatched but never confirmed. Retry button.
    3. **Repeat feed failure (Ã¢â€°Â¥2)** Ã¢â‚¬â€ escalated message showing count + earliest timestamp. Indicates likely hardware (relay) problem, not network.
    4. **Stuck schedule** Ã¢â‚¬â€ sent but never acked. Force Resync button.
  - Feed + schedule banners stack vertically when both exist offline trumps all.
- Added Hiligaynon translations for all new i18n keys (audit trail, schedule editor, stuck banner, notification center).
- Added "Audit Trail" link sidebar navigation.

### Changed
- `requestFeed()` fallback dose: `buttonFeedGrams` Ã¢â€ â€™ `gramsPerFeeding` (80g Ã¢â€ â€™ 150g). Remote "Feed Now" carries the real scheduled dose.
- Schedule data flow: farmer edits Ã¢â€ â€™ `ScheduleCommand` (pending) Ã¢â€ â€™ device polls `/api/schedule-sync` Ã¢â€ â€™ status `sent` Ã¢â€ â€™ device acks Ã¢â€ â€™ status `applied`. No direct `Pond` writes.
- Ingest route now creates `DeviceStateEvent` entries for all event types, enabling the unified audit trail.
- Notification center no longer declares itself "intentionally static."

### Fixed
- Gap 1 (reconciliation on late button events): orphaned expired FeedRequests are corrected to `fulfilled_by_other_trigger` when the late event arrives, with a `feed_reconciled` audit entry.
- Gap 4 (stuck dispatched/sent states on dead devices): lazy expiry in server actions marks them expired/failed after 10 minutes, triggered on next user action Ã¢â‚¬â€ no cron needed.
- Gap 2 repeat detection: Ã¢â€°Â¥2 consecutive stuck dispatched feeds escalates the banner from "retry" to "hardware problem Ã¢â‚¬â€ inspect."

### Added
- Added `hopperLevelPct` prop to `FeedNowButton` Ã¢â‚¬â€ the confirm modal now shows a red critical warning when hopper is below 10% and an amber warning below 25%.
- Added offline awareness to `FeedNowButton` Ã¢â‚¬â€ a red `AlertTriangle` banner appears in the confirm modal when the ESP32 has not sent a heartbeat within the offline threshold.
- Added `"Awaiting deviceÃ¢â‚¬Â¦"` label state to `FeedNowButton` while the feed request is in-flight, replacing the static button label during `dispensing`.
- Added distinct `toast.info("Feed already queued Ã¢â‚¬â€ awaiting device")` when a duplicate "Feed Now" click is detected (suppressed silently before).
- Added live `Notification` row creation in `/api/ingest` on every `feed_dispensed` event Ã¢â‚¬â€ the Notification Center now receives real data, not only seeded rows.
- Added `requestFeed` duplicate-request guard in `lib/actions/energy.ts` Ã¢â‚¬â€ returns `{ success: true, message: "Feed already pending" }` instead of creating duplicate `FeedRequest` rows.
- Added `EnergyControllerCard` offline banner prop (`isOffline`) with red `AlertTriangle` alert and updated status badge to show `"Offline"` state in red.
- Added `event_id` deduplication to `/api/ingest` Ã¢â‚¬â€ firmware retries with the same `event_id` are safely ignored via `FeedEvent.eventId @unique` and `P2002` error handling.
- Added lazy-expiry logic to `/api/feed-command` Ã¢â‚¬â€ pending `FeedRequest` rows older than 60 seconds are marked `"expired"` before dispatching, preventing an offline device from firing a backlog of stale commands on reconnect.
- Added `@@index([pondId, recordedAt])` to `BiomassLog` to speed up the latest-sample query on every dashboard load.
- Added `docs/audit-report.html` and `optifeed-feed-request-roadmap.html` Ã¢â‚¬â€ visual audit report and interactive roadmap tracking the feed request flow implementation status.

### Fixed
- Fixed success toast wording in `FeedNowButton` from an implied "done" message to `"Feed request sent Ã¢â‚¬â€ device will dispense within 5s"` to accurately reflect that the DB write succeeded, not the physical dispense.
- Fixed `EnergyControllerCard` status badge Ã¢â‚¬â€ now correctly renders `"Offline"` with a red dot (previously only showed `"Feeding..."` or `"Idle"`).
- Fixed `FeedEvent.createdAt` renamed to `receivedAt` for semantic clarity (server receipt time, not device event time).

### Changed
- Renamed `apps/web/middleware.ts` Ã¢â€ â€™ `proxy.ts` to avoid conflict with Next.js middleware conventions.
- `FeedNowButton` and `ScheduleControls` now call `requestFeed` from `lib/actions/energy.ts` (the `FeedRequest` polling path the ESP32 reads) instead of the legacy `triggerManualFeed` from `lib/actions/schedule.ts` (which only wrote a `FeedingEvent` log row and never reached the hardware).
- Updated migration `20260711000001_audit_fixes` Ã¢â‚¬â€ adds `FeedEvent.eventId` unique column, `BiomassLog` index, and `FeedRequest.status` expiry support.

## [1.8.7] - 2026-07-11

### Added
- Integrated Google Gemini API (`gemini-2.0-flash`) into the OptiFeed Assistant chatbot for AI-powered responses.
- Created `lib/gemini.ts` service module with `askGemini()` and `isGeminiEnabled()` helpers.
- Added `GEMINI_API_KEY` environment variable Ã¢â‚¬â€ just paste your key in `.env` to enable the AI assistant.
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
