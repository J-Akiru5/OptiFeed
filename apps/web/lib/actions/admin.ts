"use server";

import { redirect } from "@/i18n/routing";
import { deleteUserSubtree } from "@/lib/actions/admin-internal";
import {
	inviteRoleError,
	isMemberRole,
	revokeMemberError,
	roleChangeError,
} from "@/lib/auth/member-rules";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { passwordErrorMessage, validatePassword } from "@/lib/auth/password";
import {
	type Permission,
	type PermissionOverride,
	ROLE_DEFAULTS,
	effectivePermissions,
	isPermission,
	requirePermission,
} from "@/lib/auth/permissions";
import { buildPondEmail, getCurrentUser } from "@/lib/auth/session";
import { invalidateFarm } from "@/lib/auth/session-cache";
import { TENANT_ADMIN_ROLES, requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { inviteOrAttachMember } from "@/lib/membership-invite";
import { deliverMemberInviteEmail } from "@/lib/notify/invite-email";
import { resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { checkDeviceTokenRevealRateLimit } from "@/lib/rate-limit";
import { getListPageSize, normalizeListPageSize } from "@/lib/settings/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole, PondStatus, Prisma, UserRole } from "@prisma/client";
import { getLocale } from "next-intl/server";

/** One numbered page of a tenant-admin list. */
export interface AdminListPage<T> {
	rows: T[];
	total: number;
	page: number;
	pageSize: number;
}

/** Use the caller's page size when given, otherwise the app-wide setting. */
async function resolveAdminPageSize(provided?: number): Promise<number> {
	return provided === undefined ? getListPageSize() : normalizeListPageSize(provided);
}

// ─── Tenant scoping ──────────────────────────────────────────────────────────
//
// The legacy /admin console is per-tenant: every read below is filtered by the
// caller's Membership-derived scope. Scope resolution fails closed to an empty
// set, so an account with no OWNER/ADMIN membership sees nothing rather than
// everything. Platform admins are excluded from the user list entirely — the
// superadmin lives in /superadmin and must not surface in tenant management.

/**
 * userIds holding a PlatformAdmin row.
 *
 * Excluded from the tenant user list: the platform console is the superadmin's
 * surface, and surfacing it here would imply a tenant admin could manage it.
 */
async function platformAdminUserIds(): Promise<string[]> {
	const rows = await prisma.platformAdmin.findMany({ select: { userId: true } });
	return rows.map((r) => r.userId);
}

/**
 * True when the user holds an unrevoked PlatformAdmin grant.
 *
 * Tenant admins must never edit or delete a platform admin — the grant is
 * managed from /superadmin, and a tenant console able to reassign or remove it
 * would be a privilege-escalation path out of the tenant.
 */
async function hasPlatformAdminGrant(userId: string): Promise<boolean> {
	const grant = await prisma.platformAdmin.findFirst({
		where: { userId, revokedAt: null },
		select: { id: true },
	});
	return grant !== null;
}

const PLATFORM_ADMIN_MANAGED_ELSEWHERE =
	"Platform administrators must be managed from the platform console.";

// ─── User Management ─────────────────────────────────────────────────────────
//
// There is deliberately no createUser here. Farmers are created by
// createPondWithFarmer (the pond flow) and tenant admins by the platform
// console — both attach a Membership, which is what makes the account visible
// to anyone. A user created without a membership would be invisible to every
// admin console, so the standalone path was removed with its page.

export type UpdateUserResult = { success: true } | { error: string };

export async function updateUser(
	userId: string,
	data: { displayName?: string },
): Promise<UpdateUserResult> {
	await requireTenantAdmin();
	// Permission gate before the scope read and before the try: `Forbidden`
	// must reach the caller rather than be flattened into a generic failure.
	await requirePermission("manage_members");
	const scope = await resolveOrgScope();
	if (!scope.memberUserIds.includes(userId)) {
		return { error: "That user is outside your organization." };
	}
	// Platform admins are managed from /superadmin; a tenant console must not
	// be able to change their role or details.
	if (await hasPlatformAdminGrant(userId)) {
		return { error: PLATFORM_ADMIN_MANAGED_ELSEWHERE };
	}

	const displayName = typeof data.displayName === "string" ? data.displayName.trim() : undefined;
	if (displayName === undefined) return { error: "Nothing to update." };
	if (!displayName) return { error: "Display name is required." };
	if (displayName.length > 80) return { error: "Display name is too long." };

	try {
		await prisma.user.update({
			where: { id: userId },
			// `User.role` is deliberately not writable from the tenant console.
			// Tenant authority is Membership.role; allowing a tenant admin to set
			// the legacy global ADMIN flag would be a privilege-escalation path.
			// Platform roles are managed in /superadmin only.
			data: { displayName },
		});
		return { success: true };
	} catch (e) {
		console.error("[admin] updateUser error:", e);
		return { error: "Failed to update user." };
	}
}

export type DeleteUserResult = { success: true } | { error: string };

export async function deleteUser(userId: string): Promise<DeleteUserResult> {
	await requireTenantAdmin();
	await requirePermission("manage_members");
	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	// Self-deletion would strand the org with no one able to manage it, and
	// cross-tenant deletion is the leak this scoping exists to prevent.
	if (actor?.id === userId) return { error: "You cannot delete your own account." };
	if (!scope.memberUserIds.includes(userId)) {
		return { error: "That user is outside your organization." };
	}
	// A platform admin's account (and its grant) is the superadmin's to remove.
	if (await hasPlatformAdminGrant(userId)) {
		return { error: PLATFORM_ADMIN_MANAGED_ELSEWHERE };
	}

	try {
		// Get the user to also delete from Supabase
		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) return { error: "User not found." };

		// Delete from Supabase Auth first: auth.admin.deleteUser returns an error
		// object rather than throwing, so it must be checked. Aborting here leaves
		// both stores intact; the reverse order would strand a live login with no
		// app row to attach it to.
		const supabase = createAdminClient();
		const { error: authError } = await supabase.auth.admin.deleteUser(user.supabaseId);
		if (authError) {
			console.error("[admin] deleteUser auth error:", authError.message);
			return { error: "Failed to remove the account's login. Nothing was deleted." };
		}

		// Delete from DB: the farmer's whole subtree (ponds → devices → events → farm)
		await prisma.$transaction(async (tx) => {
			// Safety net: the guard above refuses active grants, but a revoked
			// row must not outlive its user (PlatformAdmin has no FK to User).
			await tx.platformAdmin.deleteMany({ where: { userId } });
			await deleteUserSubtree(tx, userId, user.farmId);
		});

		// Drop any cached farm binding immediately; otherwise a valid JWT could
		// keep passing withAuth for the cache TTL after the account is gone.
		invalidateFarm(user.supabaseId);

		return { success: true };
	} catch (e) {
		console.error("[admin] deleteUser error:", e);
		return { error: "Failed to delete user." };
	}
}

/**
 * Deletes a farmer's entire record in FK-safe order: event rows and devices
 * (RESTRICT), then ponds, then the Farm (CASCADE target), then the User.
 *
 * Moved to admin-internal.ts — a plain server-only module without "use server",
 * so this transaction helper is not itself callable as a server action.
 */

export async function getUsers(
	input: { page?: number; pageSize?: number } = {},
): Promise<AdminListPage<Prisma.UserGetPayload<{ include: { farm: true } }>>> {
	await requireTenantAdmin();
	const pageSize = await resolveAdminPageSize(input.pageSize);
	const [scope, platformAdmins] = await Promise.all([resolveOrgScope(), platformAdminUserIds()]);
	const where = {
		id: { in: scope.memberUserIds },
		// Platform admins are managed from /superadmin, never here.
		...(platformAdmins.length > 0 ? { NOT: { id: { in: platformAdmins } } } : {}),
	};
	const requestedPage = Math.max(1, Math.floor(input.page ?? 1) || 1);

	const [total, firstFetch] = await Promise.all([
		prisma.user.count({ where }),
		prisma.user.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (requestedPage - 1) * pageSize,
			take: pageSize,
			include: { farm: true },
		}),
	]);
	const paging = resolvePagination(requestedPage, pageSize, total);
	const rows =
		paging.page === requestedPage
			? firstFetch
			: await prisma.user.findMany({
					where,
					orderBy: { createdAt: "desc" },
					skip: paging.offset,
					take: paging.pageSize,
					include: { farm: true },
				});

	return { rows, total, page: paging.page, pageSize: paging.pageSize };
}

