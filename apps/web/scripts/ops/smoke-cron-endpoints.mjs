#!/usr/bin/env node
/**
 * Smoke-call each cron endpoint with the shared secret (#725).
 *
 *   APP_BASE_URL=https://app.example.com CRON_SECRET=... pnpm --filter web cron:smoke
 *
 * A 2xx proves the route, the secret and the deployment agree. The routes are
 * idempotent (heartbeat/reminder/job claims), so a smoke run is safe; the jobs
 * endpoint is capped at one job.
 */
const baseUrl = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(
	/\/+$/,
	"",
);
const secret = process.env.CRON_SECRET ?? "";
if (!baseUrl || !secret) {
	console.error("[cron:smoke] APP_BASE_URL and CRON_SECRET are required.");
	process.exit(2);
}

const paths = ["/api/cron/device-watch", "/api/cron/jobs?max=1", "/api/cron/crop-watch"];
let failed = false;

for (const path of paths) {
	try {
		const response = await fetch(`${baseUrl}${path}`, {
			headers: { authorization: `Bearer ${secret}` },
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) {
			failed = true;
			console.error(`[cron:smoke] ${path}: HTTP ${response.status}`);
		} else {
			console.log(`[cron:smoke] ${path}: ${response.status}`);
		}
	} catch (error) {
		failed = true;
		console.error(
			`[cron:smoke] ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

process.exit(failed ? 1 : 0);
