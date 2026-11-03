#!/usr/bin/env node
/**
 * Provision the pg_cron + pg_net schedules from environment values (#725).
 *
 * Usage (from the repo root):
 *   APP_BASE_URL=https://app.example.com \
 *   CRON_SECRET=... \
 *   DATABASE_URL=postgres://... \
 *   pnpm --filter web cron:apply
 *
 * The app URL and Vault secret are injected here, never copied by hand into a
 * .sql file. The script creates/updates each Vault secret and calls
 * `cron.schedule(name, schedule, command)`, which replaces an existing schedule
 * with the same name. Secret values are never printed.
 */
import { PrismaClient } from "@prisma/client";

const JOBS = [
	{
		name: "device-watch",
		path: "/api/cron/device-watch",
		schedule: "*/5 * * * *",
		timeoutMs: 8_000,
		vaultName: "device_watch_secret",
	},
	{
		name: "background-jobs",
		path: "/api/cron/jobs?max=5",
		schedule: "* * * * *",
		timeoutMs: 15_000,
		vaultName: "jobs_worker_secret",
	},
	{
		name: "crop-watch",
		path: "/api/cron/crop-watch",
		schedule: "0 22 * * *",
		timeoutMs: 8_000,
		vaultName: "crop_watch_secret",
	},
];

const baseUrl = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(
	/\/+$/,
	"",
);
const secret = process.env.CRON_SECRET ?? "";
const dryRun = process.argv.includes("--dry-run");

function fail(message) {
	console.error(`[cron:apply] ${message}`);
	process.exit(2);
}

if (!baseUrl) fail("APP_BASE_URL (or NEXT_PUBLIC_BASE_URL) is required.");
if (!dryRun && !secret) fail("CRON_SECRET is required.");
if (!dryRun && !process.env.DATABASE_URL && !process.env.DIRECT_URL) {
	fail("DATABASE_URL or DIRECT_URL is required.");
}

const commandFor = (job) =>
	`SELECT net.http_get(url := '${baseUrl}${job.path}', headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${job.vaultName}')), timeout_milliseconds := ${job.timeoutMs}) AS request_id;`;

if (dryRun) {
	for (const job of JOBS) {
		console.log(`# ${job.name} (${job.schedule})`);
		console.log(commandFor(job));
	}
	process.exit(0);
}

const prisma = new PrismaClient();

async function storeSecret(name, value) {
	const rows =
		await prisma.$queryRaw`SELECT id::text AS id FROM vault.secrets WHERE name = ${name}`;
	if (rows.length > 0) {
		await prisma.$queryRaw`SELECT vault.update_secret(${rows[0].id}::uuid, ${value}, ${name})`;
		return "updated";
	}
	await prisma.$queryRaw`SELECT vault.create_secret(${value}, ${name})`;
	return "created";
}

async function main() {
	await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_cron");
	await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_net");

	for (const job of JOBS) {
		const secretState = await storeSecret(job.vaultName, secret);
		await prisma.$queryRaw`SELECT cron.schedule(${job.name}, ${job.schedule}, ${commandFor(job)})`;
		console.log(
			`[cron:apply] ${job.name}: schedule ${job.schedule}; vault secret ${job.vaultName} ${secretState}`,
		);
	}

	const rows = await prisma.$queryRaw`
		SELECT jobname, schedule, active FROM cron.job ORDER BY jobname
	`;
	console.table(rows);
}

main()
	.catch((error) => {
		console.error(`[cron:apply] failed: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
