/**
 * Client-address derivation for security-relevant call sites (issues #329,
 * #732).
 *
 * Proxy assumption — a configurable number of trusted hops:
 * Vercel rewrites `x-forwarded-for` with the public address it observed and
 * does not forward client-supplied entries
 * (https://vercel.com/docs/headers/request-headers). Under the generic
 * trusted-proxy model, the final entry is the one the nearest proxy wrote and
 * everything to its left is whatever the client sent. `TRUSTED_PROXY_HOPS`
 * defaults to 1 (Vercel alone) and may be raised to 10 when a proxy the
 * operator controls sits in front of the app.
 *
 * Fail closed: if the chain is shorter than the configured hop count, the
 * selected entry is malformed or the configured value is out of bounds, the
 * result is `null`. The function never falls back to the first (client-written)
 * entry. Rate-limit keys still substitute a fixed placeholder so they stay a
 * bounded string, while audit rows record `null` instead of inventing an
 * address.
 */

/** Placeholder for rate-limit keys, which need a bounded, non-empty string. */
export const UNKNOWN_CLIENT_IP = "127.0.0.1";

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

// IPv4 / IPv6 character set; 45 chars is the max length of an IPv6 form.
const MAX_IP_LENGTH = 45;
const IP_CHARACTERS = /^[0-9a-fA-F:.]+$/;

/**
 * Configured trusted proxy hop count. An absent, non-integer or out-of-range
 * value falls back to the bounded default rather than trusting a shorter
 * chain; `parseClientIp` itself rejects an invalid explicit value.
 */
export function trustedProxyHops(): number {
	const configured = process.env.TRUSTED_PROXY_HOPS?.trim();
	if (!configured || !/^\d+$/.test(configured)) return DEFAULT_TRUSTED_PROXY_HOPS;
	const hops = Number(configured);
	if (!Number.isFinite(hops)) return DEFAULT_TRUSTED_PROXY_HOPS;
	return Math.min(MAX_TRUSTED_PROXY_HOPS, Math.max(1, Math.trunc(hops)));
}

/**
 * The trusted client address from an X-Forwarded-For value, or `null` when the
 * header is absent, shorter than `trustedHops`, or the selected entry is not a
 * plain IP literal. The selected entry is `trustedHops` positions from the
 * right: the address written by the outermost trusted proxy.
 */
export function parseClientIp(
	raw: string | null | undefined,
	trustedHops: number = trustedProxyHops(),
): string | null {
	if (
		!Number.isInteger(trustedHops) ||
		trustedHops < 1 ||
		trustedHops > MAX_TRUSTED_PROXY_HOPS
	) {
		return null;
	}

	const entries = (raw ?? "").split(",");
	// A short chain means the expected proxies did not all participate; the
	// remaining entries could be client-supplied, so do not guess.
	if (entries.length < trustedHops) return null;

	const candidate = entries[entries.length - trustedHops]?.trim() ?? "";
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
