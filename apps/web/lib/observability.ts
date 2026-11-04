import { buildErrorEvent, persistErrorEvent } from "@/lib/error-capture";
import { scrubText } from "@/lib/error-scrub";
import {
	type AlertSeverity,
	sendAlert,
	shouldPage,
	storageSeverity,
} from "@/lib/observability/alert";

/**
 * Error reporting hook — all auth/limiter/route catch paths route through
 * here so nothing is silently swallowed.
 *
 * Every call still writes one `console.error("[obs]", …)` line with its route,
 * scrubbed context, message and stack, so Vercel function logs stay greppable.
 * The same text is what gets persisted, which means a secret that must not
 * reach `ErrorEvent` cannot reach the log drain or the alert webhook either.
 *
 * Since mission 2026-10-29e (owner decision E1) the call also persists a
 * scrubbed `ErrorEvent` row in our own database. Persistence is fire-and-forget:
 * it runs after the log line, never blocks the caller, and a failure falls back
 * to `console.error` instead of throwing.
 *
 * ## Severity and paging (#729)
 * The optional third argument is an alert routing level:
 *
 *   - `CRITICAL` — page-worthy. The call is forwarded to the neutral alert
 *     webhook (`lib/observability/alert.ts`) in addition to being logged and
 *     stored. Use it only where failure is silent and unattended.
 *   - `ERROR` (default) — recorded and logged, not paged. A caller that sees a
 *     5xx, or a firmware poll that will retry on 503, is already visible.
 *   - `WARNING` / `INFO` — recorded only; expected fallbacks and diagnostics.
 *
 * `CRITICAL` is an alerting concept, not a database enum value. `ErrorEvent`
 * has no CRITICAL member and this change adds no migration, so a CRITICAL report
 * is stored as `ERROR`; the alert payload keeps the original level. This keeps
 * the existing schema untouched while making the paging decision explicit at
 * each call site instead of inferring it from a route name.
 *
 * Scrubbing, dedupe and the 30-day retention window live in lib/error-capture.ts
 * and lib/error-scrub.ts. The admin view is
 * /superadmin/operations/errors (platform-admin only).
 */
export function reportError(
	error: unknown,
	context?: Record<string, unknown>,
	severity: AlertSeverity = "ERROR",
): void {
	try {
		const record = buildErrorEvent(error, context, storageSeverity(severity));

		console.error("[obs]", record.route, record.context ?? {}, record.message, record.stack ?? "");

		void persistErrorEvent(record).catch((persistenceFailure) => {
			console.error("[obs] error event persistence failed", failureDetails(persistenceFailure));
		});

		if (shouldPage(severity)) {
			// `sendAlert` never rejects; the `void` is only to keep `reportError`
			// synchronous, exactly like persistence above.
			void sendAlert({
				severity,
				fingerprint: record.fingerprint,
				route: record.route,
				message: record.message,
				context: record.context,
			});
		}
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
