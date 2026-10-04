"use server";

import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import type { PondStatus, UserRole } from "@prisma/client";

export type FarmOverview = {
	ownerId: string;
	farmId: string;
	name: string;
	ponds: { id: string; name: string }[];
};

/**
 * Farm + pond list for the current (authenticated) farmer's own farm.
 * Returns null when the farmer has no Farm row yet.
 */
export async function getFarmOverview(): Promise<FarmOverview | null> {
	const ownerId = await getCurrentPondOwnerId();

	const farm = await prisma.farm.findUnique({
		where: { ownerId },
		include: {
			ponds: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
		},
	});

	if (!farm) return null;

	return { ownerId: farm.ownerId, farmId: farm.id, name: farm.name, ponds: farm.ponds };
}

export type RenameFarmResult = { success: true; name: string } | { error: string };

/**
 * Renames the current user's own farm (ownership-scoped — never touches
 * another farmer's farm).
 */
export async function renameFarm(name: string): Promise<RenameFarmResult> {
	const ownerId = await getCurrentPondOwnerId();

	const trimmed = name.trim();
	if (trimmed.length < 2 || trimmed.length > 60) {
		return { error: "Farm name must be between 2 and 60 characters." };
	}

	try {
		const updated = await prisma.farm.update({
			where: { ownerId },
			data: { name: trimmed },
		});
		return { success: true, name: updated.name };
	} catch (e) {
		console.error("[farm] renameFarm error:", e);
		return { error: "Failed to rename farm." };
	}
}

export type FarmHierarchy = {
	user: {
		id: string;
		displayName: string | null;
		email: string | null;
		farmId: string;
		role: UserRole;
	};
	farm: { id: string; name: string; ownerId: string };
	ponds: {
		id: string;
		name: string;
		status: PondStatus;
		devices: { id: string; label: string; lastSeenAt: string | null }[];
	}[];
};

/**
 * Full User → Farm → Ponds → Devices hierarchy for the current farmer.
 * Dates are serialized to ISO strings so the result is safe to pass
 * from a server page into client components.
 */
export async function getFarmHierarchy(): Promise<FarmHierarchy | null> {
	const ownerId = await getCurrentPondOwnerId();

	const user = await prisma.user.findUnique({
		where: { farmId: ownerId },
		select: { id: true, displayName: true, email: true, farmId: true, role: true },
	});
	if (!user) return null;

	const farm = await prisma.farm.findUnique({
		where: { ownerId },
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
	});
	if (!farm) return null;

	return {
		user,
		farm: { id: farm.id, name: farm.name, ownerId: farm.ownerId },
		ponds: farm.ponds.map((pond) => ({
			id: pond.id,
			name: pond.name,
			status: pond.status,
			devices: pond.energyDevices.map((device) => ({
				id: device.id,
				label: device.label,
				lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
			})),
		})),
	};
}
