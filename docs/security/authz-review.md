# Authorization review

Read-only review of the authorization surface: which guard enforces what, where it is applied,
and whether anything is missing one. Reviewed 2026-10-29 against `origin/develop` @ `8eb6ce4`
(v1.29.0) plus the in-flight mission branches noted inline.

**Result: no route or server action was found that is missing an authorization guard.** Four
lower-severity defects in how existing controls are applied are recorded in §5; none is an
authentication or authorization bypass. No authorization code was changed in this workstream — the
findings are for the lead to file and schedule.

Scope reviewed: all 28 `route.ts` files under `apps/web/app/api`, all 40 modules under
`apps/web/lib/actions`, and the route-group layouts. Not reviewed: the body of every page under
`(dashboard)`/`(admin)`/`(superadmin)` (their gate is the layout, see §4), the RLS policies
themselves, and Supabase dashboard settings.

---

## 1. The model in one page

Authorization is layered, and each layer fails closed:

1. **Authenticated?** — a Supabase session, verified server-side. A JWT is checked against the
   project's JWKS (`getClaims()`), with `getUser()` as the server-verified fallback. No session →
   `null` → 401 or redirect.
2. **Which tenant?** — the session e-mail must be a pond-provisioned address whose local part
   equals `User.farmId` (`getCurrentUser`). The `ownerId` used by handlers always comes from that
   database row, never from the request.
3. **Which tenant role?** — an active `Membership` (OWNER/ADMIN/OPERATOR/VIEWER) in an `ACTIVE`
   `Organization`, plus optional `MembershipPermission` grants and revocations.
4. **Platform authority?** — a separate `PlatformAdmin` row (unrevoked, unexpired). Neither this
   nor the tenant role implies the other.
5. **Fresh credential?** — step-up: an HMAC-signed, user-bound, 5-minute cookie required for
   dangerous platform actions.

Orthogonal to those: **view-as** (read-only impersonation), **device tokens** (machine callers) and
the **cron secret** (scheduled jobs).

---

## 2. Guard catalogue

Every helper is in `apps/web/lib/auth/` unless stated. "Redirect" means the helper redirects the
browser; "throws" means it raises and the caller turns that into 403/500; "fails closed" means the
deny path is the default on missing data or an error.

| Helper | What it proves | Failure mode | Used by |
| --- | --- | --- | --- |
| `getVerifiedSession()` (`verify-session.ts`) | The JWT is genuine and unexpired | `null` | `getCurrentUser`, `withAuth`, platform export route |
| `getCurrentUser()` (`session.ts`) | Session + `User` row + e-mail/farm binding | `null` | Every server-side read |
| `requirePasswordChanged()` / `assertPasswordChanged()` | Authenticated and no forced password change pending | Redirect / throws | Every layout; write guards; API-adjacent actions |
| `requireRole(...roles)` | Legacy `User.role` is in the list | Redirect to `/dashboard` | No call site left in `apps/web/app`; tenant gates use `requireTenantAdmin()`. Kept for compatibility |
| `requireWriteAccess()` | ADMIN/OPERATOR + password changed + not view-as | Throws | Tenant write actions |
| `getTenantAdminState()` / `isCurrentTenantAdmin()` / `requireTenantAdmin()` (`tenant-admin.ts`) | Active OWNER/ADMIN membership in an ACTIVE org | Redirect | `/admin` layout; admin actions; print labels |
| `requirePermission(name)` (`permissions.ts`) | Role defaults + explicit grants − revocations | Throws `Forbidden` | Admin actions (members, schedule, ponds, calibration, …) |
| `isCurrentPlatformAdmin()` / `requirePlatformAdmin()` (`require-platform-admin.ts`, `platform-admin.ts`) | Active PlatformAdmin row | Redirect / used as a boolean | `/superadmin` layout; every `lib/actions/platform/*` and `superadmin.ts` export |
| `requireStepUp()` / `withStepUp()` (`step-up.ts`) | A fresh password check within 5 minutes | Throws `step_up_required` | Disable/enable user, grant/revoke admin, device register/rotate/remote feed/pause, view-as start |
| `assertNotViewingAs()` (`view-as.ts`) | No live read-only impersonation session | Throws | `requireWriteAccess`, `canWrite`, `requirePermission` |
| `withAuth` / `withCronAuth` (`with-auth.ts`) | Session + farm binding / `CRON_SECRET` bearer (timing-safe) | 401/403 envelope | API routes |
| `resolveOrgScope()` / `resolveMemberOrgScope()` (`org-scope.ts`) | The org/pond ids a caller may read | Returns `EMPTY_SCOPE` | Admin reads, calendar, device detail, search |
| `resolveActivePond()` (`pond-access.ts`) | A pond belongs to the caller's farm (or the view-as farm) and is ACTIVE | Throws | Pond switcher |
| `verifyDeviceToken()` / `isDeviceApproved()` (`lib/device-auth.ts`) | A hashed device credential and an APPROVED unit | `null` / false | Device API routes |

