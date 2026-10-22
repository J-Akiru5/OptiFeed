import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "@/lib/api/envelope";
import { forbidden, unauthorized } from "@/lib/api/errors";
import { recordPhase } from "@/lib/api/request-context";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";
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
 * Auth cost is recorded as the `auth` phase of `Server-Timing` (§9): session
 * verification is a network call plus one indexed lookup, and it must be
 * visible in the latency budget rather than hidden inside "app" time.
 *
 * Usage:
 *   export const GET = withApi(withAuth(async (req, { ownerId }) => { ... }));
 */
export function withAuth(handler: AuthenticatedHandler) {
	return async (request: NextRequest) => {
		const startedAt = performance.now();
		const supabase = await createClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();

		if (!user?.id || !user?.email) {
			recordPhase("auth", performance.now() - startedAt);
			return fail(unauthorized());
		}

		// Resolve ownerId from the DB row (by Supabase auth id), never from the
		// email local part alone — a lookalike domain must not act as the farm.
		const dbUser = await prisma.user.findUnique({
			where: { supabaseId: user.id },
			select: { farmId: true },
		});
		const emailFarmId = farmIdFromPondEmail(user.email);
		const ownerId = dbUser && emailFarmId === dbUser.farmId ? dbUser.farmId : null;

		// Stop the auth clock before the handler runs: `app` is derived as
		// total - db - auth, so including handler time here would erase it.
		recordPhase("auth", performance.now() - startedAt);

		if (!ownerId) {
			return fail(unauthorized());
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
		const startedAt = performance.now();
		const header = request.headers.get("authorization");
		if (!header?.startsWith("Bearer ")) {
			recordPhase("auth", performance.now() - startedAt);
			return fail(unauthorized());
		}

		const secret = process.env.CRON_SECRET;
		if (!secret) {
			recordPhase("auth", performance.now() - startedAt);
			return fail(forbidden("Cron secret is not configured."));
		}

		const provided = createHash("sha256").update(header.slice("Bearer ".length)).digest();
		const expected = createHash("sha256").update(secret).digest();
		if (!timingSafeEqual(provided, expected)) {
			recordPhase("auth", performance.now() - startedAt);
			return fail(forbidden());
		}

		// Auth ends before the job body; see the note in withAuth.
		recordPhase("auth", performance.now() - startedAt);
		return handler(request);
	};
}

// Kept for callers that need raw Response objects (file bodies), while the
// envelope helpers above serve JSON routes.
export type { AuthenticatedHandler };
