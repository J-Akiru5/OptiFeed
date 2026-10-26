# Autonomous mission 2026-10-26: superadmin god-mode, RBAC, hardening, E2E, UI/UX

Owner: Jeff. Orchestrator / integrator: Claude Code (this repository's main agent).
Workers: OpenCode CLI sessions, model **`opencode-go/deepseek-v4.1-flash` only**.
Governing documents: `CONTRIBUTING.md`, `HANDOFF.md`, `docs/SUPERADMIN-MULTITENANCY-PLAN.md` (v2),
and the owner's global OpenCode rules (`~/.config/opencode/AGENTS.md` + `instructions/`).

## Decisions recorded for this mission (Jeff, 2026-10-26)

| ID | Decision |
|---|---|
| D1 | **Superadmin is god mode for the whole application** (resolves plan O9: plan T4 stands). It includes managing any org's members and permissions, view-as, and remote feeder control. Guardrails stay: required reason, audit row, step-up for dangerous actions, and the §6 safety caps (no force flag; firmware caps still apply). |
| D2 | **Tenant RBAC in Settings**: org owners/admins grant and revoke access (members, roles, per-member permissions). |
| D3 | **Integration**: every task branch is reconciled into `integration/mission-2026-10-26`, verified there, and shipped as **one PR into `develop`**. Jeff merges it. Nobody merges into `develop`, `staging` or `main` during the mission. |
| D4 | **Workers** run with the owner's full global permissions. The one hard restriction: **no deployment to `main`** (and, per the repo, no push to `main`/`staging`). Workers push only their own task branch and never merge. |
| D5 | **Database (amended 2026-10-26)**: no Docker and no separate project. E2E and migrations run against the **production** Supabase project (`xjjnkikgkraixlfhhvoh`) while PakaonAI is not in operation (Jeff's go). Guardrails: a full backup before any migration, `prisma migrate deploy` only (never reset), E2E data prefixed `e2e-` and cleaned up afterwards, and workers never touch the database (the integrator runs DB steps). Staging shares this DB. |
| D6 | **Firmware buttons** *(swapped 2026-10-26 to match the soldered board)*: GPIO 17 = Wi-Fi reset, 5 s hold (keeps identity). GPIO 16 = factory reset, 10 s hold (wipes NVS). Both to GND with internal pull-up. |
| D7 | **Deployments: only `staging` (preview) and `main` (production).** `develop` is the reconciliation branch and is never deployed by any route (Vercel Git, CLI, SHA deploy, hook, CI). If a deployed preview is needed, promote `develop` to `staging`. Config change: PR #182. This overrides the global rule that `develop` deploys are pre-authorized. |
| D8 | **Watch the other local agents and worktrees** every loop iteration (`orchestrator.mjs inventory`), never edit them, and keep the single source of truth current: `docs/SUPERADMIN-MULTITENANCY-PLAN.md` for decisions and phases, this file for mission state. |
| D9 | **Offline PWA** (already built) gets hardened and its UX improved (T-11). |
| D10 | **Remote firmware updates (OTA)** for units far from any IT help: research first (subagent benchmark of ESP32 OTA, free and self-hostable options), then design and build (T-12). |

## Rules every worker follows

1. Work only in the worktree and branch you were given (`mission/T-xx-…`), based on `integration/mission-2026-10-26`. Never edit another worktree.
2. Before coding, read `apps/web/AGENTS.md`. This Next.js version differs from what you know; check `apps/web/node_modules/next/dist/docs/` when an API matters.
3. Match repo style: Biome (tabs, 100 columns, double quotes), Conventional Commits, Server Actions in `lib/actions/`. Every new or changed authorization path gets an allow test **and** a deny test. Platform actions call `requirePlatformAdmin()`, tenant actions `requireTenantAdmin()`, and both are scoped as in `lib/auth/org-scope.ts`.
4. Never weaken an existing guard or test to make something pass. Never log or return a secret, token or password, except a device token returned once by its issuing action.
5. Never deploy anything (D7): no `vercel` commands, no deploy hooks. No Prisma migration unless the task says so. Never run `prisma migrate reset`. Never touch the production database or production credentials.
6. Before you finish, run `pnpm lint`, `pnpm typecheck` and `pnpm test` from the repo root, and fix what you broke. Commit on your branch with Conventional Commits and push your branch. Do not open or merge PRs (the integrator does).
7. End with a report: what changed (files), tests added, the exact commands you ran and their results, anything not done, and open questions. Do not claim a check you did not run.

## Tasks

Status: `todo` / `running` / `review` / `integrated` / `blocked`.

| ID | Task | Depends on | Needs DB | Status |
|---|---|---|---|---|
| T-01 | Firmware reset buttons (D6) + sticker note | — | no | integrated, verified |
| T-02 | Token reveal audit + rate limit (plan M3F.5) | — | no | integrated, verified |
| T-03 | Superadmin quick fixes (plan M3.9) | — | no | integrated, verified |
| T-04 | Step-up re-auth + safe user delete (M3.2, M3.3, M3.10) | — | no | integrated, verified |
| T-05 | Tenancy negative-test harness + superadmin behavioural tests (M0.3, M3.11 tests) | — | no | integrated, verified |
| T-06 | RBAC: members and permissions in Settings, plus superadmin for any org (D1, D2, M2.7) | T-04 | no (mocked tests) | integrated, verified |
| T-07 | Superadmin god mode: view-as (read-only) + remote feeder control (D1, M5.1, M5.2) | T-04 | no (mocked tests) | integrated, verified |
| T-08 | E2E on the production project with `e2e-` data (D5 amended): setup, seed, Playwright suites for all flows | T-01…T-07 | **yes** | todo (DB access ready) |
| T-09 | UI/UX pass, shipped per page (admin, dashboard, superadmin, settings) | T-06, T-07 | no | T-09a running |
| T-10 | i18n for the superadmin pages (M3.11) | T-03, T-07 | no | todo |
| T-11 | Offline PWA hardening + UX (D9) | T-09 | no (mocked + unit) | todo |
| T-14 | Firmware hygiene: zero deprecation warnings (Arduino core 2.0.17 kept), server URLs baked to `https://pakaonai.syntaxure.dev`, `FW_VERSION` reported | — | no | integrated, verified (needs human OK + reflash) |
| T-15 | Real email invites via Resend from `syntaxure.dev` (e.g. `invite@syntaxure.dev`) + plan the rename of the internal login domain `pond.optifeed.local` to PakaonAI (O13) | T-06 | no (mocked) | todo |
| T-12 | Remote firmware updates (OTA) for ESP32 (D10) | design done: `docs/firmware-ota-plan.md`, all OTA decisions made | T-12c yes | **T-12a + T-12b integrated, verified** (T-12a: build only, needs human OK + bootstrap USB flash + bench test; T-12b: needs the private `firmware` bucket + first signed channel); T-12c (rollout tables/UI) needs a migration |

### T-01 Firmware reset buttons
- `firmware/firmware-main/firmware-main.ino`: `WIFI_RESET_BUTTON_PIN 16`, `FACTORY_RESET_BUTTON_PIN 17`; split `RESET_BUTTON_HOLD_MS` into `WIFI_RESET_HOLD_MS 5000` and `FACTORY_RESET_HOLD_MS 10000`. Keep debounce, startup grace and the "factory wins over Wi-Fi" rule.
- Do not change any other GPIO, the relay init state, `MAX_DISPENSE_MS`, feeding logic, URLs or the NVS namespace.
- Update the `firmware/README.md` pin and button tables.
- Sticker note (`apps/web/messages/en.json` → `dashboard.adminDeviceLabels.sticker.noteBody`): it should say to hold the **Wi-Fi reset button for 5 s** to reopen setup.
- Verify: `pio run -d firmware` compiles. The PR must say "needs human OK before merge, reflash required".

### T-02 Token reveal audit + rate limit
- `revealDeviceToken` (`lib/actions/admin.ts`) writes a `DeviceStateEvent` (`eventType: "token_revealed"`, the actor's user id, no token) on each reveal.
- Rate-limit reveals per actor using the existing PostgreSQL limiter (`lib/rate-limit.ts`), for example 10 per hour, with a clear error.
- Tests: one audit row per reveal, never containing the token; limit enforced; the cross-org deny test still passes.

### T-03 Superadmin quick fixes
- `listAllPonds`: map orgs by `User.farmId` (Pond.ownerId is the farm slug, not the user id), plus a test proving the Organizations column is filled.
- `lib/actions/superadmin.ts` `audit()`: real `targetType` per action (`user`, `organization`, `platform_admin`), `orgId` where known, `ip` and `userAgent` from `next/headers`. Same pattern as `lib/actions/platform/devices.ts`.
- Pagination (50 per page) and search on `/superadmin/users`, `/superadmin/orgs` and `/superadmin/ponds`.

### T-04 Step-up re-auth + safe user delete
- `lib/auth/step-up.ts`: the admin re-enters their password (verified with Supabase `signInWithPassword` for the same email), and a signed, httpOnly, 5-minute `stepup` cookie is set (HMAC with a server secret; no new env var if an existing secret fits, otherwise document it in `.env.example`).
- A `withStepUp` check is required by: grant/revoke platform admin, delete user, register device, rotate device token, and later T-06/T-07 actions. Audit rows record `stepUpAt`.
- A step-up dialog component in the superadmin UI re-prompts when the cookie is expired.
- Safe delete: replace the immediate hard delete with **disable**: Supabase auth ban, revoke memberships, audit. The UI requires typing the farmId to confirm. Hard purge stays a later M7 job.
- Tests: no cookie means rejection; an expired cookie means rejection; a tampered cookie means rejection; a valid cookie is accepted; disable is reversible.

### T-05 Tenancy harness + superadmin tests
- `lib/__tests__/helpers/tenancy.ts`: a two-org fixture (org A and B, each with a member, farm, pond, device and telemetry rows) and `expectNoCrossOrgAccess(fn)` for mocked Prisma.
- Use it for negative tests on every `lib/actions/admin.ts` read and write.
- Behavioural tests for every `lib/actions/superadmin.ts` mutation: allowed, denied (not a platform admin), and exactly one audit row with a reason.

### T-06 RBAC in Settings
- Read `lib/auth/permissions.ts`, `MembershipPermission`, `Membership` and the existing settings pages first, and extend what exists.
- Tenant Settings → Members: list members (role, permissions), invite by email, change role, toggle per-member permissions, revoke membership. OWNER/ADMIN only; a member cannot raise their own role; the last OWNER cannot be removed.
- Superadmin → Organizations → an org detail page: the same management for any org (god mode, D1), with step-up and audit.
- Tests: allow and deny per role, cross-org deny, last-owner guard, audit rows.

### T-07 Superadmin god mode
- **View-as (read-only)**: start an `ImpersonationSession` (reason, step-up, 30-minute expiry) and render the tenant dashboard in read-only mode with a red banner and an exit button. Every write is rejected during view-as. Audit start and stop.
- **Remote feeder control**: from the superadmin device registry, manual feed and pause/resume on any device. Go through the existing feed-command and schedule paths with the §6 caps (≤1,000 g per request, daily cap). Require step-up, reason and audit. No force flag.
- Tests: write blocked in view-as; caps enforced; step-up required; cross-org audit `orgId` correct.

### T-08 E2E (blocked until the dev project exists)
- `supabase` config for the dev project, `apps/web/.env` pointing at it (Jeff provides the keys), `prisma migrate deploy` and `seed-dev` **on the dev project only**, and `E2E_ALLOWED_DB_HOST` set to its host.
- Playwright suites:
  - auth
  - tenant devices + sticker print
  - superadmin device register/rotate/print
  - step-up
  - RBAC grant/revoke
  - view-as
  - remote feed caps
  - the existing suites

### T-09 UI/UX pass (per page)
- One branch per page group: `T-09a` admin, `T-09b` dashboard, `T-09c` superadmin, `T-09d` settings.
- Responsive at 375 px and 1280 px, consistent spacing and typography, loading and empty states, focus and contrast (WCAG AA), no layout shift. Reuse the existing components and tokens; no new design system.

### T-11 Offline PWA hardening + UX
- Read `lib/offline/*`, `lib/pwa/*`, `components/pwa/*`, `public/sw.js`, `public/offline.html`, `app/manifest.ts` and their tests first; extend, do not replace.
- Harden:
  - queued writes must survive reloads and replay exactly once (idempotency keys);
  - a replay conflict must be shown to the user, never silently dropped;
  - no feed command may ever be queued offline and fired later without fresh confirmation (feeding safety);
  - the service worker must never cache authenticated API responses across users;
  - offline data must be cleared on sign-out (already partly done).
- UX: a clear offline banner state, a pending-sync count with retry, a 'last synced' time on cached screens, and disabled controls that explain why when offline.
- Tests: unit tests for queue, replay, dedupe, conflict and sign-out clearing; Playwright offline specs once T-08 has a database.

### T-12 Remote firmware updates (OTA)
- Step 1 (running): a research subagent benchmarks ESP32 OTA practice and free or self-hostable platforms, and recommends a design.
- Step 2: the integrator writes the design into the plan (new phase).
  - Safety rules: never update during a feed; update only when idle and on stable power; signed and checksummed images; automatic rollback; a staged rollout from superadmin.
  - Bootstrap: one last USB/LAN flash installs the OTA-capable build.
- Step 3: firmware and server tasks are split out from the design. Firmware changes need a human OK and a reflash. Schema changes are a separate migration PR, run on the Supabase dev project first.

### T-10 Superadmin i18n
- Move the superadmin page strings into `messages/en.json` and `messages/hil.json` (the hil text is a draft for review). The sticker stays English only.

## Other local agents and worktrees (D8, read-only inventory)

Snapshot 2026-10-26 from `node ~/.config/opencode/bin/orchestrator.mjs inventory`. This mission never edits these worktrees; anything they need is raised with Jeff.

| Branch | Worktree | State | Note |
|---|---|---|---|
| `feat/landing-card-motion` | `S:/Dev/Capstone/optifeed-worktrees/landing-card-motion` | ready, pushed, +1 vs develop | Another agent's landing work; no overlap with this mission. |
| `feat/feed-calibration-backend`, `feat/feed-calibration-ui` | `S:/Dev/Capstone/optifeed-worktrees/calibration-*` | **local-only, +1 commit not on GitHub** | Possibly unpushed work. Jeff/Karl: push or confirm disposable. |
| `feat/crop-calendar-qa`, `feat/crop-reminders`, `feat/crop-tests` | `S:/Dev/Capstone/optifeed-worktrees/crop-*` | **local-only, +1 commit, no upstream** | Same: push or confirm disposable. |
| `main` (primary checkout) | `S:/Dev/Capstone/optifeed` | 1 untracked file | Not touched. |
| `feat/landing-hero-cards` | `S:/Dev/optifeed/public-page-quality-review-873fdc` | 2 untracked files | Not touched. |
| `fix/seed-identity-and-proxy-guard`, `feat/feed-calibration-integration`, `feat/design`, `fix/audit-remediation`, `claude/pakaonai-sticker-wifi-label-da3580`, `feature/superadmin-device-registry` | various | integrated into develop | Candidates for cleanup later; nothing is removed without Jeff's OK. |

## Events

- 2026-10-26: **RLS exposure check done** (read-only catalog query on production): no table is reachable by `anon`/`authenticated` without RLS. No hotfix needed.
- 2026-10-26: **The domain move is already live.** The app uses `pakaonai.syntaxure.dev` (health OK). `optifeed.syntaxure.dev` now returns `404 DEPLOYMENT_NOT_FOUND`, so feeders flashed with the old URL are offline until their USB reflash (T-14 bakes in the new URL).
- 2026-10-26: **The database password should be rotated.** An integrator command printed the production connection string into the agent transcript; nothing was sent externally.
- 2026-10-26: OTA signing key pairs (primary + spare, ECDSA P-256) were generated in `C:/Users/Lenovo/Documents/PakaonAI/ota-signing-keys` (outside the repo). Jeff backs the folder up to Google Drive.

- 2026-10-26: **Worker hang root cause found**: background `opencode run` waited on stdin and never created a session (T-15/T-12b launches 20:23-21:07). Fix: `< /dev/null` + brief file via `-f`; verify with `opencode session list`.

## Integration log

Branch: `integration/mission-2026-10-26` (from `feature/superadmin-device-registry` @ `dce716d`, which contains PR #174 and PR #179).

| When | Task | Commit merged | Checks on the integration branch | Notes |
|---|---|---|---|---|
| 2026-10-26 | develop | `e1fa17a` (PRs #174, #179, #180) | — | Brought the integration branch up to date with develop. |
| 2026-10-26 | T-12b | `a11d66e` via `bfe7cc9` | lint ok, typecheck ok, 102 test files pass, api:check 48/0 | Reviewed device auth (token + mac + rate limit), CI allowlist entry beside the other device routes, only public PEMs committed. |
| 2026-10-26 | T-12a | `9bbdfdc` via merge | lint ok, typecheck ok, 99 test files pass; clean `pio run` SUCCESS (flash 54.4 % of 1.9 MB slot, RAM 15.9 %, 0 sketch warnings); ELF has `T verifyRollbackLater`; invariants grepped (relay OFF init, pins, MAX_DISPENSE_MS, NVS namespace); 5 roots embedded; no private key in source | Bench plan A–G in firmware/README.md is the remaining hardware verification. Server contract for T-12b documented in firmware/README.md (signature over exact manifest string, Content-Length required, <= 8 KB). |
| 2026-10-26 | security fix | `e35ff03` | lint ok, typecheck ok, 99 test files pass | Integrator found during T-07 review: `applyGrowthPlanForPond` was a browser-callable server action trusting caller ownerId (pre-existing on develop). Moved out of the "use server" module; new static guard test proven to fail on the old code. |
| 2026-10-26 | T-07 | `1dd8656`,`8444516` via `5558b1a` | lint ok, typecheck ok, 98 test files pass | Reviewed view-as (signed cookie + DB session + active grant), write guards in requireWriteAccess/requirePermission/withAuth, scanned all writing actions. Conflict in superadmin orgs page: kept both Manage members and View as. |
| 2026-10-26 | T-14 | `46f5fb4` via `546fde1` | lint ok, typecheck ok, 93 test files pass, pio SUCCESS | URLs -> pakaonai.syntaxure.dev, FW_VERSION 1.3.0, ArduinoJson v7 (`is<float>()` also ignores null/non-numeric keys that used to be cast to 0). 24 -> 0 sketch warnings; 2 OneWire library warnings remain. `firmware_version` is stripped by the ingest schema until T-12b. |
| 2026-10-26 | T-06 | `326c569` via `ceb2557` | lint ok, typecheck ok, 93 test files pass | Reviewed member-rules + tenant scoping (caller's orgs only, platform admins excluded, last owner re-checked in tx). Members section is in Admin -> Settings. Invite = one-time temp password (no email infra). |
| 2026-10-26 | T-05 | `42b4303` via merge + `48d670e` | lint ok, typecheck ok, 91 test files pass | Test-only. Reconciled 3 audit assertions with T-03's new targetType values (semantic clash, not a weakened guard). |
| 2026-10-26 | T-03 | `a8f381a` via `81cb613` | lint ok, typecheck ok, 89 test files pass | Pond org mapping fixed via `User.farmId` (spot-checked); 13/13 superadmin exports gated; audit target/org/ip/UA; pagination on users/orgs/ponds. |
| 2026-10-26 | T-04 + T-02 | `380d4ef` via `e2c3ef7`; `75fc34e` via `de9e988` | lint ok, typecheck ok, 87 test files pass (pio not re-run: firmware unchanged since `752f126`) | T-04 step-up + reversible disable reviewed line by line. T-02 reveal audit + limiter. One textual conflict in `rate-limit.ts` (both added a limiter); both kept. |
| 2026-10-26 | T-01 | `e755625` via `752f126` | lint ok, typecheck ok, 82 test files pass, `pio run` SUCCESS (flash 82.6 %) | Worker added the factory-wins suppression fix and corrected `docs/flash-plan.md`; reviewed and kept. Needs human OK and a reflash. |