Two private helpers are worth naming because they carry the object-level check for the highest-risk
admin actions: `resolveManagedMember()` (`lib/actions/admin.ts`) refuses a target outside the
caller's org and refuses to manage a platform admin; `getDeviceDetail()` (`lib/feeder/detail.ts`)
filters devices by the caller's pond scope.

---

## 3. Route coverage

Every route file, by the credential it accepts. "Session" means `withAuth` (or the inline verified
session in the platform export).

| Credential | Routes |
| --- | --- |
| Session (18) | `calendar/events`, `chat`, `chat/agent`, `chat/assistant`, `devices/[id]/state`, `export`, `export/batch`, `export-jobs`, `export-pdf`, `import`, `import/confirm`, `import-jobs`, `jobs/metrics`, `jobs/[id]`, `jobs/[id]/download`, `platform/calendar/events`, `predict-feeding`, `user-role` |
| Session **and** platform admin (1) | `platform/audit/export` (checked inline: verified session + `isCurrentPlatformAdmin()`) |
| Device token (4) | `feed-command`, `firmware/check`, `ingest`, `schedule-sync` |
| Cron secret (3) | `cron/crop-watch`, `cron/device-watch`, `cron/jobs` |
| Public by design (2) | `health`, `[...fallback]` (404 envelope) |

Object-level checks inside the session routes: `withAuth` supplies `ownerId`; handlers either pass
it into the query (`export`, `jobs`, `calendar`, `user-role`) or call a helper that re-resolves the
scope from the session (`getDeviceDetail`, `getJobForOwner`). No handler reads a farm or user id
from the request body.

Additional role checks inside session routes: `jobs/metrics` requires `User.role === "ADMIN"`;
`platform/audit/export` and `platform/calendar/events` require an active platform admin. Import and
import-job creation call `requireWriteAccess()` inside the handler, so a VIEWER cannot write.

---

## 4. Server actions and pages

- **Server actions.** 40 modules under `lib/actions` (37 of them `"use server"` modules, 127
  exported actions, including `platform/`). Writing exports are covered by a static test, `apps/web/lib/__tests__/server-action-guards.test.ts`, which requires
  each writing body to contain at least one of `requireWriteAccess`, `requirePermission`,
  `assertNotViewingAs`, `requirePlatformAdmin`, `requireTenantAdmin`, `withStepUp`. Its exception
  list has two entries, both documented in the test (own-password change and ending one's own
  view-as). Every action was also read during this review; the guards match the operation.
- **Pages.** Gates live in the route-group layouts, which Next.js runs on the server for every
  nested page render: `(dashboard)/layout.tsx` (`getCurrentPondOwnerId` + `requirePasswordChanged`),
  `(admin)/layout.tsx` (`requireTenantAdmin`), `(superadmin)/superadmin/layout.tsx`
  (`requirePlatformAdmin`), and the two print layouts (tenant and platform, each with its own gate).
  Individual admin actions re-check with `requireTenantAdmin`/`requirePermission`, so a page is not
  the only control for a mutation.

The layout gate is sound but implicit: a page moved out of its group loses its gate. The pages that
need an extra check (for example `(admin)/admin/calendar/page.tsx` calling `requireTenantAdmin`
again) already do so. This is a maintainability observation, not a gap.

---

## 5. Findings

### A1 — Audit-log IP is spoofable (Low; integrity of evidence)

Three duplicated `requestOrigin()` helpers read the **left-most** `X-Forwarded-For` entry:

- `apps/web/lib/actions/platform/audit.ts:22`
- `apps/web/lib/actions/superadmin.ts:74`
- `apps/web/lib/actions/platform/members.ts:77`

