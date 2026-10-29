# Threat model

Scope: the OptiFeed / PakaonAI system as it is deployed today — the Next.js web application and
its HTTP/JSON API, the Supabase project behind it (Postgres, Auth, Storage), the ESP32 feeder
fleet, and the Vercel and CI/CD paths that ship them. It is written against
`origin/develop` @ `8eb6ce4` (v1.29.0) plus the ISO-readiness mission changes noted inline.

This is a working document, not a certification artefact. It is reviewed when a trust boundary
or an authorization mechanism changes, and after every incident (see
[`incident-response.md`](./incident-response.md) §7).

Related: [`SECURITY.md`](../../SECURITY.md) (disclosure policy and scope),
[`csp-review.md`](./csp-review.md), [`authz-review.md`](./authz-review.md),
[`../operations/backup-and-recovery.md`](../operations/backup-and-recovery.md).

---

## 1. What the system is

| Component | What it holds | Where the code lives |
| --- | --- | --- |
| Web app + server actions | Server-rendered dashboards, admin and superadmin consoles, 28 API route files | `apps/web/app`, `apps/web/lib/actions` |
| API routes | Session-authenticated JSON/CSV/PDF endpoints, device endpoints, cron endpoints | `apps/web/app/api/**/route.ts` |
| Postgres | Every tenant row: farms, ponds, crop cycles, biomass samples, feed events, devices, memberships, permissions, audit rows, rate-limit buckets | `apps/web/prisma/schema.prisma` (36 models) |
| Supabase Auth | Pond-provisioned identities, password hashes, sessions (JWT) | Used through `apps/web/lib/supabase/*` |
| Supabase Storage | Private `avatars` bucket, private `firmware` bucket (OTA channel + images) | `apps/web/lib/avatars.ts`, `apps/web/lib/firmware/ota.ts` |
| ESP32 fleet | Relay control, RTC schedule, safety caps, device token, OTA verifier | `firmware/firmware-main/firmware-main.ino` |
| Vercel | Edge/CDN, Next.js runtime, environment variables, deployment history | `apps/web/vercel.json`, deploy config |
| Outbound integrations | OpenCode Go / Gemini (chat, prediction), Resend (email), Telegram (critical alerts) | `apps/web/lib/ai.ts`, `apps/web/lib/notify/*` |
| CI/CD | `quality`, `security`, `sbom`, `firmware`, `release` workflows | `.github/workflows/` |

Deployment fact that changes the risk picture: **`staging` shares the production database and
credentials** ([`../deployment-workflow.md`](../deployment-workflow.md) §6). A staging fault or a
staging compromise is a production incident.

---

## 2. Assets, in priority order

| # | Asset | Why it matters | Where it lives |
| --- | --- | --- | --- |
| A1 | Tenant farm data (ponds, biomass, feed history, schedules, harvests) | Commercially sensitive to the farm; the product's reason to exist. Cross-tenant disclosure is the worst outcome. | Postgres |
| A2 | Feeder command integrity and physical safety | A forged or replayed command can over-feed a pond. The firmware's caps bound the damage but do not eliminate it. | `FeedRequest`, device API, firmware |
| A3 | Production credentials — Supabase service-role key, database password, `CRON_SECRET`, AI keys, Resend key, Telegram bot token | Service role bypasses RLS and can mint sessions; DB password is total data access. | Vercel environment variables, Supabase Vault |
| A4 | Personal data — names, e-mail addresses, phone/contact fields, profile pictures, audit trails | RA 10173 obligations; a breach triggers the 72-hour process in `SECURITY.md` §2. | Postgres, `avatars` bucket |
| A5 | Device tokens | Bearer credentials for telemetry and feed-command retrieval. | `EnergyDevice.tokenHash` (SHA-256) |
| A6 | OTA signing private key (ECDSA P-256) | Signs firmware manifests. Compromise means arbitrary firmware on the fleet. | Offline, outside the repository |
| A7 | Audit records (`PlatformAuditLog`, `DeviceStateEvent`) | Only evidence of who did what during an investigation. | Postgres |
| A8 | Session tokens (Supabase JWTs) | Full account access until expiry; sign-out does not revoke an issued access token. | Browser cookies (`sb-*-auth-token`) |
| A9 | Source, lockfile and CI pipeline | A malicious dependency or workflow change reaches production through Vercel. | Git, npm registry, GitHub Actions |

---

## 3. Actors

