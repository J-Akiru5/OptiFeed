import { scrubText } from "@/lib/error-scrub";
import { reportError } from "@/lib/observability";
import type { AlertSeverity } from "@/lib/observability/alert";
import prisma from "@/lib/prisma";
import { CRON_JOBS, type CronJobDefinition, RUNNING_HEARTBEAT_MARGIN_MS } from "./cron-jobs";

/**
 * Cron heartbeats and the dead-man's switch (#725, #729).
 *
 * A run writes a `running` marker **before** its work starts, then replaces it
 * with `ok` or `error`. That ordering is the whole point: a route that exceeds
 * its wrapper budget can be killed before its last statement runs, and a
 * completion-only heartbeat then looks exactly like a job that was never
 * scheduled. The production `crop-watch` incident on 2026-11-04 is that case:
 * pg_net itself succeeded every night, but `crop-watch` had no heartbeat row at
 * all because the marker was written after `processCropReminders()`.
 *
 * A `running` marker older than the job's request budget plus
 * `RUNNING_HEARTBEAT_MARGIN_MS` is reported as `hung`, not as a generic stale
 * row. Never-run, hung and completed are therefore three distinct states, and
 * `/api/health/cron` names which one applies.
 *
 * Every heartbeat write is best-effort: a monitor must never turn a successful
 * reminder/alert pass into a 500. A failed write is itself reported through the
 * normal error path.
 */

export type CronHeartbeatStatus = "running" | "ok" | "error";

/** The three diagnostic buckets, with completed runs split by outcome. */
export type CronJobState = "never-run" | "running" | "hung" | "stale" | "error" | "ok";

const HEARTBEAT_ERROR_LIMIT = 500;

function errorText(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
	return scrubText(raw).slice(0, HEARTBEAT_ERROR_LIMIT);
}

/**
 * Record one heartbeat. `running` is the start marker; `ok`/`error` is the
 * completion.
 *
 * Restarting an already-`running` job deliberately keeps the original
 * `lastRunAt`: if a handler hangs and the scheduler starts it again every
 * minute, resetting the clock each time would hide the hang forever. A
 * completed run always moves `lastRunAt` to its completion time, so normal
 * freshness means "last successful/attempted completion".
 */
export async function recordCronHeartbeat(
	name: string,
	status: CronHeartbeatStatus,
	error?: unknown,
): Promise<void> {
	const lastError = status === "error" ? errorText(error) : null;

	try {
		if (status === "running") {
			const existing = await prisma.cronHeartbeat.findUnique({
				where: { name },
				select: { lastStatus: true },
			});
			const alreadyRunning = existing?.lastStatus === "running";
			await prisma.cronHeartbeat.upsert({
				where: { name },
				create: {
					name,
					lastRunAt: new Date(),
					lastStatus: "running",
					lastError: null,
				},
				update: alreadyRunning
					? { lastStatus: "running", lastError: null }
					: { lastRunAt: new Date(), lastStatus: "running", lastError: null },
			});
			return;
		}

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
	state: CronJobState;
	lastStatus: string | null;
	lastError: string | null;
}

export interface CronHealth {
	status: "ok" | "stale";
	jobs: CronHealthRow[];
}

function ageMinutes(ageMs: number): number {
	return Math.max(0, Math.round(ageMs / 60_000));
}

/** Read every known heartbeat and classify it. */
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
				state: "never-run",
				lastStatus: null,
				lastError: null,
			};
		}

		const ageMs = now.getTime() - row.lastRunAt.getTime();
		const base = {
			name: definition.name,
			lastRunAt: row.lastRunAt.toISOString(),
			ageMs,
			lastStatus: row.lastStatus,
			// Rows written before the scrub-on-write change may still hold raw
			// error text; the public probe must never echo it.
			lastError: row.lastError === null ? null : scrubText(row.lastError),
		};

		// Start marker still in place: either a run is genuinely in flight, or it
		// was killed after writing `running` and before writing a completion.
		if (row.lastStatus === "running") {
			const hungAfterMs = definition.timeoutMs + RUNNING_HEARTBEAT_MARGIN_MS;
			const hung = ageMs > hungAfterMs;
			return { ...base, stale: hung, state: hung ? "hung" : "running" };
		}

		if (row.lastStatus === "error") {
			return { ...base, stale: true, state: "error" };
		}

		if (ageMs > definition.staleAfterMs) {
			return { ...base, stale: true, state: "stale" };
		}

		return { ...base, stale: false, state: "ok" };
	});

	return {
		status: jobs.some((job) => job.stale) ? "stale" : "ok",
		jobs,
	};
}

export interface CronAlert {
	fingerprint: string;
	route: string;
	severity: AlertSeverity;
	message: string;
	job: string;
	state: CronJobState;
}

/**
 * Turn one unhealthy heartbeat into the message a pager actually carries.
 * Healthy and in-flight rows return `null`; a `running` row is only alerted once
 * it crosses the hung threshold.
 */
export function cronAlertForJob(job: CronHealthRow): CronAlert | null {
	if (!job.stale) return null;

	const definition = CRON_JOBS.find((candidate) => candidate.name === job.name);
	const schedule = definition?.schedule ?? "unknown";
	const budget = definition?.timeoutMs ?? 0;

	let message: string;
	switch (job.state) {
		case "never-run":
			message = `Cron "${job.name}" has never recorded a heartbeat. Expected schedule ${schedule}; the job may never have been provisioned.`;
			break;
		case "hung":
			message = `Cron "${job.name}" started at ${job.lastRunAt} and never finished (running for ${ageMinutes(job.ageMs ?? 0)} min; request budget ${budget} ms). It was killed or is still stuck.`;
			break;
		case "error":
			message = `Cron "${job.name}" last run failed at ${job.lastRunAt}: ${scrubText(job.lastError ?? "no error text")}.`;
			break;
		case "stale":
			message = `Cron "${job.name}" last completed at ${job.lastRunAt} (${ageMinutes(job.ageMs ?? 0)} min ago; expected schedule ${schedule}).`;
			break;
		default:
			return null;
	}

	return {
		fingerprint: `cron:${job.name}:${job.state}`,
		route: `cron/${job.name}`,
		severity: "CRITICAL",
		message,
		job: job.name,
		state: job.state,
	};
}
