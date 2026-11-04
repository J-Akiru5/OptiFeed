/**
 * Pure MFA policy (#719).
 *
 * The platform console ships optional TOTP second factors. Supabase Auth is the
 * only source of truth for factors, so nothing here reads a database column or
 * a secret: it only decides what a session's assurance level means.
 *
 * Kept free of server imports so the policy can be unit-tested and, if a client
 * ever needs it, imported without pulling Prisma into the browser bundle.
 */

/** The subset of `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` we use. */
export type MfaLevel = {
	currentLevel: string | null;
	nextLevel: string | null;
};

/** The subset of a Supabase `Factor` the policy reads. */
export interface MfaFactorLike {
	id: string;
	factor_type?: string | null;
	status?: string | null;
}

/**
 * True when at least one factor has been verified. A verified factor means
 * every new password session must be promoted to `aal2` before it is usable.
 */
export function hasVerifiedFactor(factors: readonly MfaFactorLike[] | null | undefined): boolean {
	return (factors ?? []).some((factor) => factor.status === "verified");
}

/**
 * Pick the factor the in-app challenge can verify.
 *
 * Only TOTP is supported here, so a verified phone or WebAuthn factor must not
 * be silently skipped: the caller treats "no TOTP but another verified factor"
 * as unsupported rather than as "nothing to do" (fail closed).
 */
export function firstVerifiedTotpFactor<T extends MfaFactorLike>(
	factors: readonly T[] | null | undefined,
): T | null {
	return (
		(factors ?? []).find(
			(factor) => factor.factor_type === "totp" && factor.status === "verified",
		) ?? null
	);
}

/**
 * True when this session signed in with a password but still owes a TOTP code.
 *
 * `nextLevel` is what the account is capable of and `currentLevel` is what this
 * session has done. No session, or an account with no factor, reports aal1 or
 * null and is never challenged — that is what keeps MFA optional.
 */
export function isMfaChallengePending(level: MfaLevel | null | undefined): boolean {
	if (!level) return false;
	if (level.currentLevel === "aal2") return false;
	return level.nextLevel === "aal2";
}

/**
 * Normalise a code typed into a TOTP form. Whitespace is stripped (authenticator
 * apps and password managers copy codes with a space), anything that is not
 * exactly six digits is rejected before it reaches Supabase.
 */
export function normalizeTotpCode(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const compact = value.replace(/\s+/g, "");
	return /^\d{6}$/.test(compact) ? compact : null;
}
