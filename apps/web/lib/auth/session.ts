import { redirect } from "@/i18n/routing";
import { getVerifiedSession } from "@/lib/auth/verify-session";
import prisma from "@/lib/prisma";
import type { MemberRole, User, UserRole } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { ActionDeniedError } from "./action-denial";
import { canManagePondAlerts as resolveCanManagePondAlerts } from "./notification-alerts";
import { resolveWriteAuthority } from "./write-access";

/**
 * Session verification is part of this module's public surface: API routes
 * that must authenticate without a tenant binding (a platform admin is not
 * required to have a farm) import it from here, which is also what the
 * `Check API route auth` CI gate recognises as session auth.
 */
export { getVerifiedSession };

const POND_EMAIL_DOMAIN = "pond.optifeed.local";

export function buildPondEmail(farmId: string): string {
	return `${farmId.toLowerCase().trim()}@${POND_EMAIL_DOMAIN}`;
}

export function farmIdFromEmail(email: string | undefined | null): string | null {
	if (!email) return null;
	const local = email.split("@")[0];
	if (!local) return null;
	return local.toLowerCase();
}

/**
 * Extract the farmId from a pond-provisioned email, requiring the trusted
 * domain. Returns null for any other domain, so a lookalike account
 * (demo-farmer-1@evil.com) can never resolve to a farm.
 */
export function farmIdFromPondEmail(email: string | undefined | null): string | null {
	if (!email) return null;
	const normalized = email.toLowerCase();
	if (!normalized.endsWith(`@${POND_EMAIL_DOMAIN}`)) return null;
	return farmIdFromEmail(normalized);
}

export async function getCurrentPondOwnerId(): Promise<string> {
	const ownerId = await getCurrentPondOwnerIdSafe();

	if (!ownerId) {
		const locale = await getLocale();
		redirect({ href: "/login", locale });
		return ""; // unreachable — redirect aborts the request
	}

	return ownerId;
}

export async function getCurrentPondOwnerIdSafe(): Promise<string | null> {
	const currentUser = await getCurrentUser();
	if (!currentUser) return null;

	// Read-only view-as (plan M5.1): reads resolve to the target tenant's farm,
	// never to the admin's own farm. The import is dynamic on purpose — view-as
	// needs getCurrentUser, so a static import here would be a module cycle.
	const { getViewAsState } = await import("./view-as");
	const viewingAs = await getViewAsState();
	return viewingAs.active ? viewingAs.farmId : currentUser.farmId;
}

/**
 * Get the current user's database record (with role info).
 * Returns null if not authenticated or user not found in DB.
 *
 * Wrapped in React `cache()` so a render tree / server action that calls
 * `getCurrentUser`, `getCurrentPondOwnerId`, `getCurrentUserRole`, and
 * `canWrite` performs one lookup per request instead of one per call.
 * Outside a React request scope the wrapper is a passthrough (verified
 * against React 19); route handlers rely on the auth caches instead.
 *
 * Lookup is by Supabase auth user id (User.supabaseId) — never by the
 * email local part alone. The email must also be a pond-provisioned
 * address for this row's farm, so a lookalike domain
 * (demo-farmer-1@evil.com) can never act as the farm.
 */
export const getCurrentUser = cache(async () => {
	const session = await getVerifiedSession();
	if (!session) return null;

	const dbUser = await prisma.user.findUnique({
		where: { supabaseId: session.sub },
	});
	if (!dbUser) return null;

	const emailFarmId = farmIdFromPondEmail(session.email);
	if (!emailFarmId || emailFarmId !== dbUser.farmId) return null;

	return dbUser;
});

/**
 * Require an authenticated user who has completed any forced password change.
 *
 * Redirects unauthenticated visitors to /login and flagged users to
 * /change-password. Call this before role/platform gates so a temporary
 * password cannot reach any console.
 */
export async function requirePasswordChanged(): Promise<User> {
	const user = await getCurrentUser();

	if (!user) {
		const locale = await getLocale();
		redirect({ href: "/login", locale });
		throw new Error("redirect");
	}

	if (user.mustChangePassword) {
		const locale = await getLocale();
		redirect({ href: "/change-password", locale });
		throw new Error("redirect");
	}

	return user;
}

/**
 * Throw when the caller must still change their temporary password.
 *
 * `requirePasswordChanged()` redirects, which is correct for layouts but wrong
 * for a server action or API route. The shared action guards call this so a
 * flagged user cannot bypass the change screen by invoking an action directly.
 */
export async function assertPasswordChanged(): Promise<void> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Not authenticated");
	if (user.mustChangePassword) throw new Error("Password change required");
}

/**
 * Get the current user's role. Returns null if not authenticated.
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
	const currentUser = await getCurrentUser();
	return currentUser?.role ?? null;
}

/**
 * Require the current user to have one of the specified roles.
 * Redirects to /dashboard if not authorized.
 */
async function requireRole(...roles: UserRole[]): Promise<void> {
	const locale = await getLocale();
	const userRole = await getCurrentUserRole();

	if (!userRole || !roles.includes(userRole)) {
		redirect({ href: "/dashboard", locale });
	}
}

