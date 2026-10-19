"use server";

import { redirect } from "@/i18n/routing";
import { checkLockout, recordFailedAttempt, resetLockout } from "@/lib/auth/lockout";
import { isPlatformAdminFarmId } from "@/lib/auth/require-platform-admin";
import { buildPondEmail } from "@/lib/auth/session";
import { reportError } from "@/lib/observability";
import { checkLoginRateLimit, getClientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";

export type LoginResult =
	| { error: "invalid" | "locked" | "rate_limited" | "service"; secondsRemaining?: number }
	| undefined;

// Prisma "cannot reach database" / "timeout on startup" — worth one retry.
function isTransientDbError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("code" in error)) return false;
	const code = (error as { code?: unknown }).code;
	return code === "P1001" || code === "P1002";
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		if (isTransientDbError(error)) return fn();
		throw error;
	}
}

export async function loginWithPin(farmId: string, pin: string): Promise<LoginResult> {
	try {
		if (!farmId.trim()) return { error: "invalid" };
		if (pin.length < 4 || pin.length > 6) return { error: "invalid" };

		const normalizedFarmId = farmId.trim().toLowerCase();

		// Rate limit: 5 attempts per 60 seconds per IP (fail-closed in the store)
		const ip = await getClientIp();
		const { success } = await checkLoginRateLimit(ip);
		if (!success) {
			return { error: "rate_limited" };
		}

		// Per-(farm, IP) hard lockout + farm-wide cap (F-031) before Supabase
		const lockout = await withRetry(() => checkLockout(normalizedFarmId, ip));
		if (lockout.locked) {
			return { error: "locked", secondsRemaining: lockout.secondsRemaining };
		}

		const locale = await getLocale();
		const supabase = await createClient();

		const { error } = await supabase.auth.signInWithPassword({
			email: buildPondEmail(normalizedFarmId),
			password: pin,
		});

		if (error) {
			console.error("[auth] login failed:", error.message);
			await withRetry(() => recordFailedAttempt(normalizedFarmId, ip));
			return { error: "invalid" };
		}

		// Successful login — reset this pair's lockout counter
		await withRetry(() => resetLockout(normalizedFarmId, ip));

		// Platform admins land on their own console; everyone else on the
		// farmer dashboard. Fail-closed: if the lookup errors we fall through
		// to /dashboard rather than blocking a valid login.
		let landing = "/dashboard";
		try {
			if (await isPlatformAdminFarmId(normalizedFarmId)) {
				landing = "/superadmin";
			}
		} catch (dbError) {
			reportError(dbError, { action: "loginWithPin.landing", farmId });
		}
		redirect({ href: landing, locale });
	} catch (error) {
		// redirect() throws NEXT_REDIRECT — never swallow it.
		if (
			typeof error === "object" &&
			error !== null &&
			"digest" in error &&
			typeof (error as { digest?: unknown }).digest === "string" &&
			(error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw error;
		}
		reportError(error, { action: "loginWithPin", farmId });
		return { error: "service" };
	}
}
