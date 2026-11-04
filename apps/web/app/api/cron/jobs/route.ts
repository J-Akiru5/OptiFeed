import { randomUUID } from "node:crypto";
import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withCronAuth } from "@/lib/auth/with-auth";
import { processJobs } from "@/lib/jobs/service";
import { reportError } from "@/lib/observability";
import { recordCronHeartbeat } from "@/lib/ops/cron-heartbeat";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withCronAuth(async (request) => {
		// Start marker before the queue claim. A worker killed by the 15 s wrapper
		// budget leaves `running`, which the dead-man's switch reports as "started,
		// never finished" instead of "never ran".
		await recordCronHeartbeat("background-jobs", "running");
		const { searchParams } = new URL(request.url);
		const max = Math.min(20, Math.max(1, Number(searchParams.get("max") ?? 5) || 5));
		try {
			const result = await processJobs({
				workerId: `cron-${randomUUID()}`,
				max,
				budgetMs: 8_000,
				deadlineMs: 13_000,
			});
			await recordCronHeartbeat("background-jobs", "ok");
			return ok(result);
		} catch (error) {
			reportError(error, { route: "cron/jobs" }, "CRITICAL");
			await recordCronHeartbeat("background-jobs", "error", error);
			throw error;
		}
	}),
	{ route: "GET /api/cron/jobs", timeoutMs: 15_000, slowMs: 8_000, violationMs: 15_000 },
);
