#!/usr/bin/env tsx
/**
 * Provision the pg_cron + pg_net schedules from the shared `CRON_JOBS` list (#725, #729).
 *
 * Usage (from the repository root):
 *   APP_BASE_URL=https://app.example.com \
 *   CRON_SECRET=... \
 *   DATABASE_URL=postgres://... \
 *   pnpm --filter web cron:apply
 *
 *   pnpm --filter web cron:apply -- --dry-run   # print SQL, no connection
 *   pnpm --filter web cron:apply -- --check     # read-only drift check
 *
 * The app URL and Vault secret are injected here, never copied by hand into a
 * .sql file. The script creates/updates each Vault secret and calls
 * `cron.schedule(name, schedule, command)`, which replaces an existing schedule
 * with the same name. Secret values are never printed.
 *
 * `--check` exists because `cron.job` has no typed timeout column: the applied
 * timeout lives inside the command string, so a schedule can look active in
 * `cron.job_run_details` while the request budget has drifted from the repo.
 * The check compares schedule, timeout and active state against `CRON_JOBS`.
 */
import { PrismaClient } from "@prisma/client";
import { type AppliedCronJob, diffCronSchedules } from "../../lib/ops/cron-drift";
import { CRON_JOBS } from "../../lib/ops/cron-jobs";

const baseUrl = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(
	/\/+$/,
	"",
);
const secret = process.env.CRON_SECRET ?? "";
const dryRun = process.argv.includes("--dry-run");
const check = process.argv.includes("--check");
const apply = !dryRun && !check;

function fail(message: string): never {
	console.error(`[cron:apply] ${message}`);
	process.exit(2);
}

if (!check && !baseUrl) fail("APP_BASE_URL (or NEXT_PUBLIC_BASE_URL) is required.");
if (apply && !secret) fail("CRON_SECRET is required.");
if (!dryRun && !process.env.DATABASE_URL && !process.env.DIRECT_URL) {
	fail("DATABASE_URL or DIRECT_URL is required.");
}

const commandFor = (job: (typeof CRON_JOBS)[number]): string =>
	`SELECT net.http_get(url := '${baseUrl}${job.path}', headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${job.vaultName}')), timeout_milliseconds := ${job.timeoutMs}) AS request_id;`;

if (dryRun) {
	for (const job of CRON_JOBS) {
		console.log(`# ${job.name} (${job.schedule})`);
		console.log(commandFor(job));
	}
	process.exit(0);
}

const prisma = new PrismaClient();

async function storeSecret(name: string, value: string): Promise<string> {
	const rows = await prisma.$queryRaw<
		Array<{ id: string }>
	>`SELECT id::text AS id FROM vault.secrets WHERE name = ${name}`;
	if (rows.length > 0) {
		await prisma.$queryRaw`SELECT vault.update_secret(${rows[0].id}::uuid, ${value}, ${name})`;
		return "updated";
	}
	await prisma.$queryRaw`SELECT vault.create_secret(${value}, ${name})`;
	return "created";
}

async function appliedJobs(): Promise<AppliedCronJob[]> {
	return prisma.$queryRaw<AppliedCronJob[]>`
		SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname
	`;
}

function reportIssues(issues: ReturnType<typeof diffCronSchedules>): void {
	for (const issue of issues) {
		console.error(
			`[cron:check] ${issue.job}: ${issue.field} mismatch — expected ${issue.expected}, applied ${issue.actual}`,
		);
	}
}

async function main(): Promise<void> {
	if (check) {
		const issues = diffCronSchedules(await appliedJobs());
		if (issues.length > 0) {
			reportIssues(issues);
			process.exitCode = 1;
			return;
		}
		console.log(`[cron:check] ${CRON_JOBS.length} schedules match CRON_JOBS`);
		return;
	}

	await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_cron");
	await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_net");

	for (const job of CRON_JOBS) {
		const secretState = await storeSecret(job.vaultName, secret);
		await prisma.$queryRaw`SELECT cron.schedule(${job.name}, ${job.schedule}, ${commandFor(job)})`;
		console.log(
			`[cron:apply] ${job.name}: schedule ${job.schedule}; timeout ${job.timeoutMs} ms; vault secret ${job.vaultName} ${secretState}`,
		);
	}

	const rows = await appliedJobs();
	console.table(rows.map(({ jobname, schedule, active }) => ({ jobname, schedule, active })));

	// Self-verify the write: a silent drift is exactly the failure this change
	// exists to make visible.
	const issues = diffCronSchedules(rows);
	if (issues.length > 0) {
		reportIssues(issues);
		process.exitCode = 1;
		return;
	}
	console.log(`[cron:apply] verified ${CRON_JOBS.length} schedules against CRON_JOBS`);
}

main()
	.catch((error) => {
		console.error(`[cron:apply] failed: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
