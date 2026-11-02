# Mission 2026-11-02: Pakoy in the admin and superadmin consoles (#518)

Owner: Jeff. Agent: OpenCode.
Base: `origin/develop` after the 2026-11-02 consolidation.
Issue: #518, "chore(pakoy ai): Pakoy position".

This document is the **single source of truth** for this slice. It records the
decision, what was mounted, what was deliberately deferred, and the acceptance
criteria for the platform-context expansion.

## Decision

There is **one Pakoy**, not a second assistant per console. The existing
`ChatWidgetProvider` + `FabStack` + `ChatWidget` are mounted in the tenant-admin
and platform-admin shells with the roles the server already understands:

| Shell | Role | Intro / chips |
|---|---|---|
| Farmer dashboard | `farmer` / `owner` / `superadmin` (resolved) | existing |
| Tenant admin `/admin` | `owner` | existing |
| Platform admin `/superadmin` | `superadmin` | existing |

No new tool catalogue is introduced. The admin and superadmin tools already
exist in `lib/assistant/tools.ts` and are gated by `tenantAdminOnly`,
`platformAdminOnly`, permissions and step-up at Accept time.

## Implemented in this slice

- `app/[locale]/(admin)/layout.tsx` wraps the shell in
  `ChatWidgetProvider role="owner"` and renders `FabStack` + `ChatWidget`.
- `app/[locale]/(superadmin)/superadmin/layout.tsx` wraps the shell in
  `ChatWidgetProvider role="superadmin"` and renders the same controls **when**
  `hasFarmDashboard` is true.
- `lib/__tests__/pakoy-consoles.test.ts` locks the mounts and the single
  provider per shell.
- No change to the farmer dashboard widget.

## Why the platform mount is gated

The chat API uses `withAuth`, which requires a farm binding
(`User.farmId` + the email farm id). A `PlatformAdmin` with no tenant
membership is a valid console user but has no farm login, so the API returns
401. Showing a FAB that cannot answer would be worse than hiding it.

A platform-only admin still gets the **proposal** path through
`getAssistantCaller`, which resolves `isPlatformAdmin` independently of a farm;
only the chat transport is blocked.

The gate is `hasActiveTenantMembership`, the same condition the shell already
uses for the farm-dashboard link. It is not a role check.

## Deferred: platform context and tool expansion

The following is the next slice, not part of this PR:

1. **Platform chat auth.** Add a chat-specific auth path that accepts an active
   `PlatformAdmin` with no farm. Do not relax `withAuth` for every route.
2. **Platform context.** Build an org/fleet summary (organizations, devices,
   offline counts, recent incidents) instead of the pond context. The prompt
   already handles `ctx === null`; a real platform context is better than an
   empty one.
3. **Role-aware tool prompt.** Expose tenant tools only when the caller has a
   tenant scope; expose `superadmin.*` only for an active platform admin.
   Acceptance still re-checks permission, scope and step-up server-side.
4. **Navigation anchors.** Add `/admin` and `/superadmin` help targets so Pakoy
   can point at members, device approvals, audit and organization actions.
5. **Tests.** A platform admin with no farm can chat; a tenant admin cannot
   invoke `superadmin.*`; a platform admin without step-up cannot accept a
   destructive action; no tenant data appears in a platform-only context.

## Acceptance for this slice

- Pakoy FAB and panel render on `/admin` for a tenant admin.
- Pakoy FAB and panel render on `/superadmin` when the platform admin has a
  tenant membership; the role is `superadmin`.
- The farmer widget is unchanged.
- `pakoy-consoles.test.ts`, typecheck and the full unit suite pass.

## Files

- `apps/web/app/[locale]/(admin)/layout.tsx`
- `apps/web/app/[locale]/(superadmin)/superadmin/layout.tsx`
- `apps/web/lib/__tests__/pakoy-consoles.test.ts`
- `docs/missions/2026-11-02-pakoy-consoles.md`
