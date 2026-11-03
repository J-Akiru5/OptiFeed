#!/usr/bin/env node
/**
 * Dead-man's-switch check for the pg_cron schedules (#725).
 *
 *   APP_BASE_URL=https://app.example.com node apps/web/scripts/ops/check-cron-health.mjs
 *
 * Exits 0 when every known cron heartbeat is fresh, 1 when `/api/health/cron`
 * returns 503 (missing/stale/failed run) or the probe cannot be reached. This is
 * the command an external monitor (cron-job.org, Better Stack, a CI schedule)
 * should run; the endpoint itself is public but carries no tenant data.
 */
const baseUrl = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(
	/\/+$/,
	"",
);
if (!baseUrl) {
	console.error("[cron:health] APP_BASE_URL (or NEXT_PUBLIC_BASE_URL) is required.");
	process.exit(2);
}

try {
	const response = await fetch(`${baseUrl}/api/health/cron`, {
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		console.error(`[cron:health] HTTP ${response.status}`, body);
		process.exit(1);
	}
	console.log("[cron:health] ok", body);
} catch (error) {
	console.error(`[cron:health] probe failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
