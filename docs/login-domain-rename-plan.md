# Login domain rename plan (`pond.optifeed.local` → PakaonAI)

**Status: plan only. Nothing in this document has been implemented.** Mission T-15, plan decision
O13. The implemented part of T-15 is the Resend invitation email; this file is the careful plan for
renaming the internal login domain without locking existing users out.

**TL;DR.** The pond domain is not an email service. It is a synthetic address that turns a login ID
into the `email` value Supabase Auth expects (`<login-id>@pond.optifeed.local`). Renaming it means
changing three things together: the code constant, the Supabase Auth `email` of every user, and the
matching `User.email` row. A blind constant change locks every existing account out. The safe order
is **accept both domains → make login resolve both → migrate Supabase emails in batches → move the
producer code → verify → retire the legacy domain only after a quiet period**.

Decisions needed from Jeff before implementation:

1. **Target domain.** Recommended: `pond.pakaonai.local` (internal-only, non-routable, no mailbox).
   Alternative: a real subdomain such as `login.pakaonai.syntaxure.dev`, which is routable and could
   receive bounces or be mistaken for a real mailbox. This plan assumes `pond.pakaonai.local`.
2. **Migration window.** A short window with no new membership provisioning is simplest. Without one,
   the script must be re-runnable and catch accounts created mid-run.
3. **Retention of the legacy domain.** Recommendation: keep `@pond.optifeed.local` accepted for reads
   until at least the Supabase refresh-token lifetime after the last migrated account, then remove it
   in a separate release.

---

## 1. How the current login model works

- The login form collects a **Farm ID** (`apps/web/app/[locale]/login/page.tsx` → `farmIdLabel`).
- `loginWithPassword` normalizes it and calls
  `supabase.auth.signInWithPassword({ email: buildPondEmail(farmId), password })`
  (`apps/web/lib/actions/auth.ts`, around line 59).
- `buildPondEmail` appends the hardcoded domain (`apps/web/lib/auth/session.ts`):
  `POND_EMAIL_DOMAIN = "pond.optifeed.local"`.
- The session JWT therefore carries the synthetic email. `getCurrentUser` requires
  `farmIdFromPondEmail(session.email) === dbUser.farmId` (`lib/auth/session.ts`), and API
  authentication repeats that check in `lib/auth/with-auth.ts`.
- Provisioning creates the Supabase user with the same synthetic address:
  `manage-users.ts`, `membership-invite.ts`, `admin.ts` (`createPondWithFarmer`),
  `superadmin.ts` (`createPlatformUser`), seed scripts, demo provisioner and E2E setup.
- Nothing sends mail to the pond domain. It is not a deliverable mailbox; password changes are done
  inside the app, and invitations are now delivered to the inviter-typed real address (T-15).

The domain literal is duplicated rather than centralized, so a rename must update every producer and
every reader, plus the seeded/fixture data.

## 2. Inventory (grep snapshot, 2026-10-26)

Search performed: `pond\.optifeed\.local`, `POND_EMAIL_DOMAIN`, `buildPondEmail`,
`farmIdFromPondEmail`, `buildSeedEmail`, `DEMO_EMAIL` across the repository (excluding
`node_modules`/`.git`).

### 2.1 Runtime producers and readers (must change)

| File | What it does | Change |
|---|---|---|
| `apps/web/lib/auth/session.ts` | `POND_EMAIL_DOMAIN`, `buildPondEmail`, `farmIdFromPondEmail`, `getCurrentUser` gate | Single source of truth: current domain + legacy-domain acceptance list |
| `apps/web/lib/auth/with-auth.ts` | API auth repeats the pond-domain check | Uses the same acceptance helper |
| `apps/web/lib/actions/auth.ts` | Login builds the Supabase email | Resolve the account's actual email first; fall back to the configured domain (see §4) |
| `apps/web/lib/membership-invite.ts` | New member login is provisioned on the pond domain | Uses the centralized builder |
| `apps/web/lib/actions/admin.ts` | `createPondWithFarmer` builds the pond email | Uses the centralized builder |
| `apps/web/lib/actions/superadmin.ts` | `createPlatformUser` builds the pond email | Uses the centralized builder |
| `apps/web/prisma/seed-identity.ts` | Duplicate `POND_EMAIL_DOMAIN` + `buildSeedEmail` | Import the centralized builder or the shared constant |
| `apps/web/prisma/manage-users.ts` | Duplicate `buildPondEmail` helper | Import the centralized builder |
| `apps/web/prisma/seed.ts` | Demo email via `buildSeedEmail` | No literal; follows the builder |
| `apps/web/prisma/seed-dev.ts` | Demo email via `buildSeedEmail` | No literal; follows the builder |
| `apps/web/scripts/provision-demo-user.ts` | Literal `demo-farmer-1@pond.optifeed.local` | Use the shared builder |
| `apps/web/e2e/global-setup.ts` | Literal `DEMO_EMAIL` | Use the shared builder |

