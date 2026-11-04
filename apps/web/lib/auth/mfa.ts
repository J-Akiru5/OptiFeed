import { createClient } from "@/lib/supabase/server";
import { type MfaLevel, isMfaChallengePending } from "./mfa-policy";

/**
 * Server-side MFA reads (#719).
 *
 * Import this only from server components, server actions and route handlers:
 * it builds the cookie-bound Supabase client. The decision logic lives in
 * `./mfa-policy`, which is pure.
 *
 * Supabase Auth owns the factors. This module never stores a secret, a QR code
 * or a challenge — `PlatformAdmin.mfaEnrolledAt` is a reporting timestamp only,
 * never the gate (a stale timestamp must not be able to lock an admin out).
 */

/** The current session's assurance level, or null when there is no session. */
export async function getSessionMfaLevel(): Promise<MfaLevel | null> {
	try {
		const supabase = await createClient();
		const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
		if (error || !data) return null;
		return { currentLevel: data.currentLevel, nextLevel: data.nextLevel };
	} catch {
		// No session, or a session the client cannot decode. The normal auth
		// gate decides what happens next; this helper only answers "is a second
		// factor pending for a session that exists".
		return null;
	}
}

/** True when a verified factor is waiting for a code in this session. */
export async function isMfaChallengePendingForSession(): Promise<boolean> {
	return isMfaChallengePending(await getSessionMfaLevel());
}

export type TotpFactorSummary = {
	id: string;
	status: "verified" | "unverified";
	/** ISO timestamp, straight from Supabase. */
	createdAt: string;
	friendlyName: string | null;
};

/**
 * The signed-in user's TOTP factors, without secrets.
 *
 * This is the only shape the account page and the settings component receive:
 * factor ids and metadata are safe to render; the secret only exists in the
 * response of a fresh `enroll()` call, which is shown once and never stored.
 */
export async function listTotpFactors(): Promise<TotpFactorSummary[]> {
	try {
		const supabase = await createClient();
		const { data, error } = await supabase.auth.mfa.listFactors();
		if (error || !data) return [];
		return data.all
			.filter((factor) => factor.factor_type === "totp")
			.map((factor) => ({
				id: factor.id,
				status: factor.status,
				createdAt: factor.created_at,
				friendlyName: factor.friendly_name ?? null,
			}));
	} catch {
		return [];
	}
}
