import { defaultLocale, locales } from "@/i18n/locales";

/**
 * Recovery-link routing (#741).
 *
 * A Supabase recovery email used to point straight at `/reset-password`, but a
 * server-rendered page cannot consume the tokens Supabase puts in the URL
 * fragment, and the PKCE code verifier belongs to the browser that started the
 * flow — not the server that minted the link with `generateLink`. The visitor
 * therefore arrived without a session and was told the link was invalid.
 *
 * The link now targets `/auth/confirm`, which verifies the `token_hash`
 * server-side (`supabase.auth.verifyOtp`) and sets the session cookies before
 * redirecting to the reset form with the single-use proof from #718. These
 * helpers keep the redirect target and the locale validation in one place so
 * neither the actions nor the route can drift into an open redirect.
 */

/** Supabase verification types this route is allowed to consume. */
export const RECOVERY_TOKEN_TYPE = "recovery";

export type SupportedLocale = (typeof locales)[number];

/** True when `value` is one of the configured locales. */
export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
	return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * The reset form path for a locale, optionally carrying the signed proof.
 *
 * `locale` is validated here rather than trusted from the URL, and the proof is
 * encoded, so the result is always a same-origin path.
 */
export function resetPasswordPath(locale: string, resetToken?: string | null): string {
	const safeLocale = isSupportedLocale(locale) ? locale : defaultLocale;
	const path = `/${safeLocale}/reset-password`;
	if (!resetToken) return path;
	return `${path}?reset=${encodeURIComponent(resetToken)}`;
}

/**
 * Build the link that is emailed for a recovery request.
 *
 * `tokenHash` is Supabase's `hashed_token`; it is a credential and must only
 * ever live in the email payload (never in an audit row or a log).
 */
export function buildRecoveryConfirmUrl(input: {
	appBaseUrl: string;
	locale: string;
	tokenHash: string;
	resetToken: string;
}): string {
	const baseUrl = input.appBaseUrl.replace(/\/+$/, "");
	const locale = isSupportedLocale(input.locale) ? input.locale : defaultLocale;
	const query = new URLSearchParams({
		token_hash: input.tokenHash,
		type: RECOVERY_TOKEN_TYPE,
		reset: input.resetToken,
	});
	return `${baseUrl}/${locale}/auth/confirm?${query.toString()}`;
}
