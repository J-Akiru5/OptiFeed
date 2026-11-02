import prisma from "@/lib/prisma";

/**
 * farm → user → active membership → organization (M3.9, reused by M3C.4/M3C.5).
 *
 * A `Pond` has no `organizationId` and neither does `Farm`; the tenant is found
 * the way the device registry resolves it, through the farm owner's active
 * membership. The fleet monitor and the incident queue must agree on this, so it
 * lives here once instead of being copied into both loaders.
 *
 * Resolution is deliberately conservative: a farm with no active membership
 * resolves to nothing (the caller shows the row as unassigned) rather than to a
 * guessed organization, and when a farmer holds memberships in more than one
 * organization the first by name wins so the answer is stable between renders.
 */

export interface ResolvedTenant {
	id: string;
	name: string;
}

export async function resolveFarmsToOrganizations(
	farmIds: readonly string[],
): Promise<Map<string, ResolvedTenant>> {
	const resolved = new Map<string, ResolvedTenant>();
	if (farmIds.length === 0) return resolved;

	const users = await prisma.user.findMany({
		where: { farmId: { in: [...farmIds] } },
		select: { id: true, farmId: true },
	});
	if (users.length === 0) return resolved;

	const memberships = await prisma.membership.findMany({
		where: { userId: { in: users.map((user) => user.id) }, revokedAt: null },
		select: { userId: true, orgId: true },
	});
	if (memberships.length === 0) return resolved;

	const organizations = await prisma.organization.findMany({
		where: { id: { in: [...new Set(memberships.map((membership) => membership.orgId))] } },
		select: { id: true, name: true },
		orderBy: { name: "asc" },
	});
	const orgById = new Map(organizations.map((org) => [org.id, org]));
	const farmByUser = new Map(users.map((user) => [user.id, user.farmId]));

	for (const membership of memberships) {
		const farmId = farmByUser.get(membership.userId);
		const organization = orgById.get(membership.orgId);
		if (!farmId || !organization || resolved.has(farmId)) continue;
		resolved.set(farmId, { id: organization.id, name: organization.name });
	}

	return resolved;
}
