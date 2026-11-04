# Optional TOTP MFA for platform admins (#719)

| | |
| --- | --- |
| Status | Shipped, **optional** |
| Scope | Platform admins (`PlatformAdmin` row) |
| Factor | TOTP (authenticator app) |
| Owner decision | Enrolment first, **unenforced**; enforcement is a separate decision |
| Storage | Supabase Auth (`auth.mfa_factors`) only — no application table |

## Why optional

Issue #719 asks for a second factor on the highest-privilege accounts. The
owner's recorded decision is to ship TOTP **without enforcement** so that no
administrator is locked out during rollout. The console therefore offers
enrolment, challenges any account that has a verified factor, and otherwise
behaves exactly as before.

Nothing in this change makes MFA mandatory. There is no policy that requires a
factor, no role-level exception list and no "enrol later" grace screen. A
platform admin with no factor signs in with a password exactly as today.

## What Supabase provides

The installed clients (`@supabase/supabase-js` 2.110.0, `@supabase/ssr` 0.6.1)
already expose the whole flow under `supabase.auth.mfa`:

| Call | Use |
| --- | --- |
| `enroll({ factorType: "totp" })` | Creates an unverified factor, returns the secret, QR code and `otpauth://` URI once |
| `listFactors()` | The account page's factor list (metadata only) |
| `challengeAndVerify({ factorId, code })` | Confirms an enrolment and checks a fresh code before removal |
| `unenroll({ factorId })` | Removes a factor |
| `getAuthenticatorAssuranceLevel()` | Reads the session's `aal1`/`aal2` level and whether a verified factor exists |

**No dependency was added.** Supabase returns the QR code itself, so the
repository's existing `qrcode-generator` package is not used for MFA. **No
Prisma model or migration was added**: `PlatformAdmin.mfaEnrolledAt` already
existed and is now written as a reporting timestamp for the security band. It is
not a gate — a stale value can never lock an administrator out, because the
sign-in challenge is decided from Supabase's AAL, not from that column.

## Enrolment flow

`/superadmin/account` → **Two-factor authentication**.

1. The admin presses **Add authenticator app**. The server action
   `beginTotpEnrollment()` calls `mfa.enroll()` on the cookie-bound Supabase
   client and returns `{ factorId, secret, qrCodeDataUrl }` to the component's
   state. Any earlier *unverified* TOTP factor is discarded first so abandoned
   attempts cannot pile up against the per-user factor limit.
2. The page shows the QR code and the secret once, with a copy button. The
   secret is never logged, never written to the database and never returned by
   any other action.
3. The admin scans the code and submits a 6-digit code.
   `confirmTotpEnrollment()` calls `challengeAndVerify()`. On success Supabase
   promotes the session to `aal2` (and revokes the account's other sessions, as
   it does for any new factor), and the action records
   `PlatformAdmin.mfaEnrolledAt = now()` for reporting.
4. **Active authenticator apps** lists verified factors with their creation
   date. A pending (unverified) factor is shown separately and can be discarded
   without a code — it is not a second factor yet and grants nothing.

Removal requires a **fresh code**: `unenrollTotpFactor()` verifies a current
TOTP code with `challengeAndVerify()` *before* calling `unenroll()`. A stolen
`aal1` session cannot remove the factor, and a stolen `aal2` session still needs
the device. When the last verified factor is gone, `mfaEnrolledAt` is cleared.

All three actions start with `requirePlatformAdmin()`, which (see below) itself
requires a completed challenge once a factor exists.

## Sign-in flow

1. `loginWithPassword()` accepts the password. If Supabase returns a user with a
   verified factor, the action returns `{ mfaRequired: true }` **without**
   resolving a destination and **without** redirecting. The session at that
   point is `aal1` and cannot open the platform console.
2. The login page switches to the code step. `completeMfaLogin()` re-reads the
   live user, picks the verified TOTP factor (never a client-supplied id), calls
   `challengeAndVerify()` and only then resolves the post-login destination and
   redirects. Attempts are rate-limited per IP, fail-closed.
3. A user with no factor never sees the step and is redirected exactly as
   before.
4. Abandoning the step (**Use a different account**) clears the local session
   with `signOut({ scope: "local" })`; the account is untouched and can sign in
   again.

The server-side gate lives in `requirePlatformAdmin()`: every
`/superadmin/**` page and every platform server action already calls it, so a
pending `aal1` session is redirected to `/login` before the console renders.
`isCurrentPlatformAdminMfaSatisfied()` covers the one API route that authorizes
on `isCurrentPlatformAdmin()` directly (the full backup export), and the
platform scope of global search. The assistant only *proposes* platform
actions; execution re-enters the gated server actions.

## Recovery when the device is lost

There is **no self-service bypass** — no email fallback, no backup codes, no
"remember this device" exemption, no recovery action in the app. That is
deliberate: any of those would defeat the factor.

The exact recovery path is:

1. A platform administrator with access to the Supabase project opens the
   dashboard for the project in `NEXT_PUBLIC_SUPABASE_URL`.
2. **Authentication → Users**, select the affected account
   (`<farm-id>@pond.optifeed.local`), and delete the TOTP entry under
   **Factors**.
3. The affected admin signs in with their password again. With no verified
   factor left, the login action does not challenge and the console opens.

Notes:

- `PlatformAdmin.mfaEnrolledAt` is reporting-only. Removing the factor in the
  dashboard is sufficient even if the column still says the admin is enrolled;
  the next in-app enrolment or removal refreshes it.
- The Supabase dashboard is project-owner access, not an application role. Do
  not grant it to resolve a support ticket unless the person already holds it.
- If the affected admin is the only person with dashboard access, the project
  owner is the recovery path. There is no application-level break-glass.
- Never "temporarily" disable the gate, delete a factor through SQL or add a
  bypass to unblock someone. Remove the factor through Supabase Auth so the
  auth server's state and the session's AAL stay consistent.

## Deliberately not built

- **Enforcement.** No requirement to enrol, no role-level block, no
  time-boxed exception. That is a separate owner decision; when it is taken it
  should also decide what happens to an admin who has not enrolled.
- **Tenant owners/admins.** Issue #719 proposes them next; the UI and gate are
  written against `PlatformAdmin`, not `UserRole`.
- **WebAuthn/passkeys and phone factors.** Supabase supports both; this change
  verifies TOTP only. A verified non-TOTP factor fails closed
  (`{ error: "unsupported" }`) rather than being skipped.
- **Audit rows.** Enrolment and removal are not written to `PlatformAuditLog`
  yet; the table's action taxonomy and reason requirement are designed for
  operator actions on other accounts. Add them with the enforcement decision.

## Verification

- `lib/auth/mfa-policy.ts` is pure and unit-tested
  (`lib/__tests__/mfa-policy.test.ts`): challenge detection, factor selection
  and code normalisation.
- `lib/__tests__/mfa-actions.test.ts` pins the safety order (verify before
  remove), the refusal of unverified factors and the reporting-timestamp
  updates.
- `lib/__tests__/mfa-login.test.ts` covers the password step stopping before a
  redirect, the successful promotion, the wrong-code path, the rate limit, the
  dashboard-recovery path and the unsupported-factor fail-closed path.
- `lib/__tests__/backup-routes.test.ts` adds the `aal1` refusal on the backup
  export.
- The manual end-to-end check (enrol, sign out, sign in, remove) needs a real
  Supabase project with MFA enabled; it was not executed in this change and
  must be done before enforcement is considered.
