# ADR-0006: Multi-tenant access control with membership roles and permission overrides

- **Status:** Accepted
- **Date:** 2026-10-17 (locked plan decisions); permission enforcement 2026-10-22
- **Deciders:** Jeff (owner)
- **Backfilled:** 2026-10-29
- **Related:** issues #329, #330, #331, #332; [ADR-0002](./0002-json-bridges-before-defense.md)

## Context

OptiFeed started as a single-farm application where `User.role` decided what a
person could do. The multi-tenancy plan
([`docs/SUPERADMIN-MULTITENANCY-PLAN.md`](../SUPERADMIN-MULTITENANCY-PLAN.md))
moved it to a commercial SaaS shape with these locked decisions:

- **T1** Tenant = `Organization`; users join through memberships with roles.
- **T2** Hierarchy: Organization -> Farm -> Pond -> Feeder Unit -> Controller.
- **T4/T19** A platform administrator is god mode across tenants.
- **T5** Every platform admin action writes an audit row with a required reason;
  destructive and device actions also require step-up re-authentication.
- **T9** Tenant deletion revokes access immediately, retains data for a grace
  period, then purges.

Two constraints made a naive role swap unsafe. Existing accounts had no
permission rows and could not be locked out by a migration, and a role is too
coarse for one specific operation - `control_feeder` must be revocable for a
member who is otherwise an `ADMIN` or `OPERATOR`.

## Decision

1. **Organization membership is the tenant authority.** A `Membership`
   (`orgId`, `userId`, `role`, `revokedAt`) is what grants access to a tenant;
   `User.role` alone is not enough. The tenant console requires an active
   `OWNER`/`ADMIN` membership in an `ACTIVE` organization
   (`apps/web/lib/auth/tenant-admin.ts`), and `resolveOrgScope()` is the tenant
   boundary for data access.
2. **Roles carry defaults; `MembershipPermission` rows add or remove.**
   [`apps/web/lib/auth/permissions.ts`](../../apps/web/lib/auth/permissions.ts)
   defines ten permissions and `ROLE_DEFAULTS`. A row with `revokedAt = null`
   grants; a row with `revokedAt != null` denies, even for `OWNER`. Role defaults
   always apply, so a membership never has to enumerate every permission.
3. **No rows means "behave as the role always did."** This is the compatibility
   bridge: the bootstrap migration created organizations and memberships but no
   permission rows, so every pre-existing membership starts with zero rows and
   keeps working. A migration was not used to backfill permissions.
4. **Resolution is fail-closed and pure where possible.**
   `effectivePermissions(role, overrides)` is synchronous and unit tested;
   `getCurrentPermissions()` walks session -> memberships -> `ACTIVE`
   organizations -> permission rows, and returns an empty set if any link is
   missing. Unknown permission strings are ignored rather than granting
   anything.
5. **Platform administration is a separate authority.** An active
   `PlatformAdmin` row (`requirePlatformAdmin()`) is required for `/superadmin`;
   a tenant `OWNER` does not imply it, and a platform admin does not gain farm
   write powers from the platform grant. Platform mutations require a reason, an
   audit row and, for destructive or device actions, a fresh step-up; read-only
   view-as blocks tenant writes (`assertNotViewingAs`).
6. **Permission checks are server-side.** Server actions call
   `requirePermission(permission)`, which also enforces the password-change gate
   and blocks view-as. The UI does not hide or disable other controls; it is not
   the security boundary.

## Consequences

### Positive

- Least privilege is per membership, and `control_feeder` can be revoked without
  changing a person's role.
- Existing accounts were not locked out by the migration because the role
  defaults are the fallback.
- Platform actions are auditable with a reason, and destructive actions require
  re-authentication.
- The resolver is pure and testable, so the "no rows" and "some rows" paths
  cannot silently diverge.

### Negative / accepted costs

- **The permission union is not per-organization.** `getCurrentPermissions()`
  unions every active membership because the product assumes one active
  organization at a time; there is no org switcher yet (plan M2.4). Until then,
  a permission granted in org A is not scoped away from org B. **This module is
  not the cross-tenant isolation boundary** - `resolveOrgScope()` and the
  ownership filters are.
- **`MembershipPermission.permission` is free text.** The runtime gate
  (`isPermission`) is what keeps an unexpected row from becoming a grant, but the
  database itself does not constrain the value.
- **Tenant isolation depends on application code.** RLS is enabled on the core
  tables only; the plan's `db.forOrg()` extension and RLS defense in depth (M8.3)
  are not implemented. A code path that imports the raw Prisma client for a
  tenant model is not stopped by the database.
- **MFA is not implemented.** `PlatformAdmin.mfaEnrolledAt` exists but is never
  written; T13 makes MFA a commercial-readiness gate before the first paying
  tenant, not a capstone-defense requirement.
- **Open defects in how the controls apply.** The authorization review records
  spoofable audit IP (#329), a pre-auth rate-limit bucket (#330), missing step-up
  and rate limits on platform token reveal/legacy role change (#331), and a CI
  check that asserts an import rather than a guarded handler (#332). None of them
  invalidates the model; all of them are tracked rather than hidden.

### Follow-ups

- Implement the active-org cookie and switcher (M2.4), then replace the union
  with a per-organization resolution.
- Add RLS defense in depth (M8.3) and the `db.forOrg()` tenant client (M2).
- Write `mfaEnrolledAt` and enforce TOTP before the first paying tenant (T13).
- Close #329-#332; do not treat the current audit row as tamper-proof until
  #329 is fixed.

## Links

- Implementation: [`apps/web/lib/auth/permissions.ts`](../../apps/web/lib/auth/permissions.ts),
  [`apps/web/lib/auth/org-scope.ts`](../../apps/web/lib/auth/org-scope.ts),
  [`apps/web/lib/auth/tenant-admin.ts`](../../apps/web/lib/auth/tenant-admin.ts),
  [`apps/web/lib/auth/require-platform-admin.ts`](../../apps/web/lib/auth/require-platform-admin.ts),
  [`apps/web/lib/auth/step-up.ts`](../../apps/web/lib/auth/step-up.ts),
  [`apps/web/lib/auth/view-as.ts`](../../apps/web/lib/auth/view-as.ts),
  [`apps/web/lib/auth/with-auth.ts`](../../apps/web/lib/auth/with-auth.ts)
- Schema: `apps/web/prisma/schema.prisma` (`Organization`, `Membership`,
  `MembershipPermission`, `PlatformAdmin`, `PlatformAuditLog`,
  `ImpersonationSession`)
- Procedure: [`docs/rbac-permissions.md`](../rbac-permissions.md)
- Source of the decision: `docs/SUPERADMIN-MULTITENANCY-PLAN.md` section 1
  (T1-T5, T9, T19), section 3.2 (models), section 4 (tenancy and authorization)
- Review: [`docs/security/authz-review.md`](../security/authz-review.md)
