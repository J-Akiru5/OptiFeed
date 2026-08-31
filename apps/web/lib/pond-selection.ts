import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";

const COOKIE_NAME = "optifeed:pondId";

/**
 * Get the active pond ID from the cookie.
 */
export async function getActivePondId(): Promise<string | null> {
	const cookieStore = await cookies();
	return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

// biome-ignore lint/suspicious/noExplicitAny: Prisma include types require generated client
type AnyObj = Record<string, any>;

/**
 * Get the active pond for the current user.
 * Falls back to the first pond if no selection or invalid selection.
 * Pass `include` to fetch relations (e.g., `{ devices: true }`).
 */
export async function getActivePond(include?: AnyObj): Promise<AnyObj | null> {
	const ownerId = await getCurrentPondOwnerId();
	const activePondId = await getActivePondId();

	// biome-ignore lint/suspicious/noExplicitAny: Dynamic include makes strict typing impossible
	const ponds: AnyObj[] = await prisma.pond.findMany({
		where: { ownerId },
		orderBy: { createdAt: "asc" },
		...(include ? { include } : {}),
	});

	if (ponds.length === 0) return null;

	if (activePondId) {
		const found = ponds.find((p) => p.id === activePondId);
		if (found) return found;
	}

	return ponds[0];
}
