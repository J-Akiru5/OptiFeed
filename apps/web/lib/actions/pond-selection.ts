"use server";

import { resolveActivePond } from "@/lib/auth/pond-access";
import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import { cookies } from "next/headers";

const COOKIE_NAME = "optifeed:pondId";
/** A pond id is a Prisma cuid; anything much longer is not a real id. */
const MAX_POND_ID_LENGTH = 64;

/**
 * Switch the active pond by setting a cookie.
 *
 * Authorization is re-checked here, never taken from the client list the
 * selector rendered: `resolveActivePond` only returns a pond from the caller's
 * own farm (or the farm of an active read-only view-as session) that is
 * ACTIVE. A foreign, archived or unknown id throws the same generic error, so
 * the action cannot be used to probe another tenant's pond ids.
 *
 * Setting a cookie in a Server Action makes Next re-render the current route
 * with the new value (see the cookies guide), so the header, sidebar and page
 * body all pick up the pond without a redirect that would drop the reader out
 * of the page they were on.
 */
export async function switchPond(pondId: string): Promise<void> {
	if (typeof pondId !== "string" || pondId.length === 0 || pondId.length > MAX_POND_ID_LENGTH) {
		throw new Error("Pond not found or access denied");
	}

	const ownerId = await getCurrentPondOwnerIdSafe();
	if (!ownerId) {
		throw new Error("Not authenticated");
	}

	const pond = await resolveActivePond(ownerId, pondId);
	if (!pond) {
		throw new Error("Pond not found or access denied");
	}

	const cookieStore = await cookies();
	cookieStore.set(COOKIE_NAME, pond.id, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 365, // 1 year
	});
}
