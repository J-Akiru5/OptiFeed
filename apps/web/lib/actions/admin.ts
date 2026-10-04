"use server";

import { redirect } from "@/i18n/routing";
import { buildPondEmail } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { PondStatus, Prisma, UserRole } from "@prisma/client";
import { getLocale } from "next-intl/server";

// ─── User Management ─────────────────────────────────────────────────────────

export type CreateUserResult = { success: true; userId: string } | { error: string };

export async function createUser(data: {
	farmId: string;
	email?: string;
	displayName: string;
	role: UserRole;
	password: string;
}): Promise<CreateUserResult> {
	await requireRole("ADMIN");

	const normalizedFarmId = data.farmId.trim().toLowerCase();
	const email = data.email || buildPondEmail(normalizedFarmId);

	// Check if farmId already exists
	const existing = await prisma.user.findFirst({
		where: { OR: [{ farmId: normalizedFarmId }, { email }] },
	});
	if (existing) {
		return { error: `A user with farm ID "${normalizedFarmId}" or email already exists.` };
	}

	// Create Supabase auth user
	const supabase = await createClient();
	const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
		email,
		password: data.password,
		email_confirm: true,
	});

	if (authError) {
		console.error("[admin] Supabase createUser error:", authError.message);
		return { error: `Failed to create auth user: ${authError.message}` };
	}

	// Create DB user record + their single Farm in one transaction
	const user = await prisma.$transaction(async (tx) => {
		const created = await tx.user.create({
			data: {
				supabaseId: authUser.user.id,
				farmId: normalizedFarmId,
				email,
				displayName: data.displayName,
				role: data.role,
			},
		});
		await tx.farm.create({
			data: {
				ownerId: created.farmId,
				name: `${data.displayName || normalizedFarmId} Farm`,
			},
		});
		return created;
	});

	return { success: true, userId: user.id };
}

export type UpdateUserResult = { success: true } | { error: string };

export async function updateUser(
	userId: string,
	data: { displayName?: string; role?: UserRole },
): Promise<UpdateUserResult> {
	await requireRole("ADMIN");

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

	try {
		// Get the user to also delete from Supabase
		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) return { error: "User not found." };

		// Delete from Supabase Auth
		const supabase = await createClient();
		await supabase.auth.admin.deleteUser(user.supabaseId);

		// Delete from DB: the farmer's whole subtree (ponds → devices → events → farm)
		await prisma.$transaction(async (tx) => {
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
 */
async function deleteUserSubtree(
	client: Prisma.TransactionClient,
	userId: string,
	farmId: string,
): Promise<void> {
	const pondIds = (
		await client.pond.findMany({ where: { ownerId: farmId }, select: { id: true } })
	).map((p) => p.id);

	if (pondIds.length > 0) {
		const wherePond = { pondId: { in: pondIds } };
		const whereDevicePond = { device: { pondId: { in: pondIds } } };

		await client.feedLevelLog.deleteMany({ where: whereDevicePond });
		await client.feedRequest.deleteMany({ where: whereDevicePond });
		await client.feedEvent.deleteMany({ where: whereDevicePond });
		await client.deviceStateEvent.deleteMany({ where: whereDevicePond });
		await client.scheduleCommand.deleteMany({
			where: { OR: [whereDevicePond, wherePond] },
		});
		await client.notification.deleteMany({ where: wherePond });
		await client.fcrReport.deleteMany({ where: wherePond });
		await client.biomassLog.deleteMany({ where: wherePond });
		await client.feedingEvent.deleteMany({ where: whereDevicePond });
		await client.energyDevice.deleteMany({ where: wherePond });
		await client.device.deleteMany({ where: wherePond });
		await client.pond.deleteMany({ where: { id: { in: pondIds } } });
	}

	await client.farm.deleteMany({ where: { ownerId: farmId } });
	await client.user.delete({ where: { id: userId } });
}

export async function getUsers() {
	await requireRole("ADMIN");
	return prisma.user.findMany({
		orderBy: { createdAt: "desc" },
		include: { farm: true },
	});
}

export async function getUserById(userId: string) {
	await requireRole("ADMIN");
	return prisma.user.findUnique({ where: { id: userId } });
}

// ─── Pond Management ─────────────────────────────────────────────────────────

export async function getPonds() {
	await requireRole("ADMIN");
	return prisma.pond.findMany({
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

export async function createPond(data: {
	name: string;
	ownerFarmId: string;
	feedingRatePct: number;
	feedsPerDay: number;
	scheduleStart: string;
	scheduleEnd: string;
}): Promise<CreatePondResult> {
	await requireRole("ADMIN");

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
	return prisma.energyDevice.findMany({
		include: { pond: true },
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
 * Every user's full User → Farm → Ponds → Devices hierarchy (admin view).
 * Dates serialized to ISO strings for safe pass-through to client components.
 */
export async function getAllFarmHierarchies(): Promise<FarmHierarchyNode[]> {
	await requireRole("ADMIN");

	const users = await prisma.user.findMany({
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

	const [userCount, pondCount, deviceCount, recentEvents] = await Promise.all([
		prisma.user.count(),
		prisma.pond.count(),
		prisma.energyDevice.count(),
		prisma.deviceStateEvent.findMany({
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

	const where = cursor ? { createdAt: { lt: new Date(cursor) } } : {};

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

export async function updatePondOwner(
	pondId: string,
	newOwnerFarmId: string,
): Promise<UpdateUserResult> {
	await requireRole("ADMIN");

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

	if (status !== "ACTIVE" && status !== "ARCHIVED") {
		return { error: "Invalid pond status." };
	}

	try {
		await prisma.pond.update({ where: { id: pondId }, data: { status } });
		return { success: true };
	} catch (e) {
		console.error("[admin] setPondStatus error:", e);
		return { error: "Failed to update pond status." };
	}
}