| Actor | Capability | Motivation |
| --- | --- | --- |
| Anonymous internet | Can reach every route, the login page and `/api/health`; can guess ids and device MACs | Opportunistic scanning, credential stuffing, fraud |
| `VIEWER` member | Read-only tenant role; `view_dashboard`, `view_reports` by default | Accidental misuse; a compromised account |
| `OPERATOR` member | Feeds, schedules, crop cycle, claims devices | Same, plus deliberate tampering by a departing employee |
| Tenant `OWNER`/`ADMIN` | Manages members, roles, ponds and devices in their organization | Insider threat against the tenant they administer |
| Platform admin | Cross-tenant read, account lifecycle, device registration and remote feed/pause, view-as | Highest-value target; a single compromised account is a full breach |
| Device holder / physical attacker | Possesses a unit, its MAC and possibly its token; can open the enclosure | Over-feed, clone a device, extract firmware |
| Dependency / CI attacker | Can publish a malicious package version or alter a workflow | Supply-chain compromise at scale |
| Cloud providers (Supabase, Vercel, Resend, AI) | Process data and hold credentials | Provider-side breach or misconfiguration |

The project has **two maintainers and one owner of production access**. There is no security team
and no on-call rotation; that is stated in `SECURITY.md` and it is a real constraint on every
control below.

---

## 4. Trust boundaries

| # | Boundary | What crosses it | Control at the boundary |
| --- | --- | --- | --- |
| B1 | Browser → Vercel edge → Next server | Cookies, form posts, JSON bodies, headers (all attacker-controlled) | Supabase JWT verification (`lib/auth/verify-session.ts`), tenant binding (`lib/auth/session.ts`), CSP, `withAuth` |
| B2 | Next server → Postgres/Auth/Storage | SQL through Prisma (owner role), admin API calls with the service-role key | Application-layer guards are authoritative (see §5); RLS only protects the PostgREST surface |
| B3 | Device → API | `X-Device-Token`, `device_id`, telemetry JSON | Hashed-token lookup with `timingSafeEqual`, `isDeviceApproved`, per-device rate buckets |
| B4 | Server → outbound providers | Farm context for AI, invitation and reminder e-mail, alert text | Server-side only; no provider key is `NEXT_PUBLIC_` |
| B5 | Platform console ↔ tenant console | Authority granted by `PlatformAdmin` vs. `Membership` | Two separate tables and two separate guards; neither flag opens the other console |
| B6 | Release pipeline → device fleet | Signed manifest, firmware image, signed download URL | ECDSA P-256 signature checked on the device; SHA-256 and size checked on both sides |
| B7 | Repository/CI → production | Build output and environment configuration | Review + `CODEOWNERS`, `quality`/`security`/`sbom` gates, Vercel branch allowlist |
| B8 | Owner ↔ offline signing key | Firmware signing | Manual, offline, two keys (`primary`, `spare`) in the firmware trust store |

---

## 5. Controls that already exist

Each row names the code that implements the control, so a reviewer can check it rather than trust
this document.

