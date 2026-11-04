import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withCronAuth } from "@/lib/auth/with-auth";
import { reportError } from "@/lib/observability";
import { sendAlert } from "@/lib/observability/alert";
import {
	type CronAlert,
	cronAlertForJob,
	readCronHealth,
	recordCronHeartbeat,
} from "@/lib/ops/cron-heartbeat";

export const dynamic = "force-dynamic";

const JOB_NAME = "heartbeat-watch";

/**
 * Cron dead-man's switch (#729).
 *
 * pg_cron calls this every 15 minutes with the same `CRON_SECRET` bearer as the
 * other cron routes. It reads `CronHeartbeat`, turns every unhealthy job into a
 * provider-neutral alert, and records its own start/finish like any other job.
 *
 * The three diagnostic states are preserved in the response:
 * `never-run` (no row), `hung` (a `running` marker older than the job's budget
 * plus margin), and the completed-run states `error` / `stale`. `/api/health/cron`
 * exposes the same per-job `state` for external probes.
 *
 * This route is the alerting path, not a health probe: it returns 200 when the
 * check itself ran, even when it paged. A pager should not retry on "the page
 * was sent". `/api/health/cron` is the 503-on-stale probe.
 */
export const GET = withApi(
	withCronAuth(async () => {
		// Write the start marker before the read so this watcher is visible in the
		// same table it checks. A 504 here leaves `running`, which is a real
		// signal rather than a silent gap.
		await recordCronHeartbeat(JOB_NAME, "running");
		try {
			const health = await readCronHealth();
			const alerts = health.jobs
				.map(cronAlertForJob)
				.filter((alert): alert is CronAlert => alert !== null);

			// Parallel so three stale jobs do not multiply the 3 s webhook timeout
			// by three and trip the route budget. `sendAlert` never rejects.
			const outcomes = await Promise.all(
				alerts.map((alert) =>
					sendAlert({
						severity: alert.severity,
						fingerprint: alert.fingerprint,
						route: alert.route,
						message: alert.message,
						context: { cron: alert.job, state: alert.state },
					}),
				),
			);

			await recordCronHeartbeat(JOB_NAME, "ok");

			return ok({
				status: health.status,
				checked: health.jobs.length,
				alerts: alerts.map((alert, index) => ({
					job: alert.job,
					state: alert.state,
					outcome: outcomes[index],
				})),
			});
		} catch (error) {
			reportError(error, { route: "cron/heartbeat-watch" }, "CRITICAL");
			await recordCronHeartbeat(JOB_NAME, "error", error);
			return Response.json({ error: "Internal Error" }, { status: 500 });
		}
	}),
	{ route: "GET /api/cron/heartbeat-watch", timeoutMs: 8_000, slowMs: 3_000, violationMs: 6_000 },
);
