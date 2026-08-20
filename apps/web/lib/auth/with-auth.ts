import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { farmIdFromEmail } from "./session";

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

		if (!user?.email) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const ownerId = farmIdFromEmail(user.email);
		if (!ownerId) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		return handler(request, { ownerId, user: { id: user.id, email: user.email } });
	};
}
