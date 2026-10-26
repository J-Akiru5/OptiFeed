# OptiFeed audit remediation — 2026-10-26

Source report: [`system-audit-report.html`](./system-audit-report.html) (Karl Calimotan, 2026-08-20, v1.10.0, 30 findings).
Remediation branch: `fix/audit-remediation`, based on `develop` `9a499b0`.
Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (73 files / 796 tests), `npx next build`, `pnpm api:check`.

Status legend: **Fixed** — implemented and verified in code. **Mitigated** — the original risk is reduced and a residual is documented. **Deferred** — needs a separate decision or a larger behavior-neutral refactor. **N/A** — the finding does not apply to the current runtime. **Owner action** — cannot be completed from the repository.

## Finding-by-finding status

| # | Finding | Status | Evidence / remaining action |
|---|---|---|---|
| 1 | Production secrets committed | **Fixed** | `apps/web/.env` is no longer tracked or present; only `.env.example` is tracked. **Owner action:** confirm the old credentials were rotated and removed from provider dashboards. |
| 2 | Hardcoded device token in firmware | **Mitigated** | NVS `device_id` / `device_token` and the captive portal supersede the compile-time fallback. The fallback remains for legacy/demo units. **Owner action:** remove the fallback before commercial units and align the README/seed token (`esp32-tok-cict-001` vs `demo-device-token-001`). |
| 3 | Brute-forceable PIN auth | **Fixed** | Password auth replaced PIN logins. `lib/actions/auth.ts` uses `checkLoginRateLimit` (5/60s per IP), `checkLockout` (per farm+IP with a farm-wide cap), and `resetLockout` on success. |
| 4 | No rate limiting on login/API | **Fixed** | `lib/rate-limit.ts` buckets on login, chat, chat/agent, predict, export, export/batch, export-jobs, import, import/confirm, import-jobs, and the device poll routes. |
| 5 | API routes excluded from middleware auth | **Fixed** | Every route is wrapped in `withApi` + `withAuth` (or is an explicit device-token allowlist entry). CI runs `pnpm api:check` and the API-route auth gate. |
| 6 | Missing ownership validation in server actions | **Fixed** | `settings`, `time`, `energy` and `notifications` resolve `getCurrentPondOwnerId` / `requireWriteAccess` and scope by `ownerId`; tenant-admin guards are in `lib/auth/require-platform-admin.ts` and `tenant-admin.ts`. |
| 7 | No security headers | **Fixed** | `next.config.ts` sets CSP (enforced + report-only), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, `poweredByHeader: false`, and now Strict-Transport-Security (`max-age=31536000; includeSubDomains`). |
| 8 | No CORS configuration | **N/A** | The dashboard is same-origin; the ESP32 is not a browser and device routes use bearer tokens plus rate limits. Permissive CORS would not add a control here. |
| 9 | No row-level security | **Mitigated** | RLS migrations exist (`20260831120000_add_rls_policies`, `20261004010000_fix_rls_policies_and_farm`, `20261004030000_add_pond_ownership_history`, `20261013020000_enable_rls_on_user`). Prisma connects with the owner role, so application-level ownership guards remain authoritative for the app; RLS protects the PostgREST surface. |
| 10 | Error details leaked to client | **Fixed** | No `details: String(error)` remains. `withApi` returns the error envelope with a request id; full details stay in server logs. |
| 11 | Device API routes have no error handling | **Fixed** | `feed-command`, `schedule-sync` and the other handlers use `withApi` with timeouts and structured failures. |
| 12 | Import N+1 and no transaction | **Fixed** | `lib/jobs/import-data.ts` wraps each import in `$transaction` and uses `createMany` per entity. |
| 13 | No test framework | **Fixed** | Vitest: 73 files / 796 tests. Playwright e2e specs exist under `apps/web/e2e`. |
| 14 | No health check | **Fixed** | `GET /api/health` runs `SELECT 1` and returns `{status:"ok"}` / 503 `degraded`, without leaking the driver error. |
| 15 | No graceful shutdown | **N/A** | Vercel runs serverless functions, not a long-lived process to drain. `withApi` bounds each request. |
| 16 | No structured logging | **Mitigated** | `withApi` adds `X-Request-Id` and `Server-Timing` (`total`, `db`, `app`, `auth`, `queries`) and logs failures with the request id. A dedicated logger (pino) is not adopted; residual noted. |
| 17 | Gemini API key prefix logged | **Fixed** | No `geminiDebugInfo` / `keyPrefix` remains after the provider migration. |
| 18 | No prompt-injection protection | **Mitigated** | Chat caps each message at 2000 characters, keeps the last 20 turns, and sends a server-built system prompt. No content filter; residual noted. |
| 19 | Hardcoded user data in UI | **Fixed** | Greeting is generic; fish count, hopper capacity and offline threshold come from `lib/constants.ts`; the remaining "Juan Miguel" strings are form placeholders and seed fixtures. |
| 20 | Dashboard monolith | **Deferred** | `dashboard/page.tsx` is still 687 lines. A behavior-neutral extraction of the bento grid should be its own reviewable task. |
| 21 | Duplicated constants | **Fixed** | `apps/web/lib/constants.ts` centralises `OFFLINE_THRESHOLD_MS`, `DEFAULT_FISH_COUNT`, `EXPORT_ROW_LIMIT` and `HOPPER_CAPACITY_KG`; call sites import them. |
| 22 | Unbounded export queries | **Fixed** | `lib/jobs/export-data.ts` applies `EXPORT_ROW_LIMIT` (`take`) to every export query. |
| 23 | Missing database indexes | **Fixed in this branch** | Added `FcrReport(pondId, periodEnd)` and `ScheduleCommand(deviceId, appliedAt)` to the schema and `20261026010000_add_audit_indexes`. `Notification(pondId, read)` already existed. **Production migration requires the owner's explicit approval** — migrations run only on the `main` deployment. |
| 24 | Audit cursor pagination bug | **Fixed** | `lib/actions/audit.ts` paginates with `where.id = { lt: cursor }` and returns the id cursor. |
| 25 | Empty monorepo packages | **Fixed** | Only `packages/config` remains; the empty `types`/`ui` stubs are gone. |
| 26 | Deprecated models still active | **Deferred** | `Device` / `FeedingEvent` are unused by app code (only seed cleanup touches them). Dropping the tables is destructive and needs a separate owner-approved migration. |
| 27 | Chat history not cleared on logout | **Fixed** | `clearChatHistory()` runs on logout; the provider aborts in-flight streams on unmount and `sessionStorage` is the only persistence. |
| 28 | Only one error boundary | **Fixed** | `(admin)`, `(dashboard)`, `(superadmin)` and `app/global-error.tsx` boundaries exist. |
| 29 | No global unhandled-rejection handler | **N/A** | Vercel serverless; `withApi` catches route failures. No long-lived process to attach `unhandledRejection` to. |
| 30 | CSV import dynamic typing risk | **Fixed** | `lib/csv.ts` sets `dynamicTyping: false`; import rows are parsed explicitly and validated. |

## What changed in this branch

- `apps/web/next.config.ts`: added `Strict-Transport-Security`.
- `apps/web/prisma/schema.prisma`: added the two composite indexes.
- `apps/web/prisma/migrations/20261026010000_add_audit_indexes/migration.sql`: additive index migration.
- This remediation record.

## Owner decisions still open

1. **#23 production migration** — promoting this branch to `main` applies the index migration on the production database (`migrate-if-production.mjs`). Approve explicitly before promotion.
2. **#1 credential rotation** — the file is gone from git, but rotation cannot be verified from the repository.
3. **#2 firmware fallback** — remove the compile-time token before commercial units; the current fallback is demo-only.
4. **#26 deprecated tables** — destructive drop needs an owner-approved release.
5. **#20 dashboard refactor** — deferred as a separate behavior-neutral task.