// ─── Permission Management ───────────────────────────────────────────────────
//
// Tenant admins grant or revoke `MembershipPermission` rows for one member at a
// time. The row is a denial when `revokedAt` is set and a grant when it is null;
// role defaults still apply underneath (lib/auth/permissions.ts), so "grant" on
// a permission the role already has is a redundant no-op and "revoke" is a
// durable denial.
//
// Every entry point repeats the same guard chain: ADMIN role, the
// `manage_members` permission, then the target user must be an active member of
// an ACTIVE org the caller administers. Permission management cannot be used to
// reach across tenants or to edit a platform admin.

export type UserPermissionOverride = {
	permission: Permission;
	granted: boolean;
};

export type UserPermissionState = {
	success: true;
	role: MemberRole;
	defaults: Permission[];
	overrides: UserPermissionOverride[];
};

export type UserPermissionResult = UserPermissionState | { success: false; error: string };

type ManagedMembership = { id: string; role: MemberRole };

type ManagedMembershipResult =
	| { success: true; membership: ManagedMembership }
	| { success: false; error: string };

/**
 * Resolve the membership a tenant admin is allowed to edit, or a user-facing
 * error. Scope resolution fails closed, so an account with no OWNER/ADMIN
 * membership never matches any target.
 *
 * A user can have a membership in more than one org in scope; the earliest
 * membership wins. The product still assumes one active org per user, so this
 * is a deterministic choice rather than a per-org switcher.
 */
async function resolveManagedMembership(userId: string): Promise<ManagedMembershipResult> {
	const scope = await resolveOrgScope();
	if (!scope.memberUserIds.includes(userId)) {
		return { success: false, error: "That user is outside your organization." };
	}
	if (await hasPlatformAdminGrant(userId)) {
		return { success: false, error: PLATFORM_ADMIN_MANAGED_ELSEWHERE };
	}

	const membership = await prisma.membership.findFirst({
		where: { userId, revokedAt: null, orgId: { in: scope.orgIds } },
		orderBy: { createdAt: "asc" },
		select: { id: true, role: true },
	});
	if (!membership) {
		return { success: false, error: "That user has no active membership in your organization." };
	}

	return { success: true, membership };
}

/**
 * Read the stored state for one membership. Unknown permission names are
 * filtered out because `isPermission` ignores them during resolution, so the UI
 * never renders a checkbox that has no effect.
 */
async function permissionStateFor(membership: ManagedMembership): Promise<UserPermissionState> {
	const rows = await prisma.membershipPermission.findMany({
		where: { membershipId: membership.id },
		select: { permission: true, revokedAt: true },
	});

	const overrides: UserPermissionOverride[] = [];
	for (const row of rows) {
		if (!isPermission(row.permission)) continue;
		overrides.push({ permission: row.permission, granted: row.revokedAt === null });
	}

	return {
		success: true,
		role: membership.role,
		defaults: [...ROLE_DEFAULTS[membership.role]],
		overrides,
	};
}

/**
 * Permission state for one member, used by the admin users screen when the
 * permissions dialog opens.
 */
export async function getUserPermissionState(userId: string): Promise<UserPermissionResult> {
	await requireTenantAdmin();
	// Outside the try: a `Forbidden` denial must reach the caller rather than be
	// flattened into a generic load failure.
	await requirePermission("manage_members");

	const target = await resolveManagedMembership(userId);
	if (!target.success) return target;

	try {
		return await permissionStateFor(target.membership);
	} catch (e) {
		console.error("[admin] getUserPermissionState error:", e);
		return { success: false, error: "Failed to load permissions." };
	}
}