| Control | Implementation | Failure mode |
| --- | --- | --- |
| Session verification | `getVerifiedSession()` verifies the JWT through Supabase `getClaims()` (JWKS) and falls back to `getUser()`; results are cached 30 s per cookie fingerprint (`lib/auth/session-cache.ts`) | No session → `null`; every caller fails closed |
| Tenant binding | `getCurrentUser()` requires the session e-mail local part to equal `User.farmId` (`farmIdFromPondEmail`), so a lookalike domain cannot act as a farm | Mismatch → `null` |
| Tenant scope | `resolveOrgScope()` walks membership → ACTIVE organization → members → farms → ponds, and returns `EMPTY_SCOPE` on any missing link (`lib/auth/org-scope.ts`) | Suspended org grants nothing |
| Tenant role | `requireTenantAdmin()` checks an active OWNER/ADMIN membership, not the legacy `User.role` (`lib/auth/tenant-admin.ts`) | Redirect to `/dashboard` |
| Granular permissions | `requirePermission()` applies role defaults plus explicit grants/revocations (`lib/auth/permissions.ts`); a revoked row denies even an OWNER | Throws `Forbidden` |
| Platform authority | `requirePlatformAdmin()` checks an unrevoked, unexpired `PlatformAdmin` row (`lib/auth/require-platform-admin.ts`, `platform-admin.ts`) | Redirect to `/dashboard` |
| Step-up | `withStepUp()` requires an HMAC-signed, user-bound, 5-minute `stepup` cookie; the key is derived from the service-role secret with a domain label; verification is timing-safe (`lib/auth/step-up.ts`) | Throws `step_up_required` |
| Last-admin protection | Demoting/disabling/revoking the last active platform admin is refused, counted inside the transaction (`lib/actions/superadmin.ts`) | Returns an error, mutation does not run |
| Read-only view-as | Signed cookie + live `ImpersonationSession` row + active grant + 30-minute TTL; every tenant write guard calls `assertNotViewingAs()` (`lib/auth/view-as.ts`) | Writes refused; unverifiable state fails closed |
| API authentication | `withAuth` resolves `ownerId` from the database row, never from the request; `withCronAuth` compares SHA-256 digests of the bearer secret (`lib/auth/with-auth.ts`) | 401/403 JSON envelope |
| Device authentication | `verifyDeviceToken()` looks up the SHA-256 hash and compares it in constant time; `isDeviceApproved()` gates PENDING/REJECTED units (`lib/device-auth.ts`) | 401/403 |
| Rate limiting | Postgres fixed-window buckets (`lib/rate-limit.ts`): login 5/min per IP **fail-closed**, step-up 5/5 min per user **fail-closed**, API 30/min per user, device 20/min per device **per endpoint**, token reveal 10/h per admin | Store failure only opens the fail-open buckets |
| Login lockout | 5 failures per (farm, IP) locks that pair for 15 min; 10 failures across IPs locks the farm for 15 min and raises a `security` notification (`lib/auth/lockout.ts`) | Lockout, plus notification |
| Audit — platform | `PlatformAuditLog` rows carry actor, action, target, reason (≥10 chars), `stepUpAt`, IP/UA, before/after, written in the same transaction as the mutation (`lib/actions/platform/audit.ts`) | No row, no mutation |
| Audit — tenant | `DeviceStateEvent` records user-touched actions (feed, schedule, pause, set time, token reveal/rotate) with `actorId` | Same |
| Export scoping | CSV/PDF/zip exports and job downloads resolve the caller's `ownerId` and check job ownership (`app/api/export*`, `app/api/jobs/[id]/download`) | 404 for anything outside the farm |
| Device safety caps | Firmware refuses >1,000 g per dose, >5,000 g/day, and forces the relay off after 300 s (`firmware-main.ino`); the server clamps to the same constants (`lib/limits.ts`) | Dose refused and reported |
| Signed OTA | Device verifies the ECDSA P-256 manifest signature against `primary`/`spare`, then SHA-256 and size; the server validates the channel file against the same manifest and mints a 10-minute signed URL (`lib/firmware/ota.ts`) | Update not offered |
| RLS (defence in depth) | `ENABLE ROW LEVEL SECURITY` on 20 tables (31 policies) across the migrations | Prisma connects as the database owner, so RLS is **not** the app's enforcement layer; it protects the PostgREST/anon surface |
| Error scrubbing | I-64 adds persistence with header/bearer/JWT/Supabase-key/e-mail scrubbing before truncation (`lib/error-scrub.ts`, integration branch) | Console-only until that lands |
| Supply chain | `pnpm audit` gate with an expiring, reasoned allowlist (`security/audit-allowlist.json`, `.github/workflows/security.yml`), Dependabot, CycloneDX SBOM and gitleaks (`.github/workflows/sbom.yml`) | CI failure |

---

## 6. Threats (STRIDE)

Likelihood/impact are judged for *this* deployment (a capstone system with real farm data and a
small user base), not for a bank.

