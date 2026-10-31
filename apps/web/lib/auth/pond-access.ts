import prisma from "@/lib/prisma";

/**
 * Every pond an owner may act on, in the order the owner created them.
 *
 * This is the one scoped pond list in the app: the active-pond resolver, the
 * dashboard pond switcher and any future caller share the same owner + ACTIVE
 * filter, so a foreign or archived pond can never enter a selection surface.
 */
export function listActivePondsForOwner(ownerId: string) {
	return prisma.pond.findMany({
		where: { ownerId, status: "ACTIVE" },
		orderBy: { createdAt: "asc" },
	});
}

/**
 * Resolve the pond an authenticated owner should act on.
 *
 * Fails closed: only ACTIVE ponds are considered, ordered by createdAt
 * ascending so the owner's first-created pond is the deterministic default
 * when no pondId is supplied. When `pondId` is given it must be one of the
 * owner's ACTIVE ponds — an archived, nonexistent, or foreign pond yields
 * null, never a silent fallback to another pond.
 *
 * Returns null when the owner has no ACTIVE pond.
 */
export async function resolveActivePond(ownerId: string, pondId?: string | null) {
	const ponds = await listActivePondsForOwner(ownerId);

	if (ponds.length === 0) return null;

	if (pondId) {
		return ponds.find((p) => p.id === pondId) ?? null;
	}

	return ponds[0];
}
