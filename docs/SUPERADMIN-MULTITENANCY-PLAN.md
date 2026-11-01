# PakaonAI: Superadmin and Multi-Tenancy Plan (v2)

> Status: **partly built.** v1 written 2026-10-17 against `origin/develop` @ `be77a18`. **v2 amended 2026-10-26** against `origin/develop` @ `3089c65`: new decisions T15–T18 (§1), progress and new findings (§2a), the device registry phase M3F (§8), a revised PR order (§9) and a production-grade benchmark (Appendix A). **v2.2 amended 2026-11-01** against `origin/develop` @ `fc727bb`: the Platform Command Center (decisions T24–T26, phase M3C, open questions O19–O24, issue #479). What changed is listed in the change log at the end.
> Pattern source: Syntaxure EMS Architecture v3 (WVSU energy monitoring), mapped onto PakaonAI.
> Human-readable version with diagrams and charts: `docs/superadmin-multitenancy-portal.html` (**still v1**; this file wins where they differ).
> This file is written for the executing AI agent. It follows the same conventions as `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`.

Evidence labels used in this file:
- **(verified)**: checked directly in code or migrations on `origin/develop`.
- **(inference)**: likely, not directly checked. Confirm in code before relying on it.
- **(assumption)**: a planning number with no measured source yet. Replace with real data when available.
- **(open)**: needs Jeff's decision. Do not decide it yourself.

---

## 0. Instructions for the executing AI

**Hard rules (same as the hardening plan; they still apply):**
- Follow `CONTRIBUTING.md`: one short-lived branch per task (`feature/*`, `fix/*`, `docs/*`, …) from the latest `develop`, a PR into `develop`, never a push to `develop`, `staging` or `main`. *(v2: the shared `Karl` branch from v1 is retired, see `HANDOFF.md` §2.)*
- Previews and `develop` share the **production** database. Never test a write path (create, rotate, delete, purge) on a preview; use a local or separate dev database.
- Never run `prisma migrate reset`. Production uses `migrate deploy`.
- Every migration in this plan must be **additive** until Phase M2 is verified. No `DROP COLUMN`, `DROP TABLE`, `TRUNCATE`, or unique-constraint removal without an explicit human OK in chat. Section 6 lists the few contract steps that need that OK.
- Next.js is 16: the file is `proxy.ts`, not `middleware.ts`. Read `apps/web/node_modules/next/dist/docs/` before touching routing, route handlers or caching.
- Match repo style: Biome (tabs, 100 columns, double quotes), Conventional Commits, Server Actions in `lib/actions/`, no code comments.
- Money is stored as **integer centavos** (`Int`/`BigInt`), never `Float`. Rates are stored as **basis points** (`Int`, 1 bp = 0.01%).
- Before any conclusion about repo state, compare `develop`, `staging` and `main` with a full clone (never shallow). At the time of writing, `develop` is 104 commits ahead of `staging`, and `main` has 1 merge commit not in `develop`.
- Do not guess. Items marked **(open)** block the task that depends on them. Put them in section 7 and continue with other work.

**How to work:**
1. Phases run in order, M0 to M8. Tasks inside a phase may run in parallel unless the table says otherwise.
2. After each phase, run `pnpm self-check` plus the new tenancy negative-test suite (task M2.6). Report the output before starting the next phase.
3. Every RLS policy and every tenant-scoped query ships with a **negative test** proving that org A cannot read or write org B's rows. No exceptions. This is the EMS rule, and it carries over unchanged.

---

## 1. Locked decisions (signed off by Jeff, 2026-10-16/17)

These are decided. Do not reopen them.

| ID | Decision | EMS analog |
|---|---|---|
| T1 | **Tenant = Organization.** One org owns many farms. Users join orgs through memberships with roles. Org types: `INDIVIDUAL`, `COOPERATIVE`, `COMPANY`, `LGU`, `ACADEMIC`. | Customer (with `type`) |
| T2 | **Hierarchy: Organization → Farm → Pond → Feeder Unit → Controller.** A pond can hold one or more feeder units. The ESP32 controller is a replaceable component under the feeder unit. | Customer → Site → Building → EMU → Controller |
| T3 | **Target: full commercial SaaS**, with the capstone defense as the first milestone. The schema must never block commercialization. | — |
| T4 | **Superadmin powers:** view-as (impersonation), remote feeder control on any tenant, global config and per-tenant feature flags, suspend / export / purge tenants. Plus everything the current `ADMIN` already does. | Super Admin |
| T5 | **Guardrails:** every superadmin action writes an audit row with a **required reason**. Destructive actions and device actions also require **step-up re-authentication**. | #6 (partial) |
| T6 | **Hardware ownership: both.** Units can be provider-owned (leased) or customer-owned (sold). Ownership is a **separate column** (`ownershipParty`) from day one. It must never be overloaded onto an assignment or level field. | Fixes the EMS `owner_type` gap |
| T7 | *(Amended by T15, 2026-10-26: self-claim stays, alongside superadmin direct assignment.)* **Provisioning: farmer self-claim.** Each unit ships factory-flashed with its identity. The farmer scans a QR claim code in the app, which binds the unit to their org and pond. WiFi is entered through the captive portal. | Captive portal + dual reset buttons |
| T8 | **Oversight orgs (MAO, BFAR, co-op over members): deferred.** Keep `Organization.parentId` in the schema, but build no recursive access until a real customer needs it. | #7 |
| T9 | **Tenant deletion: revoke, retain, then purge.** Access is cut immediately and a data export is offered. Personal data is hard-deleted after a grace period. Anonymized telemetry from **provider-owned** units is retained. | #3 / ADR-08, tightened for the Data Privacy Act |
| T10 | **Demo carve-out: EMS-style.** Temporary superadmin grants have full powers, are time-boxed (`expiresAt`, checked fail-closed), have their own access log, and show a visible banner. Reason and step-up still apply to purge and device actions during a demo grant. | #9 / ADR-09 |
| T11 | **Business model: revenue share.** Farmers use the system for a percentage of **gross sales per dispatch**, where a dispatch is a harvest sold to a buyer or trader. | — |
| T12 | **Maintenance is billed per service, on top of the percentage.** | — |
| T13 | **Superadmin MFA (TOTP) is a commercial-readiness gate.** It is required before the first paying tenant and is not required for the capstone defense. | #6 |
| T14 | **Hardware BOM ≈ ₱20,000 per feeder unit** (Jeff's estimate). | — |
| T15 | *(2026-10-26)* **Device registration is superadmin-only.** A platform admin creates the device and must choose the **org and pond** at creation, so it appears at once in that tenant's Admin → Devices. Tenant admins cannot register devices. Farmer self-claim (T7, M4.2) stays planned for units sold to new customers. | — |
| T16 | *(2026-10-26)* **Token reveal is interim.** The tenant's "Show token" reveal of the stored plaintext token stays for now, because the setup portal needs the token typed in. Every reveal must be audited and rate-limited (M3F.5). Show-once tokens and dropping `EnergyDevice.token` remain the target (M4.3), after field units are reflashed. | — |
| T17 | *(2026-10-26)* **Setup AP name is `PakaonAI-XXXX`**, XXXX = last four hex digits of the chip's **eFuse MAC** (replaces `PAKAON-XXXX` in §5.2). The device registry records that same MAC, so the printed sticker QR always matches the unit, including before identity is set. | — |
| T19 | *(2026-10-26)* **Superadmin is god mode for the whole application** (resolves O9: T4 stands). Includes any org's members and permissions, view-as and remote feeder control. Guardrails stay: reason, audit, step-up, and the §6 safety caps. | — |
| T23 | *(2026-10-26)* **No separate dev database.** E2E tests and migrations run against the production Supabase project while PakaonAI is not in operation (Jeff). Guardrails: a backup before every migration, E2E data prefixed `e2e-` and cleaned up, `migrate deploy` only (never reset). | — |
| T20 | *(2026-10-26)* **Only `staging` (preview) and `main` (production) deploy.** `develop` is the reconciliation branch, validated by CI only (PR #182). | — |
| T21 | *(2026-10-26)* **Remote firmware updates (OTA)** are required, because units sit on farms with no IT help. Design follows the ESP32 OTA research (mission T-12). | — |
| T22 | *(2026-10-26)* **Firmware reset buttons on GPIO 17 (Wi-Fi, 5 s) and GPIO 16 (factory, 10 s)** (swapped the same day to match the soldered board), replacing the §5.3 proposal of 18/19. | — |
| T18 | *(2026-10-26)* **Check the platform tables' exposure now.** Jeff checks whether RLS is off on the platform tables (§2a, N1) and whether the Data API exposes them. If they are exposed, ship an additive `ENABLE ROW LEVEL SECURITY` hotfix migration as its own PR with Jeff's explicit OK, despite the migration freeze. | — |
| T24 | *(2026-11-01)* **The Superadmin landing page becomes a Platform Command Center** (issue #479). It answers, in order: what is happening, what is wrong, what should I do. Direction proposed by Jeff in chat; the build slices are Phase M3C and every threshold is still open (O19 to O24). A third-party dashboard screenshot was a layout reference only; nothing from it is reused, and the numbers in the proposal are illustrative placeholders. | — |
| T25 | *(2026-11-01)* **Three scopes, always visible:** global (the console), tenant (one organization) and resource (one device, pond or user). A banner shows the path, for example `GLOBAL SUPERADMIN → ORGANIZATION ALPHA`. The red view-as banner stays the tenant-scope case for a live session. | — |
| T26 | *(2026-11-01)* **Red, amber and green are reserved for status.** The dark blue sidebar and the orange accent stay; the Superadmin page is light by default with dark monitoring panels; Inter and an 8 px spacing scale. | — |

---

## 2. Verified current state (what the plan builds on)

| # | Finding | Evidence |
|---|---|---|
| S1 | **Tenant today = one farmer.** `User.farmId` is `@unique`. `Farm.ownerId` is `@unique` and references `User.farmId`. One login means one farm. | `prisma/schema.prisma` **(verified)** |
| S2 | **`UserRole.ADMIN` is already a global god role.** Every function in `lib/actions/admin.ts` calls only `requireRole("ADMIN")`, so it reads and writes every farm. There is no tenant-admin concept. | `lib/actions/admin.ts` **(verified)** |
| S3 | **Prisma connects as the `postgres` owner role, so RLS never applies to the app.** The existing RLS policies only protect PostgREST/Realtime access. Tenant isolation for the app is **100% application code**. | `.env` user `postgres.<ref>`; migration `20261013020000` comment **(verified)** |
| S4 | **Telemetry ownership stamps already exist.** A `BEFORE INSERT` trigger `stamp_telemetry_farm_id()` writes `Farm.id` into `farmId` on FeedEvent, FeedRequest, DeviceStateEvent, FeedLevelLog, BiomassLog, FcrReport, Notification, ScheduleCommand and FishSample. The column has no FK by design. This is ADR-05 from EMS, already applied. | migration `20261004000000_add_telemetry_farm_stamps` **(verified)** |
| S5 | **Device auth already uses hashed lookup.** `verifyDeviceToken` hashes the token with SHA-256, looks it up by `tokenHash`, and confirms with a constant-time compare. This is ahead of where EMS was. **But** `EnergyDevice.token` still stores the plaintext token. | `lib/device-auth.ts`, schema **(verified)** |
| S6 | **`EnergyDevice` mixes the logical unit and the physical controller in one row** (MAC + token + pond + calibration). There is no unit/controller split, so replacing an ESP32 breaks the history chain. | schema **(verified)** |
| S7 | **Firmware hardcodes identity:** `#define DEVICE_TOKEN "esp32-tok-cict-001"`, and the device_id (MAC) is baked into the poll URLs. WiFi credentials are already in NVS (`Preferences`). There is **no captive portal**. | `firmware/firmware-main/firmware-main.ino` **(verified)** |
| S8 | **Pins in use:** 21/22 (DS3231 I²C), 25 (relay), 26 (DS18B20), 27 (feed button), 32/33 (HC-SR04). EMS put its reset buttons on 32/33, which **cannot** be copied here. | firmware + `firmware/README.md` **(verified)** |
| S9 | Several API routes derive `ownerId` from the email local part (`farmIdFromEmail`) instead of the DB row: `chat`, `export`, `export/batch`, `import`, `import/confirm`. `withAuth` was hardened against exactly this. Signup is closed, so exploitability is low, but the pattern is inconsistent. M2 replaces all of them. | grep **(verified)**; severity **(inference)** |
| S10 | **Approved firmware feed caps** (from the hardening plan): 300,000 ms max dispense, 1,000 g per request, 5,000 g per day (or `hopperCapacityG` when lower). | hardening plan §0.5 **(verified)** |

### 2a. Progress and new findings (v2, 2026-10-26, verified on `origin/develop` @ `3089c65` unless noted)

**Built since v1:** Organization, Membership, MembershipPermission, PlatformAdmin, PlatformAuditLog (append-only trigger) and ImpersonationSession exist in the schema (M1.1). The tenant console is gated by membership (`requireTenantAdmin`, `lib/auth/tenant-admin.ts`) and scoped by `resolveOrgScope` (`lib/auth/org-scope.ts`), and no `requireRole("ADMIN")` remains in `lib/actions/admin.ts` (most of M2.5). `/superadmin` exists with orgs, users, ponds (read-only) and AI providers, gated by `requirePlatformAdmin`, with required reasons and audit rows on every mutation (part of M3.1, M3.2, M3.5, M3.6). Pending in PR #174: the printable Wi-Fi/power-rating sticker in Admin → Devices and the `PakaonAI-XXXX` firmware rename.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| N1 | RLS is enabled only on the core tables. No migration enables it on `PlatformAdmin`, `PlatformAuditLog`, `Organization`, `Membership`, `MembershipPermission`, `ImpersonationSession` (or `AiProviderConfig`, `BackgroundJob`, `JobArtifact`, the lockout and rate-limit tables). If the Data API exposes `public`, the public anon key could read or write them, including inserting a `PlatformAdmin` row. **Checked live 2026-10-26 (T18): not exposed.** 17 of 32 public tables have RLS off (all platform tables included), but none grants SELECT or INSERT to `anon` or `authenticated`, so the Data API cannot reach them. `PondOwnershipHistory` grants anon/authenticated SELECT but has RLS on with a policy. | migrations grep + live catalog query **(verified)** | Low now; enabling RLS on them stays as defense in depth (M8.3) |
| N2 | No MFA and no step-up anywhere: `PlatformAdmin.mfaEnrolledAt` and `PlatformAuditLog.stepUpAt` are never written. | grep **(verified)** | High (M3.2/M3.3 are defense items) |
| N3 | Superadmin **delete user is an immediate hard delete** of the auth user and the whole farm subtree (ponds, devices, telemetry), with only a reason box to confirm. | `lib/actions/superadmin.ts` `deleteUser` → `deleteUserSubtree` **(verified)** | High |
| N4 | Audit rows always use `targetType: "platform_console"`, never set `orgId`, `ip` or `userAgent`, and nothing reads `PlatformAuditLog` (no explorer, no export). | `superadmin.ts:67`, grep **(verified)** | Medium |
| N5 | Bug: `listAllPonds` keys orgs by `Membership.userId` but looks them up by `Pond.ownerId`, which is `User.farmId` (a slug, not the cuid), so the Organizations column on `/superadmin/ponds` is always empty. | `superadmin.ts` `listAllPonds` **(verified)** | Low |
| N6 | Devices are created only by seed scripts. There is no create, rotate, revoke or decommission action. `generateDeviceToken()` exists but only tests use it. | grep **(verified)** | High (blocks real deployments) |
| N7 | `revealDeviceToken` gives any tenant OWNER/ADMIN the plaintext token with no audit row and no rate limit. | `lib/actions/admin.ts` **(verified)** | Medium (T16) |
| N8 | Firmware names the setup AP from the saved `device_id`, which falls back to the compile-time demo MAC, so every unit without a saved identity broadcasts the same `…-3B09` name. | `firmware-main.ino` `loadDeviceIdentity`, `provisioningApSsid` **(verified)** | High for stickers (T17) |
| N9 | The SoftAP setup portal is **open** (no password or proof-of-possession). Anyone in range of a unit in setup mode can overwrite its Wi-Fi and identity. | `WiFi.softAP(name)` **(verified)** | High (field risk) |
| N10 | The superadmin pages hard-code English (no `getTranslations`), every list is unbounded `findMany`, and no superadmin mutation has a behavioural test. | grep **(verified)** | Medium |
| N11 | Grants with `expiresAt` (T10 demo grants) can only be made from the CLI; the console never passes `expiresAt`. | **(inference, from the benchmark report)** | Low |

---

## 3. Domain model

### 3.1 Hierarchy

```
Platform (Syntaxure)  ── PlatformAdmin (superadmin, incl. temporary demo grants)
   │
   └── Organization (tenant)  ── Membership (OWNER | ADMIN | OPERATOR | VIEWER) ── MembershipPermission
          │   parentId (schema only, T8)
          └── Farm
                 └── Pond
                        └── FeederUnit  (permanent logical identity; ownershipParty PROVIDER|CUSTOMER)
                               └── Controller (ESP32; replaceable; tokenHash; status ACTIVE|REPLACED|REVOKED)
   FeederInstallation: time-scoped (unit, org, farm, pond, controller, startedAt, endedAt)
```

**Unit naming (open, O1):** `FeederUnit` / "FU" is a placeholder. The name becomes a table name in M1, which is a one-way door, so **O1 blocks M1.1**.

### 3.2 New and changed models (Prisma sketch, all additive in M1)

```prisma
enum OrgType        { INDIVIDUAL COOPERATIVE COMPANY LGU ACADEMIC }
enum OrgStatus      { ACTIVE SUSPENDED PENDING_DELETION PURGED }
enum MemberRole     { OWNER ADMIN OPERATOR VIEWER }
enum OwnershipParty { PROVIDER CUSTOMER }
enum FeederStatus   { INVENTORY ASSIGNED CLAIMED INSTALLED ACTIVE MAINTENANCE DECOMMISSIONED }
enum ControllerStatus { ACTIVE REPLACED REVOKED }

model Organization {
  id                  String    @id @default(cuid())
  name                String
  type                OrgType   @default(INDIVIDUAL)
  status              OrgStatus @default(ACTIVE)
  parentId            String?   // T8: schema only, no recursive access
  suspendedAt         DateTime?
  suspendedReason     String?
  deletionRequestedAt DateTime?
  purgeAfter          DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@index([status])
}

model Membership {
  id        String     @id @default(cuid())
  orgId     String
  userId    String
  role      MemberRole
  invitedBy String?
  createdAt DateTime   @default(now())
  revokedAt DateTime?
  @@unique([orgId, userId])
  @@index([userId])
}

model MembershipPermission {         // materialized at membership creation (EMS pattern)
  id           String    @id @default(cuid())
  membershipId String
  permission   String    // see §4.2
  grantedAt    DateTime  @default(now())
  revokedAt    DateTime?
  @@unique([membershipId, permission])
}

model FeederUnit {
  id              String         @id @default(cuid())
  serial          String         @unique          // printed on unit + QR
  ownershipParty  OwnershipParty                   // T6 — never reuse for anything else
  status          FeederStatus   @default(INVENTORY)
  orgId           String?                          // current tenant (null in inventory)
  pondId          String?                          // current pond (null = assigned, not installed)
  claimCodeHash   String?        @unique           // sha256, single use
  claimExpiresAt  DateTime?
  createdAt       DateTime       @default(now())
  @@index([orgId])
  @@index([status])
}

model FeederInstallation {           // EMS emu_installations analog
  id           String    @id @default(cuid())
  feederUnitId String
  orgId        String
  farmId       String?
  pondId       String?
  controllerId String?
  startedAt    DateTime  @default(now())
  endedAt      DateTime?
  endReason    String?   // REASSIGNED | DECOMMISSIONED | TENANT_DELETED | CONTROLLER_REPLACED
  @@index([feederUnitId, startedAt])
  @@index([orgId])
}

model PlatformAdmin {                // replaces UserRole.ADMIN as the god-mode source of truth
  id            String    @id @default(cuid())
  userId        String    @unique
  grantedBy     String?
  expiresAt     DateTime? // T10: non-null = temporary demo grant
  revokedAt     DateTime?
  mfaEnrolledAt DateTime? // T13 gate
  createdAt     DateTime  @default(now())
}

model PlatformAuditLog {             // append-only; UPDATE/DELETE rejected by trigger
  id                 String   @id @default(cuid())
  actorUserId        String
  action             String   // e.g. tenant.suspend, feeder.manual_feed, impersonate.start
  targetType         String
  targetId           String?
  orgId              String?
  reason             String   // T5: required, min 10 chars
  stepUpAt           DateTime?
  temporaryGrant     Boolean  @default(false)
  impersonationId    String?
  before             Json?
  after              Json?
  ip                 String?
  userAgent          String?
  createdAt          DateTime @default(now())
  @@index([orgId, createdAt])
  @@index([actorUserId, createdAt])
}

model ImpersonationSession {
  id          String    @id @default(cuid())
  actorUserId String
  orgId       String
  mode        String    // READ_ONLY | READ_WRITE (READ_WRITE needs step-up)
  reason      String
  startedAt   DateTime  @default(now())
  expiresAt   DateTime  // default 30 min
  endedAt     DateTime?
}

model PlatformConfig { key String @id  value Json  updatedBy String  updatedAt DateTime @updatedAt }
model OrgConfigOverride { orgId String  key String  value Json  updatedBy String  updatedAt DateTime @updatedAt  @@id([orgId, key]) }
model OrgFeatureFlag { orgId String  flag String  enabled Boolean  updatedBy String  updatedAt DateTime @updatedAt  @@id([orgId, flag]) }
```

**Commercial models (M6):**

```prisma
model CommissionAgreement { id String @id @default(cuid())  orgId String  rateBps Int  minimumPerCycleCentavos Int @default(0)  effectiveFrom DateTime  effectiveTo DateTime?  signedDocUrl String?  createdBy String }
model Dispatch {             // harvest sold to a buyer/trader (T11)
  id String @id @default(cuid())
  orgId String  farmId String  pondId String
  dispatchedAt DateTime
  weightKgMilli Int          // grams precision, integer
  pricePerKgCentavos Int
  grossCentavos BigInt       // computed server-side, never client-supplied
  buyerName String?  buyerContact String?
  proofUrls String[]         // receipt / weighing slip photos (Supabase Storage, org-scoped bucket path)
  estimatedBiomassKgMilli Int?  // snapshot from biomass model at report time
  varianceBps Int?           // (reported - estimated) / estimated
  status String              // REPORTED | FLAGGED | VERIFIED | DISPUTED | INVOICED
  reportedBy String  verifiedBy String?  createdAt DateTime @default(now())
  @@index([orgId, dispatchedAt])
}
model ServiceTicket { id String @id @default(cuid())  orgId String  feederUnitId String?  kind String  status String  feeCentavos Int @default(0)  technician String?  openedAt DateTime @default(now())  closedAt DateTime? }
model LedgerEntry {          // append-only money trail
  id String @id @default(cuid())
  orgId String
  kind String                // COMMISSION | SERVICE_FEE | MINIMUM_TOPUP | PAYMENT | ADJUSTMENT
  amountCentavos BigInt      // + = owed to Syntaxure, - = payment/credit
  dispatchId String?  serviceTicketId String?  statementId String?
  memo String  createdBy String  createdAt DateTime @default(now())
  @@index([orgId, createdAt])
}
model Statement { id String @id @default(cuid())  orgId String  periodStart DateTime  periodEnd DateTime  totalCentavos BigInt  status String  issuedAt DateTime?  paidAt DateTime? }
```

### 3.3 Changes to existing models (M1, additive)

| Model | Change |
|---|---|
| `Farm` | add `orgId String?` (+ index). `ownerId @unique` stays until M2.8. |
| `Pond` | add `orgId String?` (+ index). |
| `EnergyDevice` | **becomes the Controller.** Add `feederUnitId String?`, `status ControllerStatus @default(ACTIVE)`, `firmwareVersion String?`, `revokedAt DateTime?`. Do not rename the table in this plan; a `@@map` rename is optional cleanup after M8. Calibration fields (`gramsPerSecond`, hopper cm/g, `tempOffsetC`) describe the physical unit and move to `FeederUnit` in M4.4, copy first, then switch reads. |
| Telemetry tables (the 9 stamped tables, S4) | add `orgId String?`, `feederUnitId String?`, `installationId String?`. Extend `stamp_telemetry_farm_id()` into `stamp_telemetry_ownership()`, which resolves all four stamps at insert time. Keep the COALESCE behavior and the no-FK rule. |
| `User` | no change in M1. `farmId` stays as the login slug. Its tenant meaning is retired in M2. `role` (`UserRole`) stays readable but is no longer used for authorization after M2.5. |

### 3.4 Feeder lifecycle

`INVENTORY → ASSIGNED → CLAIMED → INSTALLED → ACTIVE ⇄ MAINTENANCE → DECOMMISSIONED`

- `INVENTORY`: factory-flashed, sitting in Syntaxure stock, no org.
- `ASSIGNED`: superadmin issued it to an org, or it was sold. A claim code is generated.
- `CLAIMED`: the farmer scanned the QR. Bound to the org and to a pond, or "unplaced" (EMS #5: shown in the dashboard and not treated as an error).
- `INSTALLED`: the first heartbeat arrived over the farmer's WiFi.
- `ACTIVE`: telemetry flowing, schedule synced.
- `MAINTENANCE`: an open service ticket. Remote feeding is still allowed and caps still apply.
- `DECOMMISSIONED`: the controller is revoked and the installation is closed.
- **Cross-org reassignment** closes the current installation and opens a new one. A **provider-owned** unit can only be reassigned by superadmin (EMS #2). A **customer-owned** unit cannot be reassigned across orgs at all, only transferred by the owner org through a superadmin-assisted transfer with a reason.

---

## 4. Tenancy and authorization

### 4.1 Resolution order (EMS four gates, unchanged)

1. **Authenticated.** Resolve the user by `supabaseId`, never by email local part.
2. **Member** of the resource's owning org (`Membership`, `revokedAt IS NULL`). The org must be `ACTIVE`. A `SUSPENDED` org gets read-only access to the export page only.
3. **Scope** covers the resource. The resource's `orgId` equals the membership org.
4. **Permission** present and not revoked on this membership.

Superadmin is a **separate path**: `requirePlatformAdmin({ action, stepUp, reason })`. It checks for a `PlatformAdmin` row that is not revoked and, when `expiresAt` is set, `expiresAt > now()` (fail-closed). It requires the reason and step-up the action needs. It writes `PlatformAuditLog` **in the same transaction** as the action. If the audit insert fails, the action fails.

### 4.2 Permission set

| Permission | Owner | Admin | Operator | Viewer |
|---|---|---|---|---|
| `view_dashboard` | ✓ | ✓ | ✓ | ✓ |
| `view_reports` | ✓ | ✓ | — | ✓ |
| `manage_members` | ✓ | ✓ | — | — |
| `manage_farms_ponds` | ✓ | ✓ | — | — |
| `manage_schedule` | ✓ | ✓ | ✓ | — |
| `claim_feeder` | ✓ | ✓ | ✓ | — |
| `replace_controller` | ✓ | — | ✓ | — |
| `move_feeder_within_org` | ✓ | ✓ | — | — |
| `control_feeder` (manual feed, pause) | ✓ revocable | ✓ revocable | ✓ revocable | — |
| `record_dispatch` | ✓ | ✓ | — | — |
| `view_billing` | ✓ | ✓ | — | — |

`control_feeder` is the PakaonAI equivalent of EMS `control_relay`: independently revocable per membership. External delegates (EMS #4) are not in scope.

### 4.3 Isolation strategy (S3 makes this the most important section)

Because Prisma bypasses RLS, isolation needs two layers:

- **Layer 1 (M2, required for the defense):** a tenant-scoped Prisma client extension, `db.forOrg(orgId)`. It injects `where: { orgId }` on every read and write of tenant models and rejects writes whose payload carries a different `orgId`. A self-check rule fails the build if tenant code imports the raw `prisma` client for a tenant model outside `lib/db/tenant.ts` and `lib/actions/platform/*`. Negative tests per model (M2.6).
- **Layer 2 (M8, commercial gate):** a dedicated non-owner Postgres role `app_tenant` for tenant traffic. RLS policies read `current_setting('app.org_id', true)`, which is set per transaction by `forOrg()` via `SELECT set_config('app.org_id', $1, true)`. Superadmin and cron keep the owner role. This is defense in depth: an app bug no longer leaks data by itself. Do not use `FORCE ROW LEVEL SECURITY` on the owner role (hardening plan note).

### 4.4 Superadmin boundary

| Control | Defense (capstone) | Commercial gate (M8) |
|---|---|---|
| Audit log with required reason | ✓ | ✓ |
| Step-up re-auth (PIN or password re-entry, valid 5 min) for destructive and device actions | ✓ | ✓ |
| Temporary demo grants: `expiresAt`, separate access log, banner | ✓ (T10) | ✓ |
| TOTP MFA for every PlatformAdmin | — | **required** (T13) |
| Credential rotation and secure recovery (Resend) | — | required |
| Non-owner DB role + RLS (Layer 2) | — | required |
| Contract and Data Privacy review | — | required (human) |

**Actions that require step-up:** tenant suspend / purge / restore, impersonation in READ_WRITE mode, any remote feeder command, controller revoke, cross-org feeder reassignment, commission rate change, ledger adjustment, granting or revoking PlatformAdmin.

---

## 5. Devices and provisioning

### 5.1 Factory flash (Syntaxure, before shipping)

> **v2 interim path (M3F, before M1.2/M4):** a platform admin registers the device on today's `EnergyDevice` model: eFuse MAC (canonical `AA:BB:CC:DD:EE:FF`, unique case-insensitively), label, org and pond (T15). The server generates the token with `generateDeviceToken()` and stores `tokenHash` plus, **interim (T16)**, the plaintext `token`. The admin flashes or types the identity, then prints the sticker. The sticker never carries the token. Order: register → set identity on the unit → print → check that the AP name matches.


- Generate the `FeederUnit` (`INVENTORY`) and the `Controller` (MAC, `tokenHash`). The plaintext token is shown **once** and flashed into NVS. It is never stored in the DB: the plaintext `EnergyDevice.token` column is dropped in M4 under the section-6 contract rule.
- Firmware reads `device_id` and `device_token` from NVS. `#define DEVICE_TOKEN` and the MAC hardcoded in URLs are removed. Jeff can reflash existing units.
- Print the serial and a QR claim code on the unit. The claim code is random with 128 bits of entropy, stored as SHA-256, single-use, expires 90 days after `ASSIGNED` **(assumption)**, and rate-limited by the existing PostgreSQL limiter (D1).

### 5.2 Self-claim (farmer)

1. Farmer opens the app → **Add feeder** → scans the QR → picks a farm and pond (or leaves it unplaced).
2. Server: verify claim hash → set `FeederUnit.orgId/pondId`, status `CLAIMED` → open a `FeederInstallation` → consume the claim code → write a `DeviceStateEvent`.
3. Farmer powers the unit. With no WiFi stored, it starts SoftAP `PakaonAI-XXXX` (T17: last 4 hex digits of the eFuse MAC) and serves a form at `192.168.4.1` asking for **SSID and password only**. Identity is already in NVS (EMS blank-field fallback).
4. First authenticated heartbeat → status `INSTALLED` → `ACTIVE` after the first schedule sync ack.

### 5.3 Dual reset buttons (EMS pattern, new pins)

| Button | GPIO **(proposed, verify on the board)** | Long press | Preserves |
|---|---|---|---|
| WiFi reset | **18** | 5 s: clear app NVS WiFi keys **and** call `esp_wifi_restore()`, then reboot into SoftAP | device id, token, calibration, schedule cache |
| Factory reset | **19** | 10 s: clear the whole NVS namespace | nothing; needs re-flash or re-provision by Syntaxure |

GPIO 18 and 19 are not strapping pins (0, 2, 5, 12, 15), not input-only (34–39), not flash pins (6–11), and not used by current firmware (S8). They support `INPUT_PULLUP`. **Factory reset wipes identity**, so for a customer-owned unit the server must allow re-binding of the same serial by superadmin only.

### 5.4 Controller replacement (EMS conflict #2, closed by design)

`replaceController(feederUnitId, newMac)` runs in **one transaction**: old controller → `REVOKED` (`revokedAt`), new controller row → `ACTIVE`, close the installation (`CONTROLLER_REPLACED`) and open a new one with the same org and pond. Ingest rejects tokens of `REVOKED` controllers. A test proves the old token gets 401 immediately.

---

## 6. Safety precedence (ADR-PK-05)

```
Superadmin / tenant UI command
   ↓  server rules (feed-command route): daily ceiling ≤5,000 g/day or hopperCapacityG
      (the only gram cap; 5,000 g is also the payload sanity bound), relay window
   ↓  firmware caps: ≤300,000 ms dispense, ≤1,000 g per dose, hopper-empty → feed_refused
   ↓  motor
```

Superadmin god mode **never** bypasses server caps or firmware caps. There is no "force" flag. A remote command to a feeder whose hopper reads empty produces `feed_refused`, and that is the correct outcome. Any future "remote reset" of a refusal requires human acknowledgment and can never override an active local safety condition (EMS #8).

**Contract (destructive) steps that need a human OK in chat:** dropping `EnergyDevice.token` (M4.3), dropping `Farm.ownerId @unique` (M2.8), retiring `UserRole` from authorization (M2.5; the enum itself stays), and the first real purge job run (M7.4).

---

## 7. Commercial model (T11, T12)

### 7.1 Flow

1. An Owner or Admin records a **Dispatch**: date, pond, weight, price/kg, buyer, and at least one proof photo (receipt or weighing slip). `grossCentavos` is computed server-side.
2. The server snapshots the biomass estimate for that pond (fish samples × population, existing model) and computes `varianceBps`.
3. If |variance| > threshold (**open, O4**; proposed 25%), status → `FLAGGED` and the dispatch goes to the superadmin **verification queue**. Otherwise `VERIFIED`.
4. A `VERIFIED` dispatch writes a `LedgerEntry(COMMISSION) = gross × rateBps / 10,000`, using the `CommissionAgreement` active on `dispatchedAt`.
5. At cycle close, if the commissions are below `minimumPerCycleCentavos` (**open, O3**), a `MINIMUM_TOPUP` entry is added.
6. Closing a `ServiceTicket` writes `SERVICE_FEE` (T12, on top of commission).
7. A monthly `Statement` aggregates the ledger. Payments are recorded manually first. A PayMongo/Xendit integration is out of scope for this plan.

### 7.2 Unit economics (illustrative, not a forecast)

Inputs: BOM ₱20,000/unit (T14). Farmgate ₱150/kg planning price (Luzon 2026 range ₱130–180/kg; wiseph.net hito guide). Grow-out cycle 4.5 months (same source). Revenue arrives **only at harvest**, so payback is counted in whole cycles. Operating cost per unit (cloud, connectivity, support) is **excluded (unknown)**, so real payback is longer than shown.

| Harvest per cycle per unit | Gross/cycle | 3% | 5% | 8% |
|---|---|---|---|---|
| 500 kg | ₱75,000 | 9 harvests ≈ 40.5 mo | 6 ≈ 27 mo | 4 ≈ 18 mo |
| 1,000 kg | ₱150,000 | 5 ≈ 22.5 mo | 3 ≈ 13.5 mo | 2 ≈ 9 mo |
| 1,500 kg | ₱225,000 | 3 ≈ 13.5 mo | 2 ≈ 9 mo | 2 ≈ 9 mo |
| 3,000 kg | ₱450,000 | 2 ≈ 9 mo | 1 ≈ 4.5 mo | 1 ≈ 4.5 mo |

What this means: under about 1,000 kg per cycle per unit, a leased unit takes more than 2 years to recover its hardware cost at 3–5%. Small backyard ponds need either a higher rate, a per-cycle minimum, or a customer-owned unit. The yield per unit is the most important number to measure in pilot trials.

---

## 8. Phases

### Phase M0: Safety net and blockers

| ID | Task | Acceptance |
|---|---|---|
| M0.1 | Resolve **O1** (unit name) and **O2** (defense date and scope) with Jeff. | Written answer in chat, recorded in §11. |
| M0.2 | Confirm backups (hardening plan H7) and run every M1/M2 migration on the **dev** Supabase project first. | H7 ticked; dev migration log attached to the PR. |
| M0.4 | *(v2, T18)* Jeff checks RLS and Data API exposure of the platform tables (N1). If exposed: additive `ENABLE ROW LEVEL SECURITY` hotfix migration, its own PR, explicit OK, following the `20261013020000` pattern. | Advisor/SQL output pasted in the PR. After the fix, anon key cannot read `PlatformAdmin`. |
| M0.5 | *(v2)* Separate dev Supabase project for testing write paths, since previews share production (hardening plan H8). | Device registry create/rotate is tested there, never on a preview. |
| M0.3 | Add a tenancy negative-test harness: two seeded orgs (A, B), each with a farm, a pond, a feeder and telemetry, plus a helper `expectNoCrossOrgAccess(fn)`. | Harness runs in `pnpm test`, with zero tests yet. |

### Phase M1: One-way doors (additive schema)

| ID | Task | Acceptance |
|---|---|---|
| M1.1 | Add Organization, Membership, MembershipPermission, PlatformAdmin, PlatformAuditLog (+ append-only trigger), ImpersonationSession. | `migrate deploy` on dev succeeds. An UPDATE or DELETE on PlatformAuditLog raises an error. |
| M1.2 | Add FeederUnit (with `ownershipParty` **separate** from status/assignment) and FeederInstallation. | Schema review confirms no field carries two meanings. |
| M1.3 | Add `orgId` to Farm and Pond, and `orgId`, `feederUnitId`, `installationId` to the 9 telemetry tables. Replace the stamp trigger with `stamp_telemetry_ownership()`. | Insert tests: a row inserted via a device gets all four stamps. An explicit stamp is respected. |
| M1.4 | Backfill: every existing User with a farm → one `INDIVIDUAL` org (name = farm name) + `OWNER` membership + permissions. Every `ADMIN` user → `PlatformAdmin` row. Every `EnergyDevice` → one `FeederUnit` (`PROVIDER` for demo units **(confirm)**) + an open installation. Backfill the telemetry `orgId` from `farmId` → `Farm.orgId`. | Counts match: orgs = farms; null `orgId` on telemetry only where `farmId` was null. Re-running is a no-op (idempotent). |

### Phase M2: Authorization cutover

| ID | Task | Acceptance |
|---|---|---|
| M2.1 | `lib/auth/access.ts`: `resolveAccess(user, resource, permission)` with the four gates (§4.1). | Unit tests for each gate failing. |
| M2.2 | `lib/db/tenant.ts`: `forOrg(orgId)` Prisma extension (§4.3, Layer 1). | Test: `forOrg(A).pond.findMany()` never returns B's ponds. A write with a mismatched `orgId` throws. |
| M2.3 | Convert every dashboard route and server action to `resolveAccess` + `forOrg`. Replace every `farmIdFromEmail` use (S9). | grep finds no `farmIdFromEmail` outside `session.ts` tests. |
| M2.4 | Org switcher in the dashboard header, for users with more than one membership. The active org is stored in a signed cookie and re-validated on every request. | A user in 2 orgs can switch, and a forged cookie gets 403. |
| M2.5 | Move god-mode checks from `requireRole("ADMIN")` to `requirePlatformAdmin`. **Needs a human OK** (§6). | No `requireRole("ADMIN")` remains in `lib/actions`. |
| M2.6 | Negative tests: one per tenant model, plus every API route, using the M0.3 harness. | All pass. The self-check rule from §4.3 is active. |
| M2.7 | Org settings page for tenants: members, invite by email, roles, `control_feeder` toggle per member. | Owner can invite and revoke; a Viewer can't see the page. |
| M2.8 | Contract step: drop `Farm.ownerId @unique` so one org can have several farms. **Needs a human OK.** | Farm create works for an org with an existing farm. |

### Phase M3: Superadmin console core (`/superadmin`)

| ID | Task | Acceptance |
|---|---|---|
| M3.1 | Rename `(admin)` to `(platform)` at `/superadmin`. Layout gate is `requirePlatformAdmin`, enforced in `proxy.ts` and again in the layout (defense in depth, EMS phase 5). | A non-admin gets 404 (not 403) at both layers. |
| M3.2 | `withPlatformAction({ action, reason, stepUp })` wrapper: validates the reason (≥10 chars), checks step-up freshness (5 min), writes the audit row in the same transaction. | Test: an audit insert failure rolls back the action. |
| M3.3 | Step-up dialog: re-enter PIN or password, sets a short-lived signed `stepup` cookie. | Expired step-up → the dialog appears again. |
| M3.4 | **Overview:** tenants by status, active feeders, offline feeders, feeders in MAINTENANCE, dispatch volume, commission accrued this month. | Numbers match direct SQL counts on seeded data. |
| M3.5 | **Tenants:** list, search, create org + invite owner, view a tenant (farms, ponds, feeders, members, billing), suspend / reactivate. | Suspend blocks tenant writes within 1 request. |
| M3.6 | **Users:** global search, memberships, unlock (lockout), reset PIN, revoke sessions. | Each action audited. |
| M3.7 | **Audit explorer:** filter by actor, org, action, date; export CSV. | Temporary-grant rows visually distinct. |
| M3.9 | *(v2)* Quick fixes: `listAllPonds` org mapping (N5) with a test; real `targetType`, `orgId`, `ip`, `userAgent` on audit rows (N4); pagination on superadmin lists (N10). | Test proves the Organizations column is filled. Audit rows carry target and org. |
| M3.10 | *(v2)* Safe user delete (N3): type-the-farmId confirmation and step-up; disable first (auth ban + revoke memberships), hard purge later through M7. | A deleted user can be restored until purge. |
| M3.11 | *(v2)* Behavioural tests for every superadmin mutation, and i18n for the superadmin pages (N10). | Each action has an allow, a deny and an audit-row test. |
| M3.8 | **Platform admins and demo grants (T10):** grant with `expiresAt`, revoke, fail-closed expiry check, access log, persistent banner "Temporary superadmin, expires …". | An expired grant gets 404 on the next request with no cached pass. |

### Phase M3F: Device registry v1 (v2, now, no schema change)

Runs on today's `EnergyDevice` model, before M1.2. Branch `feature/superadmin-device-registry`. It reuses the sticker from PR #174, so it is **stacked on PR #174** until that merges.

| ID | Task | Acceptance |
|---|---|---|
| M3F.1 | `/superadmin/devices`: every device with MAC, label, org, pond, last seen; search; paginated. Includes legacy devices with no pond. | Platform admin sees all; a tenant admin gets 404. |
| M3F.2 | **Register device** (T15): eFuse MAC (canonicalised, validated, unique case-insensitive, P2002 handled), label, org → pond picker built from the org's member farms (same chain as `resolveOrgScope`). Server action in `lib/actions/platform/devices.ts`, reason required, `PlatformAuditLog` row (`platform.device.create`, `targetType: "energy_device"`, `orgId`, `after: {mac, label, pondId}`, **never the token**). | Duplicate MAC rejected with a clear message; pond outside the chosen org rejected; audit row written in the same transaction. |
| M3F.3 | Token issued with `generateDeviceToken()`; `tokenHash` stored; plaintext stored only because of T16. Shown after creation with copy and an "I have set it on the unit" acknowledgement; never logged, never in a page payload. | Test: token absent from logs, RSC payload and audit row. Device authenticates with it (`verifyDeviceToken`). |
| M3F.4 | **Print sticker** from the superadmin side, right after registering and from the list: platform-gated print route reusing `DeviceSticker`, allow-listed select (no `token`/`tokenHash`). | Same no-credential tests as the tenant sticker. |
| M3F.5 | Audit and rate-limit token reveals (T16): tenant `revealDeviceToken` writes a `DeviceStateEvent` `token_revealed` with the actor; superadmin reveal writes `PlatformAuditLog`; both use the existing PostgreSQL rate limiter. | Each reveal leaves exactly one audit entry; the limit returns a clear error. |
| M3F.6 | **Rotate token** (superadmin, reason, audit): new token and hash, old token gets 401 immediately. | Test: old token rejected, new accepted. |
| M3F.7 | Docs: the registration → flash identity → print → AP-name check procedure in `firmware/README.md` and `HANDOFF.md`. | Reviewed by Jeff. |

### Phase M3C: Platform Command Center (v2.2, T24 to T26)

Tracked as issue #479. Source: Jeff's redesign proposal in chat, 2026-11-01. The landing page of `/superadmin` stops being an analytics overview and becomes the page that answers, in order: **what is happening, what is wrong, what should I do.** A third-party MSP dashboard screenshot was shared as a layout reference only; nothing from it (name, logo, copy, data) is reused. The numbers in the original proposal are illustrative placeholders, so every figure on the page comes from a query.

Runs on today's data: only M3C.6 changes the schema. Verified on `origin/develop` @ `fc727bb` (v1.42.1), 2026-11-01.

**Today versus target**

| Section | Exists today **(verified)** | Gap |
|---|---|---|
| A. Global platform status | Overview has eight KPI cards (`getPlatformAnalytics`). Operations > Health has job counts, the oldest queued job, cron activity and a device list (`getSystemHealth`). | No single verdict. Platform, tenant, device and security health are not separated. No "checked at". |
| B. Tenant health | Organizations list and detail page; suspend and restore control with step-up and audit (`setOrganizationStatus`). | No per-organization row: members, ponds, feeders, online %, last activity, open alerts. |
| C. Device fleet | `/superadmin/devices` registry (org, pond, feed level, last seen, sticker). `EnergyDevice` holds `lastSeenAt`, `wifiRssiDbm` and the feed-level and water-temperature timestamps. Firmware version comes from `firmware_reported` events (`lib/device-firmware.ts`). Faults and safe mode come from `device_health` events (`lib/device-health-model.ts`). | No superadmin page reads the `device_health` events (checked: no import under `(superadmin)`). Uptime is not stored. No "last successful feed" or per-reading freshness column. Numeric error codes do not exist; fault names do. |
| D. Incident center | Per-pond `Notification` (tier, category, acknowledge, auto-clear), `ErrorEvent` (resolved flag), failed `BackgroundJob` rows, offline devices computed on the fly (`evaluateDeviceStatus`). | None of these is an incident: no owner, no timeline, no lifecycle, no dedupe across sources. |
| E. Analytics | Signups, feeds by source, kg dispensed, device split, alerts by type, top FCR, over 7, 30 or 90 days. | No per-organization comparison. No registered versus active view. No connectivity trend, because no heartbeat history is stored. |
| F. Security and oversight | Audit explorer (action, actor and org filters), step-up dialog, view-as sessions, AI provider keys with step-up, device approval counts. | No single oversight panel. No test proving every destructive action needs step-up. No MFA enrolment anywhere (N2, verified 2026-10-26, not re-checked). |
| Scopes | The red view-as banner covers the tenant scope. | No global or resource banner. |

**Navigation (proposal).** The sidebar has nine flat items today. It regroups into three, with existing URLs unchanged:

| Group | Items |
|---|---|
| Command Center | Overview, Incidents (new), Fleet monitor (new), Analytics (new, P2) |
| Ecosystem Management | Organizations, Users, Ponds, Devices (registry and provisioning), Calendar |
| Platform Control | Operations (jobs, errors, firmware, announcements), Audit, AI providers, Settings |

The Fleet monitor and the Devices registry share one data layer and link to each other; they are two views, not two copies. Operations > Health becomes the detail page behind the Platform status band.

**Tasks**

| ID | Task | Acceptance | Priority |
|---|---|---|---|
| M3C.1 | **Scope banner and nav regroup.** A banner shows the path, e.g. `GLOBAL SUPERADMIN → ORGANIZATION ALPHA → FEEDER 3B09`, on console, org and device pages. The view-as banner keeps its meaning (a live session). Strings in `en`, `hil` and `tl`. **Built (E72):** the path shows global and section crumbs on console pages and global then organization on an org page; the sidebar has the three groups with the nine existing links. Device pages show `GLOBAL SUPERADMIN → DEVICES` until a per-device page exists; the banner already takes a third, resource crumb for it. | Nav test lists the three groups. Locale parity test passes. Every existing URL still resolves. The banner path is correct on an org page and a device page. | P0 |
| M3C.2 | **Status bands:** Platform, Tenants, Devices, Security, each OK, Degraded, Critical or Unknown, with its rule table shown and a "checked at" time. Inputs: platform = failed jobs, oldest queued job, cron freshness, unresolved errors; tenants = organizations by status; devices = the configured `device.status` policy buckets; security = active lockouts, temporary grants near expiry, platform admins without MFA. | Unit test per rule. A source that fails or is stale gives Unknown, never OK. The thresholds shown are the configured ones, not copies. | P0 |
| M3C.3 | **Tenant health table**, worst first, sortable, paginated: status, members, ponds, feeders, online %, last activity, open alerts, active incidents. | Numbers match direct SQL on seeded data. Needs the org-to-pond mapping fix (M3.9, N5). | P0 |
| M3C.4 | **Fleet monitor:** last heartbeat, RSSI with bars, firmware version, last successful feed, freshness of feed level, water temperature and RSSI, state, faults and safe mode. | A missing value reads "Not reported", never 0 and never green. Uptime and numeric error codes stay "Not reported" until #454 lands. No token field is selected. | P0 |
| M3C.5 | **Incident read model**, no schema change: one queue over offline devices, failed jobs, unresolved errors, un-acknowledged critical notifications and safe-mode faults, with severity and age, deduplicated by (type, subject). | The same condition is never listed twice. Each row links to its source. | P0 |
| M3C.6 | **Incident lifecycle:** additive tables `PlatformIncident` and `PlatformIncidentEvent`; states New, Acknowledged, Investigating, Resolved, Escalated; auto-open and auto-resolve from the device watch; every transition audited with a reason. **Blocked on O19 and O20.** | A repeating condition does not open a second incident. Auto-resolve writes a timeline note. RLS enabled on both tables (the N1 lesson). Backup taken before the migration. | P0 |
| M3C.7 | **Security and oversight panel:** latest audit rows, org suspend and restore, device approval queue, AI provider key source, platform admins with expiry and MFA state. | A test lists every destructive action reachable from the command center and asserts step-up on each. MFA shows "not enrolled" while N2 stands. | P1 |
| M3C.8 | **Visual system:** Inter, 8 px spacing scale, dark monitoring panels on a light page, the brand orange as the accent, red, amber and green reserved for status, AA contrast (O17). Depends on #477 and O23. | Contrast check on every status colour in both themes. Status is never colour alone (icon and text). | P1 |
| M3C.9 | **Per-organization comparison:** feed volume, FCR and online % side by side. Global configuration is M5.3 and is not re-planned here. | Same numbers as the tenant table for the same window. | P1 |
| M3C.10 | **Registered versus active** entities and connectivity trends. **Blocked on O22 and O24.** | Trend query reads stored history only; nothing is estimated. | P2 |

**Guardrails for this phase**
- No firmware change here. Uptime, numeric error codes and `safety_trip` incidents wait for #454 and #455. Flashing needs Jeff's explicit yes each time.
- Reuse the existing data layers (`getPlatformAnalytics`, `getSystemHealth`, `evaluateDeviceStatus`, `listPlatformDevices`, `getDeviceHealth`); do not add a second copy of the offline thresholds.
- No state is shown green without a fresh reading. Unknown and Not reported are first-class states *(proposed rule, Claude)*.
- Every page sits behind `requirePlatformAdmin` in the layout and in the page. Mutations keep reason, audit row and step-up where §4.4 requires it. Never expose `token` or `tokenHash`.
- Only M3C.6 migrates: additive, full backup first, `migrate deploy` only.
- Stay inside the bundle budget and latency CI checks; no client polling in P0. A server-side cache of up to 60 s per section is an **(assumption)** to measure before relying on it.

**Dependencies:** #454 (heartbeat `diag`), #455 (`safety_trip`), #456 (hopper threshold push), #477 (theme toggle), M3.9 (org mapping and pagination; the audit explorer already filters by org, so part of it has landed **(inference)**, re-check when M3C.3 starts), M5.3 (global configuration).

### Phase M4F: Remote firmware updates (v2.1, T21)

Design: `docs/firmware-ota-plan.md`. It builds on our own stack: a private Supabase Storage bucket, a `/api/firmware/check` endpoint using device-token auth, signed manifests (offline ECDSA P-256 key), A/B slots with rollback, and staged rollouts from superadmin.

Integrator findings (verified 2026-10-26):
- The default partition table already has two OTA slots. The app is 82.6 % full.
- The firmware trusts only ISRG Root X1. Production `optifeed.syntaxure.dev` validates today only through the Let's Encrypt Root YR → ISRG X1 cross-sign, which the Gen Y transition can remove. The OTA build must carry several roots before that happens.

Open decisions OTA-1…OTA-7 are listed in the design doc §8. Tasks: T-12a firmware bootstrap build (human OK + one last flash), T-12b server without schema change, T-12c migration + rollout UI.

### Phase M4: Fleet and provisioning

| ID | Task | Acceptance |
|---|---|---|
| M4.1 | **Fleet** page: inventory by status, ownership party, org, firmware version, last seen. Create units in batches (factory flash), showing the token once. | Plaintext token is never persisted. |
| M4.2 | Claim codes + QR sheet (printable PDF/PNG per unit). Tenant **Add feeder** flow (§5.2). | E2E: claim → pond binding → installation row. A second use of the same code fails. |
| M4.3 | Firmware: identity from NVS, SoftAP captive portal (`PAKAON-XXXX`), blank-field fallback, WiFi and factory reset buttons on GPIO 18/19 (§5.3). Drop the `EnergyDevice.token` column (**human OK**). | BUILD-VERIFIED **and** PHYSICALLY-VERIFIED reported separately (EMS rule). |
| M4.4 | Move calibration fields to `FeederUnit` (copy, dual-read, switch). | Calibration survives a controller replacement. |
| M4.5 | `replaceController` transaction (§5.4) and `decommission`. | The old token gets 401 immediately. History is continuous across the swap. |
| M4.6 | Cross-org reassignment, superadmin only, provider-owned only (§3.4). | A customer-owned unit is blocked with a clear message. |
| M4.7 | Installation history visibility (EMS ADR-07): tenants see only rows with their own `orgId`. Superadmin sees all. | Negative test: org B can't see org A's earlier installation of the same unit. |

### Phase M5: God-mode operations

| ID | Task | Acceptance |
|---|---|---|
| M5.1 | **View-as:** start an impersonation session (reason, mode). READ_ONLY by default; READ_WRITE needs step-up. 30 min expiry. Red banner with an exit button. Every request during the session is tagged with `impersonationId`. | Writes in READ_ONLY are rejected. All actions show in the audit log under the real actor. |
| M5.2 | **Remote feeder control:** manual feed, pause/resume, push schedule on any feeder, through the existing feed-command and schedule-sync paths with the caps in §6. | Commands over the caps are rejected server-side. `feed_refused` is displayed. |
| M5.3 | **Global config:** feeding formula constants (Sir Roy formula parameters), alert thresholds (offline, pellet low/critical), with per-org overrides. Effective value = override ?? global ?? code default. | Changing a threshold changes alert behavior without a deploy. |
| M5.4 | **Feature flags per org**, e.g. `ai_chat`, `dispatch_billing`, `telegram_alerts`. | A disabled flag hides the UI and blocks the API. |

### Phase M6: Commercial module

| ID | Task | Acceptance |
|---|---|---|
| M6.1 | CommissionAgreement CRUD (superadmin, step-up). Rate history is preserved and never edited in place. | Changing the rate creates a new agreement row. |
| M6.2 | Tenant **Record dispatch** form with proof upload (org-scoped storage path). | Gross is computed server-side. Client-supplied gross is ignored. |
| M6.3 | Variance check against the biomass estimate. Superadmin verification queue (verify / dispute with reason). | Flagged dispatch → no commission entry until verified. |
| M6.4 | Ledger + monthly statements (superadmin issues, tenant views). Manual payment recording. | Ledger is append-only. Adjustments are new rows with a reason. |
| M6.5 | Service tickets, linked to a feeder unit. Closing a ticket bills `SERVICE_FEE`. Feeder → `MAINTENANCE` while open. | Ticket fee appears on the next statement. |

### Phase M7: Data lifecycle

| ID | Task | Acceptance |
|---|---|---|
| M7.1 | Tenant self-export: ponds, telemetry, biomass, dispatches, ledger as CSV/ZIP. | Export contains only that org's rows (negative test). |
| M7.2 | Suspend: writes blocked, export still allowed, devices keep feeding on the cached schedule. Fish must not starve because of a billing state. | Firmware keeps its local schedule. Server stops accepting new schedule pushes. |
| M7.3 | Deletion request → `PENDING_DELETION`, `purgeAfter = now + 30 days` **(assumption, O5)**, owner notified, superadmin can cancel. | Cancel restores `ACTIVE` with no data loss. |
| M7.4 | Purge job (`pg_cron`): hard-delete users and memberships for that org, PII in dispatches (buyer fields), proof files. Close installations. Provider-owned units → `INVENTORY`, with telemetry kept anonymized by `orgId` stamp. Customer-owned telemetry is deleted. **First real run needs a human OK.** | Dry-run report first. After the run, no PII rows remain for the org. |

### Phase M8: Commercial-readiness gate

| ID | Task | Acceptance |
|---|---|---|
| M8.1 | TOTP MFA for all PlatformAdmins (T13), with recovery codes. | Login without TOTP is impossible for a PlatformAdmin. |
| M8.2 | Credential rotation (device token rotate endpoint; superadmin forced password rotation) + secure recovery via Resend from a provider domain. | Rotated token works; old token gets 401. |
| M8.3 | Layer 2 isolation: `app_tenant` role + RLS policies on `current_setting('app.org_id')` (§4.3). | The negative suite passes with the app connected as `app_tenant`. |
| M8.4 | Human: contract template for revenue share + maintenance, Data Privacy Act review (privacy notice, retention statement), legal check that the revenue share isn't treated as financing. | Signed off by Jeff and a lawyer. Not something an AI can complete. |

---

## 9. Order of PRs (each from its own branch to `develop`)

**v2 near-term queue (2026-10-26), ahead of the v1 list below:**

1. PR #174 `feat(admin): power-rating sticker` + `feat(firmware): PakaonAI-XXXX setup AP` (**needs human OK, reflash**). v2 adds: the AP name from the eFuse MAC (T17). Keep the compile-time `device_id` fallback for now so the demo unit keeps authenticating after the reflash; moving the default `device_id` to the eFuse MAC needs the demo unit re-provisioned and its DB MAC updated (a production data change, human OK).
2. `fix(db): enable RLS on platform tables` (M0.4), **only if** Jeff's check shows exposure. Additive migration, explicit OK.
3. `feat(superadmin): device registry v1` (M3F.1–M3F.4, M3F.6), stacked on #174.
4. `feat: audit and rate-limit token reveals` (M3F.5).
5. `fix(superadmin): ponds org mapping, audit fields, pagination` (M3.9).
6. `feat(superadmin): step-up re-auth` (M3.2, M3.3), then safe user delete (M3.10).
7. Firmware PR: per-unit SoftAP password or proof-of-possession printed on the sticker (N9), default `device_id` from the eFuse MAC, remove the shared fallback token. **Human OK, reflash.**

Then continue with the v1 order below, skipping what §2a lists as built.

**v2.2 Command Center queue (2026-11-01, issue #479), alongside the queue above:** (a) `feat(superadmin): theme toggle on the top bar` (#477, independent, unblocks M3C.8); (b) M3.9 if it has not fully landed (prerequisite for M3C.3); (c) M3C.1 scope banner and nav; (d) M3C.2 and M3C.4 together (read only); (e) M3C.3; (f) M3C.5; (g) M3C.6 as its own migration PR, only after O19 and O20 are answered and a backup is taken; (h) M3C.7, M3C.8, M3C.9; (i) M3C.10 last. Each is a small PR into `develop`.

**v1 order:**


1. `test: tenancy negative-test harness` (M0.3)
2. `feat(db): organizations, memberships, platform admin, audit log` (M1.1)
3. `feat(db): feeder units and installations` (M1.2)
4. `feat(db): org and unit ownership stamps` (M1.3)
5. `chore(db): backfill orgs, memberships, feeder units` (M1.4)
6. `feat(auth): resolveAccess and forOrg tenant client` (M2.1, M2.2)
7. `refactor: route and action cutover to org scope` (M2.3, M2.6)
8. `feat: org switcher and org settings` (M2.4, M2.7)
9. `feat: platform admin gate` (M2.5, **human OK**) then `feat(db): allow multiple farms per org` (M2.8, **human OK**)
10. `feat(superadmin): console shell, actions, step-up, audit explorer` (M3.1 to M3.3, M3.7)
11. `feat(superadmin): overview, tenants, users, demo grants` (M3.4 to M3.6, M3.8)
12. `feat: fleet, claim codes, add-feeder flow` (M4.1, M4.2)
13. `feat(firmware): NVS identity, captive portal, reset buttons` (M4.3, separate firmware PR)
14. `feat: calibration on unit, controller replacement, reassignment` (M4.4 to M4.7)
15. `feat(superadmin): view-as, remote control, config and flags` (M5.x)
16. `feat: dispatch, commission, ledger, service tickets` (M6.x)
17. `feat: export, suspend, deletion grace, purge` (M7.x, purge run **human OK**)
18. `feat: MFA, rotation, recovery, app_tenant RLS` (M8.1 to M8.3)

**Suggested defense cut (pending O2):** PRs 1 to 12 + M5.1 + M5.2. That demonstrates real multi-tenancy, a god-mode console with audit and step-up, self-claim provisioning, and view-as. Commercial (M6) can be demoed with seeded data if time is short.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Cross-tenant leak through a missed query (app layer is the only barrier, S3) | **High** | Layer 1 `forOrg` + self-check import rule + per-model negative tests (M2). Layer 2 RLS at the commercial gate (M8.3). |
| Backfill (M1.4) maps a farm to the wrong org | High | Idempotent script, dry-run diff, run on dev first, counts asserted. |
| Ownership semantics overloaded again (the EMS `owner_type` mistake) | Medium | `ownershipParty` has one meaning only. Schema review in M1.2 acceptance. |
| Under-reported dispatch revenue | **High (business)** | Proof photos, biomass variance flag, verification queue, minimum per cycle (O3). |
| Cash gap: ₱20k per leased unit with revenue only at harvest (4.5 mo minimum) | High (business) | Per-cycle minimum, target ≥1,000 kg/cycle ponds for leases, customer-owned option for small farms. |
| Suspension starving fish | High (animal welfare) | Suspend never stops local schedules (M7.2). |
| Superadmin compromise (pre-MFA during the defense) | Medium | Audit, step-up, demo-grant expiry. MFA mandatory before the first paying tenant. |
| Branch drift across `develop`/`staging`/`main` | Medium (realized in EMS) | Full-clone divergence check before every phase report. |
| Self-reported "verified" claims | Medium (realized in EMS) | Every report separates CODE / BUILD / DEPLOYMENT / PHYSICALLY verified. |
| *(v2)* Platform tables reachable through the Data API (N1) | **Critical if exposed** | M0.4 check now; additive RLS hotfix with explicit OK. |
| *(v2)* Testing write paths mutates production (previews share the DB) | **High** | M0.5 dev project; mocked unit tests until then; never exercise create/rotate on a preview. |
| *(v2)* Open SoftAP portal lets anyone nearby overwrite a unit in setup mode (N9) | High | Firmware PoP/password on the sticker (§9 v2 item 7); keep setup windows short. |
| *(v2.1)* Devices trust a single TLS root (ISRG X1); a CA change could cut every unit off from the server and from any remote fix | **High** | The OTA bootstrap build carries several roots (`docs/firmware-ota-plan.md` §3.3); watch Let's Encrypt Gen Y. |
| *(v2)* Plaintext tokens stay in the DB longer because of T16 | Medium | Audit and rate-limit every reveal (M3F.5); rotate on suspicion (M3F.6); M4.3 drop after reflash. |

---

## 11. Open questions (block the listed tasks)

| ID | Question | Blocks |
|---|---|---|
| O1 | Final name for the feeder unit (placeholder `FeederUnit`). | M1.2 |
| O2 | Capstone defense date, and which phases must be live for it. | Defense cut in §9 |
| O3 | Commission rate(s), and whether there is a per-cycle minimum. Units sold outright: same percentage, or a separate software fee? | M6.1 |
| O4 | Dispatch variance threshold that triggers manual verification (proposed 25%). | M6.3 |
| O5 | Deletion grace period (proposed 30 days) and how long anonymized telemetry from provider-owned units is retained. | M7.3, M7.4 |
| O6 | Are existing demo units provider-owned? | M1.4 |
| O7 | Claim code expiry (proposed 90 days). | M4.2 |
| O8 | Per-unit operating cost (cloud, SIM or WiFi, support), needed for a true payback figure. | §7.2 refresh |
| O9 | *(v2, **resolved by T19**)* T4 stands: superadmin has remote feeder control (with step-up, audit and the §6 caps). | — |
| O10 | *(v2)* When does staging/dev get its own database (M0.5)? | Safe testing of M3F, M7 |
| O11 | *(v2, **resolved 2026-10-26**)* RLS check done: no exposure (see N1). No hotfix migration needed. | — |
| O13 | *(v2.1, **decided 2026-10-26**)* Real email invites through Resend from the verified `syntaxure.dev` domain (e.g. `invite@syntaxure.dev`); the internal login domain `pond.optifeed.local` is to be renamed for PakaonAI (planned carefully: it changes existing users' login emails). Mission T-15. | M2.7 follow-up |
| O14 | *(v2.1, **confirmed by Jeff**)* Superadmin member management bypasses the tenant last-owner/self/ADMIN guards (god mode, T19). | — |
| O15 | *(v2.1, **confirmed by Jeff**)* Existing accounts keep their legacy `User.role` when their membership role changes, until `UserRole` is retired from authorization (M2.5). | M2.5 |
| O16 | *(v2.1, from T-15)* Target for the internal login domain rename (`docs/login-domain-rename-plan.md`): `pond.pakaonai.local` (recommended) or a routable subdomain; needs a migration window. | rename execution |
| O17 | *(v2.1, from T-09a)* White text on the brand orange `#E85A2A` is 3.54:1 (fails WCAG AA for small text); the admin console now uses `#C2410C` for text-bearing actions. Adopt one AA-safe orange app-wide? | T-09 follow-up |
| O18 | *(v2.1, from T-10)* Server actions return English error strings without stable codes (superadmin, platform devices/members/impersonation, step-up, ai-providers, password), so they show untranslated. Add stable error codes in a follow-up? | i18n follow-up |
| O12 | *(v2)* The benchmark rates missing MFA as High; T13 defers it to the commercial gate. Keep T13 as is, or pull MFA forward? (Not reopened here; Jeff's call.) | M8.1 timing |
| O19 | *(v2.2)* Incident storage: derive only, or add `PlatformIncident` and `PlatformIncidentEvent`? Recommendation: derive first (M3C.5), add the tables in M3C.6 with a backup first. | M3C.6 |
| O20 | *(v2.2)* What does "Escalated" do: who is told, and through which channel (email through Resend, a push, both)? | M3C.6 |
| O21 | *(v2.2)* Which conditions make a tenant Degraded and which Critical? M3C.2 proposes rules from the existing device policy; no composite health score is invented. | M3C.2, M3C.3 |
| O22 | *(v2.2)* What counts as "active" for registered versus active (proposed: one feed command or heartbeat in 30 days, **assumption**)? | M3C.10 |
| O23 | *(v2.2)* Superadmin theme: ship the #477 toggle first (recommended), or fix the console to light. | M3C.8 |
| O24 | *(v2.2)* Heartbeat history for uptime and connectivity trends: store it, for how long, and in what shape (shares the design of #454). | M3C.10 |

---

## 12. Definition of done

- Two orgs seeded on dev; the full negative suite passes; no `requireRole("ADMIN")`, no `farmIdFromEmail` in authorization paths.
- Every superadmin mutation leaves exactly one audit row with a reason; step-up enforced on the §4.4 list.
- A unit can be factory-flashed, claimed by QR, put on WiFi via the captive portal, reset via button, have its controller replaced, and be reassigned, with continuous history and no token reuse.
- A dispatch produces a commission entry only when verified; a closed service ticket produces a fee; a statement totals the ledger.
- A tenant can be suspended (fish still fed), exported, and purged with PII gone and provider-unit telemetry retained anonymized.
- Commercial gate (M8) is complete before the first paying tenant.

Sources: hito grow-out period and 2026 farmgate price range from the wiseph.net hito farming guide (https://wiseph.net/hito-farming-guide-philippines/). EMS patterns from `energy-monitoring-architecture-v3.html` (Syntaxure internal).

---

## Appendix A. Production-grade benchmark (v2, 2026-10-26)

Read-only research comparing the console against multi-tenant SaaS and IoT fleet practice. The gaps are folded into §2a, §8 and §9 above.

| Practice | What leaders do | PakaonAI | Planned in |
|---|---|---|---|
| Admin tables behind RLS | Supabase lint 0013: a `public` table without RLS is readable and writable by anyone with the project URL and anon key ([Supabase](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0013_rls_disabled_in_public)) | Off on platform tables (N1) | M0.4 |
| MFA for privileged admins | Supabase AAL2 checks ([Supabase](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel)); NIST re-auth limits ([NIST 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)) | None (N2) | M8.1 (T13, O12) |
| Step-up for sensitive actions | GitHub sudo mode ([GitHub](https://docs.github.com/en/enterprise-server@3.5/authentication/keeping-your-account-and-data-secure/sudo-mode)) | Reason only (N2) | M3.2, M3.3 |
| Show-once secrets, hash at rest, rotation | Stripe secret keys ([Stripe](https://docs.stripe.com/keys)) | Plaintext stored, reveal (T16) | M3F.5, M3F.6, M4.3 |
| Per-device credentials, registered before first connect | Golioth PSKs ([Golioth](https://docs.golioth.io/device-management/authentication)); Azure DPS ([Azure](https://learn.microsoft.com/en-us/azure/iot-dps/concepts-symmetric-key-attestation)) | Per-device token; shared firmware fallback | M3F, §9 v2 item 7 |
| Controlled provisioning | AWS IoT fleet provisioning with a pre-provisioning hook ([AWS](https://docs.aws.amazon.com/iot/latest/developerguide/provision-wo-cert.html)) | Seed scripts only (N6) | M3F, M4.1 |
| Provisioning portal auth | Espressif proof-of-possession in the QR ([Espressif](https://components.espressif.com/components/espressif/network_provisioning/versions/1.2.5/examples/wifi_prov)) | Open AP (N9) | §9 v2 item 7 |
| Claim and transfer between owners | Particle claiming ([Particle](https://docs.particle.io/getting-started/cloud/device-claiming/)) | `pondId` edit only | M4.2, M4.6 |
| Immutable audit with who/what/where, export | OWASP logging ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)); GitHub audit streaming ([GitHub](https://docs.github.com/en/enterprise-server@3.18/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/streaming-the-audit-log-for-your-enterprise)) | Append-only; fields missing, no viewer (N4) | M3.9, M3.7 |
| Support impersonation with reason and consent | WorkOS ([WorkOS](https://workos.com/docs/user-management/impersonation)) | None (safe) | M5.1 |
| Four-eyes for destructive actions | Google Workspace multi-party approval ([Google](https://workspaceupdates.googleblog.com/2024/04/multi-party-approvals-for-sensitive-admin-actions.html)) | None | Later; needs ≥ 2 platform admins |
| Just-in-time privileged access | Entra PIM ([Microsoft](https://learn.microsoft.com/graph/api/resources/privilegedidentitymanagementv3-overview)) | CLI time-boxed grants (N11) | M3.8 |
| Deletion grace period | AWS 90-day reopen window ([AWS](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-closing.html)) | Immediate hard delete (N3) | M3.10, M7.3 |
| Session lifetime limits | Supabase time-box and inactivity timeout ([Supabase](https://supabase.com/docs/guides/auth/sessions)) | Defaults | M8 (plan-tier dependent) |

## Change log

- **v2.2 (2026-11-01):** decisions T24–T26 (Platform Command Center, three scopes, reserved status colours); phase M3C with tasks M3C.1–M3C.10 and a today-versus-target table verified on `origin/develop` @ `fc727bb`; a Command Center queue in §9; open questions O19–O24. Tracked as issue #479. `docs/superadmin-multitenancy-portal.html` is still not updated.
- **v2.1 (2026-10-26):** decisions T19–T22 (god mode, staging/main-only deploys, OTA, reset buttons on GPIO 16/17), O9 resolved. Execution is tracked in `docs/missions/2026-10-26-autonomous-mission.md`.
- **v2 (2026-10-26):** decisions T15–T18 and the T7 amendment from Jeff in chat; §2a progress and findings N1–N11; branch rule updated to `CONTRIBUTING.md`; phase M3F (device registry v1) and tasks M0.4, M0.5, M3.9–M3.11; v2 near-term PR queue in §9; four new risks; open questions O9–O12; Appendix A benchmark. `docs/superadmin-multitenancy-portal.html` is not yet updated.
- **v1 (2026-10-17):** initial plan.
