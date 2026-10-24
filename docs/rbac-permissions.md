# RBAC permission enforcement

**Status: backend enforcement plus a tenant-admin management UI.** `MembershipPermission` rows gate a
specific set of tenant server actions, and tenant admins can grant or revoke them from
**Admin → Users → Permissions**. The UI does not hide or disable other dashboard controls, and it does
not change tenant data scoping.

Source of truth for the permission model: [`SUPERADMIN-MULTITENANCY-PLAN.md`](./SUPERADMIN-MULTITENANCY-PLAN.md)
§4.1 (resolution order) and §4.2 (permission set).

## TL;DR

- A `MembershipPermission` row with `revokedAt = null` grants a permission.
- A row with `revokedAt != null` denies it, even for `OWNER` (`control_feeder` is the case this
  exists for).
- A membership with **no rows** is authorized by its role defaults. This is the compatibility
  bridge: existing owners, admins and operators keep working exactly as before.
- Role defaults are always applied; rows only add grants or remove them. You never have to
  enumerate every permission for a membership.
- Permissions are unioned across the user's active memberships in `ACTIVE` organizations.
- The resolver fails closed: no session, no user row, no membership, or no `ACTIVE` organization
  yields no permissions.
- Tenant admins manage grants and revocations from **Admin → Users → Permissions**. The server
  requires `ADMIN` + `manage_members` + a target inside the caller's org scope.
- An admin cannot revoke their own `manage_members`; the guard is enforced server-side.

## Permission set

Defined in `apps/web/lib/auth/permissions.ts` as the `PERMISSIONS` tuple and `Permission` type.
Any other string in the database is ignored by `isPermission` — it neither grants nor revokes.

| Permission | Meaning |
|---|---|
| `view_dashboard` | See the farmer dashboard. |
| `view_reports` | See reports and exports. |
| `manage_members` | Invite, edit and remove tenant members. |
| `manage_farms_ponds` | Create and change farms and ponds. |
| `manage_schedule` | Change feeding schedules and device calibration. |
| `claim_feeder` | Claim a feeder unit into the tenant. |
| `control_feeder` | Manual feed and pause/resume. Independently revocable per membership. |
| `record_dispatch` | Record a harvest dispatch (M6). |
| `view_billing` | See billing and statements (M6). |

## Role defaults

`ROLE_DEFAULTS` in `apps/web/lib/auth/permissions.ts`:

| Permission | OWNER | ADMIN | OPERATOR | VIEWER |
|---|---|---|---|---|
| `view_dashboard` | yes | yes | yes | yes |
| `view_reports` | yes | yes | — | yes |
| `manage_members` | yes | yes | — | — |
| `manage_farms_ponds` | yes | yes | — | — |
| `manage_schedule` | yes | yes | yes | — |
| `claim_feeder` | yes | yes | yes | — |
| `control_feeder` | yes (revocable) | yes (revocable) | yes (revocable) | — |
| `record_dispatch` | yes | yes | — | — |
| `view_billing` | yes | yes | — | — |

`OWNER` and `ADMIN` intentionally have the same defaults. `control_feeder` is in every default that
can hold it because revocation is the mechanism that removes it — a default grant is not a
permanent grant.

## Resolution

`effectivePermissions(role, overrides)` is pure and synchronous:

1. Start from `ROLE_DEFAULTS[role]`.
2. For each row: an unrevoked row adds its permission; a revoked row removes it.
3. Unknown permission names are skipped.

`getCurrentPermissions()` is the DB-backed resolver used by server actions:

1. `getCurrentUser()` — fails closed to an empty set if there is no session or no `User` row.
2. `Membership` rows for that user with `revokedAt: null`.
3. `Organization` rows for those memberships with `status: ACTIVE`. A `SUSPENDED`,
   `PENDING_DELETION` or `PURGED` org contributes nothing, matching `resolveOrgScope()`.
