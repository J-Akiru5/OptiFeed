import { cachedOk } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import prisma from "@/lib/prisma";

/**
 * The signed-in user's role. User-specific reference data: safe to revalidate
 * on the client for a minute, never cacheable by a shared proxy.
 */
export const GET = withApi(
	withAuth(async (request, { ownerId, user }) => {
		const dbUser = await prisma.user.findUnique({
			where: { farmId: ownerId },
			select: { role: true, displayName: true },
		});

		return cachedOk(
			{ role: dbUser?.role ?? null, email: user.email, displayName: dbUser?.displayName ?? null },
			request,
			{ maxAgeSeconds: 60, private: true },
		);
	}),
	{ route: "GET /api/user-role", sunset: LEGACY_API_SUNSET },
);