| ID | STRIDE | Threat | Likelihood | Impact | Current mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Spoofing | Credential stuffing or brute force against a pond login | Medium | High | 5/min per IP login bucket (fail-closed), 5-per-(farm, IP) lockout, farm-wide cap, breach notification to the farm (**lockout.ts**) | No MFA. A second attacker IP can hold the farm lock for 15 min (accepted trade-off, F-031). |
| S2 | Spoofing | Stolen or leaked device token used to poll commands or post telemetry | Medium | Medium | Token stored as SHA-256 hash, constant-time compare, approval status, per-device 20/min bucket (**device-auth.ts**) | Tokens are long-lived bearers; there is no rotation schedule, no per-request signature and no replay window. A stolen token works until an admin rotates it. |
| S3 | Spoofing | Stolen session cookie replayed from another host | Low | High | Supabase JWT signature/expiry verified server-side; `httpOnly` cookies; 30 s cache keyed on the cookie fingerprint (**verify-session.ts**, **session-cache.ts**) | Supabase does not revoke an issued access token on sign-out; a password change relies on short token lifetime, not instant revocation. |
| T1 | Tampering | Cross-tenant write by supplying another farm's id | Low | High | `ownerId` comes from the session, never the request; `resolveOrgScope`/`resolveManagedMember` fail closed; device detail and job downloads re-check pond/farm ownership | Enforcement is entirely in application code (Prisma runs as the DB owner, so RLS does not catch a missed guard). One forgotten guard is a cross-tenant write. |
| T2 | Tampering | Audit trail manipulated to hide an action | Low | Medium | Audit rows are written in the same transaction as the mutation; reason and step-up are mandatory; the app exposes no delete path | The recorded IP comes from the **leftmost** `X-Forwarded-For` entry in three helpers (`lib/actions/platform/audit.ts:22`, `lib/actions/superadmin.ts:74`, `lib/actions/platform/members.ts:77`) and is spoofable by the actor — inconsistent with `lib/rate-limit.ts` (F-014). A DB owner can still delete rows. |
| T3 | Tampering | Malicious or corrupted firmware pushed to the fleet | Low | Critical | Signed manifest verified on-device (ECDSA P-256, `primary`/`spare`), SHA-256 + size + version cross-checked, `min_from_version`, 8 KB response cap (**ota.ts**, `verifyManifestSignature`) | The private key is offline and manually handled; there is no revocation list beyond rotating to `spare`, and a compromised storage bucket alone cannot forge a manifest. |
| R1 | Repudiation | A farmer denies dispatching a feed or changing a schedule | Medium | Low | `DeviceStateEvent` + `FeedEvent.feedRequestId` + notifications record the actor and the request id; platform actions carry a written reason | Device acknowledgements are not signed; the server trusts what the unit reports. |
| I1 | Information disclosure | IDOR on an API route or server action exposes another tenant's rows | Medium | High | Every route carries `withAuth`, a device token or the cron secret; `getDeviceDetail` filters by pond scope; exports and job artifacts are owner-scoped; `next-config`-independent review in [`authz-review.md`](./authz-review.md) | No automated per-route object-level authorization test. The CI auth gate checks an import, not a call (see authz review A5). |
| I2 | Information disclosure | Secret committed to the repository or printed in logs | Medium | High | gitleaks on the working tree and last 100 commits (`.github/workflows/sbom.yml`, `.gitleaks.toml`); no secret is `NEXT_PUBLIC_` except the anon key; error scrubbing (I-64) | Full history contains 11 findings, all reviewed as fake fixtures/doc examples; a secret pushed to a fork or outside CI would still leak. |
| I3 | Information disclosure | Farm data leaves the system through an AI provider | Medium | Medium | Chat context is built server-side and bounded; message length capped; the fallback intent path needs no provider (**app/api/chat/route.ts**) | Provider retention/training terms are outside this repository; there is no DPA evidence on file. Prompt injection can induce disclosure of the caller's own tenant context, not another tenant's. |
| I4 | Information disclosure | Staging is treated as a test environment but shares production data | High | High | Documented in `SECURITY.md` §2 and `docs/deployment-workflow.md` §6; agents are forbidden from deploying staging | A bug or an experiment on staging is a production event. This is an accepted architectural decision, not a control. |
| D1 | Denial of service | An unauthenticated caller exhausts a device's rate-limit bucket | Medium | Medium | Per-device buckets fail open only on store errors; the firmware keeps feeding from its RTC schedule | `feed-command` and `schedule-sync` consume the bucket for the **unverified** `device_id` before checking the token (`feed-command/route.ts:57`, `schedule-sync/route.ts:111`). Anyone who knows a MAC can keep that unit at 429 — dashboard feeds are delayed, scheduled feeding continues. |
| D2 | Denial of service | A flood of AI calls drains the provider quota or the function budget | Low | Medium | 30/min per user on chat, 10/min on prediction, 30/min on exports; the chat falls back to keyword intents when the provider fails | Quota exhaustion degrades chat to fallback, not the feeder. |
| E1 | Elevation of privilege | Tenant admin tries to reach platform authority (or vice versa) | Low | Critical | Separate `Membership` (OWNER/ADMIN, ACTIVE org) and `PlatformAdmin` (unrevoked, unexpired) guards; neither opens the other console; grants and revocations require a reason, step-up and an audit row | The single owner holds both roles in practice. A compromised owner session is a full breach; step-up (5 min) is the only second factor. |
| E2 | Elevation of privilege | View-as escapes its read-only contract and writes as the tenant | Low | High | `assertNotViewingAs()` in `requireWriteAccess`, `canWrite` and `requirePermission`; `withAuth` refuses non-GET/HEAD during view-as; the session is a signed pointer to a DB row with a 30-minute TTL and a live-grant check | GET endpoints intentionally resolve to the target farm. A missed write guard on a GET route would be writable-in-effect. |
| E3 | Elevation of privilege | Malicious dependency or workflow change ships to production | Medium | Critical | Pinned lockfile, frozen-lockfile install in CI, `pnpm audit` gate with an expiring allowlist, Dependabot, SBOM artifact, required review via `CODEOWNERS` | No npm provenance/signature verification; install scripts run in CI and on developer machines; overrides can hide a vulnerable transitive path from the audit gate. |
| E4 | Elevation of privilege | Physical access to a unit yields fleet-wide credentials | Low | Medium | Device identity is provisioned per unit into NVS with no compile-time fallback (`firmware-main.ino`); LAN OTA is a bench-only build flag; tokens can be rotated from the platform console with step-up | A unit's token is readable from NVS by someone who opens the device. Rotation is manual and per device. |
| S4 | Spoofing (adjacent) | An attacker within Wi-Fi range of an unprovisioned unit joins the setup AP and captures or supplies the device credentials | Low | Medium | The setup AP exists only until the unit is provisioned, provisioning is attended and local, and the unit makes no API calls before it has an identity (`firmware-main.ino`, `lib/provisioning-ap.ts`) | The setup AP is **open** (`WIFI:T:nopass`) and the provisioning form — including the device token — is served over plain HTTP. A nearby attacker during provisioning can read the token and use it until an admin rotates it. |

