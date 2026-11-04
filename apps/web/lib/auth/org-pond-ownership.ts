import type { MemberRole, Prisma } from "@prisma/client";

/**
 * Organization pond ownership across a membership revocation (#808).
 *
 * `resolveOrgScope()` derives every admin-visible pond from the `User.farmId` of
 * ACTIVE members, and `Pond.ownerId` / `Pond.farmId` are the only ownership
 * stamp a pond carries. Revoking a membership therefore used to *remove the
 * organization's view* of the ponds that live on that member's farm: the rows
 * stayed, but no remaining admin could reach them, and nothing archived or
 * transferred them.
 *
 * The #808 owner decision is **reassign, not block**: on revocation the ponds
 * stamped with that member's farm move to the organization's **anchor farm**
 * (see `resolveOrgPondAnchor` for the rule and why it is the owner). No schema
 * change is needed — moving `ownerId` + `farmId` is enough, the
 * `record_pond_ownership_event` DB trigger already writes a `TRANSFERRED` row
 * to `PondOwnershipHistory` when `Pond.farmId` changes, and the receiving farm
 * belongs to an active member, so the remaining admins keep seeing the ponds.
 *
 * The revoked member loses write access by the same mechanism that made them
 * lose org visibility: every pond write gate compares `Pond.ownerId` with the
 * caller's `User.farmId` (`isPondOwner`, `resolveActivePond`, the tenant write
 * guards), and after the move the two no longer match.
 *
 * Plain server-only module, no "use server": it runs inside a caller's
 * transaction and must never be exposed as a callable server action.
 */

/**
 * Roles in the order a pond prefers its new owner.
 *
 * OWNER first because that is the organization's accountable farm; ADMIN next
 * because `manage_farms_ponds` is an ADMIN default, so the receiver can actually
 * manage what it inherits; OPERATOR and VIEWER only matter for an organization
 * with no owner or admin left, where visibility still beats disappearance.
 */
const ANCHOR_ROLE_PRIORITY: readonly MemberRole[] = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"];

type PondOwnershipClient = Pick<Prisma.TransactionClient, "farm" | "membership" | "pond" | "user">;

export type OrgPondAnchor = {
	/** `User.id` of the member whose farm receives the ponds. */
	userId: string;
	/** `User.farmId` — the value `Pond.ownerId` stores. */
	ownerId: string;
	displayName: string | null;
	role: MemberRole;
};

export type OrgPondTransfer = {
	/** `Farm.id` that received the ponds, or null when nothing moved. */
	targetFarmId: string | null;
	/** `User.farmId` of the receiving member, or null when nothing moved. */
	targetOwnerId: string | null;
	/** Number of pond rows reassigned. */
	movedCount: number;
};

function noTransfer(): OrgPondTransfer {
	return { targetFarmId: null, targetOwnerId: null, movedCount: 0 };
}

/** Position of `role` in `ANCHOR_ROLE_PRIORITY`; unknown roles rank last. */
function anchorRank(role: MemberRole): number {
	const index = ANCHOR_ROLE_PRIORITY.indexOf(role);
	return index === -1 ? ANCHOR_ROLE_PRIORITY.length : index;
}

/** Role first, then membership age, then id — never read order. */
function compareAnchorCandidates(
	left: { id: string; role: MemberRole; createdAt: Date },
	right: { id: string; role: MemberRole; createdAt: Date },
): number {
	const byRole = anchorRank(left.role) - anchorRank(right.role);
	if (byRole !== 0) return byRole;
	const byAge = left.createdAt.getTime() - right.createdAt.getTime();
	if (byAge !== 0) return byAge;
	return left.id.localeCompare(right.id);
}

/**
 * The farm that receives an organization's ponds when a member leaves.
 *
 * Rule: among the organization's *other* ACTIVE members, pick the highest role
 * first (OWNER → ADMIN → OPERATOR → VIEWER) and the longest-standing membership
 * second (`createdAt` ascending, `id` ascending as the tie-break). In practice
 * that is the organization's primary owner: every organization with an owner
 * has one, and the last-owner guard (`revokeMemberError`) keeps the oldest
 * owner from being revoked while it is the last one.
 *
 * Why role before age: the receiver has to be able to manage the ponds, not
 * just see them. Why age is the tie-break: the answer must not depend on the
 * order a query happens to return.
 *
 * Why not a dedicated org-owned farm: `Farm.ownerId` is a non-null unique
 * reference to `User.farmId`, so an organization-level farm would need a
 * login-less account — a much larger change than this bug justifies. Reusing a
 * member's farm keeps the ponds inside the org scope without a schema change.
 *
 * `excludeUserId` is required: the member being revoked must never receive the
 * ponds it is losing. Returns null when no other ACTIVE member remains (only
 * the platform console can revoke the last one); callers then leave the ponds
 * untouched, because there is nobody left to see them.
 */
export async function resolveOrgPondAnchor(
	client: PondOwnershipClient,
	input: { orgId: string; excludeUserId: string },
): Promise<OrgPondAnchor | null> {
	const memberships = await client.membership.findMany({
		where: {
			orgId: input.orgId,
			revokedAt: null,
			userId: { not: input.excludeUserId },
		},
		select: { id: true, userId: true, role: true, createdAt: true },
		orderBy: { createdAt: "asc" },
	});
	if (memberships.length === 0) return null;

	const [anchor] = [...memberships].sort(compareAnchorCandidates);
	const user = await client.user.findUnique({
		where: { id: anchor.userId },
		select: { farmId: true, displayName: true },
	});
	if (!user) return null;

	return {
		userId: anchor.userId,
		ownerId: user.farmId,
		displayName: user.displayName,
		role: anchor.role,
	};
}

/**
 * Move every pond on `revokedFarmId` to the organization's anchor farm.
 *
 * Called inside the caller's revocation transaction so the membership stamp and
 * the pond move commit or roll back together. A member with no ponds costs one
 * indexed lookup and no anchor resolution. `Pond.status` is deliberately not
 * filtered: archived ponds are part of the org scope too, and an admin must not
 * lose them either.
 */
export async function transferOrgPondsOnRevoke(
	client: PondOwnershipClient,
	input: { orgId: string; revokedUserId: string; revokedFarmId: string },
): Promise<OrgPondTransfer> {
	const ponds = await client.pond.findMany({
		where: { ownerId: input.revokedFarmId },
		select: { id: true },
	});
	if (ponds.length === 0) return noTransfer();

	const anchor = await resolveOrgPondAnchor(client, {
		orgId: input.orgId,
		excludeUserId: input.revokedUserId,
	});
	if (!anchor) return noTransfer();

	// `Pond.farmId` is a required FK to `Farm.id`, so the receiver's single Farm
	// row must exist before the ponds can point at it. Self-heal it the same way
	// `updatePondOwner` does rather than failing the revocation on legacy data.
	const farm = await client.farm.upsert({
		where: { ownerId: anchor.ownerId },
		update: {},
		create: {
			ownerId: anchor.ownerId,
			name: `${anchor.displayName ?? anchor.ownerId} Farm`,
		},
	});

	const { count } = await client.pond.updateMany({
		where: { id: { in: ponds.map((pond) => pond.id) }, ownerId: input.revokedFarmId },
		data: { ownerId: anchor.ownerId, farmId: farm.id },
	});

	return { targetFarmId: farm.id, targetOwnerId: anchor.ownerId, movedCount: count };
}
