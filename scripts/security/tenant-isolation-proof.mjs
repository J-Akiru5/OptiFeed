#!/usr/bin/env node
/**
 * Read-only two-tenant proof for #711 Phase 2.
 *
 * Runs the same counts as the privileged connection and as `optifeed_app`
 * with `app.farm_ids` set to one tenant. It never inserts, updates or deletes.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:... \
 *   APP_DATABASE_URL=postgresql://optifeed_app:... \
 *   TENANT_PROOF_CONFIRM=yes \
 *   node scripts/security/tenant-isolation-proof.mjs \
 *     --farm-a demo-farmer-1 --farm-b tenant2-admin
 *
 * On a loopback database the confirmation is not required. On any other host
 * it refuses unless TENANT_PROOF_CONFIRM=yes, so it cannot be pointed at
 * production by accident.
 */

import { PrismaClient } from "@prisma/client";

function arg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = process.argv[index + 1];
	return value && !value.startsWith("--") ? value : fallback;
}

const farmA = arg("farm-a");
const farmB = arg("farm-b");
if (!farmA || !farmB) {
	console.error("Usage: --farm-a <User.farmId> --farm-b <different User.farmId>");
	process.exit(2);
}
if (farmA === farmB) {
	console.error("farm-a and farm-b must be different tenants.");
	process.exit(2);
}

const privilegedUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!privilegedUrl || !appUrl) {
	console.error("Set DATABASE_URL (privileged) and APP_DATABASE_URL (optifeed_app).");
	process.exit(2);
}

function isLoopback(url) {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host === "127.0.0.1" || host === "localhost" || host === "::1";
	} catch {
		return false;
	}
}

if (!isLoopback(appUrl) && process.env.TENANT_PROOF_CONFIRM !== "yes") {
	console.error(
		"APP_DATABASE_URL is not loopback. Set TENANT_PROOF_CONFIRM=yes only on a staging copy, never production.",
	);
	process.exit(2);
}

const privileged = new PrismaClient({ datasources: { db: { url: privilegedUrl } } });
const app = new PrismaClient({ datasources: { db: { url: appUrl } } });

async function privilegedCounts(farmId) {
	const [ponds, feedEvents, notifications] = await Promise.all([
		privileged.$queryRaw`SELECT count(*)::int AS count FROM "Pond" WHERE "ownerId" = ${farmId}`,
		privileged.$queryRaw`
			SELECT count(*)::int AS count
			FROM "FeedEvent" fe
			JOIN "EnergyDevice" d ON d.id = fe."deviceId"
			JOIN "Pond" p ON p.id = d."pondId"
			WHERE p."ownerId" = ${farmId}
		`,
		privileged.$queryRaw`
			SELECT count(*)::int AS count
			FROM "Notification" n
			JOIN "Pond" p ON p.id = n."pondId"
			WHERE p."ownerId" = ${farmId}
		`,
	]);
	return { ponds: ponds[0].count, feedEvents: feedEvents[0].count, notifications: notifications[0].count };
}

async function appCounts(farmId) {
	return app.$transaction(
		async (tx) => {
			await tx.$executeRaw`SELECT set_config('app.farm_ids', ${farmId}, true)`;
			const ponds = await tx.$queryRaw`SELECT count(*)::int AS count FROM "Pond"`;
			const feedEvents = await tx.$queryRaw`SELECT count(*)::int AS count FROM "FeedEvent"`;
			const notifications = await tx.$queryRaw`SELECT count(*)::int AS count FROM "Notification"`;
			const crossTenant = await tx.$queryRaw`SELECT count(*)::int AS count FROM "Pond" WHERE "ownerId" = ${farmId === farmA ? farmB : farmA}`;
			return {
				ponds: ponds[0].count,
				feedEvents: feedEvents[0].count,
				notifications: notifications[0].count,
				crossTenant: crossTenant[0].count,
			};
		},
		{ timeout: 15_000 },
	);
}

let failed = false;

for (const farmId of [farmA, farmB]) {
	const expected = await privilegedCounts(farmId);
	const actual = await appCounts(farmId);
	const ok =
		actual.ponds === expected.ponds &&
		actual.feedEvents === expected.feedEvents &&
		actual.notifications === expected.notifications &&
		actual.crossTenant === 0;
	if (!ok) failed = true;
	console.log(
		`${ok ? "PASS" : "FAIL"} ${farmId}: ponds ${actual.ponds}/${expected.ponds}, feed events ${actual.feedEvents}/${expected.feedEvents}, notifications ${actual.notifications}/${expected.notifications}, cross-tenant ${actual.crossTenant}`,
	);
}

await privileged.$disconnect();
await app.$disconnect();

if (failed) {
	console.error("Tenant isolation proof failed. Do not switch DATABASE_URL.");
	process.exit(1);
}
console.log("Tenant isolation proof passed (read-only).");
