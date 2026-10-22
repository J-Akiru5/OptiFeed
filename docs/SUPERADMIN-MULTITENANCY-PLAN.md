# PakaonAI: Superadmin and Multi-Tenancy Plan (v1)

> Status: **planning, not started.** Written 2026-10-17 against `origin/develop` @ `be77a18`.
> Pattern source: Syntaxure EMS Architecture v3 (WVSU energy monitoring), mapped onto PakaonAI.
> Human-readable version with diagrams and charts: `docs/superadmin-multitenancy-portal.html`.
> This file is written for the executing AI agent. It follows the same conventions as `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`.

Evidence labels used in this file:
- **(verified)**: checked directly in code or migrations on `origin/develop`.
- **(inference)**: likely, not directly checked. Confirm in code before relying on it.
- **(assumption)**: a planning number with no measured source yet. Replace with real data when available.
- **(open)**: needs Jeff's decision. Do not decide it yourself.

---

## 0. Instructions for the executing AI

**Hard rules (same as the hardening plan; they still apply):**
- Work only on branch `Karl`. Start with `git checkout Karl && git pull origin develop --rebase`. Open small PRs from `Karl` to `develop`. Never push to `develop`, `staging` or `main`.
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
| T7 | **Provisioning: farmer self-claim.** Each unit ships factory-flashed with its identity. The farmer scans a QR claim code in the app, which binds the unit to their org and pond. WiFi is entered through the captive portal. | Captive portal + dual reset buttons |
| T8 | **Oversight orgs (MAO, BFAR, co-op over members): deferred.** Keep `Organization.parentId` in the schema, but build no recursive access until a real customer needs it. | #7 |
| T9 | **Tenant deletion: revoke, retain, then purge.** Access is cut immediately and a data export is offered. Personal data is hard-deleted after a grace period. Anonymized telemetry from **provider-owned** units is retained. | #3 / ADR-08, tightened for the Data Privacy Act |
| T10 | **Demo carve-out: EMS-style.** Temporary superadmin grants have full powers, are time-boxed (`expiresAt`, checked fail-closed), have their own access log, and show a visible banner. Reason and step-up still apply to purge and device actions during a demo grant. | #9 / ADR-09 |
| T11 | **Business model: revenue share.** Farmers use the system for a percentage of **gross sales per dispatch**, where a dispatch is a harvest sold to a buyer or trader. | — |
| T12 | **Maintenance is billed per service, on top of the percentage.** | — |
| T13 | **Superadmin MFA (TOTP) is a commercial-readiness gate.** It is required before the first paying tenant and is not required for the capstone defense. | #6 |
| T14 | **Hardware BOM ≈ ₱20,000 per feeder unit** (Jeff's estimate). | — |

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

- Generate the `FeederUnit` (`INVENTORY`) and the `Controller` (MAC, `tokenHash`). The plaintext token is shown **once** and flashed into NVS. It is never stored in the DB: the plaintext `EnergyDevice.token` column is dropped in M4 under the section-6 contract rule.
- Firmware reads `device_id` and `device_token` from NVS. `#define DEVICE_TOKEN` and the MAC hardcoded in URLs are removed. Jeff can reflash existing units.
- Print the serial and a QR claim code on the unit. The claim code is random with 128 bits of entropy, stored as SHA-256, single-use, expires 90 days after `ASSIGNED` **(assumption)**, and rate-limited by the existing PostgreSQL limiter (D1).

### 5.2 Self-claim (farmer)

1. Farmer opens the app → **Add feeder** → scans the QR → picks a farm and pond (or leaves it unplaced).
2. Server: verify claim hash → set `FeederUnit.orgId/pondId`, status `CLAIMED` → open a `FeederInstallation` → consume the claim code → write a `DeviceStateEvent`.
3. Farmer powers the unit. With no WiFi stored, it starts SoftAP `PAKAON-XXXX` (last 4 hex digits of the eFuse MAC) and serves a form at `192.168.4.1` asking for **SSID and password only**. Identity is already in NVS (EMS blank-field fallback).
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
   ↓  server caps (feed-command route): ≤1,000 g/request, ≤5,000 g/day or hopperCapacityG
   ↓  firmware caps: ≤300,000 ms dispense, hopper-empty → feed_refused
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
| M3.8 | **Platform admins and demo grants (T10):** grant with `expiresAt`, revoke, fail-closed expiry check, access log, persistent banner "Temporary superadmin, expires …". | An expired grant gets 404 on the next request with no cached pass. |

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

## 9. Order of PRs (from `Karl` to `develop`)

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

---

## 12. Definition of done

- Two orgs seeded on dev; the full negative suite passes; no `requireRole("ADMIN")`, no `farmIdFromEmail` in authorization paths.
- Every superadmin mutation leaves exactly one audit row with a reason; step-up enforced on the §4.4 list.
- A unit can be factory-flashed, claimed by QR, put on WiFi via the captive portal, reset via button, have its controller replaced, and be reassigned, with continuous history and no token reuse.
- A dispatch produces a commission entry only when verified; a closed service ticket produces a fee; a statement totals the ledger.
- A tenant can be suspended (fish still fed), exported, and purged with PII gone and provider-unit telemetry retained anonymized.
- Commercial gate (M8) is complete before the first paying tenant.

Sources: hito grow-out period and 2026 farmgate price range from the wiseph.net hito farming guide (https://wiseph.net/hito-farming-guide-philippines/). EMS patterns from `energy-monitoring-architecture-v3.html` (Syntaxure internal).
