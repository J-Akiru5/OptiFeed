import { requestOrigin } from "@/lib/actions/platform/audit";
import { contactEmailTargetError } from "@/lib/auth/member-rules";
import { TENANT_ADMIN_ROLES } from "@/lib/auth/tenant-admin";
import {
	CONTACT_EMAIL_TAKEN,
	isContactEmailConflict,
	normalizeContactEmail,
} from "@/lib/contact-email";
import prisma from "@/lib/prisma";

/**
 * Persist a user's contact email and the audit row that records it (#449).
 *
 * Plain server-only module, deliberately without "use server": it trusts its
 * caller. The tenant action (`updateMemberContactEmail`) has already checked
 * the caller's authority, the target's scope and the hierarchy rule; this
 * module validates and normalises the address itself, so nothing else can store
 * an unchecked one.
 *
 * The change and its audit row share one transaction, so an address can never
 * be swapped without a record of who did it. The previous and new values go in
 * the row: that is the evidence an account-takeover investigation needs.
 */

export type SetContactEmailResult = { success: true } | { error: string };

/**
 * Why the caller may not change this account's contact email, or null when
 * they may. `orgIds` is the caller's own organization scope; the rules
 * themselves live in `contactEmailTargetError`.
 */
export async function contactEmailRuleError(input: {
	userId: string;
	actorUserId: string;
	orgIds: readonly string[];
}): Promise<string | null> {
	const [targetMemberships, actorMemberships] = await Promise.all([
		prisma.membership.findMany({
			where: { userId: input.userId, revokedAt: null },
			select: { orgId: true, role: true },
		}),
		prisma.membership.findMany({
			where: {
				userId: input.actorUserId,
				revokedAt: null,
				role: { in: [...TENANT_ADMIN_ROLES] },
			},
			select: { orgId: true, role: true },
		}),
	]);
	const actorRoleByOrg = new Map(
		actorMemberships.filter((m) => input.orgIds.includes(m.orgId)).map((m) => [m.orgId, m.role]),
	);
	return contactEmailTargetError({ actorRoleByOrg, targetMemberships });
}

export async function setContactEmail(input: {
	userId: string;
	/** What the administrator typed; blank or `null` clears the address. */
	value: unknown;
	actorUserId: string;
	orgId: string;
	reason: string;
}): Promise<SetContactEmailResult> {
	const normalized = normalizeContactEmail(input.value);
	if (!normalized.ok) return { error: normalized.error };

	try {
		return await prisma.$transaction(async (tx): Promise<SetContactEmailResult> => {
			const current = await tx.user.findUnique({
				where: { id: input.userId },
				select: { contactEmail: true },
			});
			if (!current) return { error: "User not found." };
			if (current.contactEmail === normalized.value) return { success: true };

			await tx.user.update({
				where: { id: input.userId },
				data: { contactEmail: normalized.value },
			});
			const origin = await requestOrigin();
			await tx.platformAuditLog.create({
				data: {
					actorUserId: input.actorUserId,
					action: "platform.user.contact_email_updated",
					targetType: "user",
					targetId: input.userId,
					orgId: input.orgId,
					reason: input.reason,
					before: { contactEmail: current.contactEmail },
					after: { contactEmail: normalized.value },
					ip: origin.ip,
					userAgent: origin.userAgent,
				},
			});
			return { success: true };
		});
	} catch (error) {
		// Only the contact email carries a unique index in this update.
		if (isContactEmailConflict(error)) return { error: CONTACT_EMAIL_TAKEN };
		throw error;
	}
}
