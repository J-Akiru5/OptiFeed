import { redirect } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@prisma/client";
import { getLocale } from "next-intl/server";

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

export async function getCurrentPondOwnerId(): Promise<string> {
	const locale = await getLocale();
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	const ownerId = user?.email ? farmIdFromEmail(user.email) : null;

	if (!ownerId) {
		redirect({ href: "/login", locale });
		return ""; // unreachable — redirect aborts the request
	}

	return ownerId;
}

export async function getCurrentPondOwnerIdSafe(): Promise<string | null> {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) return null;
	return farmIdFromEmail(user.email);
}

/**
 * Get the current user's database record (with role info).
 * Returns null if not authenticated or user not found in DB.
 */
export async function getCurrentUser() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user?.email) return null;

	const farmId = farmIdFromEmail(user.email);
	if (!farmId) return null;

	return prisma.user.findUnique({
		where: { farmId },
	});
}

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
