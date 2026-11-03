import { type Permission, getCurrentPermissions } from "@/lib/auth/permissions";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { canWrite as currentCanWrite, getCurrentUser } from "@/lib/auth/session";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";
import prisma from "@/lib/prisma";
import type { MemberRole } from "@prisma/client";
import type { AssistantRole } from "./types";

/** Server-resolved identity for one assistant turn. Never trusted from the client. */
export interface AssistantCaller {
	userId: string;
	role: AssistantRole;
	/** The caller's membership role in their first active org, or null. */
	membershipRole: MemberRole | null;
	/** True when the caller is an OWNER in at least one active organization. */
	isOwner: boolean;
	permissions: Set<Permission>;
	canWrite: boolean;
	isPlatformAdmin: boolean;
	isTenantAdmin: boolean;
	orgName: string | null;
}

export async function getAssistantCaller(): Promise<AssistantCaller | null> {
	const user = await getCurrentUser();
	if (!user) return null;

	const [permissions, canWrite, isPlatformAdmin, isTenantAdmin] = await Promise.all([
		getCurrentPermissions(),
		currentCanWrite(),
		isCurrentPlatformAdmin(),
		isCurrentTenantAdmin(),
	]);

	// A platform admin sees the platform vocabulary even in a tenant screen.
	// The reverse is not true: tenant kinds still require the tenant permission.
	const role: AssistantRole = isPlatformAdmin ? "superadmin" : isTenantAdmin ? "owner" : "farmer";

	let orgName: string | null = null;
	let membershipRole: MemberRole | null = null;
	try {
		const membership = await prisma.membership.findFirst({
			where: { userId: user.id, revokedAt: null },
			orderBy: { createdAt: "asc" },
			select: { orgId: true, role: true },
		});
		if (membership) {
			membershipRole = membership.role;
			const org = await prisma.organization.findUnique({
				where: { id: membership.orgId },
				select: { name: true },
			});
			orgName = org?.name ?? null;
		}
	} catch {
		// A platform admin with no tenant membership is a valid state.
		orgName = null;
		membershipRole = null;
	}

	return {
		userId: user.id,
		role,
		membershipRole,
		isOwner: membershipRole === "OWNER",
		permissions,
		canWrite,
		isPlatformAdmin,
		isTenantAdmin,
		orgName,
	};
}
