# Production-readiness register (#618)

**Status:** audit, read-only. Findings only; fixes are separate tasks.
**Base:** `origin/develop` @ `f55032c` (v1.46.0), 2026-11-03.
**Method:** static reading of the source, tests and committed budgets. **Nothing was executed** — no build, typecheck, test run, Lighthouse run or migration. Live platform state (Supabase grants, Vercel plan, pooler, cron schedules, provider quotas) is unverified.
**Prior work:** OP4's register on #618 (`origin/develop` @ `b6abb2d`) is the starting point; this file refreshes it against current `develop` and records what has shipped since.

## 0. Earlier findings that are now fixed

| Earlier finding | Status on `f55032c` |
| --- | --- |
| RLS off on 19 tables (P1) | **Fixed** — migration `20261103100000_db_rls_index_retention` enables RLS on all 19. RLS is containment, not tenant isolation — see B18. |
| `getDeviceHealthSafe` fails open (P1) | **Fixed** — #624 / PR #634: "cannot verify" with timestamps. |
| Legacy `User.role` is write authority (#583) | **Fixed** — #596; membership wins, revoked membership denies. `/api/jobs/metrics` still reads the legacy column (B1). |
| Retry/dead-letter missing (#590) | **Fixed** — #595. |
| Ingest duplicate feed request (#588/#589) | **Fixed** — partial unique index + transaction. |
| Landing-page budget has no headroom | **Fixed** — #612. |

## 1. P0

| # | Area | Finding | Evidence | Issue |
| --- | --- | --- | --- | --- |
| P0-1 | Environment | Staging shares the production database and credentials, by documented decision, so any staging write/migration/seed is a production write. | `docs/operations/backup-and-recovery.md:27-29` | #668 |

## 2. P1

| # | Area | Finding | Evidence | Issue |
| --- | --- | --- | --- | --- |
| P1-1 | Offline | A sample queued after a transient failure is not replayed until an `online` event; the outbox flushes only on mount and `OfflineSync` never remounts. | `components/pwa/offline-sync.tsx:138-141`; `lib/offline/sync.ts:105` | #665 |
| P1-2 | Kiosk | The large-screen header printed a frozen SSR status while the viewer polls every 15 s, so the two could contradict each other indefinitely. | `large-screen/[id]/page.tsx` (pre-#667) | #666 (PR #667) |
| P1-3 | Admin | `deleteUser` deletes the Supabase login inside the Prisma transaction, then deletes DB rows; a later failure rolls back the DB but not the login. | `lib/actions/admin.ts:243-267` | #669 |
| P1-4 | Dosing | `feed-command` dispatch is `findFirst({status:"pending"})` then `update({where:{id}})`, with no status predicate or count check — two overlapping polls can both dispatch. The sibling `schedule-sync` route does it correctly. | `app/api/feed-command/route.ts:141-153`; correct pattern `app/api/schedule-sync/route.ts:160-165` | #670 |
| P1-5 | Security | Backup headers interpolate `reason`, actor and org names into SQL comments without stripping newlines, so a newline escapes the comment and executes on restore. | `lib/backup/sql.ts:124-134`; `app/api/admin/backup/export/route.ts:27-33` | #671 |
| P1-6 | Recovery | Provider backups/PITR are unconfirmed and the runbook says no drill ever ran, while `restore-drill.yml` has five successful recent runs. No verified provider-level recovery point. | `docs/operations/backup-and-recovery.md:10,17,52`; `restore-drill-record.md:3`; CI runs 2026-11-02 | #672 |

## 3. P2 — backend

| # | Area | Finding | Evidence |
| --- | --- | --- | --- |
| B1 | Authz | `/api/jobs/metrics` authorises on the legacy `User.role`, so a member demoted to VIEWER keeps access while the column says ADMIN. | `app/api/jobs/metrics/route.ts:13-14` |
| B2 | Errors | Write actions call `requireWriteAccess()` inside the function-wide `try`, flattening denials into generic failures logged as server faults. | OP4 register (13 actions) |
| B3 | Idempotency | Feed dispatch flips `pending → dispatched` before responding; a lost response loses the dose and ingest ignores `dispatched`. | OP4 register |
| B4 | Idempotency | Calibration queue paths bypass the #581 lock; `saveCalibrationFromTest` has no replay guard. | OP4 register |
| B5 | Reliability | The heartbeat handler opens an interactive transaction with default 2 s/5 s timeouts inside a 5 s budget, then ~10 sequential awaits. | OP4 register |
| B6 | Reliability | Device routes turn a DB failure into a **200 "idle/default"**, so a pending feed is silently not delivered while monitoring sees success. | OP4 register |
| B7 | Observability | Server actions mostly use `console.error`: 91 sites in 29 modules vs `reportError` in 4. | OP4 register |
| B8 | Deployment | Declared route budgets (35 s/30 s/15 s) exceed the platform limit and no `maxDuration` is set. | OP4 register; Vercel plan unverified |
| B9 | Cron | Cron scheduling is an out-of-band SQL script with a `YOUR_APP_URL` placeholder and a Vault secret the repo cannot verify; no heartbeat monitor. | `docs/sql/cron-device-watch.sql:34,37`; `cron-jobs.sql:33`; `cron-crop-watch.sql` |
| B10 | Data | Retention covers heartbeat `FeedEvent` (7 d), `DeviceStateEvent` (180 d), `PondSettingsDraft` (30 d). No retention for `WaterTempLog` (~288 rows/device/day), `FeedLevelLog`, `Notification`, `ReminderLog`, `CalibrationRun`, `AssistantAction`, `IssueReport`. | `lib/retention.ts:22-131`; no `deleteMany` elsewhere |
| B12 | i18n | The chat fallback drops Tagalog: it selects `hil` or `en` only, while routing supports `tl`. | `lib/chat/fallback.ts:21`; `lib/__tests__/tagalog-locale.test.ts:59` |
| B13 | Testing | The coverage floor measures `lib/**` only; `app/` (68 pages, 33 routes) and `components/` (223 files) are outside the denominator. | `vitest.config.ts:21` |
| B14 | Ingest | `FeedEvent.eventId` is globally unique although it is minted per device; a collision is treated as a duplicate and returns 204, silently dropping a real event. | `prisma/schema.prisma:454`; `app/api/ingest/route.ts:832-834,969-971` |
| B15 | Authz | Any authenticated user, including VIEWER, can export the whole tenant dataset (CSV/ZIP/XLSX/PDF); only the SQL backup is tenant-admin gated. | `app/api/export/route.ts:10-11`; `export/batch/route.ts`; `export-pdf/route.ts`; `export-jobs/route.ts` |
| B16 | Security | Device provisioning tokens are stored in plaintext at rest (`EnergyDevice.token`) and can be revealed by a tenant admin with no step-up, contradicting the step-up claim for the same class of action. | `prisma/schema.prisma:384`; `lib/actions/admin.ts:1676`; contrast `app/api/superadmin/backup/export/route.ts:55-67` |
| B17 | Security | RLS is not a tenant-isolation boundary: the app connects as `postgres` with `BYPASSRLS`, so every isolation guarantee is an application `where` clause. One missing predicate is a cross-tenant read with no DB backstop. | `docs/database-rls-retention.md:42-51`; `lib/supabase/admin.ts:22-23` |
| B18 | Data | Organization deletion requests write `PENDING_DELETION` + `purgeAfter`, but nothing ever purges. | `lib/actions/platform/organizations.ts:62-63`; no cron/job reads `purgeAfter` |
| B19 | Observability | `reportError` never carries the request id and `ErrorEvent` has no request-id column, so a failed request cannot be joined to its log line. | `lib/observability.ts:24-36`; `lib/api/instrumentation.ts:61,320-324` |
| B20 | Idempotency | `POST /api/import/confirm` and the `import_confirm` job have no idempotency key; a double submit duplicates every non-unique row. | `lib/jobs/import-data.ts:114`; `app/api/import/confirm/route.ts:49`; `lib/jobs/service.ts:309-315` |
| B21 | Reliability | `withApi`'s deadline is a `Promise.race` with no cancellation, so a 504 returns while the transaction/export/PDF keeps running. | `lib/api/instrumentation.ts:102-135` |
| B22 | Reliability | Job artifact download reads the whole `Bytes` column into memory and copies it again; artifacts are up to 50 000 rows with no size cap on write. | `app/api/jobs/[id]/download/route.ts:23-28`; `lib/jobs/service.ts:284-297`; `lib/constants.ts:4` |
| B23 | Security | `completePasswordReset` sets a new password for any authenticated Supabase session without proving mailbox ownership or that the session came from a recovery link. | `lib/actions/password-reset.ts:174-206` |
| B24 | Ingest | `safety_trip` dedupe and heartbeat thinning are read-then-write with no unique constraint, so concurrent/retried beats can duplicate. | `app/api/ingest/route.ts:1190-1197,244-255` |
| B25 | Ops | `device-watch` alerts are check-then-write, the scan is capped at 100 rows ordered by `lastSeenAt desc`, and devices with `lastSeenAt = null` never alert. | `app/api/cron/device-watch/route.ts:45-57,108-129` |

## 4. P2 — frontend

| # | Area | Finding | Evidence |
| --- | --- | --- | --- |
| F3 | Boundaries | No `error.tsx` outside the three console groups: kiosk, auth and landing fall through to Next's unstyled English error page. | only `(admin)`, `(dashboard)`, `(superadmin)` |
| F4 | Boundaries | No `not-found.tsx` outside the dashboard group; kiosk/auth/superadmin 404s use Next's default page. | only `(dashboard)/not-found.tsx` |
| F5 | Motion | The shared skeletons animate without `motion-reduce`, unlike the chart and superadmin skeletons. | `components/skeletons.tsx:5`; contrast `chart-skeleton.tsx:31` |
| F6 | A11y | The axe gate covers 6 surfaces; ~84 of ~90 routes have no automated a11y check. | `lib/__tests__/a11y-pages.test.tsx:373-516` |
| F7 | Performance | Lighthouse audits four public URLs only; no authenticated route has performance or a11y gating. | `lighthouserc.json:5-10` |
| F8 | Performance | The landing page is one `"use client"` tree eagerly importing `motion/react` and a dialog; its floor is the lowest in the config (0.52). | `app/[locale]/page.tsx:1,11,36`; `lighthouserc.json:25` |
| F9 | Performance | Routes without a measured baseline inherit the global 1484.6 kB ceiling; the kiosk route has no entry. | `scripts/perf/bundle-budget.mjs:324`; `perf/bundle-budget.json:14-279` |
| F10 | Performance | `/dashboard` sits at 98 % of its budget (1455.4/1484.6); any client addition fails a required check. | `perf/bundle-budget.json:120-123` |
| F11 | Offline | Service-worker install is atomic: one missing precache URL aborts the install and silently removes offline support. | `public/sw.js:48` vs `:15-25` |
| F12 | i18n | Legal body copy is hardcoded English inside a translated shell. | `components/legal/privacy-policy-content.tsx:26,63,72,110`; `terms-of-service-content.tsx:20,51,96,119` |
| F13 | i18n | The i18n scanners do not cover top-level components; `StuckRequestBanner` ships "Force Resync" untranslated. | `components/StuckRequestBanner.tsx:215`; `dashboard-i18n.test.ts:155-164` |
| F14 | A11y | Icon-only controls expose hardcoded English accessible names. | `components/dark-mode-toggle.tsx:18`; `chat-toggle-button.tsx:21`; `chat-conversation.tsx:114` |

## 5. P3

| # | Area | Finding | Evidence |
| --- | --- | --- | --- |
| P3-1 | Onboarding | The tour anchors to the chat button's English `aria-label` via CSS, so translating it breaks the spotlight. | `components/onboarding-provider.tsx:45` |
| P3-2 | Kiosk | Skeleton and scene used different clamped heights, so the display shifted on load. **Fixed in #667.** | `feeder-viewer-lazy.tsx:81` vs `feeder-viewer.tsx:333` |
| P3-3 | Kiosk | The scene was capped at 780 px, so a 4K display did not fill the viewport. **Fixed in #667.** | `feeder-viewer.tsx:333` |
| P3-4 | Loading | The dashboard control-room skeleton flashes on nested routes with no `loading.tsx` (calendar, harvest, device detail). | `dashboard/loading.tsx:6` |
| P3-5 | Errors | The last-resort boundary is hardcoded English with `lang="en"`. | `app/global-error.tsx:11,24,38` |
| P3-6 | Offline | Without a cached shell, navigation falls back to a plain-text 503. | `public/sw.js:143-146` |
| P3-7 | Offline | Offline navigation pays ~900 ms of retry backoff before the shell appears. | `public/sw.js:116-129` |
| P3-8 | A11y | Offline pill dismiss target is 24×24 px (36×36 in the sync panel) and both sit at `z-40` within 16 px on small screens. | `offline-banner.tsx:35,46`; `offline-sync.tsx:185,205` |

## 6. Critical paths with no test

1. Calibration concurrency / double dose (`lib/actions/calibration.ts:262-273`).
2. Dispatch with a lost poll response.
3. Cron route orchestration (`cron/jobs`, `cron/device-watch`, `cron/crop-watch`).
4. `/api/jobs/metrics`, `/api/jobs/[id]`, `/api/jobs/[id]/download`.
5. `/api/predict-feeding`, `/api/health`.
6. `/api/chat*` handler contracts.
7. `/api/devices/[id]/state` — covered at the component/DTO level by #620, not the route.
8. RLS behaviour: no test asserts a VIEWER cannot read, or that the 19 tables are unreachable via PostgREST.
9. Retention of non-heartbeat tables.
10. Restore of `auth.users` — documented as unautomated.
11. Token rotation end-to-end.
12. `/api/import/confirm`.

## 7. What was not audited

- Live environment: Supabase grants, Vercel plan limits, pooler configuration, cron schedules, provider quotas, branch protection.
- Contrast ratios (read, not measured), real keyboard traversal, service-worker runtime.
- A fresh build, typecheck or test run; bundle numbers are from `perf/bundle-budget.json`.
- `(print)` routes, `components/assistant/**`, `components/backup/**`, form-level a11y on the auth pages.
- Firmware behaviour beyond what the server contract depends on.

## 8. Issues filed from this audit

| Issue | Severity | Finding |
| --- | --- | --- |
| #665 | P1 | Offline sample replay waits for an `online` event |
| #666 | P1 | Kiosk header status was static (fix in PR #667) |
| #668 | P0 | Staging shares the production database and credentials |
| #669 | P1 | `deleteUser` removes the login inside the DB transaction |
| #670 | P1 | `feed-command` dispatch can double-dispatch |
| #671 | P1 | Newline in the backup reason injects SQL |
| #672 | P1 | Provider backups/PITR unconfirmed; runbook contradicts the drill |
