/**
 * Error reporting hook — all auth/limiter/route catch paths route through
 * here so nothing is silently swallowed.
 *
 * Console-only by design (2026-10-13: Sentry was removed entirely — see the
 * note on task 3.2 in the plan). Context (route, deviceId, farmId) is logged
 * alongside the error so Vercel function logs stay greppable.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
	console.error("[obs]", context ?? {}, error);
}
