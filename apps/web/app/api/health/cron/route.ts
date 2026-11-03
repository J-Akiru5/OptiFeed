import { withApi } from "@/lib/api/instrumentation";
import { readCronHealth } from "@/lib/ops/cron-heartbeat";

export const dynamic = "force-dynamic";

/**
 * Dead-man's-switch probe for the pg_cron schedules (#725).
 *
 * An external monitor (or `scripts/ops/check-cron-health.mjs`) polls this
 * endpoint. 503 means at least one known cron has never run, its heartbeat is
 * older than its schedule allows, or its last run recorded an error. The body
 * names the job, time and error text; it contains no tenant data.
 */
export const GET = withApi(
	async () => {
		const health = await readCronHealth();
		return Response.json(health, {
			status: health.status === "ok" ? 200 : 503,
			headers: { "Cache-Control": "no-store" },
		});
	},
	{ route: "GET /api/health/cron", timeoutMs: 3_000, shape: "passthrough" },
);
