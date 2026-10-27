"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { setStepUpCookie } from "@/lib/auth/step-up";
import { reportError } from "@/lib/observability";
import { checkStepUpRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Step-up re-authentication (plan M3.2/M3.3).
 *
 * The admin re-enters their own password. It is verified against Supabase on a
 * throwaway client, so the real session cookies are not rotated just to check a
 * credential (same pattern as changeOwnPassword). Success sets the signed,
 * httpOnly `stepup` cookie; the form never receives a token or a password hash.
 */

export type StartStepUpResult = { success: true; expiresAt: string } | { error: string };

export async function startStepUp(password: string): Promise<StartStepUpResult> {
	try {
		const user = await getCurrentUser();
		if (!user) return { error: "Not authenticated." };
		if (typeof password !== "string" || password.length === 0) {
			return { error: "Enter your password." };
		}

		// A credential check is an oracle: throttle it per user, fail-closed.
		const limit = await checkStepUpRateLimit(user.id);
		if (!limit.success) {
			return { error: "Too many attempts. Wait a few minutes and try again." };
		}

		const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
		if (!url || !anonKey) return { error: "Step-up is temporarily unavailable." };

		const verifier = createSupabaseClient(url, anonKey, {
			auth: { autoRefreshToken: false, persistSession: false },
		});
		const { error } = await verifier.auth.signInWithPassword({
			email: user.email,
			password,
		});
		if (error) return { error: "That password is not correct." };

		const expiresAt = await setStepUpCookie(user.id);
		return { success: true, expiresAt: expiresAt.toISOString() };
	} catch (error) {
		reportError(error, { action: "startStepUp" });
		return { error: "Step-up is temporarily unavailable." };
	}
}
