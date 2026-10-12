/**
 * Error reporting hook.
 *
 * Currently logs with a structured prefix; task 3.2 installs
 * @sentry/nextjs and swaps this implementation for a real Sentry capture.
 * All auth/limiter catch paths route through here so nothing is silently
 * swallowed before Sentry lands.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
	console.error("[obs]", context ?? {}, error);
}
