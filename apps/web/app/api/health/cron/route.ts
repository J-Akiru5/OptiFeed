import { withApi } from "@/lib/api/instrumentation";
import { readCronHealth } from "@/lib/ops/cron-heartbeat";

export const dynamic = "force-dynamic";

/**
 * Dead-man's-switch probe for the pg_cron schedules (#725, #729).
 *
 * An external monitor (or `scripts/ops/check-cron-health.mjs`) polls this
 * endpoint. 503 means at least one known cron is unhealthy, and every job row
 * names which of the three diagnostic states applies:
 *
 *   - `never-run`  — no heartbeat row at all (never scheduled, or the route was
 *                    never reached);
 *   - `hung`       — a `running` start marker older than the job's request
 *                    budget plus `RUNNING_HEARTBEAT_MARGIN_MS` ("started, never
 *                    finished");
 *   - `error` / `stale` — a completed run that failed or is older than its
 *                    schedule allows;
 *   - `running`    — a run genuinely in flight, not yet a fault;
 *   - `ok`.
 *
 * The body also carries a `summary` of job names per bucket so a pager mapping
 * does not have to re-derive it. It contains job names, timestamps and scrubbed
 * error text only — no tenant data and no secrets.
 */
export const GET = withApi(
	async () => {
		const health = await readCronHealth();
		const namesIn = (state: string) =>
			health.jobs.filter((job) => job.state === state).map((job) => job.name);

		return Response.json(
			{
				...health,
				summary: {
					neverRun: namesIn("never-run"),
					hung: namesIn("hung"),
					running: namesIn("running"),
					failed: namesIn("error"),
					stale: namesIn("stale"),
				},
			},
			{
				status: health.status === "ok" ? 200 : 503,
				headers: { "Cache-Control": "no-store" },
			},
		);
	},
	{ route: "GET /api/health/cron", timeoutMs: 3_000, shape: "passthrough" },
);
