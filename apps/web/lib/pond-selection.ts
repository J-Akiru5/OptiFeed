import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";

const COOKIE_NAME = "optifeed:pondId";

/**
 * Get the active pond ID from the cookie.
 */
export async function getActivePondId(): Promise<string | null> {
	const cookieStore = await cookies();
	return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Get the active pond for the current user.
 * Falls back to the first pond if no selection or invalid selection.
 * Pass `include` to fetch relations (e.g., `{ devices: true }`).
 */
export async function getActivePond<T extends Prisma.PondInclude = Record<string, never>>(
	include?: T,
): Promise<Prisma.PondGetPayload<{ include: T }> | null> {
	const ownerId = await getCurrentPondOwnerId();
	const activePondId = await getActivePondId();

	const ponds = await prisma.pond.findMany({
		where: { ownerId },
		orderBy: { createdAt: "asc" },
		...(include ? { include } : {}),
	});

	if (ponds.length === 0) return null;

	if (activePondId) {
		const found = ponds.find((p) => p.id === activePondId);
		if (found) return found as Prisma.PondGetPayload<{ include: T }>;
	}

	return ponds[0] as Prisma.PondGetPayload<{ include: T }>;
}
