import {
	type AppliedCronJob,
	diffCronSchedules,
	parseAppliedTimeoutMs,
} from "@/lib/ops/cron-drift";
import { CRON_JOBS, type CronJobDefinition } from "@/lib/ops/cron-jobs";
import { describe, expect, it } from "vitest";

function rowFor(job: CronJobDefinition, overrides: Partial<AppliedCronJob> = {}): AppliedCronJob {
	return {
		jobname: job.name,
		schedule: job.schedule,
		active: true,
		command: `SELECT net.http_get(url := 'https://app.example${job.path}', headers := jsonb_build_object('Authorization', 'Bearer secret'), timeout_milliseconds := ${job.timeoutMs}) AS request_id;`,
		...overrides,
	};
}

function appliedRows(): AppliedCronJob[] {
	return CRON_JOBS.map((job) => rowFor(job));
}

describe("parseAppliedTimeoutMs", () => {
	it("reads the timeout from the applied pg_net command", () => {
		expect(parseAppliedTimeoutMs("timeout_milliseconds := 8000)")).toBe(8_000);
		expect(parseAppliedTimeoutMs("TIMEOUT_MILLISECONDS:=15000")).toBe(15_000);
	});

	it("returns null when the command has no timeout", () => {
		expect(parseAppliedTimeoutMs("SELECT net.http_get(url := 'x')")).toBeNull();
	});
});

describe("diffCronSchedules (#729)", () => {
	it("accepts applied schedules that match CRON_JOBS", () => {
		expect(diffCronSchedules(appliedRows())).toEqual([]);
	});

	it("fails when the applied timeout differs from CRON_JOBS", () => {
		const cropWatch = CRON_JOBS.find((job) => job.name === "crop-watch");
		if (!cropWatch) throw new Error("crop-watch definition missing");
		const rows = appliedRows().map((row) =>
			row.jobname === "crop-watch"
				? rowFor(cropWatch, {
						command: row.command.replace(
							`timeout_milliseconds := ${cropWatch.timeoutMs}`,
							"timeout_milliseconds := 15000",
						),
					})
				: row,
		);

		const issues = diffCronSchedules(rows);

		expect(issues).toEqual([
			{
				job: "crop-watch",
				field: "timeout",
				expected: "8000 ms",
				actual: "15000 ms",
			},
		]);
	});

	it("fails when the command has no timeout at all", () => {
		const cropWatch = CRON_JOBS.find((job) => job.name === "crop-watch");
		if (!cropWatch) throw new Error("crop-watch definition missing");
		const rows = appliedRows().map((row) =>
			row.jobname === "crop-watch"
				? rowFor(cropWatch, { command: "SELECT net.http_get(url := 'x')" })
				: row,
		);

		expect(diffCronSchedules(rows)).toContainEqual({
			job: "crop-watch",
			field: "timeout",
			expected: "8000 ms",
			actual: "(not present in command)",
		});
	});

	it("fails when the schedule differs", () => {
		const deviceWatch = CRON_JOBS.find((job) => job.name === "device-watch");
		if (!deviceWatch) throw new Error("device-watch definition missing");
		const rows = appliedRows().map((row) =>
			row.jobname === "device-watch" ? rowFor(deviceWatch, { schedule: "*/30 * * * *" }) : row,
		);

		expect(diffCronSchedules(rows)).toContainEqual({
			job: "device-watch",
			field: "schedule",
			expected: "*/5 * * * *",
			actual: "*/30 * * * *",
		});
	});

	it("reports a job that is missing from cron.job", () => {
		const rows = appliedRows().filter((row) => row.jobname !== "heartbeat-watch");

		expect(diffCronSchedules(rows)).toContainEqual({
			job: "heartbeat-watch",
			field: "missing",
			expected: "schedule */15 * * * *, timeout 8000 ms",
			actual: "(not scheduled)",
		});
	});

	it("reports an inactive job", () => {
		const rows = appliedRows().map((row) =>
			row.jobname === "crop-watch" ? { ...row, active: false } : row,
		);

		expect(diffCronSchedules(rows)).toContainEqual({
			job: "crop-watch",
			field: "active",
			expected: "active",
			actual: "inactive",
		});
	});

	it("ignores unrelated pg_cron jobs", () => {
		const rows = [
			...appliedRows(),
			{
				jobname: "some-other-project",
				schedule: "0 * * * *",
				active: true,
				command: "SELECT 1",
			},
		];

		expect(diffCronSchedules(rows)).toEqual([]);
	});
});
