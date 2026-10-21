"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

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
 * Renames the current user's own farm (ownership-scoped â€” never touches
 * another farmer's farm).
 */
export async function renameFarm(name: string): Promise<RenameFarmResult> {
	try {
		await requireWriteAccess();
	} catch {
		return { error: "Write access required (ADMIN or OPERATOR)" };
	}

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
