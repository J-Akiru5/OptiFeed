import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { buildSeedEmail, resolveSupabaseUserId } from "../prisma/seed-identity";
import { isLocalE2eHost as isLoopbackHost, isMainModule } from "./e2e/guards";
import {
	TENANT_B_ADMIN_FARM_ID,
	TENANT_B_OPERATOR_FARM_ID,
	TENANT_B_ORG_ID,
	TENANT_B_ORG_NAME,
	type TenantBBiomassSeed,
	type TenantBCalibrationSeed,
	type TenantBDemoData,
	type TenantBDeviceSeed,
	type TenantBDeviceStateEventSeed,
	type TenantBFcrSeed,
	type TenantBFeedLevelSeed,
	type TenantBFeedPairSeed,
	type TenantBNotificationSeed,
	type TenantBPondEventSeed,
	type TenantBPondSeed,
	type TenantBScheduleCommandSeed,
	type TenantBWaterTempSeed,
	buildTenantBDemoData,
	deviceLastSeenAt,
} from "./tenant-b-demo-data";

/**
 * Demo seed for the second tenant (issue #418).
 *
 * The live database has a `tenant2-admin` account that owns the "Tenant B
 * Fisheries" organization but owns no farm and no ponds, so the tenant console
 * and the farmer dashboard are empty for that account. This script fills the
 * organization with a second member, two farms, three ponds, three feeders and
 * enough history for every chart to have data, so the multi-tenant model can be
 * shown in a presentation.
 *
 * Safety properties:
 *
 * - **Scoped.** Every row this script creates is owned by the Tenant B demo
 *   users, the Tenant B organization or the three demo ponds/feeders. The
 *   cleanup step deletes by those ids only — never an unscoped delete — so no
 *   other tenant's data can be touched. Memberships of other users in the
 *   organization are read but never modified.
 * - **Idempotent.** Re-running it replaces the demo rows instead of adding a
 *   second copy: ponds are upserted by their stable id and every child row is
 *   deleted and recreated.
 * - **Acknowledged.** The staging deployment runs against the production
 *   database, so writing to a non-loopback host requires
 *   `SEED_TENANT_B_CONFIRM=yes` first (see `assertSeedTarget`).
 * - **Non-destructive to the admin account.** The existing `tenant2-admin`
 *   row keeps its Supabase identity and its password; `mustChangePassword` is
 *   only cleared when `--unlock` is passed explicitly.
 */

export const SEED_TENANT_B_CONFIRM_KEY = "SEED_TENANT_B_CONFIRM";
export const SEED_TENANT_B_CONFIRM_VALUE = "yes";

/** Password given to the demo operator account. Never a real credential. */
const DEFAULT_DEMO_PASSWORD = "OptiFeedDemo123";

const ORGANIZATION_TYPE = "COMPANY" as const;

/**
 * Refuse to write unless the target database is acknowledged.
 *
 * A loopback host is the disposable local stack and needs no acknowledgement.
 * Any other host is a shared database, so the operator has to say so
 * explicitly. This mirrors the e2e fixture guard (scripts/e2e/guards.ts).
 */
export function assertSeedTarget(env: Record<string, string | undefined> = process.env): {
	host: string;
	mode: "local" | "remote";
} {
	const databaseUrl = env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error(
			"SEED_TENANT_B blocked: DATABASE_URL is not set. Point it at the target database first.",
		);
	}

	let host: string;
	try {
		host = new URL(databaseUrl).hostname;
	} catch {
		throw new Error("SEED_TENANT_B blocked: DATABASE_URL is not a valid URL.");
	}

	if (isLoopbackHost(host)) return { host, mode: "local" };

	if (env[SEED_TENANT_B_CONFIRM_KEY]?.trim() !== SEED_TENANT_B_CONFIRM_VALUE) {
		throw new Error(
			`SEED_TENANT_B blocked: DATABASE_URL host "${host}" is not a loopback host. ` +
				`Set ${SEED_TENANT_B_CONFIRM_KEY}=${SEED_TENANT_B_CONFIRM_VALUE} to acknowledge that this writes demo data to ${host}.`,
		);
	}

	return { host, mode: "remote" };
}