4. `MembershipPermission` rows for the remaining memberships — **including revoked rows**, since
   they are denials rather than absence of a grant.
5. `effectivePermissions` per membership, unioned into one set.

`hasPermission(permission)` answers a boolean; `requirePermission(permission)` throws
`new Error("Forbidden")` on denial. Server actions use `requirePermission`; UI code that later
needs to hide a control should use `hasPermission`.

### Compatibility fallback (no rows)

The management UI is the only application writer of `MembershipPermission` rows. The bootstrap
migration (`20261017010000_bootstrap_tenant_orgs`) creates `Organization` and `Membership` rows but no
permission rows, and a membership that has never been edited still has zero rows. Every existing
membership therefore starts with zero rows, and the fallback is what authorizes it. The fallback is
part of the contract, not a migration detail:

- **No rows at all** → the membership behaves exactly as its role did before this change.
- **Some rows** → defaults still apply, except where a revoked row denies. An unrevoked row is an
  additional grant, never a replacement for the default set.

This is why a normal `ADMIN` or `OPERATOR` with no rows sees no behavior change.

An account with **no active membership at all** is a different case: it is denied every action gated
here, even though it has a `User` row and a role. That is the required fail-closed behavior and it
matches `resolveOrgScope()`. The bootstrap migration backfills `OWNER` memberships for `ADMIN` users,
and the pond/platform creation flows create one for each farmer; a legacy account that predates both
needs a membership before these gates will let it act.

### Multiple memberships and the single-active-org assumption

`getCurrentPermissions()` unions permissions across every active membership in an `ACTIVE` org. It
does **not** intersect them per organization.

The current product assumes a user acts within one active organization at a time (the tenant
dashboard is resolved from the user's single `User.farmId`/membership context; there is no org
switcher yet — plan M2.4). Under that assumption the union is equivalent to "the permissions of the
org the user is currently in". It is deliberately the permissive choice for this stage: a user who
belongs to two active orgs gets the union rather than being locked out of one of them.

Per-resource org permission resolution (`resolveAccess` in plan §4.1, M2.1) and a signed active-org
cookie (M2.4) replace this assumption. Until then:

- Do not grant a permission in org A expecting it to be scoped away from org B.
- Do not rely on this module for cross-tenant isolation. `resolveOrgScope()` and the existing
  ownership filters remain the tenant boundary.

## Enforcement points

Each action keeps its existing `requireRole` / `requireWriteAccess` guard. The permission check is
an additional gate placed before any write (and before the permission-management read).

| Action | File | Permission | Existing guard kept |
|---|---|---|---|
| `updateUser` | `lib/actions/admin.ts` | `manage_members` | `requireRole("ADMIN")` |
| `deleteUser` | `lib/actions/admin.ts` | `manage_members` | `requireRole("ADMIN")` |
| `getUserPermissionState` | `lib/actions/admin.ts` | `manage_members` | `requireRole("ADMIN")` |
| `setUserPermission` | `lib/actions/admin.ts` | `manage_members` | `requireRole("ADMIN")` |
| `createPondWithFarmer` | `lib/actions/admin.ts` | `manage_farms_ponds` | `requireRole("ADMIN")` |
| `createPond` | `lib/actions/admin.ts` | `manage_farms_ponds` | `requireRole("ADMIN")` |
| `updatePondOwner` | `lib/actions/admin.ts` | `manage_farms_ponds` | `requireRole("ADMIN")` |
| `setPondStatus` | `lib/actions/admin.ts` | `manage_farms_ponds` | `requireRole("ADMIN")` |
| `requestFeed` | `lib/actions/energy.ts` | `control_feeder` | `requireWriteAccess()` |
| `saveHopperCalibration` | `lib/actions/energy.ts` | `manage_schedule` | `requireWriteAccess()` |
| `saveDurationCalibration` | `lib/actions/energy.ts` | `manage_schedule` | `requireWriteAccess()` |
| `saveTemperatureCalibration` | `lib/actions/energy.ts` | `manage_schedule` | `requireWriteAccess()` |
| `toggleDevicePause` | `lib/actions/schedule.ts` | `control_feeder` | `requireWriteAccess()` |
| `updateScheduleCommand` | `lib/actions/schedule.ts` | `manage_schedule` | `requireWriteAccess()` |

