"use server";

import { redirect } from "@/i18n/routing";
import { deleteUserSubtree } from "@/lib/actions/admin-internal";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requirePermission } from "@/lib/auth/permissions";
import { buildPondEmail, getCurrentUser } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PondStatus, Prisma, UserRole } from "@prisma/client";
import { getLocale } from "next-intl/server";

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
	data: { displayName?: string; role?: UserRole },
): Promise<UpdateUserResult> {
	await requireRole("ADMIN");
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

	try {
		await prisma.user.update({
			where: { id: userId },
			data,
		});
		return { success: true };
	} catch (e) {
		console.error("[admin] updateUser error:", e);
		return { error: "Failed to update user." };
	}
}

export type DeleteUserResult = { success: true } | { error: string };

export async function deleteUser(userId: string): Promise<DeleteUserResult> {
	await requireRole("ADMIN");
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

export async function getUsers() {
	await requireRole("ADMIN");
	const [scope, platformAdmins] = await Promise.all([resolveOrgScope(), platformAdminUserIds()]);

	return prisma.user.findMany({
		where: {
			id: { in: scope.memberUserIds },
			// Platform admins are managed from /superadmin, never here.
			...(platformAdmins.length > 0 ? { NOT: { id: { in: platformAdmins } } } : {}),
		},
		orderBy: { createdAt: "desc" },
		include: { farm: true },
	});
}

// ─── Pond Management ─────────────────────────────────────────────────────────

export async function getPonds() {
	await requireRole("ADMIN");
	const scope = await resolveOrgScope();

	return prisma.pond.findMany({
		where: { id: { in: scope.pondIds } },
		include: {
			owner: true,
			farm: true,
			energyDevices: true,
			_count: { select: { biomassLogs: true, notifications: true, ownershipHistory: true } },
		},
		orderBy: { createdAt: "desc" },
	});
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
	/** 6-digit PIN (set-time policy, task 2.7). */
	pin: string;
	pondName: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population?: number | null;
	scheduleStart: string;
	scheduleEnd: string;
}): Promise<CreatePondWithFarmerResult> {
	await requireRole("ADMIN");
	await requirePermission("manage_farms_ponds");

	const loginId = data.loginId?.trim().toLowerCase() ?? "";
	const farmerName = data.farmerName?.trim() ?? "";
	const pondName = data.pondName?.trim() ?? "";

	if (!/^[a-z0-9-]+$/.test(loginId)) {
		return { error: "Login ID must be lowercase alphanumeric with hyphens." };
	}
	if (!farmerName) return { error: "Farmer name is required." };
	if (!pondName) return { error: "Pond name is required." };
	if (!/^\d{6}$/.test(data.pin ?? "")) return { error: "PIN must be exactly 6 digits." };

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
		password: data.pin,
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
	await requireRole("ADMIN");
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

export async function getDevices() {
	await requireRole("ADMIN");
	const scope = await resolveOrgScope();

	return prisma.energyDevice.findMany({
		where: { pondId: { in: scope.pondIds } },
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
	});
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
	await requireRole("ADMIN");
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
	await requireRole("ADMIN");
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

export async function getAuditLog(cursor?: string, limit = 50) {
	await requireRole("ADMIN");
	const scope = await resolveOrgScope();

	const where: Prisma.DeviceStateEventWhereInput = {
		device: { pondId: { in: scope.pondIds } },
		...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
	};

	return prisma.deviceStateEvent.findMany({
		where,
		take: limit,
		orderBy: { createdAt: "desc" },
		include: {
			device: { select: { label: true, mac: true } },
		},
	});
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
	await requireRole("ADMIN");
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
	await requireRole("ADMIN");
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