export type TenantBSeedSummary = {
	organization: { id: string; name: string; created: boolean };
	admin: { farmId: string; created: boolean; unlocked: boolean };
	operator: { farmId: string; created: boolean } | null;
	ponds: { id: string; name: string }[];
	devices: { mac: string; label: string }[];
	counts: Record<string, number>;
};

export type TenantBSeedDeps = {
	prisma: PrismaClient;
	now: Date;
	/**
	 * Creates a Supabase Auth account and returns its id. Omitted when Supabase
	 * is not reachable, in which case only accounts that already exist in the
	 * database can be used.
	 */
	ensureAuthUser?: (email: string, password: string) => Promise<string>;
	/**
	 * Clears `mustChangePassword` on the pre-existing admin account so the
	 * presenter lands straight in the console. Off unless asked for.
	 */
	unlockAdmin: boolean;
};

type SeedUser = { id: string; farmId: string; email: string; displayName: string | null };

async function ensureUser(
	deps: TenantBSeedDeps,
	input: {
		farmId: string;
		displayName: string;
		role: "ADMIN" | "OPERATOR";
		unlock: boolean;
	},
): Promise<{ user: SeedUser; created: boolean }> {
	const { prisma } = deps;
	const email = buildSeedEmail(input.farmId);
	const existing = await prisma.user.findUnique({
		where: { farmId: input.farmId },
		select: { id: true, farmId: true, email: true, displayName: true },
	});

	if (existing) {
		// The Supabase identity is the login key: it must never be rewritten,
		// or the account stops being able to sign in.
		const user = await prisma.user.update({
			where: { id: existing.id },
			data: {
				displayName: input.displayName,
				...(input.unlock ? { mustChangePassword: false } : {}),
			},
			select: { id: true, farmId: true, email: true, displayName: true },
		});
		return { user, created: false };
	}

	const supabaseId = deps.ensureAuthUser
		? await deps.ensureAuthUser(email, DEFAULT_DEMO_PASSWORD)
		: await resolveSupabaseUserId({ email });

	const user = await prisma.user.create({
		data: {
			supabaseId,
			farmId: input.farmId,
			email,
			displayName: input.displayName,
			role: input.role,
			mustChangePassword: false,
		},
		select: { id: true, farmId: true, email: true, displayName: true },
	});
	return { user, created: true };
}

async function resolveOrganization(
	deps: TenantBSeedDeps,
	adminUserId: string,
): Promise<{ id: string; name: string; created: boolean }> {
	const { prisma } = deps;

	// The organization the admin already administers is the right one: the
	// tenant console resolves its scope through that membership.
	const membership = await prisma.membership.findFirst({
		where: { userId: adminUserId, revokedAt: null, role: { in: ["OWNER", "ADMIN"] } },
		orderBy: { createdAt: "asc" },
		select: { orgId: true },
	});

	if (membership) {
		const org = await prisma.organization.findUnique({
			where: { id: membership.orgId },
			select: { id: true, name: true },
		});
		if (org) return { ...org, created: false };
	}

	const byName = await prisma.organization.findFirst({
		where: { name: TENANT_B_ORG_NAME },
		select: { id: true, name: true },
	});
	if (byName) return { ...byName, created: false };

	const created = await prisma.organization.create({
		data: {
			id: TENANT_B_ORG_ID,
			name: TENANT_B_ORG_NAME,
			type: ORGANIZATION_TYPE,
			status: "ACTIVE",
		},
		select: { id: true, name: true },
	});
	return { ...created, created: true };
}

async function ensureFarm(
	deps: TenantBSeedDeps,
	ownerFarmId: string,
	name: string,
): Promise<{ id: string }> {
	return deps.prisma.farm.upsert({
		where: { ownerId: ownerFarmId },
		update: { name },
		create: { ownerId: ownerFarmId, name },
		select: { id: true },
	});
}

/**
 * Remove the demo rows this script owns.
 *
 * Every delete is filtered by the demo pond ids or the demo feeder MAC
 * addresses, so a re-run never leaves a duplicate behind and never reaches a
 * row belonging to another tenant. The order follows the foreign keys: the
 * device-keyed children go before the feeders they point at.
 */
