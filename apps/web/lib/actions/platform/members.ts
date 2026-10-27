"use server";

import { isMemberRole } from "@/lib/auth/member-rules";
import {
	type Permission,
	type PermissionOverride,
	effectivePermissions,
	isPermission,
} from "@/lib/auth/permissions";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { inviteOrAttachMember } from "@/lib/membership-invite";
import type { InviteLinkTransaction } from "@/lib/membership-invite";
import { deliverMemberInviteEmail } from "@/lib/notify/invite-email";
import prisma from "@/lib/prisma";
import type { MemberRole, Prisma } from "@prisma/client";
import { headers } from "next/headers";

/**
 * Platform organization member management (mission D1: god mode).
 *
 * Every export is gated by requirePlatformAdmin(). Mutations additionally
 * require a reason, a fresh step-up, and write exactly one PlatformAuditLog row
 * with targetType "membership", the organization's id, and stepUpAt.
 *
 * God mode intentionally bypasses the tenant-only invariants (last-owner
 * protection, self-role change, ADMIN-cannot-promote-OWNER): a platform admin
 * must be able to repair an organization that has stranded itself. The reason
 * and audit row are the guardrails for that power.
 */

const MIN_REASON_LENGTH = 10;

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed;
}

/** Reason validation as an action result instead of a thrown error. */
function checkedReason(
	reason: string | undefined,
): { ok: true; reason: string } | { ok: false; error: string } {
	try {
		return { ok: true, reason: requireReason(reason) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "A reason is required." };
	}
}

async function actorContext(): Promise<{
	id: string;
	temporaryGrant: boolean;
	displayName: string;
}> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Not authenticated.");
	const grant = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
		select: { expiresAt: true },
	});
	return {
		id: user.id,
		temporaryGrant: Boolean(grant?.expiresAt),
		displayName: user.displayName || user.farmId,
	};
}

/** Request origin for the audit row (who/what/when/where). */
async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers();
		const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
		return {
			ip: forwarded || h.get("x-real-ip") || null,
			userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
		};
	} catch {
		return { ip: null, userAgent: null };
	}
}

async function auditMembership(
	data: {
		action: string;
		membershipId: string;
		orgId: string;
		reason: string;
		actorUserId: string;
		temporaryGrant: boolean;
		stepUpAt: Date;
		before?: Prisma.InputJsonValue;
		after?: Prisma.InputJsonValue;
	},
	tx: InviteLinkTransaction,
): Promise<void> {
	const origin = await requestOrigin();
	await tx.platformAuditLog.create({
		data: {
			actorUserId: data.actorUserId,
			action: data.action,
			targetType: "membership",
			targetId: data.membershipId,
			orgId: data.orgId,
			reason: data.reason,
			stepUpAt: data.stepUpAt,
			temporaryGrant: data.temporaryGrant,
			ip: origin.ip,
			userAgent: origin.userAgent,
			...(data.before !== undefined ? { before: data.before } : {}),
			...(data.after !== undefined ? { after: data.after } : {}),
		},
	});
}

// ─── Organization detail ──────────────────────────────────────────────────────

export type PlatformOrgMember = {
	membershipId: string;
	userId: string;
	farmId: string;
	email: string;
	displayName: string | null;
	role: MemberRole;
	joinedAt: Date;
	/** 1 h signed URL for the member's picture, or null for the initials fallback. */
	avatarUrl: string | null;
	isPlatformAdmin: boolean;
	/** Effective permissions, for the platform permission editor. */
	permissions: Permission[];
	overrides: { permission: Permission; granted: boolean }[];
};

export type PlatformOrgDetail = {
	org: {
		id: string;
		name: string;
		type: string;
		status: string;
		parentId: string | null;
		createdAt: Date;
	};
	members: PlatformOrgMember[];
};

