import { redirect } from "@/i18n/routing";
import { getVerifiedSession } from "@/lib/auth/verify-session";
import prisma from "@/lib/prisma";
import type { UserRole } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { cache } from "react";

const POND_EMAIL_DOMAIN = "pond.optifeed.local";

export function buildPondEmail(farmId: string): string {
	return `${farmId.toLowerCase().trim()}@${POND_EMAIL_DOMAIN}`;
}

export function farmIdFromEmail(email: string | undefined | null): string | null {
	if (!email) return null;
	const local = email.split("@")[0];
	if (!local) return null;
	return local.toLowerCase();
}

/**
 * Extract the farmId from a pond-provisioned email, requiring the trusted
 * domain. Returns null for any other domain, so a lookalike account
 * (demo-farmer-1@evil.com) can never resolve to a farm.
 */
export function farmIdFromPondEmail(email: string | undefined | null): string | null {
	if (!email) return null;
	const normalized = email.toLowerCase();
	if (!normalized.endsWith(`@${POND_EMAIL_DOMAIN}`)) return null;
	return farmIdFromEmail(normalized);
}

export async function getCurrentPondOwnerId(): Promise<string> {
	const ownerId = await getCurrentPondOwnerIdSafe();

	if (!ownerId) {
		const locale = await getLocale();
		redirect({ href: "/login", locale });
		return ""; // unreachable — redirect aborts the request
	}

	return ownerId;
}

export async function getCurrentPondOwnerIdSafe(): Promise<string | null> {
	const currentUser = await getCurrentUser();
	return currentUser?.farmId ?? null;
}

/**
 * Get the current user's database record (with role info).
 * Returns null if not authenticated or user not found in DB.
 *
 * Wrapped in React `cache()` so a render tree / server action that calls
 * `getCurrentUser`, `getCurrentPondOwnerId`, `getCurrentUserRole`, and
 * `canWrite` performs one lookup per request instead of one per call.
 * Outside a React request scope the wrapper is a passthrough (verified
 * against React 19); route handlers rely on the auth caches instead.
 *
 * Lookup is by Supabase auth user id (User.supabaseId) — never by the
 * email local part alone. The email must also be a pond-provisioned
 * address for this row's farm, so a lookalike domain
 * (demo-farmer-1@evil.com) can never act as the farm.
 */
export const getCurrentUser = cache(async () => {
	const session = await getVerifiedSession();
	if (!session) return null;

	const dbUser = await prisma.user.findUnique({
		where: { supabaseId: session.sub },
	});
	if (!dbUser) return null;

	const emailFarmId = farmIdFromPondEmail(session.email);
	if (!emailFarmId || emailFarmId !== dbUser.farmId) return null;

	return dbUser;
});

/**
 * Get the current user's role. Returns null if not authenticated.
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
	const currentUser = await getCurrentUser();
	return currentUser?.role ?? null;
}

/**
 * Require the current user to have one of the specified roles.
 * Redirects to /dashboard if not authorized.
 */
export async function requireRole(...roles: UserRole[]): Promise<void> {
	const locale = await getLocale();
	const userRole = await getCurrentUserRole();

	if (!userRole || !roles.includes(userRole)) {
		redirect({ href: "/dashboard", locale });
	}
}

/**
 * Require write access (ADMIN or OPERATOR). Throws instead of redirecting —
 * for server actions and API routes, where a redirect is the wrong signal.
 * VIEWER and unauthenticated callers are rejected before any write happens.
 */
export async function requireWriteAccess(): Promise<void> {
	const userRole = await getCurrentUserRole();
	if (userRole !== "ADMIN" && userRole !== "OPERATOR") {
		throw new Error("Write access required (ADMIN or OPERATOR)");
	}
}

/**
 * True when the current user may perform write operations.
 * Use in server components to disable VIEWER-only-readonly UI.
 */
export async function canWrite(): Promise<boolean> {
	const userRole = await getCurrentUserRole();
	return userRole === "ADMIN" || userRole === "OPERATOR";
}

/**
 * Get all ponds owned by the current user.
 */
export async function getCurrentUserPonds() {
	const ownerId = await getCurrentPondOwnerId();
	return prisma.pond.findMany({
		where: { ownerId },
		orderBy: { createdAt: "asc" },
	});
}
