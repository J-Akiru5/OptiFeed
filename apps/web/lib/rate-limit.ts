import prisma from "@/lib/prisma";

// Shared fixed-window rate limiter backed by Postgres (table
// rate_limit_bucket). Counting is a single atomic upsert, so concurrent
// serverless instances cannot lose increments the way the old in-memory
// Map did (it reset on every deploy/instance).
//
// Fail modes are deliberate:
//   - Login: fail-closed. A limiter outage must not open the login door.
//   - Device/API: fail-open. A limiter blip must not stop feeding.

async function checkRateLimit(
	key: string,
	maxRequests: number,
	windowMs: number,
	failOpen: boolean,
): Promise<{ success: boolean; remaining: number }> {
	const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
	try {
		const rows = await prisma.$queryRaw<{ count: bigint }[]>`
			INSERT INTO rate_limit_bucket ("key", "window_start", "count")
			VALUES (${key}, ${windowStart}, 1)
			ON CONFLICT ("key", "window_start")
			DO UPDATE SET count = rate_limit_bucket.count + 1
			RETURNING count
		`;
		const count = Number(rows[0]?.count ?? 1);
		return {
			success: count <= maxRequests,
			remaining: Math.max(0, maxRequests - count),
		};
	} catch (error) {
		if (failOpen) {
			console.error("[rate-limit] store unavailable, allowing request (fail-open):", error);
			return { success: true, remaining: maxRequests };
		}
		console.error("[rate-limit] store unavailable, denying request (fail-closed):", error);
		return { success: false, remaining: 0 };
	}
}

// Login rate limit: 5 attempts per 60 seconds per IP. Fail-closed.
export function checkLoginRateLimit(ip: string) {
	return checkRateLimit(`rl:login:${ip}`, 5, 60_000, false);
}

// General API rate limit: 30 requests per 60 seconds per user. Fail-open.
export function checkApiRateLimit(ownerId: string) {
	return checkRateLimit(`rl:api:${ownerId}`, 30, 60_000, true);
}

// Device poll rate limit: 20 requests per 60 seconds per device.
// ESP32 polls every 5s (12 req/min nominal); 20 gives headroom for retries.
// Fail-open — a limiter blip must never block the feeder.
export function checkDeviceRateLimit(deviceId: string) {
	return checkRateLimit(`rl:device:${deviceId}`, 20, 60_000, true);
}

// AI prediction rate limit: 10 requests per 60 seconds per user. Each call may
// invoke the AI provider, so it's tighter than the general API limit. Fail-open.
export function checkPredictionRateLimit(ownerId: string) {
	return checkRateLimit(`rl:predict:${ownerId}`, 10, 60_000, true);
}

/**
 * Pick the client IP to rate-limit key on from an X-Forwarded-For header.
 *
 * F-014: the LEFTMOST entry is written by the client and is trivially
 * spoofable — rotating it grants a fresh rate-limit bucket per request and
 * defeats both the login limiter and the per-(farm, IP) lockout. The
 * RIGHTMOST entry is the one appended by the single trusted proxy in front
 * of the app (Vercel's edge), so it is the only hop safe for security use
 * (MDN: trusted-proxy-count = 1). The value is also validated so garbage
 * can't become an unbounded rate_limit_bucket key.
 */
export function selectClientIp(raw: string | null): string {
	const entries = (raw ?? "").split(",");
	const candidate = entries[entries.length - 1]?.trim() ?? "";
	// IPv4 / IPv6 character set; 45 chars is the max length of an IPv6 form.
	if (candidate.length > 45 || !/^[0-9a-fA-F:.]+$/.test(candidate)) {
		return "127.0.0.1";
	}
	return candidate;
}

/**
 * Extract client IP from Vercel-proxied headers.
 */
export async function getClientIp(): Promise<string> {
	const { headers } = await import("next/headers");
	const hdrs = await headers();
	return selectClientIp(hdrs.get("x-forwarded-for"));
}

/**
 * Delete rate-limit windows older than one hour (windows are at most 60 s).
 * The 3.1 device-watch cron calls this each run so the table stays small
 * without needing a separate pg_cron job (task 2.6).
 */
export async function cleanupExpiredRateLimitBuckets(): Promise<number> {
	const cutoff = new Date(Date.now() - 60 * 60 * 1000);
	const deleted =
		await prisma.$executeRaw`DELETE FROM rate_limit_bucket WHERE "window_start" < ${cutoff}`;
	return Number(deleted);
}