/**
 * Grant or revoke one permission for one member.
 *
 * `granted: true` clears `revokedAt` on the existing row (or creates an
 * unrevoked one); `granted: false` stamps `revokedAt`, which is a durable denial
 * rather than a fallback to the role default. The unique
 * `(membershipId, permission)` key is what makes the upsert safe.
 *
 * Self-lockout guard: a caller may not revoke their own `manage_members`.
 * Without it the last admin could remove their own management permission and
 * strand the organization. This is checked server-side, not only in the UI.
 */
export async function setUserPermission(
	userId: string,
	permission: string,
	granted: boolean,
): Promise<UserPermissionResult> {
	await requireTenantAdmin();
	await requirePermission("manage_members");

	if (!isPermission(permission)) {
		return { success: false, error: "Unknown permission." };
	}

	const [target, actor] = await Promise.all([resolveManagedMembership(userId), getCurrentUser()]);
	if (!target.success) return target;
	if (!actor) return { success: false, error: "Not authenticated." };

	if (actor.id === userId && permission === "manage_members" && !granted) {
		return {
			success: false,
			error: "You cannot remove your own permission to manage members.",
		};
	}

	try {
		await prisma.membershipPermission.upsert({
			where: { membershipId_permission: { membershipId: target.membership.id, permission } },
			update: { revokedAt: granted ? null : new Date() },
			create: {
				membershipId: target.membership.id,
				permission,
				revokedAt: granted ? null : new Date(),
			},
		});

		return await permissionStateFor(target.membership);
	} catch (e) {
		console.error("[admin] setUserPermission error:", e);
		return { success: false, error: "Failed to update the permission." };
	}
}

// ─── Membership Management (Settings → Members) ─────────────────────────────
//
// The Members section lists every active membership in the caller's tenant and
// lets an OWNER/ADMIN invite, change a role, edit permissions and revoke.
//
// The same authorization chain as the permission dialog applies: tenant
// admin → `manage_members` → target inside `resolveOrgScope()` → target is not
// a platform admin. On top of that, the pure rules in lib/auth/member-rules.ts
// enforce the hierarchy: nobody changes their own role, an ADMIN cannot mint or
// edit an OWNER, and the last OWNER cannot be demoted or removed.

export type TenantMemberRow = {
	membershipId: string;
	orgId: string;
	orgName: string;
	userId: string;
	farmId: string;
	email: string;
	displayName: string | null;
	role: MemberRole;
	joinedAt: Date;
	/** The caller's role in the row's organization (OWNER or ADMIN). */
	callerRole: MemberRole;
	isSelf: boolean;
	isPlatformAdmin: boolean;
	isLastOwner: boolean;
	/** Effective permissions: role defaults plus unrevoked rows, minus denials. */
	permissions: Permission[];
};

/**
 * Active members of every organization the caller administers.
 *
 * Platform admins are included (they are real members) but marked so the UI
 * and the mutation guards leave their grant to /superadmin.
 */
export type TenantMemberOrgOption = {
	id: string;
	name: string;
	/** The caller's role in this org; only administered orgs are listed. */
	callerRole: MemberRole;
};

export type TenantMemberPage = AdminListPage<TenantMemberRow> & {
	orgOptions: TenantMemberOrgOption[];
};

/**
 * Active members of every organization the caller administers, one numbered
 * page at a time.
 *
 * Platform admins are included (they are real members) but marked so the UI
 * and the mutation guards leave their grant to /superadmin.
 *
 * `orgOptions` is the full administered-org list, not the orgs visible on this
 * page: the invite form and the tenant switches must not change just because a
 * member landed on page 2.
 */