### Threats explicitly out of scope

Denial of service by volume against production, physical attacks after the enclosure is opened
(with the token-rotation caveat above), social engineering of the maintainers, and third-party
platform vulnerabilities — see `SECURITY.md` §5. They are not ignored; they are not this
document's job.

---

## 7. Residual risk register

Accepted, with the owner and the reason. "Accepted" means the owner decided the cost of fixing it
now is higher than the risk; it does not mean the risk is zero.

| # | Risk | Owner | Why accepted today | Revisit when |
| --- | --- | --- | --- | --- |
| R1 | Single person holds production credentials and the OTA key | Owner | Two-person capstone; no separate operations role exists | A second maintainer gains production access, or the project takes real customer data at scale |
| R2 | No MFA on pond logins | Owner | Pond logins are handed to farmers; lockout + rate limit are the current defence | Any account is suspected compromised, or a farmer requests it |
| R3 | Tenant isolation depends on application guards because Prisma runs as the DB owner | Owner | Changing the database role would require auditing every query and migration | Before any multi-tenant customer outside the capstone |
| R4 | `script-src 'unsafe-inline'` weakens the CSP (see [`csp-review.md`](./csp-review.md)) | Owner | Next.js inline bootstrap/hydration data without a nonce setup; flipping it would break the app | When the app adopts a nonce-based CSP |
| R5 | Staging shares the production database | Owner | Documented decision; no second database project exists | When a dev/test project is provisioned (plan H8) |
| R6 | No restore drill has been executed | Owner | Owner-only action (mission decision E4); procedure is written | Before the next production migration |
| R7 | Third-party processors have no recorded DPA/retention terms | Owner / DPO | Capstone scale; providers are standard SaaS | Before onboarding a farm outside the study |
| R8 | Audit IP is spoofable; device buckets can be poisoned | Lead | Low severity, needs a code change outside the security-depth workstream | Next security maintenance window (filed as findings in the authz review) |
| R9 | The provisioning AP is open and carries the device token over plain HTTP | Owner | Provisioning is attended, short-lived and local; changing it means a captive portal with TLS or an out-of-band token exchange on the unit | Before units are shipped or provisioned anywhere other than a controlled bench |

---

## 8. How this model is kept honest

- A new route or server action must add a guard from the catalogue in
  [`authz-review.md`](./authz-review.md) §2; the static `server-action-guards` test and the CI
  `Check API route auth` step are the backstops, not the proof.
- A change to an authentication, authorization or trust-boundary file (`apps/web/lib/auth/**`,
  `apps/web/app/api/**`, `apps/web/proxy.ts`, `firmware/**`) requires a review of the matching row
  above. `CODEOWNERS` routes those paths to the owner.
- After an incident, the affected rows are updated, and the post-incident review records which
  control failed and which test now covers it.
- Anything this model claims that is not backed by a code path, a CI job or a recorded drill is
  marked as an assumption rather than stated as fact. There is no such claim in this document.
