import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withCronAuth } from "@/lib/auth/with-auth";
import { processCropReminders } from "@/lib/crop-cycle/reminders";
import { reportError } from "@/lib/observability";
import { recordCronHeartbeat } from "@/lib/ops/cron-heartbeat";

export const dynamic = "force-dynamic";

/**
 * Daily harvest/sampling reminder job (plan §9.3).
 *
 * Idempotent by `ReminderLog.dedupeKey`: a rerun skips every reminder that was
 * already recorded. Email is best-effort; a provider failure is stored on the
 * log and retried on later runs without failing the route.
 */
export const GET = withApi(
	withCronAuth(async () => {
		try {
			const summary = await processCropReminders();
			await recordCronHeartbeat("crop-watch", "ok");
			return ok(summary);
		} catch (error) {
			reportError(error, { route: "cron/crop-watch" });
			await recordCronHeartbeat("crop-watch", "error", error);
			return Response.json({ error: "Internal Error" }, { status: 500 });
		}
	}),
	// Hard budget for the whole job. Pg_cron's pg_net call allows 8 s, so keep
	// the wrapper at that cap; the service also stops new email sends at 5 s.
	{ route: "GET /api/cron/crop-watch", timeoutMs: 8_000, slowMs: 2_000, violationMs: 5_000 },
);
