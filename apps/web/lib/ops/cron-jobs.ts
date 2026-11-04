/**
 * The pg_cron-driven endpoints and how often each is expected to run (#725).
 *
 * Shared by the heartbeat writer, `/api/health/cron`, the alert watcher
 * (`/api/cron/heartbeat-watch`) and the provisioning script
 * (`scripts/ops/apply-cron-schedules.ts`). Keep the names identical: the
 * monitor keys stale detection by `CronHeartbeat.name`, and the drift check
 * compares the applied `cron.job` row against this list.
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
	/** Supabase Vault secret name that carries `CRON_SECRET` for this job. */
	vaultName: string;
}

/**
 * How long after a start marker beyond its own request budget a `running`
 * heartbeat is treated as "started, never finished".
 *
 * The budget is the route wrapper's `timeoutMs` (and pg_net's own abort). The
 * margin covers a cold start and the gap between pg_net giving up and Vercel
 * killing the function. 60 s is deliberately a full minute: a false "hung" page
 * during a cold start would teach the operator to mute the channel, which is
 * worse than detecting a genuine hang a minute later.
 */
export const RUNNING_HEARTBEAT_MARGIN_MS = 60 * 1_000;

export const CRON_JOBS: readonly CronJobDefinition[] = [
	{
		name: "device-watch",
		path: "/api/cron/device-watch",
		schedule: "*/5 * * * *",
		timeoutMs: 8_000,
		// Five-minute cadence plus room for a slow run and one retry.
		staleAfterMs: 20 * 60 * 1000,
		vaultName: "device_watch_secret",
	},
	{
		name: "background-jobs",
		path: "/api/cron/jobs?max=5",
		schedule: "* * * * *",
		timeoutMs: 15_000,
		staleAfterMs: 15 * 60 * 1000,
		vaultName: "jobs_worker_secret",
	},
	{
		name: "crop-watch",
		path: "/api/cron/crop-watch",
		schedule: "0 22 * * *",
		timeoutMs: 8_000,
		// Daily at 22:00 UTC; 26 h allows for a delayed run.
		staleAfterMs: 26 * 60 * 60 * 1000,
		vaultName: "crop_watch_secret",
	},
	{
		name: "heartbeat-watch",
		path: "/api/cron/heartbeat-watch",
		schedule: "*/15 * * * *",
		timeoutMs: 8_000,
		// Every 15 minutes, so 40 minutes tolerates two missed runs before the
		// watcher is itself declared stale.
		staleAfterMs: 40 * 60 * 1000,
		vaultName: "heartbeat_watch_secret",
	},
] as const;