export async function listTenantMembers(
	input: { page?: number; pageSize?: number } = {},
): Promise<TenantMemberPage> {
	await requireTenantAdmin();

	const pageSize = await resolveAdminPageSize(input.pageSize);
	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	if (!actor || scope.orgIds.length === 0) {
		return { rows: [], total: 0, page: 1, pageSize, orgOptions: [] };
	}

	const where = { orgId: { in: scope.orgIds }, revokedAt: null };
	const requestedPage = Math.max(1, Math.floor(input.page ?? 1) || 1);
	const [total, firstFetch, orgs, actorMemberships] = await Promise.all([
		prisma.membership.count({ where }),
		prisma.membership.findMany({
			where,
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			skip: (requestedPage - 1) * pageSize,
			take: pageSize,
			select: { id: true, orgId: true, userId: true, role: true, createdAt: true },
		}),
		prisma.organization.findMany({
			where: { id: { in: scope.orgIds } },
			select: { id: true, name: true },
		}),
		prisma.membership.findMany({
			where: {
				userId: actor.id,
				orgId: { in: scope.orgIds },
				revokedAt: null,
				role: { in: [...TENANT_ADMIN_ROLES] },
			},
			select: { orgId: true, role: true },
		}),
	]);
	const paging = resolvePagination(requestedPage, pageSize, total);
	const memberships =
		paging.page === requestedPage
			? firstFetch
			: await prisma.membership.findMany({
					where,
					orderBy: [{ createdAt: "asc" }, { id: "asc" }],
					skip: paging.offset,
					take: paging.pageSize,
					select: { id: true, orgId: true, userId: true, role: true, createdAt: true },
				});

	const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));
	const actorRoleByOrg = new Map(actorMemberships.map((m) => [m.orgId, m.role]));
	const orgOptions: TenantMemberOrgOption[] = orgs
		.map((org) => {
			const callerRole = actorRoleByOrg.get(org.id);
			return callerRole ? { id: org.id, name: org.name, callerRole } : null;
		})
		.filter((org): org is TenantMemberOrgOption => org !== null)
		.sort((a, b) => a.name.localeCompare(b.name));

	if (memberships.length === 0) {
		return {
			rows: [],
			total,
			page: paging.page,
			pageSize: paging.pageSize,
			orgOptions,
		};
	}

	const userIds = [...new Set(memberships.map((membership) => membership.userId))];
	const membershipIds = memberships.map((membership) => membership.id);

	const [users, permissionRows, platformAdmins, ownerCounts] = await Promise.all([
		prisma.user.findMany({
			where: { id: { in: userIds } },
			select: { id: true, farmId: true, email: true, displayName: true },
		}),
		prisma.membershipPermission.findMany({
			where: { membershipId: { in: membershipIds } },
			select: { membershipId: true, permission: true, revokedAt: true },
		}),
		prisma.platformAdmin.findMany({
			where: { userId: { in: userIds }, revokedAt: null },
			select: { userId: true },
		}),
		// Owner totals cover every membership in the org, not just this page,
		// so the last-owner guard stays correct on page 2 and beyond.
		prisma.membership.groupBy({
			by: ["orgId"],
			where: { orgId: { in: scope.orgIds }, revokedAt: null, role: "OWNER" },
			_count: { _all: true },
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

	const ownerCountByOrg = new Map<string, number>();
	for (const row of ownerCounts) {
		ownerCountByOrg.set(row.orgId, row._count._all);
	}

	const rows: TenantMemberRow[] = [];
	for (const membership of memberships) {
		const user = userById.get(membership.userId);
		const orgName = orgNameById.get(membership.orgId);
		const callerRole = actorRoleByOrg.get(membership.orgId);
		if (!user || !orgName || !callerRole) continue;

		rows.push({
			membershipId: membership.id,
			orgId: membership.orgId,
			orgName,
			userId: user.id,
			farmId: user.farmId,
			email: user.email,
			displayName: user.displayName,
			role: membership.role,
			joinedAt: membership.createdAt,
			callerRole,
			isSelf: user.id === actor.id,
			isPlatformAdmin: platformAdminIds.has(user.id),
			isLastOwner: membership.role === "OWNER" && (ownerCountByOrg.get(membership.orgId) ?? 0) <= 1,
			permissions: [
				...effectivePermissions(membership.role, overridesByMembership.get(membership.id)),
			].sort(),
		});
	}

	return { rows, total, page: paging.page, pageSize: paging.pageSize, orgOptions };
}

export type MemberActionState = { success: true } | { error: string };

export type InviteMemberInput = {
	/** Defaults to the caller's primary administered org (single-org product). */
	orgId?: string;
	email: string;
	displayName: string;
	role: MemberRole;
};

export type InviteMemberState =
	| {
			success: true;
			membershipId: string;
			userId: string;
			loginEmail: string;
			/** Returned once for a new account; null when an existing account was attached. */
			temporaryPassword: string | null;
			createdUser: boolean;
			/**
			 * True when the invitation email was accepted by Resend. False when
			 * email is unconfigured, delivery failed, or only an existing account
			 * was attached (nothing new to send).
			 */
			inviteEmailSent: boolean;
	  }
	| { error: string };

type ManagedMemberTarget = {
	membership: { id: string; orgId: string; userId: string; role: MemberRole };
	actorRole: MemberRole;
	actorUserId: string;
};

type ManagedMemberResult =
	| { success: true; target: ManagedMemberTarget }
	| { success: false; error: string };

/**
 * Resolve a membership the caller may manage, plus the caller's own role in
 * that same organization. Scope fails closed, so a non-admin caller can never
 * match a target from another tenant.
 */
async function resolveManagedMember(userId: string): Promise<ManagedMemberResult> {
	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	if (!actor) return { success: false, error: "Not authenticated." };
	if (!scope.memberUserIds.includes(userId)) {
		return { success: false, error: "That user is outside your organization." };
	}
	if (await hasPlatformAdminGrant(userId)) {
		return { success: false, error: PLATFORM_ADMIN_MANAGED_ELSEWHERE };
	}

	const membership = await prisma.membership.findFirst({
		where: { userId, revokedAt: null, orgId: { in: scope.orgIds } },
		orderBy: { createdAt: "asc" },
		select: { id: true, orgId: true, userId: true, role: true },
	});
	if (!membership) {
		return { success: false, error: "That user has no active membership in your organization." };
	}

	// Membership roles are per org; the hierarchy rules use the caller's role in
	// the target membership's org, not their strongest role anywhere.
	const actorMembership = await prisma.membership.findFirst({
		where: {
			userId: actor.id,
			orgId: membership.orgId,
			revokedAt: null,
			role: { in: [...TENANT_ADMIN_ROLES] },
		},
		select: { role: true },
	});
	if (!actorMembership) {
		return { success: false, error: "You do not administer that organization." };
	}

	return {
		success: true,
		target: { membership, actorRole: actorMembership.role, actorUserId: actor.id },
	};
}

async function countActiveOwners(
	orgId: string,
	client: Pick<Prisma.TransactionClient, "membership"> = prisma,
): Promise<number> {
	return client.membership.count({
		where: { orgId, role: "OWNER", revokedAt: null },
	});
}

/**
 * Add a member to the caller's organization.
 *
 * There is no invite table: an existing account is attached (or reactivated),
 * otherwise a new login is provisioned with a one-time temporary password.
 * No email is sent — the admin shares the password directly.
 */
export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberState> {
	await requireTenantAdmin();
	await requirePermission("manage_members");

	if (!isMemberRole(input.role)) return { error: "Choose a valid role." };

	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	if (!actor) return { error: "Not authenticated." };

	const orgId = input.orgId?.trim() ? input.orgId.trim() : scope.orgIds[0];
	if (!orgId) {
		return { error: "You must belong to an organization to invite members." };
	}
	if (!scope.orgIds.includes(orgId)) {
		return { error: "That organization is outside your scope." };
	}

	const callerMembership = await prisma.membership.findFirst({
		where: {
			userId: actor.id,
			orgId,
			revokedAt: null,
			role: { in: [...TENANT_ADMIN_ROLES] },
		},
		select: { role: true },
	});
	if (!callerMembership) {
		return { error: "You do not administer that organization." };
	}

	const ruleError = inviteRoleError(callerMembership.role, input.role);
	if (ruleError) return { error: ruleError };

	const result = await inviteOrAttachMember({
		orgId,
		email: input.email,
		displayName: input.displayName,
		role: input.role,
		invitedBy: actor.id,
		refusePlatformAdminTarget: true,
	});
	if (!result.success) return { error: result.error };

	// Best-effort: neither the organization lookup nor the send may undo an
	// invite that already committed. The one-time password stays in the result
	// for the UI to show once.
	let orgName: string | undefined;
	try {
		const org = await prisma.organization.findUnique({
			where: { id: orgId },
			select: { name: true },
		});
		orgName = org?.name;
	} catch {
		orgName = undefined;
	}
	const inviteEmailSent = result.temporaryPassword
		? await deliverMemberInviteEmail({
				to: input.email,
				loginId: result.loginEmail.split("@")[0],
				temporaryPassword: result.temporaryPassword,
				orgName,
				inviterName: actor.displayName || actor.farmId,
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
}

/** Change one active member's membership role. */
export async function changeMemberRole(
	userId: string,
	role: MemberRole,
): Promise<MemberActionState> {
	await requireTenantAdmin();
	await requirePermission("manage_members");

	if (!isMemberRole(role)) return { error: "Choose a valid role." };

	const resolved = await resolveManagedMember(userId);
	if (!resolved.success) return { error: resolved.error };
	const { membership, actorRole, actorUserId } = resolved.target;

	const ownerCount =
		membership.role === "OWNER" && role !== "OWNER" ? await countActiveOwners(membership.orgId) : 0;
	const ruleError = roleChangeError({
		actorRole,
		targetRole: membership.role,
		nextRole: role,
		isSelf: actorUserId === userId,
		activeOwnerCount: ownerCount,
	});
	if (ruleError) return { error: ruleError };
	if (membership.role === role) return { success: true };

	try {
		const changed = await prisma.$transaction(async (tx) => {
			// Re-check inside the transaction so two concurrent demotions cannot
			// both observe the same last owner.
			if (membership.role === "OWNER" && role !== "OWNER") {
				const remaining = await countActiveOwners(membership.orgId, tx);
				if (remaining <= 1) return false;
			}
			await tx.membership.update({ where: { id: membership.id }, data: { role } });
			return true;
		});
		if (!changed) {
			return { error: "The last owner cannot be demoted or removed. Promote another owner first." };
		}
		return { success: true };
	} catch (e) {
		console.error(
			"[admin] changeMemberRole error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to update the role." };
	}
}

/** Revoke one active member's membership (soft delete; the account remains). */
export async function revokeMember(userId: string): Promise<MemberActionState> {
	await requireTenantAdmin();
	await requirePermission("manage_members");

	const resolved = await resolveManagedMember(userId);
	if (!resolved.success) return { error: resolved.error };
	const { membership, actorRole, actorUserId } = resolved.target;

	const ownerCount = membership.role === "OWNER" ? await countActiveOwners(membership.orgId) : 0;
	const ruleError = revokeMemberError({
		actorRole,
		targetRole: membership.role,
		isSelf: actorUserId === userId,
		activeOwnerCount: ownerCount,
	});
	if (ruleError) return { error: ruleError };

	try {
		const revoked = await prisma.$transaction(async (tx) => {
			if (membership.role === "OWNER") {
				const remaining = await countActiveOwners(membership.orgId, tx);
				if (remaining <= 1) return false;
			}
			await tx.membership.update({
				where: { id: membership.id },
				data: { revokedAt: new Date() },
			});
			return true;
		});
		if (!revoked) {
			return { error: "The last owner cannot be demoted or removed. Promote another owner first." };
		}
		return { success: true };
	} catch (e) {
		console.error("[admin] revokeMember error:", e instanceof Error ? e.message : "unknown error");
		return { error: "Failed to revoke the membership." };
	}
}

// ─── Pond Management ─────────────────────────────────────────────────────────

export async function getPonds(input: { page?: number; pageSize?: number } = {}): Promise<
	AdminListPage<
		Prisma.PondGetPayload<{
			include: {
				owner: true;
				farm: true;
				energyDevices: true;
				_count: { select: { biomassLogs: true; notifications: true; ownershipHistory: true } };
			};
		}>
	>
> {
	await requireTenantAdmin();
	const pageSize = await resolveAdminPageSize(input.pageSize);
	const scope = await resolveOrgScope();
	const where = { id: { in: scope.pondIds } };
	const requestedPage = Math.max(1, Math.floor(input.page ?? 1) || 1);

	const [total, firstFetch] = await Promise.all([
		prisma.pond.count({ where }),
		prisma.pond.findMany({
			where,
			include: {
				owner: true,
				farm: true,
				energyDevices: true,
				_count: { select: { biomassLogs: true, notifications: true, ownershipHistory: true } },
			},
			orderBy: { createdAt: "desc" },
			skip: (requestedPage - 1) * pageSize,
			take: pageSize,
		}),
	]);
	const paging = resolvePagination(requestedPage, pageSize, total);
	const rows =
		paging.page === requestedPage
			? firstFetch
			: await prisma.pond.findMany({
					where,
					include: {
						owner: true,
						farm: true,
						energyDevices: true,
						_count: { select: { biomassLogs: true, notifications: true, ownershipHistory: true } },
					},
					orderBy: { createdAt: "desc" },
					skip: paging.offset,
					take: paging.pageSize,
				});

	return { rows, total, page: paging.page, pageSize: paging.pageSize };
}

export type CreatePondResult = { success: true; pondId: string } | { error: string };

export type CreatePondWithFarmerResult =
	| { success: true; pondId: string; userId: string }
	| { error: string };

/**
 * Register a farmer and their initial pond in one step.
 *
 * This replaces the old "pick an existing user from a dropdown" flow: a farmer
 * with no pond has nothing to manage, so pond creation is the natural moment to
 * create the account. The new farmer is added to the calling admin's
 * organization as an OPERATOR, which is what puts them in scope for the admin's
 * console and keeps them out of everyone else's.
 *
 * Mirrors createUser's Supabase-then-transaction shape, and rolls the auth
 * account back if the transaction fails so no orphaned login is left behind.
 */
export async function createPondWithFarmer(data: {
	farmerName: string;
	/** Login slug / pond-email local part. */
	loginId: string;
	/** Temporary password. The user must change it on first login. */
	password: string;
	pondName: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population?: number | null;
	scheduleStart: string;
	scheduleEnd: string;
}): Promise<CreatePondWithFarmerResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");

	const loginId = data.loginId?.trim().toLowerCase() ?? "";
	const farmerName = data.farmerName?.trim() ?? "";
	const pondName = data.pondName?.trim() ?? "";

	if (!/^[a-z0-9-]+$/.test(loginId)) {
		return { error: "Login ID must be lowercase alphanumeric with hyphens." };
	}
	if (!farmerName) return { error: "Farmer name is required." };
	if (!pondName) return { error: "Pond name is required." };
	const passwordCheck = validatePassword(data.password ?? "", "temporary");
	if (!passwordCheck.ok) return { error: passwordErrorMessage(passwordCheck.code) };

	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	if (!actor) return { error: "Not authenticated." };
	// Adding a farmer to no organization would create an account that no admin
	// can see, so refuse rather than orphan it.
	if (scope.orgIds.length === 0) {
		return { error: "You must belong to an organization to add farmers." };
	}
	const orgId = scope.orgIds[0] as string;

	const email = buildPondEmail(loginId);

	const existing = await prisma.user.findFirst({
		where: { OR: [{ farmId: loginId }, { email }] },
		select: { id: true },
	});
	if (existing) return { error: `A user with login ID "${loginId}" already exists.` };

	const [startHours, startMinutes] = data.scheduleStart.split(":").map(Number);
	const [endHours, endMinutes] = data.scheduleEnd.split(":").map(Number);

	const scheduleStart = new Date();
	scheduleStart.setUTCHours(startHours, startMinutes, 0, 0);
	const scheduleEnd = new Date();
	scheduleEnd.setUTCHours(endHours, endMinutes, 0, 0);

	// Service-role client: auth.admin.createUser is rejected with the anon key.
	const supabase = createAdminClient();
	const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
		email,
		password: data.password,
		email_confirm: true,
	});
	if (authError) return { error: `Failed to create auth account: ${authError.message}` };

	try {
		const { userId, pondId } = await prisma.$transaction(async (tx) => {
			const user = await tx.user.create({
				data: {
					supabaseId: authUser.user.id,
					farmId: loginId,
					email,
					displayName: farmerName,
					role: "OPERATOR",
					mustChangePassword: true,
				},
			});

			const farm = await tx.farm.create({
				data: { ownerId: loginId, name: `${farmerName} Farm` },
			});

			const pond = await tx.pond.create({
				data: {
					name: pondName,
					ownerId: loginId,
					farmId: farm.id,
					feedingRatePct: data.feedingRatePct,
					feedsPerDay: data.feedsPerDay,
					population: data.population ?? null,
					scheduleStart,
					scheduleEnd,
				},
			});

			// No unique constraint on invitedBy, so a plain create is fine here.
			await tx.membership.create({
				data: { orgId, userId: user.id, role: "OPERATOR", invitedBy: actor.id },
			});

			return { userId: user.id, pondId: pond.id };
		});

		return { success: true, userId, pondId };
	} catch (e) {
		// Roll back the Supabase account so a failed transaction does not leave
		// an unusable auth user behind (mirrors createUser's care).
		await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => undefined);
		console.error("[admin] createPondWithFarmer error:", e);
		return { error: "Failed to create the farmer and pond." };
	}
}

/**
 * Add a pond to an existing farmer in the caller's tenant.
 *
 * Currently unreferenced by the UI — the pond form uses createPondWithFarmer,
 * which creates the farmer too. Kept because it is still a callable action, so
 * it carries the same tenant guard as everything else here.
 */
export async function createPond(data: {
	name: string;
	ownerFarmId: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population?: number | null;
	scheduleStart: string;
	scheduleEnd: string;
}): Promise<CreatePondResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const scope = await resolveOrgScope();
	if (!scope.farmIds.includes(data.ownerFarmId)) {
		return { error: "That farm is outside your organization." };
	}

	try {
		const owner = await prisma.user.findUnique({
			where: { farmId: data.ownerFarmId },
		});
		if (!owner) return { error: `User with farm ID "${data.ownerFarmId}" not found.` };

		const [startHours, startMinutes] = data.scheduleStart.split(":").map(Number);
		const [endHours, endMinutes] = data.scheduleEnd.split(":").map(Number);

		const scheduleStart = new Date();
		scheduleStart.setUTCHours(startHours, startMinutes, 0, 0);
		const scheduleEnd = new Date();
		scheduleEnd.setUTCHours(endHours, endMinutes, 0, 0);

		// Every farmer has exactly one Farm — self-heal if it's missing.
		// Farm upsert + pond create are atomic: no pond without its farm.
		const pond = await prisma.$transaction(async (tx) => {
			const farm = await tx.farm.upsert({
				where: { ownerId: owner.farmId },
				update: {},
				create: {
					ownerId: owner.farmId,
					name: `${owner.displayName || owner.farmId} Farm`,
				},
			});

			return tx.pond.create({
				data: {
					name: data.name,
					ownerId: data.ownerFarmId,
					farmId: farm.id,
					feedingRatePct: data.feedingRatePct,
					feedsPerDay: data.feedsPerDay,
					population: data.population ?? null,
					scheduleStart,
					scheduleEnd,
				},
			});
		});

		return { success: true, pondId: pond.id };
	} catch (e) {
		console.error("[admin] createPond error:", e);
		return { error: "Failed to create pond." };
	}
}

