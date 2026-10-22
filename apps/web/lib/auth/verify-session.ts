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
	}

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
			expMs: Date.now() + 30_000,
		});
	}
	return { sub: data.user.id, email: data.user.email };
}
