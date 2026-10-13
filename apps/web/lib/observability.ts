/**
 * Error reporting hook — all auth/limiter/route catch paths route through
 * here so nothing is silently swallowed (task 3.2).
 *
 * Captures to Sentry when SENTRY_DSN is configured (H4 sets it in Vercel);
 * without a DSN the SDK is never even loaded, which keeps unit tests and
 * local dev free of the SDK's bundler-specific imports. The import is lazy
 * on purpose — `@sentry/nextjs` cannot be resolved inside vitest. Context
 * (route, deviceId, farmId) is attached as `extra` for filtering in Sentry.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
	console.error("[obs]", context ?? {}, error);
	if (!process.env.SENTRY_DSN) return;

	import("@sentry/nextjs")
		.then((Sentry) => {
			Sentry.captureException(error, context ? { extra: context } : undefined);
		})
		.catch(() => {
			// Reporting must never break the caller.
		});
}