// ─── Device Management ───────────────────────────────────────────────────────

export type AdminDeviceRow = Prisma.EnergyDeviceGetPayload<{
	select: {
		id: true;
		label: true;
		mac: true;
		pondId: true;
		lastSeenAt: true;
		feedLevelPercent: true;
		gramsPerFeeding: true;
		pond: { select: { id: true; name: true } };
	};
}>;

export async function getDevices(
	input: { page?: number; pageSize?: number } = {},
): Promise<AdminListPage<AdminDeviceRow>> {
	await requireTenantAdmin();
	const pageSize = await resolveAdminPageSize(input.pageSize);
	const scope = await resolveOrgScope();
	const where = { pondId: { in: scope.pondIds } };
	const requestedPage = Math.max(1, Math.floor(input.page ?? 1) || 1);

	const [total, firstFetch] = await Promise.all([
		prisma.energyDevice.count({ where }),
		prisma.energyDevice.findMany({
			where,
			// Explicit display fields only: token/tokenHash are device credentials
			// and must never leave the server through an admin list.
			select: {
				id: true,
				label: true,
				mac: true,
				pondId: true,
				lastSeenAt: true,
				feedLevelPercent: true,
				gramsPerFeeding: true,
				pond: { select: { id: true, name: true } },
			},
			orderBy: { createdAt: "desc" },
			skip: (requestedPage - 1) * pageSize,
			take: pageSize,
		}),
	]);
	const paging = resolvePagination(requestedPage, pageSize, total);
	const rows =
		paging.page === requestedPage
			? firstFetch
			: await prisma.energyDevice.findMany({
					where,
					select: {
						id: true,
						label: true,
						mac: true,
						pondId: true,
						lastSeenAt: true,
						feedLevelPercent: true,
						gramsPerFeeding: true,
						pond: { select: { id: true, name: true } },
					},
					orderBy: { createdAt: "desc" },
					skip: paging.offset,
					take: paging.pageSize,
				});

	return { rows, total, page: paging.page, pageSize: paging.pageSize };
}

