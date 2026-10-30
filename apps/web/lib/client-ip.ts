/**
 * Client-address derivation for security-relevant call sites (issue #329).
 *
 * Proxy assumption — exactly one trusted hop, Vercel's edge:
 * Vercel rewrites `x-forwarded-for` with the public address it observed and
 * does not forward client-supplied entries
 * (https://vercel.com/docs/headers/request-headers). Under the generic
 * trusted-proxy model (`trusted-proxy-count = 1`) the same rule applies: the
 * final entry is the one the proxy wrote, and everything to its left is
 * whatever the client sent. Only that final hop is used here (F-014).
 *
 * If another proxy is ever put in front of the app, this module must be
 * revisited — the final hop would then be that proxy, not the client.
 *
 * Validation is part of the contract: a value that is not an address cannot
 * become a rate-limit bucket key or a forensic claim, so rate-limit keys fall
 * back to a fixed placeholder and audit rows record `null` instead of
 * inventing an address.
 */

/** Placeholder for rate-limit keys, which need a bounded, non-empty string. */
export const UNKNOWN_CLIENT_IP = "127.0.0.1";

// IPv4 / IPv6 character set; 45 chars is the max length of an IPv6 form.
const MAX_IP_LENGTH = 45;
const IP_CHARACTERS = /^[0-9a-fA-F:.]+$/;

/**
 * The trusted client address from an X-Forwarded-For value, or `null` when the
 * header is absent, empty or not a plain IP literal.
 */
export function parseClientIp(raw: string | null | undefined): string | null {
	const entries = (raw ?? "").split(",");
	const candidate = entries[entries.length - 1]?.trim() ?? "";
	if (candidate.length === 0 || candidate.length > MAX_IP_LENGTH) return null;
	if (!IP_CHARACTERS.test(candidate)) return null;
	return candidate;
}

/**
 * Client IP for a rate-limit key: `parseClientIp` plus a fixed fallback, so a
 * missing or malformed header still keys a single bounded bucket.
 */
export function selectClientIp(raw: string | null): string {
	return parseClientIp(raw) ?? UNKNOWN_CLIENT_IP;
}

/** Client IP from the current request's headers, for rate-limit keys. */
export async function getClientIp(): Promise<string> {
	const { headers } = await import("next/headers");
	const hdrs = await headers();
	return selectClientIp(hdrs.get("x-forwarded-for"));
}
