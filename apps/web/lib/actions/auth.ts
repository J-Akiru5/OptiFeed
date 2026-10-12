"use server";

import { redirect } from "@/i18n/routing";
import { checkLockout, recordFailedAttempt, resetLockout } from "@/lib/auth/lockout";
import { buildPondEmail } from "@/lib/auth/session";
import { checkLoginRateLimit, getClientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";

export type LoginResult =
	| { error: "invalid" | "locked" | "rate_limited"; secondsRemaining?: number }
	| undefined;

export async function loginWithPin(farmId: string, pin: string): Promise<LoginResult> {
	if (!farmId.trim()) return { error: "invalid" };
	if (pin.length < 4 || pin.length > 6) return { error: "invalid" };

	const normalizedFarmId = farmId.trim().toLowerCase();

	// Rate limit: 5 attempts per 60 seconds per IP
	const ip = await getClientIp();
	const { success } = checkLoginRateLimit(ip);
	if (!success) {
		return { error: "rate_limited" };
	}

	// Check account lockout before calling Supabase
	const lockout = await checkLockout(normalizedFarmId);
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
		await recordFailedAttempt(normalizedFarmId);
		return { error: "invalid" };
	}

	// Successful login — reset lockout counter
	await resetLockout(normalizedFarmId);
	redirect({ href: "/dashboard", locale });
}
