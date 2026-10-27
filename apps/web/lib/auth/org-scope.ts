import prisma from "@/lib/prisma";
import type { MemberRole } from "@prisma/client";
import { getCurrentUser } from "./session";

/**
 * The set of rows an ADMIN is allowed to see in the legacy /admin console.
 *
 * Every array is always present. When the caller has no admin membership the
 * arrays are empty — never undefined, never the full table. This is deliberate:
 * a missing scope must produce an empty result set, not an unscoped global one,
 * so there is no code path where forgetting to apply the scope leaks all tenants.
 */
export type OrgScope = {
	orgIds: string[];
	memberUserIds: string[];
	/** `User.farmId` for every member — matches `Pond.ownerId`. */
	farmIds: string[];
	/** `Pond.id` for every pond owned by a member. */
	pondIds: string[];
};

export const EMPTY_SCOPE: OrgScope = {
	orgIds: [],
	memberUserIds: [],
	farmIds: [],
	pondIds: [],
};

/**
 * Shared membership → org → member → farm → pond chain.
 *
 * `roles` narrows the caller's own membership rows. Without a role filter any
 * live membership counts, which is what the farmer calendar needs to show
 * org-wide events read-only.
 */
async function resolveScope(roles?: readonly MemberRole[]): Promise<OrgScope> {
	const user = await getCurrentUser();
	if (!user) return EMPTY_SCOPE;

	const memberships = await prisma.membership.findMany({
		where: {
			userId: user.id,
			revokedAt: null,
			...(roles ? { role: { in: [...roles] } } : {}),
		},
		select: { orgId: true },
	});
	if (memberships.length === 0) return EMPTY_SCOPE;

	// Organization.status gates the whole tenant: a SUSPENDED or
	// PENDING_DELETION org grants no scope even to its OWNER/ADMIN members.
	// Organization/Membership are relation-free by design (plan §3.2), so this
	// is an explicit id join rather than a nested filter.
	const candidateOrgIds = [...new Set(memberships.map((m) => m.orgId))];
	const activeOrgs = await prisma.organization.findMany({
		where: { id: { in: candidateOrgIds }, status: "ACTIVE" },
		select: { id: true },
	});
	const orgIds = activeOrgs.map((o) => o.id);
	if (orgIds.length === 0) return EMPTY_SCOPE;

	const orgMemberships = await prisma.membership.findMany({
		where: { orgId: { in: orgIds }, revokedAt: null },
		select: { userId: true },
	});
	const memberUserIds = [...new Set(orgMemberships.map((m) => m.userId))];
	if (memberUserIds.length === 0) return EMPTY_SCOPE;

	const members = await prisma.user.findMany({
		where: { id: { in: memberUserIds } },
		select: { farmId: true },
	});
	const farmIds = [...new Set(members.map((m) => m.farmId))];
	if (farmIds.length === 0) {
		return { orgIds, memberUserIds, farmIds: [], pondIds: [] };
	}

	const ponds = await prisma.pond.findMany({
		where: { ownerId: { in: farmIds } },
		select: { id: true },
	});

	return {
		orgIds,
		memberUserIds,
		farmIds,
		pondIds: ponds.map((p) => p.id),
	};
}

/**
 * Resolve the org scope for the currently authenticated user as an admin.
 *
 * Chain: user → memberships where they are OWNER/ADMIN (active) → those orgs
 * with status ACTIVE → active members → members' farms → ponds on those farms.
 *
 * Fails closed: no session, no user row, or no OWNER/ADMIN membership all
 * yield EMPTY_SCOPE. A membership that is revoked stops granting scope.
 */
export async function resolveOrgScope(): Promise<OrgScope> {
	return resolveScope(["OWNER", "ADMIN"]);
}

/**
 * Resolve the org-wide read scope for any member (E25, #212).
 *
 * The farmer calendar shows every pond in the org but writes stay limited to
 * the caller's own farm; this function only answers "what may I see". It is
 * not a write grant and callers must not use it for mutations.
 */
export async function resolveMemberOrgScope(): Promise<OrgScope> {
	return resolveScope();
}
