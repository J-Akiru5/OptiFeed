import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Login rate limit: 5 attempts per 60 seconds per IP.
// Combined with the account lockout (5 failures → 15-min lockout),
// this gives ~20 guesses/hour maximum.
export const loginRateLimit = new Ratelimit({
	redis: Redis.fromEnv(),
	limiter: Ratelimit.slidingWindow(5, "60 s"),
	prefix: "rl:login",
});

// General API rate limit: 30 requests per 60 seconds per user.
// Applied to chat, export, and import endpoints.
export const apiRateLimit = new Ratelimit({
	redis: Redis.fromEnv(),
	limiter: Ratelimit.slidingWindow(30, "60 s"),
	prefix: "rl:api",
});

/**
 * Extract client IP from Vercel-proxied headers.
 * On Vercel, x-forwarded-for is the canonical source.
 */
export async function getClientIp(): Promise<string> {
	const { headers } = await import("next/headers");
	const hdrs = await headers();
	return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
}
