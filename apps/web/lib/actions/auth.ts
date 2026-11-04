"use server";

import { redirect } from "@/i18n/routing";
import { checkLockout, recordFailedAttempt, resetLockout } from "@/lib/auth/lockout";
import {
	firstVerifiedTotpFactor,
	hasVerifiedFactor,
	normalizeTotpCode,
} from "@/lib/auth/mfa-policy";
import { validatePassword } from "@/lib/auth/password";
import {
	type PostLoginDestination,
	getPostLoginDestination,
	sanitizePostLoginPath,
} from "@/lib/auth/post-login";
import { buildPondEmail, farmIdFromPondEmail } from "@/lib/auth/session";
import { reportError } from "@/lib/observability";
import { checkLoginRateLimit, checkMfaRateLimit, getClientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";

export type LoginResult =
	| { error: "invalid" | "locked" | "rate_limited" | "service"; secondsRemaining?: number }
	/**
	 * The password was correct and the account has a verified factor, so the
	 * session is AAL1 and may not be used yet. No redirect: the login page
	 * renders the code step, and `completeMfaLogin()` finishes the sign-in.
	 */
	| { mfaRequired: true }
	| undefined;

export type MfaLoginResult =
	| { error: "invalid" | "rate_limited" | "service" | "unsupported" }
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

/** `redirect()` throws NEXT_REDIRECT — it must never be swallowed as a failure. */
function isNextRedirect(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"digest" in error &&
		typeof (error as { digest?: unknown }).digest === "string" &&
		(error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
	);
}

/**
 * Resolve the landing page after a successful password (+ optional TOTP) step
 * and redirect there. Shared by both sign-in paths so they cannot drift.
 */
async function redirectAfterSignIn(
	farmId: string,
	supabaseId: string,
	nextPath: string | undefined,
): Promise<void> {
	const locale = await getLocale();

	// A temporary-password account must change it before reaching any console.
	// Fail-closed on a lookup error: land on /dashboard rather than blocking.
	let landing: PostLoginDestination = "/dashboard";
	try {
		landing = await getPostLoginDestination(farmId, supabaseId);
	} catch (dbError) {
		// Fallback only: the sign-in still succeeds and lands on /dashboard, so
		// this is not page-worthy. It is recorded because the destination lookup
		// is broken.
		reportError(dbError, { action: "loginWithPassword.landing", farmId }, "WARNING");
	}

	// #760: return to the page the proxy intercepted, but never override a
	// forced password change. The path is validated as same-origin by the pure
	// helper; an unsafe value silently falls back to the normal landing.
	const requested = landing === "/change-password" ? null : sanitizePostLoginPath(nextPath);
	redirect({ href: requested ?? landing, locale });
}

export async function loginWithPassword(
	farmId: string,
	password: string,
	nextPath?: string,
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

		// Successful password — reset this pair's lockout counter. The MFA step
		// is rate-limited separately, so a correct password is not punished.
		await withRetry(() => resetLockout(normalizedFarmId, ip));

		// #719: a verified factor makes this session AAL1 only. Do not resolve
		// the landing page or redirect — that would hand the user a usable
		// session without the second step. The page asks for a code instead.
		if (hasVerifiedFactor(data.user.factors)) {
			return { mfaRequired: true };
		}

		await redirectAfterSignIn(normalizedFarmId, data.user.id, nextPath);
	} catch (error) {
		// redirect() throws NEXT_REDIRECT — never swallow it.
		if (isNextRedirect(error)) {
			throw error;
		}
		// Any unexpected failure here means sign-in itself is broken for everyone,
		// with no human watching the request. That is page-worthy.
		reportError(error, { action: "loginWithPassword", farmId }, "CRITICAL");
		return { error: "service" };
	}
}

/**
 * Second sign-in step for an account with a verified TOTP factor (#719).
 *
 * The password step already produced an AAL1 session. This action proves
 * possession of the authenticator with `challengeAndVerify()`, which promotes
 * the stored session to AAL2, and only then resolves the landing page. The
 * factor is read from the live user record rather than from the client, so a
 * caller cannot choose which factor (or skip it) by posting an id.
 *
 * Recovery is deliberately *not* implemented here: there is no email fallback,
 * backup code or bypass. An admin who loses the device is unenrolled by another
 * platform admin in the Supabase dashboard (docs/security/mfa.md).
 */
export async function completeMfaLogin(code: string, nextPath?: string): Promise<MfaLoginResult> {
	try {
		const normalizedCode = normalizeTotpCode(code);
		if (!normalizedCode) return { error: "invalid" };

		// A six-digit space is small; throttle attempts per IP, fail-closed.
		const ip = await getClientIp();
		const { success } = await checkMfaRateLimit(ip);
		if (!success) return { error: "rate_limited" };

		const supabase = await createClient();
		const {
			data: { user },
			error: userError,
		} = await supabase.auth.getUser();
		if (userError || !user) return { error: "service" };

		const verifiedFactors = (user.factors ?? []).filter((factor) => factor.status === "verified");

		// The factor can disappear between the password step and this one (for
		// example, an administrator removed it in the Supabase dashboard). With
		// no verified factor left there is no second step to satisfy, so finish
		// the sign-in rather than trapping the account behind a missing factor.
		if (verifiedFactors.length === 0) {
			const farmId = farmIdFromPondEmail(user.email);
			if (!farmId) return { error: "service" };
			await redirectAfterSignIn(farmId, user.id, nextPath);
			return;
		}

		// TOTP is the only factor this build verifies. A phone or WebAuthn
		// factor must not be treated as "nothing to do": fail closed and let the
		// operator remove it, instead of silently downgrading the session.
		const factor = firstVerifiedTotpFactor(verifiedFactors);
		if (!factor) return { error: "unsupported" };

		const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
			factorId: factor.id,
			code: normalizedCode,
		});
		if (verifyError) {
			// Never log the code or the challenge.
			console.error("[auth] mfa verification failed:", verifyError.message);
			return { error: "invalid" };
		}

		const farmId = farmIdFromPondEmail(user.email);
		if (!farmId) return { error: "service" };

		await redirectAfterSignIn(farmId, user.id, nextPath);
		return;
	} catch (error) {
		if (isNextRedirect(error)) {
			throw error;
		}
		// The second sign-in step is broken for every MFA account, unattended.
		reportError(error, { action: "completeMfaLogin" }, "CRITICAL");
		return { error: "service" };
	}
}
