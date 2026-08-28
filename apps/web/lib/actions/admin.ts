"use server";

import { redirect } from "@/i18n/routing";
import { buildPondEmail } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@prisma/client";
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

	// Create DB user record
	const user = await prisma.user.create({
		data: {
			supabaseId: authUser.user.id,
			farmId: normalizedFarmId,
			email,
			displayName: data.displayName,
			role: data.role,
		},
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

		// Delete from DB
		await prisma.user.delete({ where: { id: userId } });

		return { success: true };
	} catch (e) {
		console.error("[admin] deleteUser error:", e);
		return { error: "Failed to delete user." };
	}
}

export async function getUsers() {
	await requireRole("ADMIN");
	return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
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
			energyDevices: true,
			_count: { select: { biomassLogs: true, notifications: true } },
		},
		orderBy: { createdAt: "desc" },
	});
}

// ─── Device Management ───────────────────────────────────────────────────────

export async function getDevices() {
	await requireRole("ADMIN");
	return prisma.energyDevice.findMany({
		include: { pond: true },
		orderBy: { createdAt: "desc" },
	});
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
		await prisma.pond.update({
			where: { id: pondId },
			data: { ownerId: newOwnerFarmId },
		});
		return { success: true };
	} catch (e) {
		console.error("[admin] updatePondOwner error:", e);
		return { error: "Failed to update pond owner." };
	}
}
