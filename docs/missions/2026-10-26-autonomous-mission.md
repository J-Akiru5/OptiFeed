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
| D5 | **Database**: no Docker. E2E and dev migrations run against a separate hosted **Supabase dev project** that Jeff creates. **Never the production database.** Until it exists, DB-dependent work is deferred, not faked. |
| D6 | **Firmware buttons**: GPIO 16 = Wi-Fi reset, 5 s hold (keeps identity). GPIO 17 = factory reset, 10 s hold (wipes NVS). Both to GND with internal pull-up. |

## Rules every worker follows

1. Work only in the worktree and branch you were given (`mission/T-xx-…`), based on `integration/mission-2026-10-26`. Never edit another worktree.
2. Before coding, read `apps/web/AGENTS.md`. This Next.js version differs from what you know; check `apps/web/node_modules/next/dist/docs/` when an API matters.
3. Match repo style: Biome (tabs, 100 columns, double quotes), Conventional Commits, Server Actions in `lib/actions/`. Every new or changed authorization path gets an allow test **and** a deny test. Platform actions call `requirePlatformAdmin()`, tenant actions `requireTenantAdmin()`, and both are scoped as in `lib/auth/org-scope.ts`.
4. Never weaken an existing guard or test to make something pass. Never log or return a secret, token or password, except a device token returned once by its issuing action.
5. No Prisma migration unless the task says so. Never run `prisma migrate reset`. Never touch the production database or production credentials.
6. Before you finish, run `pnpm lint`, `pnpm typecheck` and `pnpm test` from the repo root, and fix what you broke. Commit on your branch with Conventional Commits and push your branch. Do not open or merge PRs (the integrator does).
7. End with a report: what changed (files), tests added, the exact commands you ran and their results, anything not done, and open questions. Do not claim a check you did not run.

## Tasks

Status: `todo` / `running` / `review` / `integrated` / `blocked`.

| ID | Task | Depends on | Needs DB | Status |
|---|---|---|---|---|
| T-01 | Firmware reset buttons (D6) + sticker note | — | no | todo |
| T-02 | Token reveal audit + rate limit (plan M3F.5) | — | no | todo |
| T-03 | Superadmin quick fixes (plan M3.9) | — | no | todo |
| T-04 | Step-up re-auth + safe user delete (M3.2, M3.3, M3.10) | — | no | todo |
| T-05 | Tenancy negative-test harness + superadmin behavioural tests (M0.3, M3.11 tests) | — | no | todo |
| T-06 | RBAC: members and permissions in Settings, plus superadmin for any org (D1, D2, M2.7) | T-04 | no (mocked tests) | todo |
| T-07 | Superadmin god mode: view-as (read-only) + remote feeder control (D1, M5.1, M5.2) | T-04 | no (mocked tests) | todo |
| T-08 | E2E on the Supabase dev project: setup, seed, Playwright suites for all flows | T-01…T-07, D5 | **yes** | blocked on D5 |
| T-09 | UI/UX pass, shipped per page (admin, dashboard, superadmin, settings) | T-06, T-07 | no | todo |
| T-10 | i18n for the superadmin pages (M3.11) | T-03, T-07 | no | todo |

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

### T-10 Superadmin i18n
- Move the superadmin page strings into `messages/en.json` and `messages/hil.json` (the hil text is a draft for review). The sticker stays English only.

## Integration log

Branch: `integration/mission-2026-10-26` (from `feature/superadmin-device-registry` @ `dce716d`, which contains PR #174 and PR #179).

| When | Task | Commit merged | Checks on the integration branch | Notes |
|---|---|---|---|---|
| — | — | — | — | — |