/**
 * Resolve the caller's write authority from their membership rows (#583).
 *
 * Chain: user → memberships (`revokedAt: null`) → organizations with status
 * ACTIVE → roles → `resolveWriteAuthority()` in `./write-access`. The policy
 * itself is pure; this function only gathers the rows.
 *
 * Tenant authority is the membership, not the legacy `User.role` column. A
 * member demoted to VIEWER keeps whatever `User.role` said, so reading the
 * global flag here would accept their writes forever.
 *
 * Wrapped in React `cache()` like `getCurrentUser`: a render tree that calls
 * `canWrite()` from several components performs one membership lookup.
 */
const getWriteAuthorityForCurrentUser = cache(async () => {
	const user = await getCurrentUser();
	if (!user) return null;

	const memberships = await prisma.membership.findMany({
		where: { userId: user.id, revokedAt: null },
		select: { orgId: true, role: true },
	});

	if (memberships.length > 0) {
		// Organization.status gates the whole tenant, matching resolveOrgScope()
		// and getCurrentPermissions(): a SUSPENDED or PENDING_DELETION org grants
		// no write authority to its members.
		const orgIds = [...new Set(memberships.map((membership) => membership.orgId))];
		const activeOrgs = await prisma.organization.findMany({
			where: { id: { in: orgIds }, status: "ACTIVE" },
			select: { id: true },
		});
		const activeOrgIds = new Set(activeOrgs.map((org) => org.id));

		return {
			user,
			authority: resolveWriteAuthority({
				legacyRole: user.role,
				activeMembershipRoles: memberships
					.filter((membership) => activeOrgIds.has(membership.orgId))
					.map((membership) => membership.role),
				hasAnyMembership: true,
			}),
		};
	}

	// No live rows. Distinguish "this account never had a membership" (a legacy
	// account, allowed to fall back to `User.role`) from "every row was revoked
	// or its org is inactive" (denied: membership still wins).
	const hasAnyMembership = (await prisma.membership.count({ where: { userId: user.id } })) > 0;

	return {
		user,
		authority: resolveWriteAuthority({
			legacyRole: user.role,
			activeMembershipRoles: [],
			hasAnyMembership,
		}),
	};
});

/**
 * Require write access (a writing tenant membership). Throws instead of
 * redirecting — for server actions and API routes, where a redirect is the
 * wrong signal. VIEWER, revoked members, unauthenticated callers, and read-only
 * view-as sessions are rejected before any write happens. The view-as guard is
 * `assertNotViewingAs`, the one shared helper also used by `requirePermission`.
 *
 * The refusal is an `ActionDeniedError` with a stable reason, so an action's
 * catch can return the precise authorization outcome instead of flattening it
 * into a generic failure (#336).
 */
export async function requireWriteAccess(): Promise<void> {
	const current = await getWriteAuthorityForCurrentUser();
	if (!current) throw new ActionDeniedError("not_authenticated");
	const { user, authority } = current;
	if (user.mustChangePassword) throw new ActionDeniedError("password_change_required");
	const { assertNotViewingAs } = await import("./view-as");
	await assertNotViewingAs();
	if (!authority.allowed) {
		throw new ActionDeniedError("wrong_role");
	}
}

/**
 * True when the current user may perform write operations.
 * Use in server components to disable VIEWER-only-readonly UI. It reads the
 * same membership authority as `requireWriteAccess`, so the buttons and the
 * server cannot disagree. A read-only view-as session is always false, so the
 * target tenant's controls render disabled rather than failing only after a
 * click.
 */
export async function canWrite(): Promise<boolean> {
	const current = await getWriteAuthorityForCurrentUser();
	if (!current) return false;
	const { user, authority } = current;
	if (user.mustChangePassword) return false;
	const { isViewingAs } = await import("./view-as");
	if (await isViewingAs()) return false;
	return authority.allowed;
}

/**
 * True when the current user may change the pond-wide alert settings (#748).
 *
 * The profile form writes one `Pond.notificationPrefs` row for every recipient,
 * so it is an owner/admin control, not a personal preference. Reads the same
 * membership chain as `canWrite` and applies the pure policy in
 * `./notification-alerts`; the profile page and the server action both call
 * this, so the disabled toggles and the server cannot disagree.
 */
export const canManagePondAlertSettings = cache(async (): Promise<boolean> => {
	const user = await getCurrentUser();
	if (!user) return false;

	const ownerId = await getCurrentPondOwnerIdSafe();
	const memberships = await prisma.membership.findMany({
		where: { userId: user.id, revokedAt: null },
		select: { orgId: true, role: true },
	});

	let activeRoles: MemberRole[] = [];
	if (memberships.length > 0) {
		// Organization.status gates the whole tenant, matching the write-authority
		// chain: a SUSPENDED organization grants no admin authority.
		const orgIds = [...new Set(memberships.map((membership) => membership.orgId))];
		const activeOrgs = await prisma.organization.findMany({
			where: { id: { in: orgIds }, status: "ACTIVE" },
			select: { id: true },
		});
		const activeOrgIds = new Set(activeOrgs.map((org) => org.id));
		activeRoles = memberships
			.filter((membership) => activeOrgIds.has(membership.orgId))
			.map((membership) => membership.role);
	}

	return resolveCanManagePondAlerts({
		isPondOwner: ownerId !== null && user.farmId === ownerId,
		activeMembershipRoles: activeRoles,
		hasAnyMembership: memberships.length > 0,
		legacyRole: user.role,
	});
});

/**
 * Get all ponds owned by the current user.
 */
async function getCurrentUserPonds() {
	const ownerId = await getCurrentPondOwnerId();
	return prisma.pond.findMany({
		where: { ownerId },
		orderBy: { createdAt: "asc" },
	});
}
