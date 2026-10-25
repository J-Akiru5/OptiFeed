# OptiFeed — Password Authentication Plan

- **Status:** Implemented and verified on `feat/password-auth` at `ea6a8ad`; pushed to `origin`; ready for review.
- **Date:** 2026-10-26
- **Repository:** `C:\Users\Client\CApstone\OptiFeed`
- **Worktree:** `C:\Users\Client\CApstone\OptiFeed-password`
- **Base:** `origin/develop` at `34f5e84` (PR #152).
- **Target:** replace numeric PIN login with password authentication, force existing accounts to set a permanent password, and add a weak/medium/strong indicator on password-setting forms.
- **Master plan:** `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md` task 2.10 on `docs/update-industry-grade-plan` (`deeef61`).
- **Isolation:** this worktree and branch are separate from the current `audit/phase-1-critical` working tree, whose unrelated changes (`firmware-main.ino`, a deleted PDF, untracked files) must not be touched.

---

## 0. Precondition: dedicated branch plan must be current

This document is the planning source of truth. Before any code, migration, or database change:

1. Create the isolated task worktree and branch.
2. Create/update the dedicated branch plan at `docs/password-auth-plan.md` (the repo uses flat `docs/*-plan.md`; use `plan/tasks/<task>.md` instead if the branch adopts AgentOps task contracts).
3. The branch plan must include: objective, locked decisions, files owned, migration and rollback, rollout, verification, status, and next steps.
4. Commit the branch plan on the task branch **before** the first implementation commit.
5. Record the branch-plan path in the PR description.
6. If a decision changes during implementation, update both this document and the branch plan before continuing.
7. Do not proceed to implementation while the branch plan is missing or out of date.

---

## 1. Objective

1. Replace the numeric PIN credential with a normal password at login.
2. Require new passwords to contain letters and numbers.
3. Add a weak / medium / strong password indicator on password-setting forms.
4. Force all existing accounts to change their password on next login.
5. Allow users to change their own password from Profile Settings.
6. Keep the e2e suite stable and verify the forced-change flow.

---

## 2. Verified current state

### Accounts

The live Supabase/Postgres database currently has **5 `User` rows**:

| Farm ID | Name | Role | Organization | Farm / ponds |
|---|---|---|---|---|
| `demo-farmer-1` | Juan Miguel | ADMIN | Juan Miguel (independent) | Juan Miguel Farm / 2 ponds |
| `superadmin` | Super Admin | VIEWER (platform admin) | — | none |
| `tenant2-admin` | Tenant B Admin | ADMIN | Tenant B Fisheries (OWNER) | none |
| `independent-farmer` | Independent Farmer | OPERATOR | Independent Farmer (independent) | Independent Farmer Farm / 1 pond |
| `test` | test | OPERATOR | Tenant B Fisheries (OPERATOR) | test Farm / 1 pond |

Supabase Auth also contains an orphan identity `aquanest-demo@pond.optifeed.local` with no `User` row. It is not part of this change.

### How PIN works today

- A PIN is a numeric password stored by Supabase Auth. There is **no PIN column** in Postgres.
- `User.supabaseId` links the Prisma row to the Supabase Auth user.
- Current PINs are 4–6 digits. They cannot be read back; only hashes exist in Supabase.

### PIN touchpoints

- `apps/web/app/[locale]/login/page.tsx` — numeric-only input, `maxLength={6}`, strips non-digits.
- `apps/web/lib/actions/auth.ts` — `loginWithPin()`, validates 4–6 digits.
- `apps/web/components/admin/create-pond-form.tsx` — PIN field.
- `apps/web/lib/actions/admin.ts` — `createPondWithFarmer()`, 6-digit PIN validation.
- `apps/web/components/superadmin/new-account-form.tsx` — PIN field.
- `apps/web/lib/actions/superadmin.ts` — `createPlatformUser()`, 6-digit PIN validation.
- `apps/web/prisma/manage-users.ts` — `create`, `reset-pin`, `--pin`.
- `apps/web/scripts/provision-demo-user.ts` — `DEMO_PIN`, default `1234`.
- `apps/web/e2e/helpers.ts`, `apps/web/e2e/auth.spec.ts` — `DEMO_PIN`, `#pin`.
- `apps/web/messages/en.json`, `apps/web/messages/hil.json` — PIN copy.
- `apps/web/app/[locale]/(dashboard)/dashboard/settings/profile/page.tsx` — disabled “Change PIN” section.
- `apps/web/lib/auth/lockout.ts` — notification text says “change the PIN”.

### Existing password/UI infrastructure

- No password-strength component or password policy module exists.
- Profile Settings has a disabled “Change PIN” button and says PIN changes are handled by an administrator.
- Login is rate-limited and lockout-protected; those controls must remain unchanged.
- Playwright uses `DEMO_PIN` and logs in through the UI on every test.

---

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Existing accounts | All 5 get the temporary initial password `password123` and `mustChangePassword = true`. |
| Forced change | On next login, redirect to a dedicated change-password page; block dashboard/admin/superadmin until changed. |
| Initial password | `password123` for all 5 existing accounts, temporary only. |
| Weak temporary password | Allowed **only** when the account is flagged `mustChangePassword = true`. Permanent passwords must pass the full policy. |
| Password policy | 8+ characters, at least one letter and one number, not a common password, max 72 bytes. |
| Strength levels | Weak / Medium / Strong. `password123` must show **Weak**. |
| Strength indicator location | Password-setting forms only: forced change, self-service change, admin/superadmin account creation. **Not** on login. |
| Self-service change | Enabled in Profile Settings. |
| Admin reset | CLI remains the reset path; resets are temporary + force change by default. |
| E2E | Setup ensures `demo-farmer-1` ends on a stable `DEMO_PASSWORD` with the flag cleared. The other 4 accounts remain on `password123` for manual first-login testing. |

### Temporary vs permanent policy

`validatePassword(password, mode)`:

- `temporary`:
  - non-empty
  - max 72 bytes
  - no composition or common-password check
  - used only when the account will be flagged `mustChangePassword = true`
- `permanent`:
  - 8–72 bytes
  - at least one Unicode letter
  - at least one digit
  - not on the common-password blocklist
  - used by forced change and self-service change

`getPasswordStrength(password)` always evaluates against the **permanent** policy:

- **Weak** — fails any permanent requirement, including `password123`.
- **Medium** — valid, but under 12 characters or lacks uppercase/symbol.
- **Strong** — valid, 12+ characters, with uppercase or a symbol.

---

## 4. Data model and migration

### Schema

Add to `apps/web/prisma/schema.prisma` → `model User`:

```prisma
mustChangePassword Boolean @default(false)
```

No password is stored in Postgres. Supabase Auth remains the credential store.

### Migration

Create a Prisma migration that:

1. Adds `mustChangePassword BOOLEAN NOT NULL DEFAULT false`.
2. Backfills `true` for every existing `User` row.

```sql
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
  SET "mustChangePassword" = true;
```

### Account defaults

- Existing 5 users: backfilled `true`.
- New accounts created by admin/superadmin/CLI: `true` (temporary password).
- `seed.ts` and `seed-dev.ts` demo user: `false`.
- `provision-demo-user.ts`: `false` after setting the stable demo password.

---

## 5. Password module and UI components

### `apps/web/lib/auth/password.ts` (new)

- `PASSWORD_MIN_LENGTH = 8`
- `PASSWORD_MAX_BYTES = 72`
- `validatePassword(password, { mode: "temporary" | "permanent" })`
- `getPasswordStrength(password): "weak" | "medium" | "strong"`
- `passwordErrorCode` / `passwordErrorMessage`
- Small common-password blocklist:
  - `password`, `password1`, `password123`, `12345678`, `123456789`, `qwerty123`, `letmein1`, `admin123`, `welcome1`, `iloveyou1`, `abc12345`, `football1`, `monkey123`, `dragon123`
- Unicode-aware letter test (`\p{L}`), digit test (`\d`).
- Byte-length check with `TextEncoder` so a 72-character Unicode password cannot silently exceed bcrypt’s limit.
- Pure module with no Next.js imports so the CLI can import it.

### `apps/web/components/password-strength.tsx` (new)

- Three-segment bar: red / amber / green.
- Label: Weak / Medium / Strong.
- Requirement checklist:
  - At least 8 characters
  - At least one letter
  - At least one number
- `aria-live="polite"` and `role="status"`.
- Hidden when the field is empty.
- Uses the `password` i18n namespace.

### `apps/web/components/password-input.tsx` (new)

- Password input with show/hide toggle.
- `autoComplete` prop.
- Optional `maxLength={72}`.
- Accessible toggle labels.

---

## 6. Login flow

### `apps/web/app/[locale]/login/page.tsx`

- Replace `pin` state with `password`.
- Replace the numeric input with `PasswordInput`.
- Props:
  - `type="password"`
  - `autoComplete="current-password"`
  - `maxLength={72}`
  - no `inputMode="numeric"`
  - no digit stripping
- Client validation: non-empty only. Do **not** require letter+number at login; legacy PINs must still work once.
- Rename the error key from `errorPinLength` to `errorPasswordRequired`.
- Update copy:
  - Label: “Password”
  - Description: “Enter the password provided by your administrator. A current PIN will work once, then you must set a password.”

### `apps/web/lib/actions/auth.ts`

- Rename `loginWithPin` → `loginWithPassword`.
- Validate: non-empty, max 72 bytes.
- Keep `signInWithPassword` call.
- After success:
  - Load the `User` row by `supabaseId` (select `id`, `mustChangePassword`).
  - If `mustChangePassword` → `redirect({ href: "/change-password", locale })`.
  - Else if active platform admin → `/superadmin`.
  - Else → `/dashboard`.
- Replace the separate `isPlatformAdminFarmId` lookup with a single post-login helper to avoid duplicate queries:
  - `apps/web/lib/auth/post-login.ts` (new)
  - `getPostLoginDestination({ farmId, supabaseId })`
- Keep the `NEXT_REDIRECT` rethrow.
- Keep rate limiting, lockout, and retry behavior unchanged.

### `apps/web/lib/auth/navigation-guard.ts`

- Add `/change-password` to `isProtectedPath()` so an unauthenticated request is redirected to login.
- Add a unit test for it.

---

## 7. Forced change flow

### Route

`apps/web/app/[locale]/change-password/page.tsx`

- Outside the dashboard/admin/superadmin layouts, so it cannot loop.
- Requires authentication via `getCurrentUser()`.
- If no user → redirect to `/login`.
- Renders a minimal card with logo, title, explanation, and `ChangePasswordForm`.
- `forced` is true when `mustChangePassword` is true.

### Form

`apps/web/components/change-password-form.tsx` (new, client component)

Fields:

- Current password
- New password (with `PasswordStrength`)
- Confirm new password
- Submit

Client checks:

- All fields non-empty.
- New password passes permanent policy.
- New password !== current password.
- New password === confirm.

Success behavior:

- Forced flow: redirect to the landing route returned by the action.
- Profile flow: show a success message and clear the fields.

### Server action

`changeOwnPassword({ currentPassword, newPassword })` in `apps/web/lib/actions/password.ts` (new) or `auth.ts`.

Steps:

1. Require an authenticated Supabase session and a matching Prisma `User`.
2. Validate `newPassword` with `mode: "permanent"`.
3. Reject if `newPassword === currentPassword`.
4. Verify `currentPassword` using a non-persisting Supabase client (`persistSession: false`, `autoRefreshToken: false`) with `signInWithPassword`.
5. Update the password:
   - Prefer the session client `updateUser({ password })`.
   - If Supabase returns `reauthentication_needed`, fall back to the admin client `updateUserById` because the current password was already verified.
6. Clear `mustChangePassword` in Prisma.
7. Best-effort `signOut({ scope: "others" })`; log but do not fail the change.
8. Return `{ success: true, redirectTo: "/superadmin" | "/dashboard" }`.
9. Map errors to codes:
   - `wrong_current`
   - `weak_password`
   - `same_password`
   - `service`
   - `mismatch` (client-side only)

### Layout guards

Add a helper in `apps/web/lib/auth/session.ts`:

```ts
requirePasswordChanged(): Promise<User>
```

- If no user → redirect to `/login`.
- If `mustChangePassword` → redirect to `/change-password`.
- Otherwise return the user.

Apply to:

- `apps/web/app/[locale]/(dashboard)/layout.tsx`
- `apps/web/app/[locale]/(admin)/layout.tsx`
- `apps/web/app/[locale]/(superadmin)/superadmin/layout.tsx`

Order: password-change guard first, then role/platform-admin gate.

### Residual risk

Layout guards do not stop a flagged user from invoking a server action directly. Optionally add `assertPasswordChanged()` to `requireWriteAccess()` and other sensitive actions. Record this as a known limitation if not implemented.

---

## 8. Self-service change

`apps/web/app/[locale]/(dashboard)/dashboard/settings/profile/page.tsx`

- Replace the disabled “Change PIN” section with `ChangePasswordForm`.
- Remove the “PIN changes are handled by your administrator” copy.
- Keep the rest of the profile page unchanged.
- The form uses the same action and permanent policy.
- Show a success message after update.

---

## 9. Account creation and reset

### Admin — Create Farmer & Pond

`apps/web/components/admin/create-pond-form.tsx`

- Replace `pin` with `password`.
- Add `PasswordInput`, `PasswordStrength`, and confirm password.
- Show a warning when the temporary password is Weak.
- `name="password"`, `autoComplete="new-password"`.

`apps/web/lib/actions/admin.ts`

- Replace `pin` with `password` in `createPondWithFarmer`.
- Validate with `mode: "temporary"`.
- Create the Prisma user with `mustChangePassword: true`.
- Return a clear error if Supabase rejects the password.

### Superadmin — New Account

`apps/web/components/superadmin/new-account-form.tsx`

- Replace `pin` with `password`.
- Add `PasswordInput`, `PasswordStrength`, and confirm password.
- Warning for weak temporary passwords.
- `autoComplete="new-password"`.

`apps/web/lib/actions/superadmin.ts`

- Replace `pin` with `password` in `createPlatformUser`.
- Validate with `mode: "temporary"`.
- Create the user with `mustChangePassword: true`.

### CLI — `apps/web/prisma/manage-users.ts`

Commands:

- `create --farm-id <id> --name <name> [--role ...] --password <value>`
- `reset-password --farm-id <id> --password <value>`
- `reset-pin` remains as a deprecated alias for `reset-password`.

Flags:

- `--temporary` (default): validate with `mode: "temporary"`, set `mustChangePassword: true`.
- `--no-force-change`: validate with `mode: "permanent"`, set `mustChangePassword: false`.

Output:

- `list` marks accounts that still need a password change.
- `create` / `reset-password` print the temporary password and say the user must change it on first login.

### Demo provisioning

`apps/web/scripts/provision-demo-user.ts`

- `DEMO_PIN` → `DEMO_PASSWORD`.
- Default dev password: `OptiFeedDemo123` (passes permanent policy).
- After updating Supabase, set `mustChangePassword: false`.
- Log the demo farm ID and password for local development only.

### Seeds

`apps/web/prisma/seed.ts` and `seed-dev.ts`

- Set `mustChangePassword: false` for the demo user.
- Do not change their password; `provision-demo-user` owns that.

### Lockout copy

`apps/web/lib/auth/lockout.ts`

- “If this wasn't you, change the PIN.” → “If this wasn't you, change the password.”

---

## 10. Initial password rollout

1. Apply the migration.
2. Confirm the 5 accounts exist and are flagged.
3. Set each account to `password123` with temporary mode:
   ```bash
   pnpm --filter web manage-user reset-password \
     --farm-id <farm-id> \
     --password password123 \
     --temporary
   ```
   Accounts:
   - `demo-farmer-1`
   - `superadmin`
   - `tenant2-admin`
   - `independent-farmer`
   - `test`
4. Verify each Supabase Auth user can sign in with `password123`.
5. If Supabase’s leaked-password protection rejects `password123`, stop and report the exact error. Do not silently fall back.
6. Do not commit the live initial password to `README`, `CHANGELOG`, or any tracked doc. It stays in the rollout command/env.
7. Supabase dashboard: align the project password policy to min 8 + letters/numbers if available. This is an owner/dashboard action; the app enforces its own policy regardless.

### Security caveat

`password123` is a known breached password. Even as a temporary credential, there is a window where anyone who knows it can sign in first and change the password, locking the real user out — especially dangerous for `superadmin`. For a public deployment, use a unique random temporary password per account. Per the owner’s decision, all 5 use `password123`; reset `superadmin` to a unique password immediately after the rollout.

---

## 11. E2E handling

The e2e suite currently logs in as `demo-farmer-1` with `DEMO_PIN` on every test.

Add a Playwright setup step:

- `apps/web/e2e/auth.setup.ts` (new) or extend `global-setup.ts`.
- Try `DEMO_PASSWORD` first:
  - If it lands on `/dashboard`, the demo account is already stable.
- Otherwise try `password123`:
  - If it lands on `/change-password`, set the new password to `DEMO_PASSWORD`, submit, and expect `/dashboard`.
- If both fail, throw with a clear message.
- This runs once before the test project, so the password change is serialized and other workers do not race.

Update:

- `apps/web/playwright.config.ts` — add a `setup` project with `testMatch: /auth\.setup\.ts/` and make `chromium` depend on it, if the setup is implemented as a Playwright test. Alternatively, extend `global-setup.ts` with the same logic.
- `apps/web/e2e/helpers.ts` — `DEMO_PASSWORD`, `#password`.
- `apps/web/e2e/auth.spec.ts` — `DEMO_PASSWORD`, `#password`, invalid credential uses a non-PIN wrong password.
- Keep the other 4 accounts on `password123` for manual first-login testing.

Optional dedicated test:

- Create a disposable account with a unique farm ID, log in with `password123`, assert the change-password redirect, change to a strong password, assert dashboard, then clean up.
- This verifies the forced-change UI end to end without mutating demo.

---

## 12. Copy and i18n

### `apps/web/messages/en.json`

Login:

- `passwordLabel`: “Password”
- `passwordDesc`: “Enter the password provided by your administrator. A current PIN will work once, then you must set a password.”
- `errorPasswordRequired`: “Please enter your password.”
- `errorInvalid`: “Invalid Farm ID or password. Please check and try again.”

New `password` namespace:

- `strength.label`: “Password strength”
- `strength.weak`: “Weak”
- `strength.medium`: “Medium”
- `strength.strong`: “Strong”
- `requirements.minLength`: “At least 8 characters”
- `requirements.letter`: “At least one letter”
- `requirements.number`: “At least one number”
- `show`: “Show password”
- `hide`: “Hide password”
- `current`: “Current password”
- `new`: “New password”
- `confirm`: “Confirm new password”
- `mismatch`: “Passwords do not match.”
- `same`: “The new password must be different from the current password.”
- `wrongCurrent`: “Current password is incorrect.”
- `weak`: “Use at least 8 characters with a letter and a number.”
- `submit`: “Update password”
- `updated`: “Password updated.”
- `forcedTitle`: “Set a new password”
- `forcedDesc`: “Your account still uses a temporary password. Set a new password to continue.”
- `temporaryWarning`: “This is a weak temporary password. The user must change it on first login.”

Profile:

- Replace `changePin` → `changePassword`
- Replace `changePinDesc` → `changePasswordDesc`
- Remove `pinManagedByAdmin`

### `apps/web/messages/hil.json`

Mirror every key. Suggested values:

- Weak: “Maluya”
- Medium: “Tunga-tunga”
- Strong: “Mabaskog”
- “At least 8 characters”: “Labing menos 8 ka karakter”
- “At least one letter”: “Labing menos isa ka letra”
- “At least one number”: “Labing menos isa ka numero”
- “Passwords do not match”: “Indi magkapareho ang mga password”
- “Current password”: “Karon nga password”
- “New password”: “Bag-o nga password”
- “Confirm new password”: “Kumpirmaha ang bag-o nga password”
- “Update password”: “I-update ang password”
- “Password updated”: “Na-update ang password”
- “Set a new password”: “Mag-set sang bag-o nga password”
- “Show password”: “Ipakita ang password”
- “Hide password”: “Taguon ang password”

Maintain en/hil leaf parity.

### Docs

- `apps/web/.env.example`: `DEMO_PIN` → `DEMO_PASSWORD`.
- `docs/vercel-deployment-checklist.md`: `DEMO_PIN` → `DEMO_PASSWORD`.
- `CHANGELOG.md` under `Unreleased`:
  - Added: password strength meter, forced password change, self-service change.
  - Changed: login now uses a password; PIN is deprecated; CLI flags renamed.
  - Security: existing PIN accounts are forced to set a permanent password.

---

## 13. Tests

### Unit

- `apps/web/lib/__tests__/password.test.ts` (new):
  - `password123` is Weak and rejected in permanent mode.
  - `password123` is accepted in temporary mode.
  - `abcdefg1` is Medium (valid, under 12).
  - `Abcdefgh1234!` is Strong.
  - Missing letter / missing number / too short / too long / common password cases.
  - Unicode letter handling.
  - 72-byte limit.
- `apps/web/lib/__tests__/login-errors.test.ts`:
  - Rename `loginWithPin` → `loginWithPassword`.
  - Add `user.findUnique` and `platformAdmin.findUnique` mocks.
  - Assert `/change-password` redirect when `mustChangePassword` is true.
  - Assert `/superadmin` for an active platform admin.
- `apps/web/lib/__tests__/navigation-guard.test.ts`:
  - `/en/change-password` without a cookie redirects to login.
- `apps/web/lib/__tests__/session-identity.test.ts`:
  - No changes expected; verify `mustChangePassword` does not break the mocked row.
- Optional: `change-password` action tests with mocked Supabase/Prisma.

### E2E

- Update `helpers.ts` and `auth.spec.ts`.
- Add the setup step described in §11.
- Run only if `DATABASE_URL` and `E2E_ALLOWED_DB_HOST` are set.

### Commands

```bash
pnpm --filter web prisma:generate
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:e2e   # only with the e2e DB guard configured
```

---

## 14. Acceptance criteria

1. Login uses a normal password field; numeric-only input constraints are gone.
2. All 5 existing accounts are flagged and forced to `/change-password` on next login.
3. `password123` works once as the initial password.
4. The forced-change page rejects `password123` as the new password and requires 8+ chars with a letter and number.
5. The strength meter shows Weak / Medium / Strong correctly.
6. After a successful change, the user reaches the correct landing page (`/superadmin` for platform admins, `/dashboard` otherwise).
7. Profile Settings allows self-service password change.
8. Admin/superadmin account creation uses passwords, confirmation, and the strength meter.
9. `manage-user` supports `--password`, `reset-password`, and the deprecated `reset-pin` alias.
10. No user-facing “PIN” copy remains in login, profile, admin, or superadmin flows.
11. en/hil message files have matching keys.
12. Unit tests, typecheck, and lint pass.
13. The e2e suite remains stable and the forced-change flow is covered.
14. The migration and rollout are verified against the live database without exposing passwords in tracked files.
15. The dedicated branch plan exists at `docs/password-auth-plan.md`, is committed before implementation commits, and matches the locked decisions in this document.

---

## 17. Implementation log (2026-10-26)

### Applied

- Migration `20261026000000_add_must_change_password` applied to the live database. All 5 existing users were backfilled to `mustChangePassword = true`.
- All 5 accounts reset to the temporary password `password123`:
  - `demo-farmer-1`
  - `superadmin`
  - `tenant2-admin`
  - `independent-farmer`
  - `test`
- Supabase accepted `password123`; leaked-password protection did not reject it.
- The demo account was temporarily stabilized by the e2e setup, then reset to `password123` with the flag set again.

### Verification evidence

| Check | Result |
|---|---|
| `pnpm --filter web test` | 67 files, 756 tests passed |
| `pnpm --filter web typecheck` | passed |
| `pnpm --filter web lint` | passed |
| `pnpm --filter web build` | passed; `/[locale]/change-password` route emitted |
| Playwright `e2e/auth.spec.ts` | 5 passed |
| Forced change — `test` | `/login` → `/change-password` → `/dashboard` |
| Forced change — `superadmin` | `/login` → `/change-password` → `/superadmin` |
| Self-service change | Profile Settings → “Password updated.” |
| Strength meter | Weak / Medium / Strong labels verified for `password123`, `abcdefg1`, `Abcdefgh1234!` |

### Residual notes

- The e2e global setup resets `demo-farmer-1` to `DEMO_PASSWORD` and clears the flag so the suite is stable. It does not touch the other four accounts.
- Direct server-action calls by a flagged user are not blocked by the layout guard. The UI and login redirects are covered; add `assertPasswordChanged()` to sensitive actions if this needs hardening.
- `password123` remains a known breached password. It is temporary-only and all five accounts are flagged for a forced change; reset `superadmin` to a unique password immediately after the rollout if the deployment is public.

---

## 15. Risks and open items

- **Supabase leaked-password protection** may reject `password123`. Stop and report if it does.
- **Non-atomic update:** Supabase password update and the Prisma flag clear cannot be one transaction. If the flag update fails, the user can retry with the new password.
- **Direct server-action bypass:** layout guards do not cover a crafted server-action call. Add `assertPasswordChanged()` to sensitive actions if this needs hardening.
- **Security of `password123`:** known breached password; temporary-only and forced change mitigate but do not eliminate the takeover window.
- **Demo/e2e state:** the setup step changes `demo-farmer-1` to `DEMO_PASSWORD`; it will no longer be on `password123` after the suite runs.
- **Supabase dashboard policy:** app-level enforcement is authoritative; dashboard alignment is an owner action.
- **No email-based reset:** resets remain admin/CLI-driven. Do not add a public reset flow in this task.

---

## 16. Implementation order

1. Create an isolated worktree and task branch.
2. Create/update the dedicated branch plan at `docs/password-auth-plan.md`; commit it.
3. Add the Prisma field and migration.
4. Add `lib/auth/password.ts` and unit tests.
5. Add `PasswordInput`, `PasswordStrength`, and `ChangePasswordForm`.
6. Update the login page and `loginWithPassword`.
7. Add `post-login.ts` and the change-password page/action.
8. Add layout guards and `requirePasswordChanged`.
9. Update admin/superadmin create forms and actions.
10. Update `manage-user`, `provision-demo-user`, seeds, and lockout copy.
11. Update en/hil messages.
12. Update e2e helpers/setup and tests.
13. Update docs/changelog.
14. Run tests, typecheck, lint, and focused e2e.
15. Apply the migration and perform the 5-account rollout.
16. Verify the forced-change flow with one account before declaring done.