/** Machine-readable failure causes the reveal component can translate. */
export type RevealDeviceTokenErrorCode = "rate_limited";

export type RevealDeviceTokenResult =
	| { success: true; token: string; mac: string; label: string }
	| { success: false; error: string; code?: RevealDeviceTokenErrorCode };

/**
 * Return one device's provisioning credential to a tenant admin, on demand.
 *
 * `getDevices` deliberately omits `token`, so the credential never rides along
 * in a list response, a cached RSC payload or a page render. This is the only
 * read path for it: it is ADMIN-only, scoped through the device's pond to the
 * caller's tenant, and reveals exactly one row per explicit request.
 *
 * Every attempt is counted against the actor's hourly reveal allowance, and
 * every successful reveal writes a `token_revealed` DeviceStateEvent for the
 * device. The audit row is written before the token is returned, so a failed
 * audit cannot produce an unlogged credential.
 *
 * The token is never logged — not on success, and not in the failure branch,
 * where the error's message (not the error object) is what gets written — and
 * it is never placed in the audit row.
 */
export async function revealDeviceToken(deviceId: string): Promise<RevealDeviceTokenResult> {
	await requireTenantAdmin();

	if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
		return { success: false, error: "A device is required." };
	}

	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	if (!actor) return { success: false, error: "Not authenticated." };

	const limit = await checkDeviceTokenRevealRateLimit(actor.id);
	if (!limit.success) {
		return {
			success: false,
			error: "Too many token reveals. Try again in an hour.",
			code: "rate_limited",
		};
	}

	try {
		const device = await prisma.energyDevice.findFirst({
			// `in: []` matches nothing, so a caller with no admin membership gets
			// the same "not found" answer as a device from another tenant.
			where: { id: deviceId, pondId: { in: scope.pondIds } },
			select: { token: true, mac: true, label: true },
		});
		if (!device) return { success: false, error: "Device not found in your organization." };

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "token_revealed",
				source: "user",
				// The credential itself is deliberately absent: the audit trail
				// records who looked, not what they saw.
				actorId: actor.id,
			},
		});

		return { success: true, token: device.token, mac: device.mac, label: device.label };
	} catch (e) {
		console.error(
			"[admin] revealDeviceToken error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { success: false, error: "Failed to load the device token." };
	}
}