/** One organization with its active members, for /superadmin/orgs/[orgId]. */
export async function getOrgDetail(orgId: string): Promise<PlatformOrgDetail | null> {
	await requirePlatformAdmin();

	if (typeof orgId !== "string" || !orgId.trim()) return null;
	const org = await prisma.organization.findUnique({
		where: { id: orgId },
		select: {
			id: true,
			name: true,
			type: true,
			status: true,
			parentId: true,
			createdAt: true,
		},
	});
	if (!org) return null;

	const memberships = await prisma.membership.findMany({
		where: { orgId: org.id, revokedAt: null },
		orderBy: { createdAt: "asc" },
		select: { id: true, userId: true, role: true, createdAt: true },
	});
	if (memberships.length === 0) return { org, members: [] };

	const userIds = [...new Set(memberships.map((membership) => membership.userId))];
	const [users, permissionRows, platformAdmins] = await Promise.all([
		prisma.user.findMany({
			where: { id: { in: userIds } },
			select: { id: true, farmId: true, email: true, displayName: true, avatarPath: true },
		}),
		prisma.membershipPermission.findMany({
			where: { membershipId: { in: memberships.map((m) => m.id) } },
			select: { membershipId: true, permission: true, revokedAt: true },
		}),
		prisma.platformAdmin.findMany({
			where: { userId: { in: userIds }, revokedAt: null },
			select: { userId: true },
		}),
	]);

	const userById = new Map(users.map((user) => [user.id, user]));
	const platformAdminIds = new Set(platformAdmins.map((grant) => grant.userId));

	const overridesByMembership = new Map<string, PermissionOverride[]>();
	for (const row of permissionRows) {
		if (!isPermission(row.permission)) continue;
		const list = overridesByMembership.get(row.membershipId) ?? [];
		list.push({ permission: row.permission, revokedAt: row.revokedAt });
		overridesByMembership.set(row.membershipId, list);
	}

	const members: PlatformOrgMember[] = [];
	for (const membership of memberships) {
		const user = userById.get(membership.userId);
		if (!user) continue;
		const overrides = overridesByMembership.get(membership.id) ?? [];
		members.push({
			membershipId: membership.id,
			userId: user.id,
			farmId: user.farmId,
			email: user.email,
			displayName: user.displayName,
			role: membership.role,
			joinedAt: membership.createdAt,
			avatarUrl: null,
			isPlatformAdmin: platformAdminIds.has(user.id),
			permissions: [...effectivePermissions(membership.role, overrides)].sort(),
			overrides: overrides
				.filter((row) => isPermission(row.permission))
				.map((row) => ({
					permission: row.permission as Permission,
					granted: row.revokedAt === null,
				})),
		});
	}

	const avatarUrls = await getSignedAvatarUrls(
		members.map((member) => ({
			id: member.userId,
			avatarPath: userById.get(member.userId)?.avatarPath ?? null,
		})),
	);
	for (const member of members) {
		member.avatarUrl = avatarUrls[member.userId] ?? null;
	}

	return { org, members };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export type PlatformMemberResult = { success: true } | { error: string; code?: "step_up_required" };

export type PlatformInviteResult =
	| {
			success: true;
			membershipId: string;
			userId: string;
			loginEmail: string;
			temporaryPassword: string | null;
			createdUser: boolean;
			/** See the tenant invite result: best-effort delivery, never a rollback. */
			inviteEmailSent: boolean;
	  }
	| { error: string; code?: "step_up_required" };

function stepUpFailure(error: unknown): { error: string; code: "step_up_required" } | null {
	if (!isStepUpRequiredError(error)) return null;
	return { error: error.message, code: "step_up_required" };
}

async function findActiveMembership(orgId: string, userId: string) {
	return prisma.membership.findUnique({
		where: { orgId_userId: { orgId, userId } },
		select: { id: true, orgId: true, userId: true, role: true, revokedAt: true },
	});
}

/**
 * Invite/attach a member to any organization. Step-up and one membership audit
 * row are required; the new-account path returns its temporary password once.
 */
export async function inviteOrgMember(input: {
	orgId: string;
	email: string;
	displayName: string;
	role: MemberRole;
	reason: string;
}): Promise<PlatformInviteResult> {
	await requirePlatformAdmin();

	const checked = checkedReason(input.reason);
	if (!checked.ok) return { error: checked.error };
	if (!isMemberRole(input.role)) return { error: "Choose a valid role." };

	const org = await prisma.organization.findUnique({
		where: { id: input.orgId },
		select: { id: true, name: true },
	});
	if (!org) return { error: "Organization not found." };

	const actor = await actorContext();

	try {
		const result = await withStepUp(async (stepUpAt) =>
			inviteOrAttachMember({
				orgId: org.id,
				email: input.email,
				displayName: input.displayName,
				role: input.role,
				invitedBy: actor.id,
				refusePlatformAdminTarget: false,
				onLinked: async (tx, linked) => {
					await auditMembership(
						{
							action: "platform.membership.invite",
							membershipId: linked.membershipId,
							orgId: org.id,
							reason: checked.reason,
							actorUserId: actor.id,
							temporaryGrant: actor.temporaryGrant,
							stepUpAt,
							after: {
								userId: linked.userId,
								role: input.role,
								loginEmail: linked.loginEmail,
								createdUser: linked.createdUser,
							},
						},
						tx,
					);
				},
			}),
		);

		if (!result.success) return { error: result.error };

		// Sent after the transaction and step-up succeeded. Delivery is
		// best-effort; the audit row above never contains the password.
		const inviteEmailSent = result.temporaryPassword
			? await deliverMemberInviteEmail({
					to: input.email,
					loginId: result.loginEmail.split("@")[0],
					temporaryPassword: result.temporaryPassword,
					orgName: org.name,
					inviterName: actor.displayName,
				})
			: false;

		return {
			success: true,
			membershipId: result.membershipId,
			userId: result.userId,
			loginEmail: result.loginEmail,
			temporaryPassword: result.temporaryPassword,
			createdUser: result.createdUser,
			inviteEmailSent,
		};
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error(
			"[platform] inviteOrgMember error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to add the member." };
	}
}

/** Change any organization member's role. God mode: no last-owner guard. */
export async function changeOrgMemberRole(input: {
	orgId: string;
	userId: string;
	role: MemberRole;
	reason: string;
}): Promise<PlatformMemberResult> {
	await requirePlatformAdmin();

	const checked = checkedReason(input.reason);
	if (!checked.ok) return { error: checked.error };
	if (!isMemberRole(input.role)) return { error: "Choose a valid role." };

	const membership = await findActiveMembership(input.orgId, input.userId);
	if (!membership || membership.revokedAt) {
		return { error: "That account has no active membership in this organization." };
	}
	if (membership.role === input.role) return { success: true };

	const actor = await actorContext();

	try {
		await withStepUp(async (stepUpAt) => {
			await prisma.$transaction(async (tx) => {
				await tx.membership.update({
					where: { id: membership.id },
					data: { role: input.role },
				});
				await auditMembership(
					{
						action: "platform.membership.role",
						membershipId: membership.id,
						orgId: membership.orgId,
						reason: checked.reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						before: { role: membership.role },
						after: { role: input.role },
					},
					tx,
				);
			});
		});
		return { success: true };
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error(
			"[platform] changeOrgMemberRole error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to update the role." };
	}
}

/** Grant or revoke one permission for any organization member. */
export async function setOrgMemberPermission(input: {
	orgId: string;
	userId: string;
	permission: string;
	granted: boolean;
	reason: string;
}): Promise<PlatformMemberResult> {
	await requirePlatformAdmin();

	const checked = checkedReason(input.reason);
	if (!checked.ok) return { error: checked.error };
	if (!isPermission(input.permission)) return { error: "Unknown permission." };

	const membership = await findActiveMembership(input.orgId, input.userId);
	if (!membership || membership.revokedAt) {
		return { error: "That account has no active membership in this organization." };
	}

	const actor = await actorContext();

	try {
		await withStepUp(async (stepUpAt) => {
			await prisma.$transaction(async (tx) => {
				const existing = await tx.membershipPermission.findUnique({
					where: {
						membershipId_permission: {
							membershipId: membership.id,
							permission: input.permission,
						},
					},
					select: { revokedAt: true },
				});

				await tx.membershipPermission.upsert({
					where: {
						membershipId_permission: {
							membershipId: membership.id,
							permission: input.permission,
						},
					},
					update: { revokedAt: input.granted ? null : new Date() },
					create: {
						membershipId: membership.id,
						permission: input.permission,
						revokedAt: input.granted ? null : new Date(),
					},
				});

				await auditMembership(
					{
						action: "platform.membership.permission",
						membershipId: membership.id,
						orgId: membership.orgId,
						reason: checked.reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						before: { granted: existing ? existing.revokedAt === null : null },
						after: { permission: input.permission, granted: input.granted },
					},
					tx,
				);
			});
		});
		return { success: true };
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error(
			"[platform] setOrgMemberPermission error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to update the permission." };
	}
}

/**
 * Revoke a membership in any organization. The account itself is untouched;
 * the member simply loses access to that tenant. No last-owner guard here:
 * god mode must be able to repair a stranded organization.
 */
export async function revokeOrgMembership(input: {
	orgId: string;
	userId: string;
	reason: string;
}): Promise<PlatformMemberResult> {
	await requirePlatformAdmin();

	const checked = checkedReason(input.reason);
	if (!checked.ok) return { error: checked.error };

	const membership = await findActiveMembership(input.orgId, input.userId);
	if (!membership || membership.revokedAt) {
		return { error: "That account has no active membership in this organization." };
	}

	const actor = await actorContext();

	try {
		await withStepUp(async (stepUpAt) => {
			await prisma.$transaction(async (tx) => {
				await tx.membership.update({
					where: { id: membership.id },
					data: { revokedAt: new Date() },
				});
				await auditMembership(
					{
						action: "platform.membership.revoke",
						membershipId: membership.id,
						orgId: membership.orgId,
						reason: checked.reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						before: { role: membership.role },
						after: { revoked: true },
					},
					tx,
				);
			});
		});
		return { success: true };
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error(
			"[platform] revokeOrgMembership error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to revoke the membership." };
	}
}
