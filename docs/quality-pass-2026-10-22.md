# Quality pass — 2026-10-22

Autonomous pass requested by Jeff: reconcile to `develop`, harden RBAC, polish
the UI, and keep working under resource pressure.

## Method and orchestration

| Task | Agent | Worktree | Branch | Output |
| --- | --- | --- | --- | --- |
| RBAC audit | `explore` subagent (read-only) | main worktree | — | 18 findings, no critical path |
| UI polish audit | `explore` subagent (read-only) | main worktree | — | 25 findings |
| RBAC hardening | parent + `general` subagent | `optifeed-worktrees/rbac-hardening` | `fix/rbac-hardening` | PR #65, merged `9b6d774` |
| Settings/nav/dark/empty states | parent | `optifeed-worktrees/quality-pass` | `chore/quality-pass` | PR #66, merged `bc72129` |
| Locale/dark notifications + audit | `general` subagent | `optifeed-worktrees/ui-followup` | `fix/ui-followup` | PR #67 |

Resource level started **red** (2.3 GB free, CPU 100%). Light work continued
(audits, docs, small edits); heavy checks were deferred until the level moved to
amber/green, then run. No check was recorded as passing while deferred.

No benchmark subagent was dispatched: the changes are authorization guards,
markup and copy, with no latency, memory, bundle-size or query-plan claim to
measure. Static review plus the existing test suite is the appropriate evidence.

## RBAC audit — conclusion

No verified unauthenticated or cross-tenant data path. Every farmer query is
scoped by `Pond.ownerId = User.farmId`; every page/route re-derives identity
from the session. The real gaps were in the half-migrated organization model and
privileged-account lifecycle.

### Fixed (PR #65)

- Notifications are no longer VIEWER-writable; tier input validated; active pond
  resolved deterministically.
- Tenant admins cannot edit/delete a platform admin; orphaned grants removed.
- `deleteUserSubtree` moved out of the `"use server"` module.
- `getDevices` no longer returns `token`/`tokenHash`.
- `requireWriteAccess()` hoisted above `try` in two actions.
- `/api/export-pdf` uses `withAuth`.
- `Organization.status` gates tenant scope (SUSPENDED/PENDING_DELETION/PURGED
  grant nothing).
- Last-admin protection and self-revoke protection for platform admins.
- Static test asserts every API route uses an auth wrapper, is a device-token
  route, or is the allowlisted health route.

### Not fixed (needs a scoped decision)

- `MembershipPermission` rows are still never enforced; per-member revocation of
  `control_feeder` has no effect.
- The tenant console is gated by global `UserRole.ADMIN`, not tenant membership.
- Admin mutations write no audit row.
- No step-up re-authentication before granting/revoking platform admin.
- The proxy remains a cookie-presence check; server checks are the real gate.

## UI audit — fixed (PRs #66, #67)

- Tablet navigation gap (768–1023 px had no nav); phone bottom nav no longer
  scrolls horizontally.
- Dead "sync" header button removed.
- Hardware settings no longer ship fake SSID/password/server values; unwired
  actions are disabled with an explanation.
- Profile settings populate the real email/role; unwired save/PIN buttons are
  disabled with an explanation.
- History rows and log-sample batch summary were dark-on-dark; fixed.
- Notifications, audit, `not-found` and dashboard `error` have dark variants,
  translated copy and locale-safe links.
- Admin/platform consoles gained `loading.tsx` and `error.tsx`.
- Dashboard and admin-users empty states; FCR tile no longer claims "optimal"
  without a report; farmer empty state no longer references the seed script.
- `hil.json` parity restored (553 leaves each; one missing key and several new
  keys added).

## Deferred UI work

- Admin/platform console strings are still English-only.
- Six near-identical admin/superadmin tables are not extracted into a shared
  component.
- Growth page has some remaining hardcoded English.
- No browser/dark-mode screenshot verification was possible (no credentials;
  staging is behind Vercel SSO). Changes are lint/typecheck/test and static
  review verified only.

## Verification and evidence

| Item | Evidence |
| --- | --- |
| Lint | PR #65 and #66 worktrees: pass; #67: pass (235 files) |
| Typecheck | Pass in all three worktrees after `prisma generate` |
| Tests | 40 files / 353–356 tests pass per branch |
| CI | #65 and #66 `quality` success and merged; #67 pending at time of writing |
| Database | `prisma migrate status`: 28/28 applied, schema up to date |
| Production | Untouched at `2795bef`; PR #63 still blocked on required review |

## Next steps

1. Merge #67 when its `quality` check completes.
2. Keep the new work on `develop` until the approved production release (#63)
   ships; promoting `staging` now would silently widen that release.
3. After production: set `OPENROUTER_API_KEY` in Vercel, then promote
   `develop → staging` with the AI/biomass reconciliation and this quality pass.
4. Optional follow-ups: permission-table enforcement, admin audit trail,
   step-up auth, shared table component, admin console translations.
