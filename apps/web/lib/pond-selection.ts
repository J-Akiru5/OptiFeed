import { listActivePondsForOwner } from "@/lib/auth/pond-access";
import { getCurrentPondOwnerId, getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";

const COOKIE_NAME = "optifeed:pondId";

/**
 * The active pond is a per-browser preference, persisted as an httpOnly cookie.
 *
 * The cookie is the right store here because the server renders every
 * dashboard page: a layout, a page and a server action can all read the same
 * selection without threading a query parameter through each link. A URL
 * parameter would reset the pond on every navigation that does not carry it,
 * and the browser-only store (localStorage) is not visible to the server at
 * all. The value is only a hint: every read re-intersects it with the caller's
 * own ACTIVE ponds, so a stale or tampered id can never select a foreign pond.
 */
export async function getActivePondId(): Promise<string | null> {
	const cookieStore = await cookies();
	return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

/**
 * The ponds the signed-in user may switch between, as full rows.
 *
 * Fails closed: no session, or no farm resolved from the session (or an active
 * view-as session), returns an empty list rather than every pond. The query is
 * the shared owner-scoped ACTIVE list, so only ponds on the caller's farm (or
 * the viewed farm) can reach the switcher. Callers that only render the
 * control map the rows down to `{ id, name }`.
 */
export async function listSelectablePonds() {
	const ownerId = await getCurrentPondOwnerIdSafe();
	if (!ownerId) return [];

	return listActivePondsForOwner(ownerId);
}

// biome-ignore lint/suspicious/noExplicitAny: Prisma include types require generated client
type AnyObj = Record<string, any>;

/**
 * Get the active pond for the current user.
 * Falls back to the first pond if no selection or invalid selection.
 * Pass `include` to fetch relations (e.g., `{ devices: true }`).
 *
 * The cookie is never trusted on its own: `ponds` is already the caller's
 * owner-scoped ACTIVE set, so a cookie pointing at another farm's pond simply
 * does not match and the first own pond wins.
 */
export async function getActivePond(include?: AnyObj): Promise<AnyObj | null> {
	const ownerId = await getCurrentPondOwnerId();
	const activePondId = await getActivePondId();

	const ponds: AnyObj[] = await prisma.pond.findMany({
		where: { ownerId, status: "ACTIVE" },
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
