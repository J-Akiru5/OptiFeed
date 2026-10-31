import { resolveOrgScope } from "@/lib/auth/org-scope";
import prisma from "@/lib/prisma";

/**
 * The row scope of a SQL export (issue #353).
 *
 * A platform export covers every row of every included table. A tenant export
 * is limited to the caller's organizations exactly as the rest of the tenant
 * console is: the same `resolveOrgScope()` chain (membership → active org →
 * members → farms → ponds) is the only source of ids, so an export cannot
 * widen beyond what the console already shows.
 *
 * `membershipIds` is derived once because `MembershipPermission` has no Prisma
 * relation to `Membership` (the plan keeps those tables relation-free), so its
 * scope cannot be expressed as a nested filter.
 */

export type PlatformExportScope = { kind: "platform" };

export type TenantExportScope = {
	kind: "tenant";
	orgIds: string[];
	orgNames: string[];
	memberUserIds: string[];
	farmIds: string[];
	pondIds: string[];
	membershipIds: string[];
};

export type ExportScope = PlatformExportScope | TenantExportScope;

/** Scope-id lookups are bounded; a real tenant stays far below this. */
export const SCOPE_ID_LIMIT = 10_000;

export const EMPTY_TENANT_SCOPE: TenantExportScope = {
	kind: "tenant",
	orgIds: [],
	orgNames: [],
	memberUserIds: [],
	farmIds: [],
	pondIds: [],
	membershipIds: [],
};

/**
 * Resolve the tenant export scope for the current user.
 *
 * Fails closed: no session, no OWNER/ADMIN membership, or only suspended
 * organizations all produce empty id lists, and the caller must refuse the
 * export rather than stream an empty file that looks successful.
 */
export async function resolveTenantExportScope(): Promise<TenantExportScope> {
	const scope = await resolveOrgScope();
	if (scope.orgIds.length === 0) return EMPTY_TENANT_SCOPE;

	const [memberships, orgs] = await Promise.all([
		prisma.membership.findMany({
			where: { orgId: { in: scope.orgIds } },
			select: { id: true },
			take: SCOPE_ID_LIMIT,
		}),
		prisma.organization.findMany({
			where: { id: { in: scope.orgIds } },
			select: { id: true, name: true },
			take: SCOPE_ID_LIMIT,
		}),
	]);

	const nameById = new Map(orgs.map((org) => [org.id, org.name]));

	return {
		kind: "tenant",
		// Sorted so the audit row and the filename are deterministic.
		orgIds: [...scope.orgIds].sort(),
		orgNames: [...scope.orgIds].sort().map((id) => nameById.get(id) ?? id),
		memberUserIds: scope.memberUserIds,
		farmIds: scope.farmIds,
		pondIds: scope.pondIds,
		membershipIds: memberships.map((membership) => membership.id),
	};
}

/** True when a tenant scope has nothing to export. */
export function isEmptyTenantScope(scope: TenantExportScope): boolean {
	return scope.orgIds.length === 0;
}
