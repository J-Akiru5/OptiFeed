import { type Permission, getCurrentPermissions } from "@/lib/auth/permissions";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { canWrite as currentCanWrite, getCurrentUser } from "@/lib/auth/session";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";
import prisma from "@/lib/prisma";
import type { AssistantRole } from "./types";

/** Server-resolved identity for one assistant turn. Never trusted from the client. */
export interface AssistantCaller {
	userId: string;
	role: AssistantRole;
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
	try {
		const membership = await prisma.membership.findFirst({
			where: { userId: user.id, revokedAt: null },
			orderBy: { createdAt: "asc" },
			select: { orgId: true },
		});
		if (membership) {
			const org = await prisma.organization.findUnique({
				where: { id: membership.orgId },
				select: { name: true },
			});
			orgName = org?.name ?? null;
		}
	} catch {
		// A platform admin with no tenant membership is a valid state.
		orgName = null;
	}

	return {
		userId: user.id,
		role,
		permissions,
		canWrite,
		isPlatformAdmin,
		isTenantAdmin,
		orgName,
	};
}
