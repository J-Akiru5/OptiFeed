import prisma from "@/lib/prisma";

/**
 * True when the user holds any active `Membership` in an `ACTIVE` organization.
 *
 * Membership is the tenant source of truth (T-06): `User.role` is the legacy
 * global flag and says nothing about which farm, if any, a user belongs to.
 * Used by the platform console to offer "Open my farm dashboard" only to a
 * platform admin who really belongs to a tenant (E18, #199).
 *
 * Fails closed: no membership, only revoked memberships, or memberships in
 * suspended orgs all resolve to false.
 */
export async function hasActiveTenantMembership(userId: string): Promise<boolean> {
	const memberships = await prisma.membership.findMany({
		where: { userId, revokedAt: null },
		select: { orgId: true },
	});
	if (memberships.length === 0) return false;

	// Organization/Membership are relation-free by design (plan §3.2), so this
	// is an explicit id join rather than a nested filter.
	const activeOrgs = await prisma.organization.count({
		where: {
			id: { in: [...new Set(memberships.map((membership) => membership.orgId))] },
			status: "ACTIVE",
		},
	});
	return activeOrgs > 0;
}
