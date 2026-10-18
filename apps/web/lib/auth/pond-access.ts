import prisma from "@/lib/prisma";

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
	const ponds = await prisma.pond.findMany({
		where: { ownerId, status: "ACTIVE" },
		orderBy: { createdAt: "asc" },
	});

	if (ponds.length === 0) return null;

	if (pondId) {
		return ponds.find((p) => p.id === pondId) ?? null;
	}

	return ponds[0];
}
