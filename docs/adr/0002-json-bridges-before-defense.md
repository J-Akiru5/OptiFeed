# ADR-0002: JSON bridges instead of schema changes before the capstone defense

- **Status:** Accepted, temporary
- **Date:** 2026-10-25 (first bridge committed); review trigger below
- **Deciders:** Jeff (owner), implementation by the feature workstreams
- **Backfilled:** 2026-10-29
- **Related:** [ADR-0001](./0001-deployment-model.md), [ADR-0006](./0006-multi-tenant-rbac.md)

## Context

The application runs against a single production Supabase database that
`staging` also uses ([ADR-0001](./0001-deployment-model.md)). A schema change is
therefore not a local experiment:

- migrations are applied only by the production deployment of `main`;
- a bad migration is not undone by an application rollback, only by a forward
  fix;
- the project has lost production data once to `prisma migrate reset`, which is
  why [`HANDOFF.md`](../../HANDOFF.md) treats that command as forbidden against
  production;
- the capstone defense is the first milestone, and the plan records a migration
  freeze while it is being prepared (`docs/SUPERADMIN-MULTITENANCY-PLAN.md`
  T18 refers to it; T23 keeps migrations on the production project and forbids
  resets).

Several features nevertheless needed a small amount of new, low-cardinality,
per-entity state: pond area/depth/feed price, a saved growth target, a platform
announcement, and the firmware version a unit reports. Adding a column or table
for each would have meant a production migration in the middle of that freeze.

## Decision

Until after the capstone defense, new per-entity settings are stored in
**existing JSON columns or existing event streams**, behind a typed adapter, and
validated at the boundary. Concretely:

| Feature | Storage | Adapter |
| --- | --- | --- |
| Pond profile (area, average depth, feed price) | `Pond.notificationPrefs.profile` | [`apps/web/lib/pond-profile.ts`](../../apps/web/lib/pond-profile.ts) |
| Calculator growth target | `Pond.notificationPrefs.profile.growthTarget` | [`apps/web/lib/growth-target-store.ts`](../../apps/web/lib/growth-target-store.ts) |
| Platform announcement | one `PlatformSetting` row, key `announcement.current` | [`apps/web/lib/announcement.ts`](../../apps/web/lib/announcement.ts) |
| Firmware version in service | `DeviceStateEvent` rows (`firmware_reported`, OTA lifecycle) | [`apps/web/lib/device-firmware.ts`](../../apps/web/lib/device-firmware.ts) |

The rules that make this safe rather than merely convenient:

1. **One typed shape.** Reads and writes go through the module that owns the
   shape (Zod schema plus parser); callers do not reach into the JSON.
2. **Validate on the way in and on the way out.** A stored value that no longer
   matches the schema is treated as absent, not trusted.
3. **Scope in the query.** Writes are filtered by `ownerId`; a pond owned by
   another tenant behaves exactly like a missing pond.
4. **Keep the derived copy derived.** The growth target is mirrored into
   `CropCycle.targetHarvestWeightG` (D-1) so every page shows one number, but the
   pond profile remains the source of truth and the mirror is cleared with it.
   A harvested cycle keeps its historical value.
5. **No schema change means no migration.** None of these features added a
   column, table or index.

## Consequences

### Positive

- No production migration was required for these features during the freeze.
- The shape can be changed, or the feature removed, in a normal code release.
- The validation rules are the same in tests and at runtime, because the parser
  is pure and shared.

### Negative / accepted costs

- **Not queryable.** SQL cannot index or filter on the bridged fields; anything
  that needs that must load the row and parse it.
- **No database constraints.** No foreign key, no `NOT NULL`, no enum. The code
  is the only guard.
- **Two representations exist while the mirror is in place.** Growth target lives
  in the profile and in the cycle; every reader must agree which is
  authoritative (the profile), and a future writer that updates only the cycle
  would drift. Issue #318 tracks other writers of the cycle target.
- **Migration debt.** Moving to columns is deliberate work later, not a free
  refactor; the parser should survive as the read adapter.
- **Discoverability.** A maintainer looking at the Prisma schema will not see
  these fields, which is exactly why this ADR exists.

### Follow-ups

- **Review trigger:** after the capstone defense, or earlier if a query needs to
  filter/sort on a bridged field, if billing/reporting depends on it, or if the
  JSON shape changes twice for the same feature.
- **Then:** add the dedicated columns in an additive migration, backfill from the
  JSON, keep the parser as the read adapter for old rows, and remove the bridge
  only when no row depends on it.
- Issue #319 (pre-mirror growth targets need a one-off backfill) is related
  cleanup for the mirror, not a reason to skip the bridge.

## Links

- Implementation: `apps/web/lib/pond-profile.ts`, `apps/web/lib/growth-target-store.ts`,
  `apps/web/lib/announcement.ts`, `apps/web/lib/device-firmware.ts`,
  `apps/web/lib/actions/growth-target.ts`
- Tests: `apps/web/lib/__tests__/growth-target.test.ts` (round-trip through the
  bridge), `apps/web/lib/__tests__/growth-plan-apply.test.ts`
- Source of the constraints: `docs/SUPERADMIN-MULTITENANCY-PLAN.md` section 1
  (T3, T18, T23), section 8 Phase M3F ("no schema change"),
  [`HANDOFF.md`](../../HANDOFF.md) (migration rules)
- Deployment constraint: [`docs/deployment-workflow.md`](../deployment-workflow.md) section 4