/** Most stickers one print job may carry; bounds the query and the page. */
const MAX_DEVICE_LABELS = 40;

export type DeviceLabelRow = { id: string; label: string; mac: string };

/**
 * Display fields for the printable Wi-Fi/power-rating sticker.
 *
 * Same gate as `revealDeviceToken`: tenant admin, and the device must sit on a
 * pond in the caller's org scope. A device outside the scope is simply absent
 * from the result — indistinguishable from one that does not exist.
 *
 * The select is an explicit allow-list. `token` and `tokenHash` are device
 * credentials and must never reach a sticker, so they are not read at all.
 */
export async function getDevicesForLabels(deviceIds: string[]): Promise<DeviceLabelRow[]> {
	await requireTenantAdmin();

	const ids = [
		...new Set(deviceIds.filter((id) => typeof id === "string" && id.trim().length > 0)),
	].slice(0, MAX_DEVICE_LABELS);
	if (ids.length === 0) return [];

	const scope = await resolveOrgScope();
	const devices = await prisma.energyDevice.findMany({
		where: { id: { in: ids }, pondId: { in: scope.pondIds } },
		select: { id: true, label: true, mac: true },
	});

	// Keep the order the admin selected them in.
	const order = new Map(ids.map((id, index) => [id, index]));
	return devices.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// ─── Farm Hierarchy ──────────────────────────────────────────────────────────

export type FarmHierarchyNode = {
	user: {
		id: string;
		displayName: string | null;
		email: string | null;
		farmId: string;
		role: UserRole;
	};
	farm: { id: string; name: string; ownerId: string } | null;
	ponds: {
		id: string;
		name: string;
		status: PondStatus;
		devices: { id: string; label: string; lastSeenAt: string | null }[];
	}[];
};

/**
 * Every user's full User → Farm → Ponds → Devices hierarchy (admin view),
 * limited to the caller's tenant scope. Dates serialized to ISO strings for
 * safe pass-through to client components.
 */
export async function getAllFarmHierarchies(): Promise<FarmHierarchyNode[]> {
	await requireTenantAdmin();
	const [scope, platformAdmins] = await Promise.all([resolveOrgScope(), platformAdminUserIds()]);

	const users = await prisma.user.findMany({
		where: {
			id: { in: scope.memberUserIds },
			// Same exclusion as getUsers/getAdminStats: a platform admin is not a
			// tenant member and must not appear in the tenant hierarchy.
			...(platformAdmins.length > 0 ? { NOT: { id: { in: platformAdmins } } } : {}),
		},
		orderBy: { createdAt: "asc" },
		include: {
			farm: {
				include: {
					ponds: {
						orderBy: { createdAt: "asc" },
						include: {
							energyDevices: {
								orderBy: { createdAt: "asc" },
								select: { id: true, label: true, lastSeenAt: true },
							},
						},
					},
				},
			},
		},
	});

	return users.map((user) => ({
		user: {
			id: user.id,
			displayName: user.displayName,
			email: user.email,
			farmId: user.farmId,
			role: user.role,
		},
		farm: user.farm ? { id: user.farm.id, name: user.farm.name, ownerId: user.farm.ownerId } : null,
		ponds: (user.farm?.ponds ?? []).map((pond) => ({
			id: pond.id,
			name: pond.name,
			status: pond.status,
			devices: pond.energyDevices.map((device) => ({
				id: device.id,
				label: device.label,
				lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
			})),
		})),
	}));
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getAdminStats() {
	await requireTenantAdmin();
	const [scope, platformAdmins] = await Promise.all([resolveOrgScope(), platformAdminUserIds()]);

	const [userCount, pondCount, deviceCount, recentEvents] = await Promise.all([
		prisma.user.count({
			where: {
				id: { in: scope.memberUserIds },
				// Same exclusion as getUsers: a platform admin is not a tenant
				// member and must not inflate the tenant's user count.
				...(platformAdmins.length > 0 ? { NOT: { id: { in: platformAdmins } } } : {}),
			},
		}),
		prisma.pond.count({ where: { id: { in: scope.pondIds } } }),
		prisma.energyDevice.count({ where: { pondId: { in: scope.pondIds } } }),
		prisma.deviceStateEvent.findMany({
			where: { device: { pondId: { in: scope.pondIds } } },
			take: 20,
			orderBy: { createdAt: "desc" },
			include: { device: { select: { label: true } } },
		}),
	]);

	return { userCount, pondCount, deviceCount, recentEvents };
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

export async function getAuditLog(input: { page?: number; pageSize?: number } = {}): Promise<
	AdminListPage<
		Prisma.DeviceStateEventGetPayload<{
			include: { device: { select: { label: true; mac: true } } };
		}>
	>
> {
	await requireTenantAdmin();
	const pageSize = await resolveAdminPageSize(input.pageSize);
	const scope = await resolveOrgScope();
	const requestedPage = Math.max(1, Math.floor(input.page ?? 1) || 1);

	const where: Prisma.DeviceStateEventWhereInput = {
		device: { pondId: { in: scope.pondIds } },
	};
	const [total, firstFetch] = await Promise.all([
		prisma.deviceStateEvent.count({ where }),
		prisma.deviceStateEvent.findMany({
			where,
			take: pageSize,
			skip: (requestedPage - 1) * pageSize,
			orderBy: { createdAt: "desc" },
			include: {
				device: { select: { label: true, mac: true } },
			},
		}),
	]);
	const paging = resolvePagination(requestedPage, pageSize, total);
	const rows =
		paging.page === requestedPage
			? firstFetch
			: await prisma.deviceStateEvent.findMany({
					where,
					take: paging.pageSize,
					skip: paging.offset,
					orderBy: { createdAt: "desc" },
					include: {
						device: { select: { label: true, mac: true } },
					},
				});

	return { rows, total, page: paging.page, pageSize: paging.pageSize };
}

// ─── Update Pond Owner ───────────────────────────────────────────────────────

/**
 * Currently unreferenced by the UI; guarded because it remains a callable
 * action. Both ends of the move must sit inside the caller's tenant.
 */
export async function updatePondOwner(
	pondId: string,
	newOwnerFarmId: string,
): Promise<UpdateUserResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const scope = await resolveOrgScope();
	if (!scope.pondIds.includes(pondId)) {
		return { error: "That pond is outside your organization." };
	}
	if (!scope.farmIds.includes(newOwnerFarmId)) {
		return { error: "That farm is outside your organization." };
	}

	try {
		const newOwner = await prisma.user.findUnique({
			where: { farmId: newOwnerFarmId },
		});
		if (!newOwner) return { error: `User with farm ID "${newOwnerFarmId}" not found.` };

		// The pond moves to the new owner's single Farm (self-heal if missing).
		// Farm upsert + pond reassignment are atomic.
		await prisma.$transaction(async (tx) => {
			const farm = await tx.farm.upsert({
				where: { ownerId: newOwner.farmId },
				update: {},
				create: {
					ownerId: newOwner.farmId,
					name: `${newOwner.displayName || newOwner.farmId} Farm`,
				},
			});

			await tx.pond.update({
				where: { id: pondId },
				data: { ownerId: newOwner.farmId, farmId: farm.id },
			});
		});
		return { success: true };
	} catch (e) {
		console.error("[admin] updatePondOwner error:", e);
		return { error: "Failed to update pond owner." };
	}
}

// ─── Pond Lifecycle ──────────────────────────────────────────────────────────

export type SetPondStatusResult = { success: true } | { error: string };

/**
 * Archive/restore a pond. Archived ponds keep all history but drop out of
 * farmer-facing flows (selector, dashboard, actions).
 */
export async function setPondStatus(
	pondId: string,
	status: PondStatus,
): Promise<SetPondStatusResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");

	if (status !== "ACTIVE" && status !== "ARCHIVED") {
		return { error: "Invalid pond status." };
	}
	const scope = await resolveOrgScope();
	if (!scope.pondIds.includes(pondId)) {
		return { error: "That pond is outside your organization." };
	}

	try {
		await prisma.pond.update({ where: { id: pondId }, data: { status } });
		return { success: true };
	} catch (e) {
		console.error("[admin] setPondStatus error:", e);
		return { error: "Failed to update pond status." };
	}
}