`lib/rate-limit.ts` documents (F-014) that the left-most entry is written by the client and is
trivially spoofable, and that only the **right-most** entry is safe behind Vercel's single proxy;
`selectClientIp()` implements that. The audit helpers do not use it, so `PlatformAuditLog.ip` is
attacker-influenced by the very actor it is meant to identify. Impact is limited to forensics: the
actor is already authenticated and identified by `actorUserId`, and only platform admins can reach
these actions. A stolen admin session could misdirect an investigation.

Suggested fix (not applied): call `selectClientIp()` from `lib/rate-limit.ts`, or move the helper
into one shared module so the next copy cannot drift.

### A2 — Device rate limit is consumed before the token is verified (Low/Medium; availability)

`apps/web/app/api/feed-command/route.ts:57` and `apps/web/app/api/schedule-sync/route.ts:111` call
`checkDeviceRateLimit(deviceId, …)` with the `device_id` query parameter **before**
`verifyDeviceToken()`. The bucket key is therefore attacker-chosen: anyone who knows a unit's MAC
(printed on the device and sent in every request) can keep that unit's 20-requests-per-minute
bucket full with bogus tokens, and the real unit receives 429s. Scheduled feeding continues from
the device's RTC schedule, so the effect is delayed dashboard commands and OTA checks, not a
stopped feeder — which is why this is not rated higher.

Suggested fix (not applied): verify the token first, then rate-limit on the verified device id
(the order `ingest` already uses). Keep the fail-open behaviour for limiter outages.

### A3 — Platform token rotation has no reveal rate limit (Info)

The tenant-side reveal (`revealDeviceToken`, `lib/actions/admin.ts:1507`) is limited to 10 reveals
per hour per actor by `checkDeviceTokenRevealRateLimit`. The platform-side rotation
(`rotateDeviceToken`, `lib/actions/platform/devices.ts:426`) returns a new plaintext token but does
not call that limiter. It does require an active platform admin, a reason, step-up and writes an
audit row. The asymmetry is worth closing so a stolen superadmin session cannot mint tokens in a
loop.

### A4 — `updatePlatformUser` can change `User.role` without step-up (Info)

`lib/actions/superadmin.ts:528` accepts `{ role }` and writes it after `requirePlatformAdmin()`,
a reason and an audit row — but without `withStepUp()`, unlike grants, revocations, disables and
device actions. `User.role` is the legacy flag: it gates `jobs/metrics` and a few legacy pages, not
the platform console or tenant authority. No tenant-crossing escalation was identified, but the
inconsistency is a reasonable thing to align.

### A5 — The CI auth gate checks an import, not a call (Info; gate quality)

`.github/workflows/ci.yml:76-91` ("Check API route auth") fails a route file that does not import
from `@/lib/auth/session` or `@/lib/auth/with-auth`. It does not check that the exported handler is
actually wrapped. A route could import `withAuth` and export an unguarded handler and still pass.
All 28 routes are correctly wrapped today (verified by reading each export), so this is a gate
limitation, not a live gap. Strengthening it — for example asserting each exported method is
assigned the result of `withApi(withAuth(…))` — would be a small script and is the kind of check
that keeps the invariant true.

### Consistency notes (not findings)

- `/api/jobs/metrics` gates on legacy `User.role === "ADMIN"`, while the admin console gates on
  `requireTenantAdmin()` (membership). The data is owner-scoped either way, so the mismatch can
  only deny a legitimate tenant owner whose legacy role is OPERATOR, or allow a legacy ADMIN who
  is not a tenant admin to see their own farm's job metrics.
- `POST /api/export-jobs` is available to a VIEWER (read-only role) because it creates an export
  job, which is a read. Import jobs are write-guarded. This is consistent with the product's
  definition of VIEWER, but worth knowing before tightening the role.
- Farm binding is cached for 60 s (`session-cache.ts`). A user whose farm binding changes keeps the
  old tenant for up to a minute; `invalidateFarm()` is called by the disable/enable paths.

---

## 6. What was not verified

- The RLS policies were not audited line by line. They are defence in depth for the PostgREST
  surface; Prisma connects as the database owner, so they are not the app's tenant boundary.
- Supabase dashboard settings (sign-up disabled, JWT signing keys, redirect URLs) are not in the
  repository and were not checked.
- No dynamic test was written: this is a code-reading review plus the existing static guards test.
  An object-level authorization test per API route would be the durable improvement, and is larger
  than this workstream.