### 2.2 Tests and fixtures (must change or be intentionally dual-domain)

| Area | Files |
|---|---|
| Session identity | `lib/__tests__/session.test.ts`, `session-identity.test.ts` |
| Auth/API | `api-auth.test.ts`, `auth-fast-path.test.ts`, `login-errors.test.ts`, `password-guard.test.ts`, `import-access.test.ts`, `import-atomic.test.ts`, `import-fish-samples.test.ts`, `view-as-api.test.ts`, `view-as-write-guards.test.ts` |
| Admin/superadmin | `admin-tenancy.test.ts`, `superadmin-mutations.test.ts`, `superadmin-audit.test.ts`, `member-management.test.ts`, `platform-members.test.ts`, `device-token-reveal.test.ts`, `device-labels.test.tsx`, `farm-actions.test.ts` |
| Seeds/tenancy | `seed-identity.test.ts`, `helpers/tenancy.ts` |
| Step-up | `step-up-action.test.ts` |

The fixtures are assertions, not production data. Update them in the same change as the constant.
Dual-domain acceptance needs explicit new tests (`old` **and** new domain accepted; a lookalike
domain still rejected).

### 2.3 Documentation and historical SQL

| File | Note |
|---|---|
| `docs/system-context.html` | Describes the synthetic-email login |
| `docs/password-auth-plan.md` | Mentions an orphan identity `aquanest-demo@pond.optifeed.local` |
| `docs/SUPERADMIN-MULTITENANCY-PLAN.md` | O13 decision text |
| `docs/missions/2026-10-26-autonomous-mission.md` | Task table |
| `apps/web/prisma/migrations/20261004010000_fix_rls_policies_and_farm/migration.sql` | Comment only; **never edit a shipped migration** |

Documentation should be updated in the same PR. Historical migrations stay untouched.

### 2.4 Data (not in git)

1. **Supabase Auth users**: `auth.users.email` for every provisioned login, including orphan
   identities that have no `User` row (for example the `aquanest-demo` identity noted in
   `docs/password-auth-plan.md`).
2. **`User.email`** in PostgreSQL: unique, must match the Supabase Auth email for the same
   `User.supabaseId`.
3. **Live sessions/JWTs**: they carry the email that was valid when the token was issued. This is the
   main reason the legacy domain must stay accepted for a while.
4. **E2E/seed data** in the shared project: demo accounts use the literal domain.

## 3. Why the constant cannot simply be changed

`getCurrentUser` and `withAuth` reject a session whose email local part does not match the user's
`farmId` **and** whose domain is not the trusted pond domain. If only the code constant changes:

- `buildPondEmail("juan")` returns the new address, but Supabase still stores the old one, so
  `signInWithPassword` fails for every existing user.
- Any still-valid JWT with the old email stops resolving, because the reader now trusts only the new
  domain.
- Seeding, `manage-user`, invitations, and superadmin user creation would create accounts on a domain
  that existing tooling does not look up.

## 4. Transition design

### Phase 0 — Backup and preflight (read-only)

- Take a full database backup (mission D5 requires one before any migration) and export the Supabase
  Auth user list (`auth.admin.listUsers`, paged) to a file outside the repo containing `id`, `email`,
  `created_at`, and `email_confirmed_at`. **No passwords or tokens.**
