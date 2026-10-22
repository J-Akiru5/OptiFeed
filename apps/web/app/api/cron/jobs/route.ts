import { randomUUID } from "node:crypto";
import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withCronAuth } from "@/lib/auth/with-auth";
import { processJobs } from "@/lib/jobs/service";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withCronAuth(async (request) => {
		const { searchParams } = new URL(request.url);
		const max = Math.min(20, Math.max(1, Number(searchParams.get("max") ?? 5) || 5));
		const result = await processJobs({
			workerId: `cron-${randomUUID()}`,
			max,
			budgetMs: 8_000,
		});
		return ok(result);
	}),
	{ route: "GET /api/cron/jobs", timeoutMs: 15_000, slowMs: 8_000, violationMs: 15_000 },
);
