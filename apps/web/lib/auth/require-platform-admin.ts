import { redirect } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import { getLocale } from "next-intl/server";
import { isPlatformAdminActive } from "./platform-admin";
import { getCurrentUser } from "./session";

/**
 * True when the current authenticated user holds an active PlatformAdmin row.
 * Fails closed: no session, no user row, no PlatformAdmin row, a revoked row,
 * or an expired temporary grant all resolve to false.
 */
export async function isCurrentPlatformAdmin(): Promise<boolean> {
	const user = await getCurrentUser();
	if (!user) return false;

	const row = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
		select: { revokedAt: true, expiresAt: true },
	});
	if (!row) return false;

	return isPlatformAdminActive(row);
}

/**
 * True when the given login slug holds an active PlatformAdmin row.
 *
 * Takes a farmId rather than a session because it is used immediately after
 * signInWithPassword, before a fresh session can be read back reliably.
 * Same fail-closed contract as isCurrentPlatformAdmin().
 */
export async function isPlatformAdminFarmId(farmId: string): Promise<boolean> {
	// PlatformAdmin.userId is a plain String with no relation (plan §3.2 keeps
	// it decoupled from User), so this is two lookups, not a nested where.
	const user = await prisma.user.findUnique({
		where: { farmId },
		select: { id: true },
	});
	if (!user) return false;

	const row = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
		select: { revokedAt: true, expiresAt: true },
	});
	if (!row) return false;
	return isPlatformAdminActive(row);
}

/**
 * Require the current user to hold an active PlatformAdmin row.
 * Redirects to /dashboard otherwise — same contract as requireRole().
 *
 * PlatformAdmin is the god-mode source of truth (plan §3.2) and is deliberately
 * separate from UserRole.ADMIN. The tenant /admin console is gated on an active
 * OWNER/ADMIN Membership instead (lib/auth/tenant-admin.ts), so neither flag
 * can open the other console.
 */
export async function requirePlatformAdmin(): Promise<void> {
	const allowed = await isCurrentPlatformAdmin();
	if (!allowed) {
		const locale = await getLocale();
		redirect({ href: "/dashboard", locale });
	}
}