async function clearDemoRows(
	deps: TenantBSeedDeps,
	pondIds: string[],
	deviceMacs: string[],
): Promise<void> {
	const { prisma } = deps;

	await prisma.pondEvent.deleteMany({ where: { pondId: { in: pondIds } } });
	await prisma.cropCycle.deleteMany({ where: { pondId: { in: pondIds } } });
	await prisma.calibrationRun.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.scheduleCommand.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.deviceStateEvent.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.feedEvent.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.feedRequest.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.feedLevelLog.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.waterTempLog.deleteMany({ where: { device: { mac: { in: deviceMacs } } } });
	await prisma.biomassLog.deleteMany({ where: { pondId: { in: pondIds } } });
	await prisma.fcrReport.deleteMany({ where: { pondId: { in: pondIds } } });
	await prisma.notification.deleteMany({ where: { pondId: { in: pondIds } } });
	await prisma.energyDevice.deleteMany({ where: { mac: { in: deviceMacs } } });
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

async function seedDevices(
	deps: TenantBSeedDeps,
	devices: TenantBDeviceSeed[],
): Promise<Map<string, { id: string }>> {
	const { prisma, now } = deps;
	const byMac = new Map<string, { id: string }>();

	for (const device of devices) {
		const lastSeenAt = deviceLastSeenAt(device, now);
		const created = await prisma.energyDevice.create({
			data: {
				mac: device.mac,
				token: device.token,
				tokenHash: hashToken(device.token),
				label: device.label,
				pondId: device.pondId,
				rtcOk: true,
				feederActive: false,
				isPaused: false,
				gramsPerFeeding: device.gramsPerFeeding,
				buttonFeedGrams: 80,
				lastSeenAt,
				feedLevelPercent: device.feedLevelPercent,
				feedLevelCm: device.feedLevelCm,
				feedLevelUpdatedAt: lastSeenAt,
				waterTempC: device.waterTempC,
				waterTempOk: device.waterTempC !== null,
				waterTempUpdatedAt: device.waterTempC === null ? null : lastSeenAt,
				wifiRssiDbm: device.wifiRssiDbm,
				wifiRssiUpdatedAt: device.wifiRssiDbm === null ? null : lastSeenAt,
				hopperEmptyCm: 30,
				hopperFullCm: 5,
				hopperCapacityG: device.hopperCapacityG,
				dailyCapG: 2000,
				gramsPerSecond: 4,
				lastCalibratedAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
				recalibrationIntervalDays: 30,
				approvalStatus: "APPROVED",
			},
			select: { id: true },
		});
		byMac.set(device.mac, created);
	}

	return byMac;
}

async function seedPonds(
	deps: TenantBSeedDeps,
	ponds: TenantBPondSeed[],
	farmIdsByOwner: Map<string, string>,
): Promise<Map<string, { id: string; farmId: string }>> {
	const { prisma } = deps;
	const byPondId = new Map<string, { id: string; farmId: string }>();

	for (const pond of ponds) {
		const farmId = farmIdsByOwner.get(pond.ownerFarmId);
		if (!farmId) throw new Error(`No farm for owner ${pond.ownerFarmId}.`);
		const data = {
			name: pond.name,
			ownerId: pond.ownerFarmId,
			farmId,
			feedingRatePct: pond.feedingRatePct,
			feedsPerDay: pond.feedsPerDay,
			population: pond.population,
			sampleIntervalDays: 14,
			scheduleStart: pond.scheduleStart,
			scheduleEnd: pond.scheduleEnd,
			status: "ACTIVE" as const,
			isFallow: false,
		};
		// Upserted by the stable id so a re-run keeps the pond (and its
		// ownership-history row) instead of failing on a duplicate key.
		const created = await prisma.pond.upsert({
			where: { id: pond.id },
			update: data,
			create: { id: pond.id, ...data },
			select: { id: true, farmId: true },
		});
		byPondId.set(pond.id, created);
	}

	return byPondId;
}

async function seedCropCycles(
	deps: TenantBSeedDeps,
	data: TenantBDemoData,
	pondIds: Set<string>,
	farmIdByPond: Map<string, string>,
	createdBy: string,
): Promise<Map<string, string>> {
	const { prisma } = deps;
	const cycleIdByPond = new Map<string, string>();

	for (const cycle of data.cropCycles) {
		if (!pondIds.has(cycle.pondId)) continue;
		const farmId = farmIdByPond.get(cycle.pondId);
		if (!farmId) throw new Error(`No farm for pond ${cycle.pondId}.`);
		const created = await prisma.cropCycle.create({
			data: {
				pondId: cycle.pondId,
				farmId,
				label: cycle.label,
				status: "ACTIVE",
				stockingDate: cycle.stockingDate,
				stockingCount: cycle.stockingCount,
				stockingAvgWeightG: cycle.stockingAvgWeightG,
				growOutDays: cycle.growOutDays,
				targetHarvestDate: cycle.targetHarvestDate,
				expectedSurvivalPct: cycle.expectedSurvivalPct,
				notes: cycle.notes,
				createdBy,
			},
			select: { id: true },
		});
		cycleIdByPond.set(cycle.pondId, created.id);
	}

	return cycleIdByPond;
}

async function seedPondEvents(
	deps: TenantBSeedDeps,
	data: TenantBDemoData,
	pondIds: Set<string>,
	farmIdByPond: Map<string, string>,
	cycleIdByPond: Map<string, string>,
	createdBy: string,
): Promise<number> {
	const { prisma } = deps;
	let count = 0;

	// One `create` per event rather than a `createMany`: `reminderMinutes` is a
	// scalar list, and the application's own writer for that field
	// (lib/actions/pond-event.ts) uses `create` too.
	for (const event of data.pondEvents) {
		if (!pondIds.has(event.pondId)) continue;
		const farmId = farmIdByPond.get(event.pondId);
		if (!farmId) throw new Error(`No farm for pond ${event.pondId}.`);
		await prisma.pondEvent.create({
			data: {
				pondId: event.pondId,
				cropCycleId: cycleIdByPond.get(event.pondId) ?? null,
				farmId,
				type: event.type,
				status: event.status,
				title: event.title,
				startsAt: event.startsAt,
				allDay: true,
				notes: event.notes,
				source: "cycle",
				createdBy,
				...(event.status === "DONE" ? { completedBy: createdBy, completedAt: event.startsAt } : {}),
				reminderMinutes: event.reminderMinutes,
			},
		});
		count += 1;
	}

	return count;
}

async function seedFeeding(
	deps: TenantBSeedDeps,
	data: TenantBDemoData,
	deviceIds: Map<string, { id: string }>,
	farmIdByDevice: Map<string, string>,
): Promise<{ feedEvents: number; feedRequests: number }> {
	const { prisma } = deps;

	const pairs: TenantBFeedPairSeed[] = data.feedPairs.filter((pair) =>
		deviceIds.has(pair.deviceMac),
	);
	if (pairs.length === 0) return { feedEvents: 0, feedRequests: 0 };

	await prisma.feedRequest.createMany({
		data: pairs.map((pair) => ({
			deviceId: deviceIds.get(pair.deviceMac)?.id ?? "",
			grams: pair.grams,
			status: "completed",
			kind: "feed",
			createdAt: pair.receivedAt,
			farmId: farmIdByDevice.get(pair.deviceMac) ?? null,
		})),
	});

	// Match the created requests back to their events. The demo data gives
	// every request on a device its own timestamp, so the pair is unambiguous.
	const stored = await prisma.feedRequest.findMany({
		where: { deviceId: { in: [...deviceIds.values()].map((device) => device.id) } },
		select: { id: true, deviceId: true, createdAt: true },
	});
	const requestIdByKey = new Map(
		stored.map((row) => [`${row.deviceId}|${row.createdAt.toISOString()}`, row.id]),
	);

	const events = pairs.map((pair) => {
		const deviceId = deviceIds.get(pair.deviceMac)?.id ?? "";
		const requestId = requestIdByKey.get(`${deviceId}|${pair.receivedAt.toISOString()}`);
		if (!requestId) {
			throw new Error(
				`Could not match the feed request for ${pair.deviceMac} at ${pair.receivedAt.toISOString()}.`,
			);
		}
		return {
			deviceId,
			eventType: "feed_dispensed",
			timestamp: pair.receivedAt.toISOString(),
			grams: pair.grams,
			source: pair.source,
			feedRequestId: requestId,
			receivedAt: pair.receivedAt,
			farmId: farmIdByDevice.get(pair.deviceMac) ?? null,
		};
	});

	const result = await prisma.feedEvent.createMany({ data: events });
	return { feedEvents: result.count, feedRequests: pairs.length };
}

async function seedTelemetry(
	deps: TenantBSeedDeps,
	data: TenantBDemoData,
	deviceIds: Map<string, { id: string }>,
	farmIdByDevice: Map<string, string>,
): Promise<Record<string, number>> {
	const { prisma } = deps;
	const counts: Record<string, number> = {};

	const levelRows: TenantBFeedLevelSeed[] = data.feedLevelLogs.filter((row) =>
		deviceIds.has(row.deviceMac),
	);
	if (levelRows.length > 0) {
		const result = await prisma.feedLevelLog.createMany({
			data: levelRows.map((row) => ({
				deviceId: deviceIds.get(row.deviceMac)?.id ?? "",
				levelPercent: row.levelPercent,
				distanceCm: row.distanceCm,
				recordedAt: row.recordedAt,
				farmId: farmIdByDevice.get(row.deviceMac) ?? null,
			})),
		});
		counts.feedLevelLogs = result.count;
	}

	const tempRows: TenantBWaterTempSeed[] = data.waterTempLogs.filter((row) =>
		deviceIds.has(row.deviceMac),
	);
	if (tempRows.length > 0) {
		const result = await prisma.waterTempLog.createMany({
			data: tempRows.map((row) => ({
				deviceId: deviceIds.get(row.deviceMac)?.id ?? "",
				tempC: row.tempC,
				recordedAt: row.recordedAt,
				farmId: farmIdByDevice.get(row.deviceMac) ?? null,
			})),
		});
		counts.waterTempLogs = result.count;
	}

	const stateRows: TenantBDeviceStateEventSeed[] = data.deviceStateEvents.filter((row) =>
		deviceIds.has(row.deviceMac),
	);
	if (stateRows.length > 0) {
		const result = await prisma.deviceStateEvent.createMany({
			data: stateRows.map((row) => ({
				deviceId: deviceIds.get(row.deviceMac)?.id ?? "",
				eventType: row.eventType,
				source: row.source,
				deviceTime: row.deviceTime,
				createdAt: row.createdAt,
				farmId: farmIdByDevice.get(row.deviceMac) ?? null,
			})),
		});
		counts.deviceStateEvents = result.count;
	}

	const commandRows: TenantBScheduleCommandSeed[] = data.scheduleCommands.filter((row) =>
		deviceIds.has(row.deviceMac),
	);
	if (commandRows.length > 0) {
		const result = await prisma.scheduleCommand.createMany({
			data: commandRows.map((row) => ({
				deviceId: deviceIds.get(row.deviceMac)?.id ?? "",
				pondId: row.pondId,
				scheduleStart: row.scheduleStart,
				scheduleEnd: row.scheduleEnd,
				feedsPerDay: row.feedsPerDay,
				feedingRatePct: row.feedingRatePct,
				buttonFeedGrams: 80,
				status: row.status,
				appliedAt: row.appliedAt,
				deviceTime: row.deviceTime,
				createdAt: row.createdAt,
				farmId: farmIdByDevice.get(row.deviceMac) ?? null,
			})),
		});
		counts.scheduleCommands = result.count;
	}

	const calibrationRows: TenantBCalibrationSeed[] = data.calibrationRuns.filter((row) =>
		deviceIds.has(row.deviceMac),
	);
	if (calibrationRows.length > 0) {
		const result = await prisma.calibrationRun.createMany({
			data: calibrationRows.map((row) => ({
				deviceId: deviceIds.get(row.deviceMac)?.id ?? "",
				sessionId: row.sessionId,
				attempt: row.attempt,
				kind: row.kind,
				durationMs: row.durationMs,
				targetGrams: row.targetGrams,
				measuredGrams: row.measuredGrams,
				gramsPerSecondBefore: row.gramsPerSecondBefore,
				gramsPerSecondAfter: row.gramsPerSecondAfter,
				errorPct: row.errorPct,
				accepted: row.accepted,
				createdAt: row.createdAt,
			})),
		});
		counts.calibrationRuns = result.count;
	}

	return counts;
}

async function seedBiomassAndReports(
	deps: TenantBSeedDeps,
	data: TenantBDemoData,
	pondIds: Set<string>,
	farmIdByPond: Map<string, string>,
): Promise<Record<string, number>> {
	const { prisma } = deps;
	const counts: Record<string, number> = {};

	const logs: TenantBBiomassSeed[] = data.biomassLogs.filter((row) => pondIds.has(row.pondId));
	if (logs.length > 0) {
		await prisma.biomassLog.createMany({
			data: logs.map((row) => ({
				pondId: row.pondId,
				sampleWeightKg: row.sampleWeightKg,
				sampleLengthCm: row.sampleLengthCm,
				sampleCount: row.sampleCount,
				avgWeightKg: row.avgWeightKg,
				batchLabel: row.batchLabel,
				source: "seed",
				recordedAt: row.recordedAt,
				farmId: farmIdByPond.get(row.pondId) ?? null,
			})),
		});
		counts.biomassLogs = logs.length;

		const stored = await prisma.biomassLog.findMany({
			where: { pondId: { in: [...pondIds] } },
			select: { id: true, pondId: true, recordedAt: true },
		});
		const logIdByKey = new Map(
			stored.map((row) => [`${row.pondId}|${row.recordedAt.toISOString()}`, row.id]),
		);

		const fish = logs.flatMap((row) => {
			const logId = logIdByKey.get(`${row.pondId}|${row.recordedAt.toISOString()}`);
			if (!logId) throw new Error(`Could not match the biomass log for pond ${row.pondId}.`);
			return row.fish.map((sample) => ({
				biomassLogId: logId,
				weightGrams: sample.weightGrams,
				lengthCm: sample.lengthCm,
				farmId: farmIdByPond.get(row.pondId) ?? null,
			}));
		});
		if (fish.length > 0) {
			const result = await prisma.fishSample.createMany({ data: fish });
			counts.fishSamples = result.count;
		}
	}

	const reports: TenantBFcrSeed[] = data.fcrReports.filter((row) => pondIds.has(row.pondId));
	if (reports.length > 0) {
		const result = await prisma.fcrReport.createMany({
			data: reports.map((row) => ({
				pondId: row.pondId,
				periodStart: row.periodStart,
				periodEnd: row.periodEnd,
				totalFeedKg: row.totalFeedKg,
				biomassGainKg: row.biomassGainKg,
				fcrValue: row.fcrValue,
				farmId: farmIdByPond.get(row.pondId) ?? null,
			})),
		});
		counts.fcrReports = result.count;
	}

	return counts;
}

async function seedNotifications(
	deps: TenantBSeedDeps,
	data: TenantBDemoData,
	pondIds: Set<string>,
	farmIdByPond: Map<string, string>,
): Promise<number> {
	const { prisma } = deps;
	const rows: TenantBNotificationSeed[] = data.notifications.filter((row) =>
		pondIds.has(row.pondId),
	);
	if (rows.length === 0) return 0;

	const result = await prisma.notification.createMany({
		data: rows.map((row) => ({
			pondId: row.pondId,
			tier: row.tier,
			message: row.message,
			linkTo: row.linkTo,
			category: row.category,
			read: row.read,
			createdAt: row.createdAt,
			farmId: farmIdByPond.get(row.pondId) ?? null,
		})),
	});
	return result.count;
}

/**
 * Seed the Tenant B demo tenant.
 *
 * Exported with its dependencies injected so the unit tests can drive it with
 * a fake database client.
 */
export async function seedTenantBDemo(deps: TenantBSeedDeps): Promise<TenantBSeedSummary> {
	const { prisma, now } = deps;
	const data = buildTenantBDemoData(now);

	const admin = await ensureUser(deps, {
		farmId: TENANT_B_ADMIN_FARM_ID,
		displayName: "Tenant B Admin",
		role: "ADMIN",
		unlock: deps.unlockAdmin,
	});

	const organization = await resolveOrganization(deps, admin.user.id);

	await prisma.membership.upsert({
		where: { orgId_userId: { orgId: organization.id, userId: admin.user.id } },
		update: { role: "OWNER", revokedAt: null },
		create: { orgId: organization.id, userId: admin.user.id, role: "OWNER" },
	});

	// A second member makes the organization view meaningful: the console lists
	// members with their roles, and the permissions screen needs a non-owner
	// membership to show an override on.
	let operator: { user: SeedUser; created: boolean } | null = null;
	try {
		operator = await ensureUser(deps, {
			farmId: TENANT_B_OPERATOR_FARM_ID,
			displayName: "Tenant B Operator",
			role: "OPERATOR",
			unlock: false,
		});
	} catch (error) {
		// No Supabase account and no existing row: the demo still works with a
		// single member, so this is reported rather than fatal.
		console.warn(
			`Could not create the ${TENANT_B_OPERATOR_FARM_ID} demo member: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const farmIdsByOwner = new Map<string, string>();
	farmIdsByOwner.set(
		TENANT_B_ADMIN_FARM_ID,
		(await ensureFarm(deps, TENANT_B_ADMIN_FARM_ID, "Tenant B Fisheries Farm")).id,
	);

	if (operator) {
		farmIdsByOwner.set(
			TENANT_B_OPERATOR_FARM_ID,
			(await ensureFarm(deps, TENANT_B_OPERATOR_FARM_ID, "Tenant B Fisheries Branch Farm")).id,
		);
		const membership = await prisma.membership.upsert({
			where: { orgId_userId: { orgId: organization.id, userId: operator.user.id } },
			update: { role: "OPERATOR", revokedAt: null },
			create: { orgId: organization.id, userId: operator.user.id, role: "OPERATOR" },
			select: { id: true },
		});

		// A revoked `control_feeder` is the documented canonical override: the
		// operator's role default grants it, and this row removes it. It makes
		// the permissions screen show a real override instead of empty defaults.
		await prisma.membershipPermission.upsert({
			where: {
				membershipId_permission: {
					membershipId: membership.id,
					permission: "control_feeder",
				},
			},
			update: { revokedAt: now },
			create: {
				membershipId: membership.id,
				permission: "control_feeder",
				revokedAt: now,
			},
		});
	}

	await prisma.orgSetting.upsert({
		where: { orgId: organization.id },
		update: {
			defaultFeedingRatePct: 3,
			hopperLowPct: 20,
			missedFeedingAlerts: true,
			alertRoles: ["OWNER", "ADMIN"],
			deviceRegistration: "ADMIN_APPROVAL",
		},
		create: {
			orgId: organization.id,
			defaultFeedingRatePct: 3,
			hopperLowPct: 20,
			missedFeedingAlerts: true,
			alertRoles: ["OWNER", "ADMIN"],
			deviceRegistration: "ADMIN_APPROVAL",
		},
	});

	// The operator's pond needs the operator's farm, so it is only seeded when
	// that member exists.
	const ponds = data.ponds.filter((pond) => farmIdsByOwner.has(pond.ownerFarmId));
	const pondIds = ponds.map((pond) => pond.id);
	const pondIdSet = new Set(pondIds);
	const devices = data.devices.filter((device) => pondIdSet.has(device.pondId));

	// The cleanup covers every demo pond and feeder, including the ones this
	// run cannot recreate, so a run that loses the operator account still
	// leaves no stale demo rows behind. The scope is still the demo ids only.
	await clearDemoRows(
		deps,
		data.ponds.map((pond) => pond.id),
		data.devices.map((device) => device.mac),
	);

	// The ponds come first: a feeder points at its pond, so the pond row has to
	// exist before the device that references it.
	const pondRows = await seedPonds(deps, ponds, farmIdsByOwner);
	const farmIdByPond = new Map<string, string>();
	for (const pond of ponds) {
		const row = pondRows.get(pond.id);
		if (row) farmIdByPond.set(pond.id, row.farmId);
	}
	const farmIdByDevice = new Map<string, string>();
	for (const device of devices) {
		const farmId = farmIdByPond.get(device.pondId);
		if (farmId) farmIdByDevice.set(device.mac, farmId);
	}

	const deviceRows = await seedDevices(deps, devices);
	const deviceIds = new Map([...deviceRows].map(([mac, device]) => [mac, { id: device.id }]));

	const cycleIdByPond = await seedCropCycles(deps, data, pondIdSet, farmIdByPond, admin.user.id);
	const pondEventCount = await seedPondEvents(
		deps,
		data,
		pondIdSet,
		farmIdByPond,
		cycleIdByPond,
		admin.user.id,
	);
	const feeding = await seedFeeding(deps, data, deviceIds, farmIdByDevice);
	const telemetryCounts = await seedTelemetry(deps, data, deviceIds, farmIdByDevice);
	const reportCounts = await seedBiomassAndReports(deps, data, pondIdSet, farmIdByPond);
	const notificationCount = await seedNotifications(deps, data, pondIdSet, farmIdByPond);

	return {
		organization: { id: organization.id, name: organization.name, created: organization.created },
		admin: { farmId: admin.user.farmId, created: admin.created, unlocked: deps.unlockAdmin },
		operator: operator ? { farmId: operator.user.farmId, created: operator.created } : null,
		ponds: ponds.map((pond) => ({ id: pond.id, name: pond.name })),
		devices: devices.map((device) => ({ mac: device.mac, label: device.label })),
		counts: {
			...telemetryCounts,
			...reportCounts,
			pondEvents: pondEventCount,
			notifications: notificationCount,
			feedEvents: feeding.feedEvents,
			feedRequests: feeding.feedRequests,
		},
	};
}

function printSummary(summary: TenantBSeedSummary): void {
	console.log("");
	console.log("============================================");
	console.log("  TENANT B DEMO SEED — second tenant");
	console.log("============================================");
	console.log(`Organization:  ${summary.organization.name} (${summary.organization.id})`);
	console.log(`Admin:         ${summary.admin.farmId}${summary.admin.created ? " (created)" : ""}`);
	console.log(
		`Operator:      ${summary.operator?.farmId ?? "(not created)"}${
			summary.operator?.created ? " (created)" : ""
		}`,
	);
	for (const pond of summary.ponds) {
		console.log(`Pond:          ${pond.name} (${pond.id})`);
	}
	for (const device of summary.devices) {
		console.log(`Feeder:        ${device.label} (${device.mac})`);
	}
	console.log("");
	for (const [key, value] of Object.entries(summary.counts)) {
		console.log(`  ${key.padEnd(20)} ${value}`);
	}
	console.log("");
	console.log("Passwords and device tokens are never printed.");
	console.log("============================================");
}

async function main(): Promise<void> {
	try {
		loadEnvFile(".env");
	} catch {
		// .env may be absent; the ambient environment is used instead.
	}

	const target = assertSeedTarget();
	const unlockAdmin = process.argv.includes("--unlock");

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	let ensureAuthUser: ((email: string, password: string) => Promise<string>) | undefined;
	if (url && serviceRoleKey) {
		const supabase = createClient(url, serviceRoleKey, {
			auth: { autoRefreshToken: false, persistSession: false },
		});
		ensureAuthUser = async (email: string, password: string) => {
			const { data: created, error } = await supabase.auth.admin.createUser({
				email,
				password,
				email_confirm: true,
			});
			if (error) throw new Error(`Supabase Auth error for ${email}: ${error.message}`);
			return created.user.id;
		};
	}

	const prisma = new PrismaClient();
	try {
		const summary = await seedTenantBDemo({
			prisma,
			now: new Date(),
			ensureAuthUser,
			unlockAdmin,
		});
		console.log(`Target host: ${target.host} (${target.mode})`);
		printSummary(summary);
	} finally {
		await prisma.$disconnect();
	}
}

if (isMainModule(import.meta.url)) {
	main().catch((error) => {
		console.error("[tenant-b seed] failed:", error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
