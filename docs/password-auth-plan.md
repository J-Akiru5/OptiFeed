# Password authentication contract (task 2.10)

**Status:** planned, not implemented. This file records the implementation contract so the work can
start without re-deciding policy.

**Source:** task 2.10 in `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`, added on
`docs/update-industry-grade-plan` (PR #128, commit `deeef61`, 2026-10-26). That commit referenced this
file but did not include it on the pushed branch. This copy is derived from the plan at
`develop@fde2774`; the plan remains the source of truth if the two differ.

## Goal

Replace the numeric PIN login with an explicit password login while keeping **Supabase Auth as the
credential store**. The app must never store, hash, or log a plaintext password.

`loginWithPin` already calls `supabase.auth.signInWithPassword({ email, password: pin })`; the PIN is
only a password with a 4-6 digit policy and a PIN-shaped UI. This task makes that explicit, adds a
forced first-login change, and adds self-service change.

## Non-goals

- No custom password table, hashing scheme, or session implementation. Supabase Auth owns credentials
  and sessions.
- No change to tenant membership, platform administration, or the permissions model. The RBAC gates
  from #153 stay as they are.
- No production password reset performed by an agent. That is an owner-authorized access-control
  change (see Rollout).

## Current state (evidence)

- `apps/web/lib/actions/auth.ts` — `loginWithPin` accepts 4-6 characters, signs in through Supabase,
  then lands platform admins on `/superadmin` and everyone else on `/dashboard`.
- `apps/web/app/[locale]/login/page.tsx` — validates 4-6 digits and labels the field **Security PIN**.
- `apps/web/lib/actions/admin.ts` — `createPondWithFarmer` requires a 6-digit PIN and passes it to
  `auth.admin.createUser({ password })`.
- `apps/web/lib/actions/superadmin.ts` — `createPlatformUser` requires a 6-digit PIN.
- `apps/web/components/admin/create-pond-form.tsx` and
  `apps/web/components/superadmin/new-account-form.tsx` — PIN inputs.
- `apps/web/app/[locale]/(dashboard)/dashboard/settings/profile/page.tsx` — says PIN changes are
  handled by the administrator; there is no self-service form.
- `User` has no `mustChangePassword` column.
- There is no `/change-password` route.

## Data model

| Change | Detail |
| --- | --- |
| `User.mustChangePassword` | `Boolean @default(false)` |
| Migration | Additive, nullable/defaulted; no data rewrite |
| Backfill | The migration leaves everyone `false`; the rollout script sets `true` on the five existing production accounts |
| Password material | Never stored in Postgres; Supabase Auth only |

The migration must not embed account passwords. The rollout script is separate and idempotent.

## Credential policy

- **Temporary password:** `password123` for the five existing accounts, with
  `mustChangePassword = true`. It is accepted once so the user can reach `/change-password`; the
  permanent policy rejects it.
- **Permanent password:** 8+ characters, at least one letter and one number, at most 72 bytes, not on
  a common-password blocklist, not the farm ID or email local part, and not the temporary password.
- **Strength meter:** Weak / Medium / Strong on every password-setting form. Weak means "does not
  meet the policy"; Medium means "meets the policy but is short or single-class"; Strong means
  "12+ characters with mixed classes". The meter never blocks a policy-compliant password; the policy
  validator is authoritative.
- **Never log** the password, confirmation, or Supabase error payloads that could contain it.

## Flows

### Login

1. Validate `farmId` and a non-empty password (max 72 bytes). Do not require 6 digits.
2. Keep the existing rate limit (5 per 60 s per IP) and lockout rules per `(farmId, ip)`.
3. `supabase.auth.signInWithPassword({ email: buildPondEmail(farmId), password })`.
4. After success, read `User.mustChangePassword` by `supabaseId` (the session's `sub`).
5. If `mustChangePassword` is `true`, redirect to `/{locale}/change-password`. **Do not** land on
   `/dashboard` or `/superadmin` first.
6. Otherwise keep the current landing rule: active platform admin → `/superadmin`, else `/dashboard`.

Rename `loginWithPin` to `loginWithPassword`; keep a one-line deprecated alias only if an external
caller still imports the old name. Error codes stay `invalid | locked | rate_limited | service` so the
login page does not need a new error model.

### Forced change

- New route `apps/web/app/[locale]/change-password/page.tsx`, authenticated but outside the dashboard,
  admin, and superadmin shells.
- New password + confirmation, the strength meter, and the policy errors.
- Server action:
  1. Re-read the authenticated user; require `mustChangePassword = true` (or allow self-service mode).
  2. Validate the policy.
  3. `supabase.auth.updateUser({ password })`.
  4. `prisma.user.update({ where: { supabaseId }, data: { mustChangePassword: false } })`.
  5. Redirect to the normal landing page.
- On failure, keep the flag set and show a generic error. Do not clear it optimistically.
- Sign out other sessions if the Supabase project allows it; at minimum, the current session stays
  valid so the user is not logged out mid-change.

### Self-service change

- Replace the "PIN changes are handled by your administrator" block in Profile Settings with a working
  form (current password, new password, confirm, meter).
- Re-authenticate with `signInWithPassword` before `updateUser` so a stolen open session cannot change
  the password without the current credential.
- Clear `mustChangePassword` on success.

### Account creation and reset

- Replace every PIN field and `/^\d{6}$/` check:
  - `createPondWithFarmer` (`lib/actions/admin.ts`)
  - `createPlatformUser` (`lib/actions/superadmin.ts`)
  - `components/admin/create-pond-form.tsx`
  - `components/superadmin/new-account-form.tsx`
- New accounts get a temporary password chosen by the creating admin (or generated and shown once),
  `mustChangePassword = true`, and the same strength meter.
- A platform-admin reset sets a new temporary password and `mustChangePassword = true`; it must be
  audited through `PlatformAuditLog` and must never log the password.
- The demo seed uses `DEMO_PASSWORD` (not `password123`) and `mustChangePassword = false` so local and
  E2E runs are not forced through the change screen on every reset.
- E2E helpers and `provision-demo-user.ts` switch from `DEMO_PIN` to `DEMO_PASSWORD`; keep
  `password123` only for the four non-demo accounts that are intentionally tested through first login.

## Guard composition with RBAC (#153)

Password-change enforcement is orthogonal to tenant/platform roles. It must run **before** them, and
it must cover server actions, not only layouts.

Recommended order:

```
session -> mustChangePassword -> tenant membership / PlatformAdmin -> permission
```

Implementation:

1. Add `apps/web/lib/auth/password-change.ts` with:
   - `mustChangePassword(): Promise<boolean>`
   - `requirePasswordChanged(): Promise<void>` — redirects to `/{locale}/change-password`
2. Call `requirePasswordChanged()` at the start of:
   - `requireTenantAdmin()` — covers the `/admin` layout and every action in `lib/actions/admin.ts`
   - `requirePlatformAdmin()` — covers `/superadmin` and every platform action
   - `requireWriteAccess()` — covers farmer writes when a flagged user calls an action directly
3. Add the same redirect to the dashboard layout (read access) so a flagged user cannot browse the
   app before changing the password.
4. The login action redirects flagged users before choosing a landing console (see Login).
5. Do **not** rely on layouts alone. Server actions are callable directly; the guard must be inside
   the shared guards.
6. `requirePasswordChanged()` must not redirect when the current path is already `/change-password`
   (avoid a loop).

The existing RBAC tests (`admin-rbac-guards.test.ts`) assert that every tenant-admin action calls
`requireTenantAdmin()`. Adding the password check inside that guard keeps that invariant and adds the
password gate for free.

## Rollout

1. Land the schema + code + `/change-password` page together. Do not land the column without the page
   or the guard would redirect to a missing route if a flag is ever set.
2. Apply the additive migration to the **development** database (authorized) and verify.
3. Run the idempotent reset script against development only. It sets the five accounts to
   `password123` + `mustChangePassword = true`.
4. Verify login, forced change, permanent-policy rejection, meter, self-service change, and the
   `/admin`/`/superadmin` redirects for a flagged account.
5. Production is a separate owner-authorized access-control change. Reset `superadmin` to a unique
   password immediately after rollout; `password123` is a known breached password and creates a
   takeover window.
6. Confirm the target Supabase project accepts `password123`. If leaked-password protection rejects
   it, choose another temporary password and update the rollout script and this contract — do not
   disable the protection.

## Acceptance tests

- The login page accepts a password, not only 4-6 digits.
- A flagged account is redirected to `/change-password` from `/dashboard`, `/admin`, `/superadmin`,
  and from a direct admin/server-action call.
- `password123` is rejected as a permanent password; a policy-compliant password is accepted.
- The strength meter returns Weak/Medium/Strong for representative inputs.
- Self-service change re-authenticates and clears the flag.
- A failed change leaves `mustChangePassword = true`.
- No password appears in logs, audit rows, or error messages.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `next build` pass.

## Files expected to change

- `apps/web/prisma/schema.prisma` + additive migration
- `apps/web/lib/actions/auth.ts`
- `apps/web/lib/actions/password.ts` (new: change password action)
- `apps/web/lib/auth/password-policy.ts` (new: validator + strength score)
- `apps/web/lib/auth/password-change.ts` (new: guard)
- `apps/web/lib/auth/tenant-admin.ts`, `apps/web/lib/auth/require-platform-admin.ts`,
  `apps/web/lib/auth/session.ts` (call the guard)
- `apps/web/app/[locale]/login/page.tsx`
- `apps/web/app/[locale]/change-password/page.tsx` (new)
- `apps/web/app/[locale]/(dashboard)/layout.tsx`
- `apps/web/app/[locale]/(dashboard)/dashboard/settings/profile/page.tsx`
- `apps/web/lib/actions/admin.ts`, `apps/web/lib/actions/superadmin.ts`
- `apps/web/components/admin/create-pond-form.tsx`,
  `apps/web/components/superadmin/new-account-form.tsx`
- `apps/web/components/password-strength.tsx` (new)
- `apps/web/prisma/seed-dev.ts`, `apps/web/scripts/provision-demo-user.ts`, `apps/web/e2e/helpers.ts`
- `apps/web/messages/en.json`, `apps/web/messages/hil.json`

## Open questions

1. Does the production Supabase project's leaked-password protection reject `password123`? Verify
   before the reset window.
2. Are there exactly five production accounts? Enumerate them from the production console; do not
   infer from the repo.
3. Should a platform admin be able to reset a tenant user's password from `/superadmin`, or is that a
   tenant-admin action? The plan implies platform reset; keep it audited either way.
