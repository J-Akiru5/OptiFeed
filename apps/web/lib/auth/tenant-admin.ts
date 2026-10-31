import { redirect } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import { getLocale } from "next-intl/server";
import { type ActionDenialReason, ActionDeniedError } from "./action-denial";
import { assertPasswordChanged, getCurrentUser } from "./session";

/**
 * Tenant roles that may open the /admin console. This is deliberately separate
 * from `User.role`: the global column is a legacy flag, while tenant authority
 * comes from an active `Membership` in an `ACTIVE` `Organization`.
 */
export const TENANT_ADMIN_ROLES = ["OWNER", "ADMIN"] as const;

export type TenantAdminState = {
	isAdmin: boolean;
	/** OWNER in at least one active organization — may manage other admins. */
	isOwner: boolean;
	orgIds: string[];
};

const NO_TENANT_ADMIN: TenantAdminState = {
	isAdmin: false,
	isOwner: false,
	orgIds: [],
};

/**
 * Resolve the caller's tenant-admin state.
 *
 * Fails closed: no session, no user row, no OWNER/ADMIN membership, or only
 * memberships in suspended orgs all resolve to "not an admin". A user who has
 * a `User.role` of ADMIN but only an OPERATOR membership is *not* a tenant
 * admin — membership wins over the legacy global flag.
 */
export async function getTenantAdminState(): Promise<TenantAdminState> {
	const user = await getCurrentUser();
	if (!user) return NO_TENANT_ADMIN;

	const memberships = await prisma.membership.findMany({
		where: {
			userId: user.id,
			revokedAt: null,
			role: { in: [...TENANT_ADMIN_ROLES] },
		},
		select: { orgId: true, role: true },
	});
	if (memberships.length === 0) return NO_TENANT_ADMIN;

	const orgIds = [...new Set(memberships.map((membership) => membership.orgId))];
	const activeOrgs = await prisma.organization.findMany({
		where: { id: { in: orgIds }, status: "ACTIVE" },
		select: { id: true },
	});
	if (activeOrgs.length === 0) return NO_TENANT_ADMIN;

	const activeOrgIds = new Set(activeOrgs.map((org) => org.id));
	return {
		isAdmin: true,
		isOwner: memberships.some(
			(membership) => membership.role === "OWNER" && activeOrgIds.has(membership.orgId),
		),
		orgIds: [...activeOrgIds],
	};
}

/** True when the caller may open the tenant /admin console. */
export async function isCurrentTenantAdmin(): Promise<boolean> {
	return (await getTenantAdminState()).isAdmin;
}

/**
 * Require a tenant OWNER/ADMIN membership. Redirects to /dashboard otherwise,
 * matching `requireRole()` / `requirePlatformAdmin()`.
 *
 * Use this instead of `requireRole("ADMIN")` for every /admin page, layout and
 * server action. `User.role` is not tenant authority.
 *
 * A server action that must report *why* it refused passes
 * `{ onDenied: "throw" }`: the redirect becomes a typed `ActionDeniedError`
 * carrying the specific reason (not signed in, password change, wrong role,
 * suspended organization) that `actionDenialResult()` turns into the action's
 * result. Pages never pass the option and keep the redirect.
 */
export async function requireTenantAdmin(
	options: { onDenied?: "redirect" | "throw" } = {},
): Promise<void> {
	if (options.onDenied === "throw") {
		const denial = await tenantAdminDenialReason();
		if (denial) throw new ActionDeniedError(denial);
		return;
	}

	await assertPasswordChanged();
	if (await isCurrentTenantAdmin()) return;
	const locale = await getLocale();
	redirect({ href: "/dashboard", locale });
}

/**
 * Why `isCurrentTenantAdmin()` is false, in the same order the state resolver
 * checks: no session, a forced password change, no OWNER/ADMIN membership, or
 * memberships only in organizations that are not ACTIVE. Returns null when the
 * caller is allowed. Only evaluated on the refusal path.
 */
async function tenantAdminDenialReason(): Promise<ActionDenialReason | null> {
	const user = await getCurrentUser();
	if (!user) return "not_authenticated";
	if (user.mustChangePassword) return "password_change_required";

	const memberships = await prisma.membership.findMany({
		where: {
			userId: user.id,
			revokedAt: null,
			role: { in: [...TENANT_ADMIN_ROLES] },
		},
		select: { orgId: true },
	});
	if (memberships.length === 0) return "wrong_role";

	const orgIds = [...new Set(memberships.map((membership) => membership.orgId))];
	const activeOrgs = await prisma.organization.count({
		where: { id: { in: orgIds }, status: "ACTIVE" },
	});
	return activeOrgs === 0 ? "org_suspended" : null;
}