- Build the mapping from `User` rows by `supabaseId` (never by email) and record:
  - rows whose Supabase email and `User.email` disagree;
  - target-domain collisions (`newAddress` already belongs to another account);
  - orphan Supabase identities with no `User` row (report, do not guess);
  - accounts where `farmId` is not a valid login-id local part.
- Verify `select count(*)` for `User` and the Supabase export count; store the counts with the
  backup so rollback can be proven complete.

### Phase 1 — Accept both domains (no visible change)

Introduce one module-level source of truth, for example:

```ts
const POND_EMAIL_DOMAIN = process.env.POND_EMAIL_DOMAIN ?? "pond.pakaonai.local";
const LEGACY_POND_EMAIL_DOMAINS = ["pond.optifeed.local"]; // emptied only in the final phase
```

- `buildPondEmail` uses `POND_EMAIL_DOMAIN`.
- `farmIdFromPondEmail` accepts the current domain and every legacy domain, and continues to reject
  any other domain.
- Keep `POND_EMAIL_DOMAIN` set to `pond.optifeed.local` in this release so behaviour is unchanged.
- Deploy through the normal path (`staging` preview, then `main`; mission D7 — `develop` is never
  deployed). Verify login with an existing account and with a test account.

### Phase 2 — Make login independent of the stored domain

`loginWithPassword` must find the account before choosing the Supabase email:

1. Normalize the Farm ID (unchanged).
2. Look up `User` by `farmId`; if present and its `email` is on an accepted domain, use that exact
   address for `signInWithPassword`. This is the authoritative email and works before, during and
   after migration.
3. If no row exists (or the row has no address), fall back to `buildPondEmail(farmId)` for the
   legacy behaviour.
4. Do **not** expose whether the difference came from a lookup; failed credentials still return the
   existing generic `invalid` result and keep the existing lockout counters (keyed by Farm ID, not
   email).

Deploy and verify before touching any Supabase user. This step alone makes the migration
non-breaking.

### Phase 3 — Migrate data with an idempotent admin script

Script shape (new `apps/web/scripts/rename-login-domain.ts`, run by the integrator, not a worker):

- Inputs: `--from pond.optifeed.local --to pond.pakaonai.local`, `--dry-run` (default),
  `--apply`, optional `--limit`/`--batch`, `--mapping <file>`.
- Page through `auth.admin.listUsers`; for each user whose email is on `--from`:
  1. Derive the target address from the current local part only.
  2. Skip when it is already on `--to` (idempotent re-run).
  3. Abort that record when the target address is already taken by another auth user.
  4. `auth.admin.updateUserById(id, { email: target, email_confirm: true })`.
  5. In the same record, update the matching `User` row by `supabaseId` **after** Supabase succeeds
     (`User.email = target`), inside a short transaction.
  6. Append `{id, farmId, oldEmail, newEmail, result}` to the mapping file (no secrets).
- Retry transient Supabase/Postgres failures with bounded backoff; stop on repeated failure and
  report the exact record.
- Never log passwords, tokens, or the service-role key. Never print the connection string.
- Orphan identities with no `User` row: report only. They cannot sign in to the app, but they still
  occupy an email in Supabase; renaming them is a separate, explicit decision.
- Because Phase 2 resolves the `User.email`, changing Supabase first and Postgres second leaves no
  window where a user is locked out. If the process dies between the two writes, the next run sees
  the Supabase email on `--to`, updates the DB row, and continues.
- Run the dry run, review the report, then apply in small batches. Record counts before/after and
  verify zero remaining `@pond.optifeed.local` `User` rows (orphans excepted and documented).

### Phase 4 — Move the producers

In one PR:

- Set the default `POND_EMAIL_DOMAIN` to `pond.pakaonai.local` (or set the env var in `staging`/`main`
  first, then change the default).
- Update the seed/demo/E2E scripts and every fixture and assertion listed in §2.
- Keep legacy acceptance in `LEGACY_POND_EMAIL_DOMAINS`.
- Add tests: new domain builds; old and new domains parse; lookalike domain rejected; login works
  when the DB row still carries the old address and when it carries the new one.
- Update the documentation listed in §2.3.

### Phase 5 — Verify

- Sign in with at least one migrated admin, one migrated operator, and the demo account; confirm the
  JWT email is the new domain after token refresh.
