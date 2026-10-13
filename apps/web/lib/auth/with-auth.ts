import { createHash, timingSafeEqual } from "node:crypto";
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

type CronHandler = (request: Request) => Promise<Response> | Response;

/**
 * Wraps a cron endpoint so only callers presenting
 * `Authorization: Bearer $CRON_SECRET` get through.
 *
 * Missing/malformed header → 401, wrong secret or unset CRON_SECRET → 403
 * (a schedule running without a configured secret is misconfigured, not
 * authorized). The comparison is timing-safe: both sides are SHA-256 hashed
 * first, so digests always have equal length and no length oracle leaks.
 */
export function withCronAuth(handler: CronHandler) {
	return async (request: Request) => {
		const header = request.headers.get("authorization");
		if (!header?.startsWith("Bearer ")) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const secret = process.env.CRON_SECRET;
		if (!secret) {
			return NextResponse.json({ error: "Cron secret not configured" }, { status: 403 });
		}

		const provided = createHash("sha256").update(header.slice("Bearer ".length)).digest();
		const expected = createHash("sha256").update(secret).digest();
		if (!timingSafeEqual(provided, expected)) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		return handler(request);
	};
}
