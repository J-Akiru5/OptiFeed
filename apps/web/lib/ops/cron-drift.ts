import { CRON_JOBS, type CronJobDefinition } from "./cron-jobs";

/**
 * Drift check for the applied pg_cron schedules (#729).
 *
 * `cron.job` stores the schedule and the SQL command, not a typed timeout
 * column, so a value can drift from `CRON_JOBS` without any repository change
 * noticing. The production `crop-watch` incident showed why that matters: the
 * schedule looked right in `cron.job_run_details`, but the request timeout that
 * actually killed the handler lived only inside the command string.
 *
 * Pure and database-free so the provisioner (`--check`) and a unit test use the
 * same comparison.
 */

export interface AppliedCronJob {
	jobname: string;
	schedule: string;
	active: boolean;
	command: string;
}

export type CronDriftField = "missing" | "schedule" | "timeout" | "active";

export interface CronDriftIssue {
	job: string;
	field: CronDriftField;
	expected: string;
	actual: string;
}

/** `net.http_get(..., timeout_milliseconds := 8000)` → 8000. */
export function parseAppliedTimeoutMs(command: string): number | null {
	const match = /timeout_milliseconds\s*:=\s*(\d+)/i.exec(command);
	if (!match) return null;
	const timeout = Number.parseInt(match[1], 10);
	return Number.isFinite(timeout) ? timeout : null;
}

/**
 * Compare what `cron.job` actually has against the repository's list. Returns
 * one issue per mismatch; an empty array means the applied schedules match.
 * Unrelated jobs in `cron.job` are ignored — the repository only owns its own
 * named schedules.
 */
export function diffCronSchedules(
	rows: readonly AppliedCronJob[],
	expected: readonly CronJobDefinition[] = CRON_JOBS,
): CronDriftIssue[] {
	const byName = new Map(rows.map((row) => [row.jobname, row]));
	const issues: CronDriftIssue[] = [];

	for (const job of expected) {
		const row = byName.get(job.name);
		if (!row) {
			issues.push({
				job: job.name,
				field: "missing",
				expected: `schedule ${job.schedule}, timeout ${job.timeoutMs} ms`,
				actual: "(not scheduled)",
			});
			continue;
		}

		if (row.schedule !== job.schedule) {
			issues.push({
				job: job.name,
				field: "schedule",
				expected: job.schedule,
				actual: row.schedule,
			});
		}

		const appliedTimeout = parseAppliedTimeoutMs(row.command);
		if (appliedTimeout !== job.timeoutMs) {
			issues.push({
				job: job.name,
				field: "timeout",
				expected: `${job.timeoutMs} ms`,
				actual: appliedTimeout === null ? "(not present in command)" : `${appliedTimeout} ms`,
			});
		}

		if (!row.active) {
			issues.push({
				job: job.name,
				field: "active",
				expected: "active",
				actual: "inactive",
			});
		}
	}

	return issues;
}
