import { createClient } from "@/lib/supabase/server";
import {
	type CachedSession,
	cacheSession,
	getCachedSession,
	sessionFingerprint,
} from "./session-cache";

export interface VerifiedSession {
	sub: string;
	email: string;
}

/**
 * Single-flight per cookie fingerprint. Two concurrent requests with the same
 * session must not both verify (and potentially both refresh) the same JWT —
 * Supabase's refresh-token reuse detection would revoke the session.
 */
const inFlight = new Map<string, Promise<VerifiedSession | null>>();

/**
 * Verify the request's Supabase session with the cheapest correct method.
 *
 * Order:
 *  1. fingerprint the session cookie and use the 30 s cache (no client, no
 *     JWT work, no network);
 *  2. `getClaims()` — verifies the JWT locally against the project JWKS when
 *     the project uses asymmetric signing keys, and falls back to the Auth
 *     server for symmetric keys;
 *  3. `getUser()` — the server-verified fallback when `getClaims()` cannot
 *     produce a usable identity.
 *
 * `sessionFingerprint()` throws outside a Next request scope (scripts, unit
 * tests); in that case there is no cookie to cache and we go straight to the
 * server-verified path. In a real request, `null` means "no session cookie"
 * and returns immediately without a network call.
 */
export async function getVerifiedSession(): Promise<VerifiedSession | null> {
	let fingerprint: string | null | undefined;
	try {
		fingerprint = await sessionFingerprint();
	} catch {
		fingerprint = undefined;
	}

	if (fingerprint === null) return null;

	if (fingerprint) {
		const cached: CachedSession | null = getCachedSession(fingerprint);
		if (cached) return { sub: cached.sub, email: cached.email };

		const pending = inFlight.get(fingerprint);
		if (pending) return pending;

		const verification = verifyWithSupabase(fingerprint);
		inFlight.set(fingerprint, verification);
		try {
			return await verification;
		} finally {
			inFlight.delete(fingerprint);
		}
	}

	return verifyWithSupabase(undefined);
}

async function verifyWithSupabase(
	fingerprint: string | undefined,
): Promise<VerifiedSession | null> {
	const supabase = await createClient();

	try {
		const { data, error } = await supabase.auth.getClaims();
		const claims = data?.claims;
		if (
			!error &&
			typeof claims?.sub === "string" &&
			typeof claims.email === "string" &&
			claims.email
		) {
			if (fingerprint) {
				cacheSession(fingerprint, {
					sub: claims.sub,
					email: claims.email,
					expMs: typeof claims.exp === "number" ? claims.exp * 1000 : 0,
				});
			}
			return { sub: claims.sub, email: claims.email };
		}
	} catch {
		// Older auth servers or a transient JWKS failure: use the server path.
	}

	const { data, error } = await supabase.auth.getUser();
	if (error || !data?.user?.id || !data.user.email) return null;

	if (fingerprint) {
		cacheSession(fingerprint, {
			sub: data.user.id,
			email: data.user.email,
			// `getUser()` does not expose the token's exp, so use a short TTL:
			// long enough to absorb a request burst, short enough that a cached
			// entry cannot outlive the access token by much.
			expMs: Date.now() + 10_000,
		});
	}
	return { sub: data.user.id, email: data.user.email };
}
