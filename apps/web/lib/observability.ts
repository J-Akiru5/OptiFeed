import { buildErrorEvent, persistErrorEvent } from "@/lib/error-capture";
import { type ErrorSeverity, scrubText } from "@/lib/error-scrub";

/**
 * Error reporting hook — all auth/limiter/route catch paths route through
 * here so nothing is silently swallowed.
 *
 * Every call still writes one `console.error("[obs]", …)` line with its route,
 * scrubbed context, message and stack, so Vercel function logs stay greppable.
 * The same text is what gets persisted, which means a secret that must not
 * reach `ErrorEvent` cannot reach the log drain either.
 *
 * Since mission 2026-10-29e (owner decision E1) the call also persists a
 * scrubbed `ErrorEvent` row in our own database — no external error service.
 * Persistence is fire-and-forget: it runs after the log line, never blocks the
 * caller, and a failure (database down, migration not applied yet, duplicate
 * race) falls back to `console.error` instead of throwing. An error reporter
 * must never be the reason a request fails.
 *
 * Scrubbing, dedupe and the 30-day retention window live in
 * lib/error-capture.ts and lib/error-scrub.ts. The admin view is
 * /superadmin/operations/errors (platform-admin only).
 */
export function reportError(
	error: unknown,
	context?: Record<string, unknown>,
	severity: ErrorSeverity = "ERROR",
): void {
	try {
		const record = buildErrorEvent(error, context, severity);

		console.error("[obs]", record.route, record.context ?? {}, record.message, record.stack ?? "");

		void persistErrorEvent(record).catch((persistenceFailure) => {
			console.error("[obs] error event persistence failed", failureDetails(persistenceFailure));
		});
	} catch (captureFailure) {
		// Building the record is pure, but an unexpected failure here still must
		// not escape: the request path is relying on this never throwing.
		console.error("[obs] error event capture failed", failureDetails(captureFailure));
	}
}

/** Scrubbed diagnostics for a capture failure, so even the fallback cannot leak. */
function failureDetails(failure: unknown): Record<string, unknown> {
	if (failure instanceof Error) {
		return {
			name: failure.name,
			message: scrubText(failure.message),
			stack: failure.stack ? scrubText(failure.stack) : null,
		};
	}
	return { message: scrubText(String(failure)), stack: null };
}