For actions whose existing guard sits outside the `try`, the permission check also sits outside it,
so a denial surfaces as `Forbidden` instead of being flattened into the action's generic failure
message.

### Not enforced yet

- **Reads.** `getUsers`, `getPonds`, `getDevices`, `getAllFarmHierarchies`, `getAdminStats` and
  `getAuditLog` still require `requireRole("ADMIN")` only. `view_dashboard` and `view_reports` are
  defined but not yet enforced anywhere.
- **Other write actions.** `settings.ts`, `farm.ts`, `biomass.ts`, `time.ts` and the rest keep
  `requireWriteAccess()` only. `claim_feeder`, `record_dispatch` and `view_billing` have no
  enforcement point yet (claiming and dispatch arrive in M4 and M6).
- **UI outside the permission dialog.** Apart from `/admin/users` → Permissions, no component hides
  or disables a control based on a permission. A VIEWER sees the same controls as before and receives
  a denial only from the server action.
- **Platform console.** `/superadmin` is gated by `requirePlatformAdmin()`, a separate path that is
  intentionally not affected by tenant permissions.

## Managing grants and revocations

Tenant admins manage permissions at **Admin → Users → Permissions**. Per row, the dialog shows the
member's membership role, its role defaults, and one checkbox per `PERMISSIONS` value. Checkbox
changes stay in local draft state until **Save changes** is pressed; each changed permission is then
applied through `setUserPermission`.

### Server-side guards

Both `getUserPermissionState` and `setUserPermission` run the same chain:

1. `requireRole("ADMIN")`.
2. `await requirePermission("manage_members")`.
3. `resolveOrgScope()` and a check that the target user is in `scope.memberUserIds`.
4. The target must have an active (`revokedAt: null`) membership in an `ACTIVE` org in scope.
5. Platform admins are refused — that grant is managed from `/superadmin`.
6. `setUserPermission` rejects any name that does not pass `isPermission`.
7. A caller cannot revoke their own `manage_members`. This is a server-side refusal, not only a
   disabled checkbox, so bypassing the UI cannot strand the organization.

### Write semantics

- **Grant** (checked) upserts the `(membershipId, permission)` row with `revokedAt: null`.
- **Revoke** (unchecked) upserts the same row with `revokedAt: now`.
- Revoking updates the existing row rather than deleting it. Deleting a row restores the role
  default; revoking is a durable denial.
- Unknown permission names are ignored during resolution, so the dialog filters them out.
- `OWNER` and `ADMIN` defaults still apply. Revoking a default is the only way to remove it, and it
  removes it for `OWNER` too (`control_feeder` is the intended case).
- No permission cache exists: a revocation takes effect on the next request.
- An unrevoked row can also grant a permission the role default lacks; the UI marks it as granted.

Direct database edits remain possible for development and repair, but the UI is the normal path.
Development-stage database access does not change the production rule: production database changes
remain out of scope for agent work and require a separate owner decision.

## Tests

- `apps/web/lib/__tests__/permissions.test.ts` — role defaults, grant/revoke overrides,
  `OWNER`-revocable `control_feeder`, unknown names, empty overrides, `ACTIVE`-org filtering, union
  across memberships, and fail-closed behavior.
- `apps/web/lib/__tests__/server-actions.test.ts` — stubs the permission gate for existing action
  tests and asserts that a denied `control_feeder` blocks `requestFeed` and `toggleDevicePause`
  before any write.
- `apps/web/lib/__tests__/farm-actions.test.ts` — stubs the gate so the tenant-scoping tests for
  `admin.ts` do not issue permission queries.
