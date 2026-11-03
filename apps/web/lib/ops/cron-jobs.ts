/**
 * The pg_cron-driven endpoints and how often each is expected to run (#725).
 *
 * Shared by the heartbeat writer, `/api/health/cron`, and the provisioning
 * script (`scripts/ops/apply-cron-schedules.mjs`). Keep the names identical:
 * the monitor keys stale detection by `CronHeartbeat.name`.
 */
export interface CronJobDefinition {
	/** `cron.job.jobname` and `CronHeartbeat.name`. */
	name: string;
	/** App path pg_cron calls. */
	path: string;
	/** ActiveRecord cron expression. */
	schedule: string;
	/** `net.http_get` timeout. */
	timeoutMs: number;
	/** A heartbeat older than this means the schedule is not running. */
	staleAfterMs: number;
}

export const CRON_JOBS: readonly CronJobDefinition[] = [
	{
		name: "device-watch",
		path: "/api/cron/device-watch",
		schedule: "*/5 * * * *",
		timeoutMs: 8_000,
		// Five-minute cadence plus room for a slow run and one retry.
		staleAfterMs: 20 * 60 * 1000,
	},
	{
		name: "background-jobs",
		path: "/api/cron/jobs?max=5",
		schedule: "* * * * *",
		timeoutMs: 15_000,
		staleAfterMs: 15 * 60 * 1000,
	},
	{
		name: "crop-watch",
		path: "/api/cron/crop-watch",
		schedule: "0 22 * * *",
		timeoutMs: 8_000,
		// Daily at 22:00 UTC; 26 h allows for a delayed run.
		staleAfterMs: 26 * 60 * 60 * 1000,
	},
] as const;
