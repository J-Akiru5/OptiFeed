import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { farmIdFromPondEmail } from "./session";

type AuthenticatedHandler = (
	request: NextRequest,
	context: { ownerId: string; user: { id: string; email: string } },
) => Promise<Response> | Response;

/**
 * Wraps an API route handler to enforce session-based authentication.
 *
 * Returns 401 if no valid session is found. Passes the resolved ownerId
 * and user object to the handler for convenience.
 *
 * Usage:
 *   export const GET = withAuth(async (req, { ownerId }) => { ... });
 */
export function withAuth(handler: AuthenticatedHandler) {
	return async (request: NextRequest) => {
		const supabase = await createClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();

		if (!user?.id || !user?.email) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Resolve ownerId from the DB row (by Supabase auth id), never from the
		// email local part alone — a lookalike domain must not act as the farm.
		const dbUser = await prisma.user.findUnique({
			where: { supabaseId: user.id },
			select: { farmId: true },
		});
		const emailFarmId = farmIdFromPondEmail(user.email);
		const ownerId = dbUser && emailFarmId === dbUser.farmId ? dbUser.farmId : null;
		if (!ownerId) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		return handler(request, { ownerId, user: { id: user.id, email: user.email } });
	};
}
