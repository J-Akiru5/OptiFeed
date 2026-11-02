import prisma from "@/lib/prisma";
import { getOrgSettingsForFarms } from "@/lib/settings/org";
import type { MemberRole } from "@prisma/client";

/**
 * Who receives an alert email for a pond (#alert email).
 *
 * In-app alerts are pond-scoped rows, so the audience is resolved at read time:
 * pond → owner farm → organization → the org's `alertRoles` → those members'
 * deliverable `contactEmail`. This is the same policy that decides whether the
 * in-app alert is created, so an email cannot reach a role the org excluded.
 *
 * A pond with no resolvable organization falls back to the owner's own contact
 * email, matching the legacy behaviour where an unlinkable pond still alerts.
 *
 * Accounts with no contact email are simply skipped: the inbox is the only
 * channel that needs an address, and the pond login never receives mail.
 */

export type PondAlertAudience = {
	pondId: string;
	pondName: string;
	/** Login slug of the pond owner, shown in the email for traceability. */
	farmId: string;
	orgId: string | null;
	/** Roles the organization chose for alerts. */
	roles: MemberRole[];
	/** Deduplicated, trimmed deliverable addresses. */
	emails: string[];
};

const MAX_PONDS = 100;

export async function resolvePondAlertAudiences(
	pondIds: readonly string[],
): Promise<Map<string, PondAlertAudience>> {
	const result = new Map<string, PondAlertAudience>();
	const uniquePondIds = [
		...new Set(pondIds.filter((id) => typeof id === "string" && id.length > 0)),
	].slice(0, MAX_PONDS);
	if (uniquePondIds.length === 0) return result;

	const ponds = await prisma.pond.findMany({
		where: { id: { in: uniquePondIds } },
		select: { id: true, name: true, ownerId: true },
	});
	if (ponds.length === 0) return result;

	const settingsByFarm = await getOrgSettingsForFarms(ponds.map((pond) => pond.ownerId));

	// One membership query for every org in scope; the per-org role list is
	// applied in memory because each organization chooses its own roles.
	const rolesByOrg = new Map<string, MemberRole[]>();
	for (const context of settingsByFarm.values()) {
		if (context.orgId) rolesByOrg.set(context.orgId, [...context.settings.alertRoles]);
	}
	const orgIds = [...rolesByOrg.keys()];

	const memberships =
		orgIds.length > 0
			? await prisma.membership.findMany({
					where: { orgId: { in: orgIds }, revokedAt: null },
					select: { orgId: true, userId: true, role: true },
				})
			: [];

	const memberUserIds = [
		...new Set(
			memberships
				.filter((membership) => rolesByOrg.get(membership.orgId)?.includes(membership.role))
				.map((membership) => membership.userId),
		),
	];

	const memberUsers =
		memberUserIds.length > 0
			? await prisma.user.findMany({
					where: { id: { in: memberUserIds } },
					select: { id: true, contactEmail: true },
				})
			: [];
	const emailByUserId = new Map(memberUsers.map((user) => [user.id, normalize(user.contactEmail)]));

	const emailsByOrg = new Map<string, string[]>();
	for (const membership of memberships) {
		const allowed = rolesByOrg.get(membership.orgId);
		if (!allowed?.includes(membership.role)) continue;
		const email = emailByUserId.get(membership.userId);
		if (!email) continue;
		const list = emailsByOrg.get(membership.orgId) ?? [];
		if (!list.includes(email)) list.push(email);
		emailsByOrg.set(membership.orgId, list);
	}

	// Legacy fallback: a pond that cannot be linked to an organization alerts its
	// owner directly, if that account has a deliverable address.
	const ownerFarms = [
		...new Set(
			ponds.filter((pond) => !settingsByFarm.get(pond.ownerId)?.orgId).map((pond) => pond.ownerId),
		),
	];
	const owners =
		ownerFarms.length > 0
			? await prisma.user.findMany({
					where: { farmId: { in: ownerFarms } },
					select: { farmId: true, contactEmail: true },
				})
			: [];
	const ownerEmailByFarm = new Map(
		owners.map((owner) => [owner.farmId, normalize(owner.contactEmail)]),
	);

	for (const pond of ponds) {
		const context = settingsByFarm.get(pond.ownerId);
		const orgId = context?.orgId ?? null;
		const emails = orgId
			? (emailsByOrg.get(orgId) ?? [])
			: ([ownerEmailByFarm.get(pond.ownerId)].filter(Boolean) as string[]);

		result.set(pond.id, {
			pondId: pond.id,
			pondName: pond.name,
			farmId: pond.ownerId,
			orgId,
			roles: orgId ? [...(rolesByOrg.get(orgId) ?? [])] : [],
			emails: [...new Set(emails)],
		});
	}

	return result;
}

function normalize(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
