import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { CRON_JOBS, type CronJobDefinition } from "./cron-jobs";

/**
 * Record one cron run (#725). Best-effort: a heartbeat write must never turn a
 * successful reminder/alert pass into a 500, and a failed run still records
 * its error for the monitor. The caller logs the real failure separately.
 */
export async function recordCronHeartbeat(
	name: string,
	status: "ok" | "error",
	error?: unknown,
): Promise<void> {
	const lastError =
		status === "error"
			? (error instanceof Error ? error.message : String(error ?? "unknown error")).slice(0, 500)
			: null;
	try {
		await prisma.cronHeartbeat.upsert({
			where: { name },
			create: { name, lastRunAt: new Date(), lastStatus: status, lastError },
			update: { lastRunAt: new Date(), lastStatus: status, lastError },
		});
	} catch (heartbeatError) {
		reportError(heartbeatError, { route: "cron/heartbeat", cron: name });
	}
}

export interface CronHealthRow {
	name: string;
	lastRunAt: string | null;
	ageMs: number | null;
	stale: boolean;
	lastStatus: string | null;
	lastError: string | null;
}

export interface CronHealth {
	status: "ok" | "stale";
	jobs: CronHealthRow[];
}

/** Read every known heartbeat and mark a missing/stale/error run as unhealthy. */
export async function readCronHealth(now = new Date()): Promise<CronHealth> {
	const rows = await prisma.cronHeartbeat.findMany({
		where: { name: { in: CRON_JOBS.map((job) => job.name) } },
	});
	const byName = new Map(rows.map((row) => [row.name, row]));

	const jobs = CRON_JOBS.map((definition: CronJobDefinition): CronHealthRow => {
		const row = byName.get(definition.name);
		if (!row) {
			return {
				name: definition.name,
				lastRunAt: null,
				ageMs: null,
				stale: true,
				lastStatus: null,
				lastError: null,
			};
		}
		const ageMs = now.getTime() - row.lastRunAt.getTime();
		return {
			name: definition.name,
			lastRunAt: row.lastRunAt.toISOString(),
			ageMs,
			stale: ageMs > definition.staleAfterMs || row.lastStatus === "error",
			lastStatus: row.lastStatus,
			lastError: row.lastError,
		};
	});

	return {
		status: jobs.some((job) => job.stale) ? "stale" : "ok",
		jobs,
	};
}
