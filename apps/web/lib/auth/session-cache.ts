import { createHash } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Bounded, in-process auth caches.
 *
 * Two different lifetimes:
 *  - a verified session (cookie fingerprint -> identity) for 30 s, so a burst
 *    of requests or a render tree does not re-verify the same JWT;
 *  - a farm binding (Supabase user id -> farmId) for 60 s. `farmId` is the
 *    tenant key; it changes only on an ownership transfer, which is rare.
 *
 * Security notes:
 *  - The session entry is only written after `getClaims()`/`getUser()` has
 *    verified the JWT signature and expiry. A forged cookie cannot populate it.
 *  - The TTL is capped by the token's own `exp`, so a cache entry never
 *    outlives the access token.
 *  - Revocation (sign-out, password change) does not invalidate an already
 *    issued access token in Supabase; 30 s is therefore no weaker than the
 *    JWT's own semantics, and a sign-out changes/removes the cookie, which
 *    changes the fingerprint immediately.
 */

const SESSION_TTL_MS = 30_000;
const FARM_TTL_MS = 60_000;
const MAX_SESSION_ENTRIES = 500;
const MAX_FARM_ENTRIES = 2_000;

// Mirrors @supabase/ssr: a base cookie plus numbered chunks for large sessions.
const SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export interface CachedSession {
	sub: string;
	email: string;
	expiresAt: number;
}

interface FarmBinding {
	farmId: string | null;
	expiresAt: number;
}

interface AuthCacheStore {
	sessions: Map<string, CachedSession>;
	farms: Map<string, FarmBinding>;
}

const GLOBAL_KEY = "__optifeedAuthCache";

/**
 * Test seam: production always reads Next's request cookie store. Unit tests
 * have no request scope, so they inject the same `getAll()` shape here instead
 * of trying to mock a Next internal module.
 */
type CookieReader = () => Promise<{ getAll(): Array<{ name: string; value: string }> }>;
let cookieReader: CookieReader | null = null;

export function __setCookieReaderForTests(reader: CookieReader | null): void {
	cookieReader = reader;
}

function store(): AuthCacheStore {
	const globalStore = globalThis as typeof globalThis & {
		[GLOBAL_KEY]?: AuthCacheStore;
	};
	if (!globalStore[GLOBAL_KEY]) {
		globalStore[GLOBAL_KEY] = { sessions: new Map(), farms: new Map() };
	}
	return globalStore[GLOBAL_KEY];
}

/**
 * Stable fingerprint of the Supabase session cookie(s), or null when the
 * request is anonymous. Reading cookies is cheap and local; the fingerprint
 * lets a cache hit skip creating a Supabase client and verifying the JWT.
 */
export async function sessionFingerprint(): Promise<string | null> {
	const cookieStore = cookieReader ? await cookieReader() : await cookies();
	const parts = cookieStore
		.getAll()
		.filter((cookie) => SUPABASE_SESSION_COOKIE.test(cookie.name) && cookie.value !== "")
		.sort((a, b) => a.name.localeCompare(b.name));

	if (parts.length === 0) return null;

	const joined = parts.map((cookie) => `${cookie.name}=${cookie.value}`).join(";");
	if (joined.length < 32) return null;

	return createHash("sha256").update(joined).digest("hex");
}

export function getCachedSession(fingerprint: string): CachedSession | null {
	const entry = store().sessions.get(fingerprint);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		store().sessions.delete(fingerprint);
		return null;
	}
	return entry;
}

export function cacheSession(
	fingerprint: string,
	session: { sub: string; email: string; expMs: number },
): void {
	const sessions = store().sessions;
	evictOldest(sessions, MAX_SESSION_ENTRIES);
	const expiresAt = Math.min(
		Date.now() + SESSION_TTL_MS,
		session.expMs || Date.now() + SESSION_TTL_MS,
	);
	sessions.set(fingerprint, { sub: session.sub, email: session.email, expiresAt });
}

/** Returns `null` when absent, otherwise the cached binding (which may be null). */
export function getCachedFarm(sub: string): { farmId: string | null } | null {
	const entry = store().farms.get(sub);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		store().farms.delete(sub);
		return null;
	}
	return { farmId: entry.farmId };
}

/** A null binding is not cached: a just-provisioned user must be able to log in immediately. */
export function cacheFarm(sub: string, farmId: string | null): void {
	if (farmId === null) {
		store().farms.delete(sub);
		return;
	}
	const farms = store().farms;
	evictOldest(farms, MAX_FARM_ENTRIES);
	farms.set(sub, { farmId, expiresAt: Date.now() + FARM_TTL_MS });
}

export function invalidateFarm(sub: string): void {
	store().farms.delete(sub);
	// Any session entry for this user is now stale too.
	for (const [fingerprint, session] of store().sessions) {
		if (session.sub === sub) store().sessions.delete(fingerprint);
	}
}

/** Test helper. Never call this from application code. */
export function __resetAuthCacheForTests(): void {
	store().sessions.clear();
	store().farms.clear();
}

function evictOldest<T>(map: Map<string, T>, max: number): void {
	if (map.size < max) return;
	// Maps iterate in insertion order; drop the oldest quarter in one pass.
	const toDrop = Math.max(1, Math.floor(max / 4));
	let dropped = 0;
	for (const key of map.keys()) {
		map.delete(key);
		if (++dropped >= toDrop) break;
	}
}
