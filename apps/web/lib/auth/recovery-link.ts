import { defaultLocale, isAppLocale } from "@/i18n/locales";

/**
 * App-owned recovery confirmation (#741).
 *
 * The recovery email used to point at Supabase's `action_link`, which lands on
 * `/reset-password` with the session in a URL fragment (implicit flow) or with
 * a PKCE `code` that no browser in this flow ever requested. Neither reaches
 * the server, so the page always rendered the expired state.
 *
 * Instead, the emailed link points at `/[locale]/auth/confirm` on this app. It
 * carries Supabase's `hashed_token`; the route handler calls
 * `auth.verifyOtp({ type: "recovery", token_hash })`, which sets the
 * `@supabase/ssr` cookies directly. The signed single-use proof (#718) travels
 * beside it, so the confirmation route only establishes the recovery session:
 * it never changes a password by itself.
 */

export const RECOVERY_CONFIRM_PATH = "/auth/confirm";

/** URL-safe token hashes and auth codes; anything else is rejected early. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,512}$/;
const AUTH_CODE = /^[A-Za-z0-9_-]{8,512}$/;
/** The shape `mintPasswordResetProof` produces: base64url payload + 43-char HMAC. */
const RESET_PROOF = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/;

export function isRecoveryProof(value: string | null | undefined): value is string {
	return typeof value === "string" && RESET_PROOF.test(value);
}

export type RecoveryConfirmation =
	| { action: "verify"; tokenHash: string }
	| { action: "exchange"; code: string }
	| { action: "invalid"; reason: "provider" | "missing" | "unsupported_type" | "malformed" };

/**
 * Decide how to consume the confirmation request.
 *
 * `token_hash` is the SSR path and the one this app mints. `code` stays as a
 * fallback so a Supabase-configured PKCE redirect into this route still works.
 * Only recovery tokens are accepted: a magic-link or signup token must not be
 * usable to open the reset form.
 */
export function parseRecoveryConfirmation(params: URLSearchParams): RecoveryConfirmation {
	// Supabase appends these when it rejects a link before reaching us.
	if (params.get("error") || params.get("error_code")) {
		return { action: "invalid", reason: "provider" };
	}

	const code = params.get("code");
	if (code) {
		return AUTH_CODE.test(code)
			? { action: "exchange", code }
			: { action: "invalid", reason: "malformed" };
	}

	const tokenHash = params.get("token_hash");
	if (!tokenHash) return { action: "invalid", reason: "missing" };

	const type = params.get("type") ?? "recovery";
	if (type !== "recovery") return { action: "invalid", reason: "unsupported_type" };

	return TOKEN_HASH.test(tokenHash)
		? { action: "verify", tokenHash }
		: { action: "invalid", reason: "malformed" };
}

/**
 * Build the link that is emailed. With `tokenHash` it is the app-owned
 * confirmation URL; without it, it is the same route as the Supabase fallback
 * destination (still locale-aware and same-origin).
 */
export function buildRecoveryConfirmUrl(input: {
	baseUrl: string;
	locale: string;
	tokenHash?: string;
	resetToken?: string;
}): string {
	const locale = isAppLocale(input.locale) ? input.locale : defaultLocale;
	const url = new URL(`${input.baseUrl.replace(/\/+$/, "")}/${locale}${RECOVERY_CONFIRM_PATH}`);

	if (input.tokenHash) {
		url.searchParams.set("token_hash", input.tokenHash);
		url.searchParams.set("type", "recovery");
	}
	if (input.resetToken) url.searchParams.set("reset", input.resetToken);

	return url.toString();
}

/**
 * The only redirect this route may emit: the localized reset page on this
 * origin. There is no `next` parameter, so the confirmation route cannot be
 * turned into an open redirect.
 */
export function recoveryRedirectPath(
	locale: string,
	resetToken: string | null | undefined,
): string {
	const safeLocale = isAppLocale(locale) ? locale : defaultLocale;
	const base = `/${safeLocale}/reset-password`;
	return isRecoveryProof(resetToken) ? `${base}?reset=${encodeURIComponent(resetToken)}` : base;
}
