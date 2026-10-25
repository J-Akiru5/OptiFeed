import { isPlatformAdminActive } from "@/lib/auth/platform-admin";
import prisma from "@/lib/prisma";

export type PostLoginDestination = "/dashboard" | "/superadmin" | "/change-password";

/**
 * Decide where a freshly authenticated user should land.
 *
 * The password-change flag wins over the platform console: a superadmin who
 * still has a temporary password must set a new one before using god mode.
 */
export async function getPostLoginDestination(
	farmId: string,
	supabaseId: string,
): Promise<PostLoginDestination> {
	const user = await prisma.user.findUnique({
		where: { supabaseId },
		select: { id: true, farmId: true, mustChangePassword: true },
	});

	// A missing or mismatched row is not a valid app identity. Fall through to
	// the dashboard; the server layout will reject it.
	if (!user || user.farmId !== farmId) return "/dashboard";
	if (user.mustChangePassword) return "/change-password";

	const admin = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
		select: { revokedAt: true, expiresAt: true },
	});

	return admin && isPlatformAdminActive(admin) ? "/superadmin" : "/dashboard";
}
