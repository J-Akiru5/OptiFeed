"use server";

import { redirect, routing } from "@/i18n/routing";
import { checkLockout, recordFailedAttempt, resetLockout } from "@/lib/auth/lockout";
import { validatePassword } from "@/lib/auth/password";
import {
	type PostLoginDestination,
	choosePostLoginPath,
	getPostLoginDestination,
} from "@/lib/auth/post-login";
import { normalizeReturnPath } from "@/lib/auth/return-to";
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

export async function loginWithPassword(
	farmId: string,
	password: string,
	next?: string,
): Promise<LoginResult> {
	try {
		if (!farmId.trim()) return { error: "invalid" };
		// Legacy PINs are numeric passwords. Login deliberately accepts any
		// non-empty password within the bcrypt limit; the permanent policy is
		// enforced when a password is created or changed.
		if (!validatePassword(password, "temporary").ok) return { error: "invalid" };

		const normalizedFarmId = farmId.trim().toLowerCase();

		// Rate limit: 5 attempts per 60 seconds per IP (fail-closed in the store)
		const ip = await getClientIp();
		const { success } = await checkLoginRateLimit(ip);
		if (!success) {
			return { error: "rate_limited" };
		}

		// Per-(farm, IP) hard lock, plus a farm-wide alert signal (F-031/#721)
		// that never blocks a different IP.
		const lockout = await withRetry(() => checkLockout(normalizedFarmId, ip));
		if (lockout.locked) {
			return { error: "locked", secondsRemaining: lockout.secondsRemaining };
		}

		const locale = await getLocale();
		const supabase = await createClient();

		const { data, error } = await supabase.auth.signInWithPassword({
			email: buildPondEmail(normalizedFarmId),
			password,
		});

		if (error || !data.user) {
			console.error("[auth] login failed:", error?.message ?? "no user returned");
			await withRetry(() => recordFailedAttempt(normalizedFarmId, ip));
			return { error: "invalid" };
		}

		// Successful login — reset this pair's lockout counter
		await withRetry(() => resetLockout(normalizedFarmId, ip));

		// A temporary-password account must change it before reaching any
		// console. Otherwise platform admins land on /superadmin and everyone
		// else on the farmer dashboard. A validated `next` from the proxy wins
		// over the role landing, but never over the password gate (#760).
		// Fail-closed: if the lookup errors we fall through to /dashboard rather
		// than blocking a valid login.
		let landing: PostLoginDestination = "/dashboard";
		try {
			landing = await getPostLoginDestination(normalizedFarmId, data.user.id);
		} catch (dbError) {
			reportError(dbError, { action: "loginWithPassword.landing", farmId });
		}
		// Re-validate on the server: the client-supplied value is untrusted even
		// though the login page already normalised it for its own redirects.
		const requested = normalizeReturnPath(next, routing.locales);
		redirect({ href: choosePostLoginPath(landing, requested), locale });
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
		reportError(error, { action: "loginWithPassword", farmId });
		return { error: "service" };
	}
}
