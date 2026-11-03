import { isPlatformAdminActive } from "@/lib/auth/platform-admin";
import prisma from "@/lib/prisma";

export type PostLoginDestination = "/dashboard" | "/superadmin" | "/change-password";

const MAX_NEXT_PATH_LENGTH = 2048;
const SAFE_ORIGIN = "https://app.invalid";

/**
 * Validate a post-login return path (#760).
 *
 * The proxy appends the originally requested page to `/login?next=…`, and the
 * login action hands it back to `redirect()`. Only a same-origin absolute path
 * is accepted: protocol-relative (`//host`), absolute URLs, backslashes (which
 * some browsers normalise to `//`) and the login page itself are rejected, so a
 * crafted link cannot bounce a freshly authenticated user off-site or loop.
 * The fragment is dropped because it never reaches the server anyway.
 */
export function sanitizePostLoginPath(value: string | null | undefined): string | null {
	if (!value) return null;
	const candidate = value.trim();
	if (candidate.length === 0 || candidate.length > MAX_NEXT_PATH_LENGTH) return null;
	if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(candidate, SAFE_ORIGIN);
	} catch {
		return null;
	}
	if (parsed.origin !== SAFE_ORIGIN) return null;
	if (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/")) return null;

	return `${parsed.pathname}${parsed.search}`;
}

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
