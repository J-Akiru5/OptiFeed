const buckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
	key: string,
	maxRequests: number,
	windowMs: number,
): { success: boolean; remaining: number } {
	const now = Date.now();
	const entry = buckets.get(key);
	if (!entry || now > entry.resetAt) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { success: true, remaining: maxRequests - 1 };
	}
	entry.count++;
	return {
		success: entry.count <= maxRequests,
		remaining: Math.max(0, maxRequests - entry.count),
	};
}

// Login rate limit: 5 attempts per 60 seconds per IP.
export function checkLoginRateLimit(ip: string) {
	return checkRateLimit(`rl:login:${ip}`, 5, 60_000);
}

// General API rate limit: 30 requests per 60 seconds per user.
export function checkApiRateLimit(ownerId: string) {
	return checkRateLimit(`rl:api:${ownerId}`, 30, 60_000);
}

/**
 * Extract client IP from Vercel-proxied headers.
 */
export async function getClientIp(): Promise<string> {
	const { headers } = await import("next/headers");
	const hdrs = await headers();
	return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
}
