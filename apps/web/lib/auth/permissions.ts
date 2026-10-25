import prisma from "@/lib/prisma";
import type { MemberRole } from "@prisma/client";
import { assertPasswordChanged, getCurrentUser } from "./session";

/**
 * Tenant permission names (plan §4.2). The database stores these as free-text
 * `MembershipPermission.permission` values, so `isPermission` is the runtime
 * gate that keeps an unexpected row from being treated as a grant.
 */
export const PERMISSIONS = [
	"view_dashboard",
	"view_reports",
	"manage_members",
	"manage_farms_ponds",
	"manage_schedule",
	"manage_crop_cycle",
	"claim_feeder",
	"control_feeder",
	"record_dispatch",
	"view_billing",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
	return PERMISSION_SET.has(value);
}

/**
 * Permissions every membership of a role gets before any explicit row is
 * applied. These are the compatibility bridge: a membership with no
 * `MembershipPermission` rows is authorized exactly as before the permission
 * table existed, so existing OWNER/ADMIN/OPERATOR accounts are not locked out.
 *
 * `control_feeder` is deliberately part of every role's defaults that has it
 * (OWNER, ADMIN, OPERATOR) because it is revocable per membership: the default
 * grants it, and a revoked row removes it.
 */
export const ROLE_DEFAULTS: Record<MemberRole, readonly Permission[]> = {
	OWNER: PERMISSIONS,
	ADMIN: PERMISSIONS,
	OPERATOR: [
		"view_dashboard",
		"manage_schedule",
		"manage_crop_cycle",
		"claim_feeder",
		"control_feeder",
	],
	VIEWER: ["view_dashboard", "view_reports"],
};

/**
 * One `MembershipPermission` row, reduced to the fields that affect the result.
 * `revokedAt` non-null is a denial; null is a grant.
 */
export type PermissionOverride = {
	permission: string;
	revokedAt: Date | null;
};

/**
 * Resolve the permissions a single membership holds.
 *
 * Role defaults always apply; explicit rows layer on top:
 * - an unrevoked row grants that permission, even when the role default lacks it;
 * - a revoked row denies it, even for OWNER (this is what makes
 *   `control_feeder` independently revocable);
 * - an unknown name, or a row for another membership, changes nothing.
 *
 * Pure and synchronous so it can be unit-tested without a database, and so the
 * "no rows" and "some rows" paths cannot drift apart.
 */
export function effectivePermissions(
	role: MemberRole,
	overrides: readonly PermissionOverride[] = [],
): Set<Permission> {
	// An unrecognized role yields no defaults rather than throwing: the caller
	// is type-checked, but tenant data is not trusted to be.
	const defaults = ROLE_DEFAULTS[role] as readonly Permission[] | undefined;
	const effective = new Set<Permission>(defaults ?? []);

	for (const override of overrides) {
		if (!isPermission(override.permission)) continue;
		if (override.revokedAt) {
			effective.delete(override.permission);
		} else {
			effective.add(override.permission);
		}
	}

	return effective;
}

/**
 * Permissions of the current user, unioned across their active memberships.
 *
 * Chain: user → memberships (`revokedAt: null`) → organizations with status
 * ACTIVE → `MembershipPermission` rows for those memberships → role defaults
 * plus explicit grants, minus revoked ones.
 *
 * Fails closed: no session, no user row, no membership, or no ACTIVE org all
 * yield an empty set. Permission union is across every active membership, which
 * relies on the current single-active-org assumption documented in
 * docs/rbac-permissions.md — a user acting in two active orgs gets the union,
 * not a per-org intersection.
 */
export async function getCurrentPermissions(): Promise<Set<Permission>> {
	const user = await getCurrentUser();
	if (!user) return new Set<Permission>();

	const memberships = await prisma.membership.findMany({
		where: { userId: user.id, revokedAt: null },
		select: { id: true, orgId: true, role: true },
	});
	if (memberships.length === 0) return new Set<Permission>();

	// Organization.status gates the whole tenant, matching resolveOrgScope():
	// a SUSPENDED or PENDING_DELETION org grants no permissions to its members.
	// Organization/Membership/MembershipPermission are relation-free by design
	// (plan §3.2), so this is an explicit id join rather than a nested query.
	const orgIds = [...new Set(memberships.map((m) => m.orgId))];
	const activeOrgs = await prisma.organization.findMany({
		where: { id: { in: orgIds }, status: "ACTIVE" },
		select: { id: true },
	});
	if (activeOrgs.length === 0) return new Set<Permission>();

	const activeOrgIds = new Set(activeOrgs.map((o) => o.id));
	const activeMemberships = memberships.filter((m) => activeOrgIds.has(m.orgId));

	// Revoked rows are fetched too: they are denials, not absence of a grant.
	const rows = await prisma.membershipPermission.findMany({
		where: { membershipId: { in: activeMemberships.map((m) => m.id) } },
		select: { membershipId: true, permission: true, revokedAt: true },
	});

	const overridesByMembership = new Map<string, PermissionOverride[]>();
	for (const row of rows) {
		const list = overridesByMembership.get(row.membershipId) ?? [];
		list.push({ permission: row.permission, revokedAt: row.revokedAt });
		overridesByMembership.set(row.membershipId, list);
	}

	const permissions = new Set<Permission>();
	for (const membership of activeMemberships) {
		const membershipPermissions = effectivePermissions(
			membership.role,
			overridesByMembership.get(membership.id) ?? [],
		);
		for (const permission of membershipPermissions) {
			permissions.add(permission);
		}
	}

	return permissions;
}

/**
 * True when the current user holds `permission` in an active membership.
 * Fails closed through `getCurrentPermissions`, so an unauthenticated caller
 * is never granted anything.
 */
export async function hasPermission(permission: Permission): Promise<boolean> {
	const permissions = await getCurrentPermissions();
	return permissions.has(permission);
}

/**
 * Throw `Forbidden` unless the current user holds `permission`.
 *
 * Throws instead of redirecting — this is called from server actions, where a
 * redirect is the wrong signal (matches `requireWriteAccess`). Callers keep
 * their existing role/write-access guards; this is an additional gate.
 */
export async function requirePermission(permission: Permission): Promise<void> {
	await assertPasswordChanged();
	if (!(await hasPermission(permission))) {
		throw new Error("Forbidden");
	}
}