- Confirm `auth.users.email = User.email` for all migrated rows (join by `supabaseId`).
- Exercise member invite, superadmin create user, `manage-user`, seed-dev, and the E2E setup.
- Confirm no `@pond.optifeed.local` values remain in `User.email` (except documented orphans).
- Check logs for auth failures or domain-mismatch drops.

### Phase 6 — Retire legacy acceptance (later release)

- Wait at least the Supabase access/refresh-token lifetime (and a quiet period with no old-domain
  logins) before emptying `LEGACY_POND_EMAIL_DOMAINS`.
- Remove the legacy list and its tests only in a separate, clearly labelled release. Reverting is then
  a code revert, not a data revert.

## 5. Ordering relative to deployments (mission D7)

1. Phase 0 backup and preflight — no deployment.
2. Phase 1 dual acceptance, with the current domain unchanged — deploy to `staging`, verify, then
   `main` (owner-approved promotion).
3. Phase 2 login resolution — same deployment path, verified before any data change.
4. Phase 3 data migration — no deployment; run against the project only after Phases 1–2 are live.
5. Phase 4 producers/tests/docs — normal PR; deploy to `staging`, verify, then `main`.
6. Phase 5 verification.
7. Phase 6 cleanup — later release.

Do not deploy `develop` by any route. Do not run the migration during a feed or while membership
provisioning is active if it can be avoided.

## 6. Rollback

| Failure point | Rollback |
|---|---|
| Phase 1/2 code is wrong | Revert the release; Supabase/Postgres data is untouched |
| Phase 3 stopped mid-run | Re-run the idempotent script; Phase 2 keeps both domains working |
| Bad target address for a batch | Use the mapping file to reverse just that batch (`--from`/`--to` swapped), then re-run forward |
| Full data rollback required | Restore the database backup and reverse the Supabase email changes from the mapping file (**not** from the backup, which does not cover `auth.users`); verify counts and a test login |
| Legacy acceptance removed too early | Re-deploy a release that accepts the legacy domain; sessions recover on next request |

The script must support `--dry-run` for the reverse direction before applying it.

## 7. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Existing JWT carries the old email | `getCurrentUser` can reject a valid session | Keep both domains accepted through the refresh-token lifetime |
| Supabase email uniqueness collision | Two accounts could map to one target address | Preflight collision report; abort the record and resolve manually |
| DB write fails after Supabase succeeds | `User.email` and auth email disagree | Phase 2 resolves `User.email`; idempotent script repairs on re-run |
| New accounts created during migration | They may be on the old domain after the sweep | Freeze provisioning during the window, or re-run until the remaining count is zero |
| Orphan auth identities | They have no `User` row and are invisible to the app | Report only; decide separately |
| Real-looking target domain | A routable domain could receive bounces or be mistaken for a mailbox | Prefer `pond.pakaonai.local` (internal, non-routable) |
| Password-reset / confirmation mail | Supabase sends to this address for some flows | Keep those flows disabled or admin-only, as they are today |
| E2E/seed fixtures drift | Tests fail or seed the wrong identity | Centralize the builder and update fixtures in Phase 4 |
| Migration script logging | A careless log could expose data | Log IDs and domains only, never credentials; service-role key stays in env |
| Historical migrations edited | Shipped migrations must stay immutable | Update comments/docs only; never edit a migration file |
| Shared production project (D5) | A mistake affects live data | Backup, dry run, batches, mapping file, explicit owner go-ahead for the window |

## 8. Acceptance checklist for the future implementation

- [ ] Target domain decided by Jeff and recorded in the plan.
- [ ] Backup and Supabase user export stored; counts recorded.
- [ ] Dual-domain acceptance shipped and verified on `staging` and `main`.
- [ ] Login resolves the stored `User.email` and still enforces lockout and rate limits.
- [ ] Dry-run report reviewed: mapping, mismatches, collisions, orphans.
- [ ] Batched apply completed; zero unexpected old-domain rows.
- [ ] One admin, one operator and the demo account signed in after migration.
- [ ] Producers, seeds, E2E and tests moved to the new domain.
- [ ] Docs updated; no migration file edited.
- [ ] Legacy acceptance retained for the agreed quiet period, then removed in a separate release.
