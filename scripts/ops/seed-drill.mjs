#!/usr/bin/env node
/**
 * Seed the deterministic restore-drill fixture.
 *
 * Writes through Prisma (no raw INSERTs), so the drill also exercises the
 * generated client against the migrated schema. Every id comes from
 * `drill-fixture.mjs`; nothing is generated at random.
 *
 * Safety: `drill-guard.mjs` refuses a non-loopback DATABASE_URL unless the
 * operator acknowledges that exact host. `--reset` deletes only the literal
 * `drill-` rows this script owns.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/ops/seed-drill.mjs [--reset]
 */
import { createHash } from "node:crypto";
import { DRILL, DRILL_BIOMASS_LOGS, DRILL_FEED_EVENTS, DRILL_TIMES } from "./drill-fixture.mjs";
import {
	DRILL_PREFIX,
	assertDrillTarget,
	describeTarget,
	loadPrismaClient,
} from "./drill-guard.mjs";

const args = new Set(process.argv.slice(2));
const reset = args.has("--reset");
const target = assertDrillTarget();
const PrismaClient = loadPrismaClient();
const prisma = new PrismaClient();

function at(value) {
	return new Date(value);
}

/** A TIME column value; Prisma serialises the time part. */
function timeOfDay(value) {
	return new Date(`1970-01-01T${value}:00.000Z`);
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

async function removeFixture(client) {
	const deviceId = DRILL.device.id;
	const pondId = DRILL.pond.id;
	const biomassIds = DRILL_BIOMASS_LOGS.map((log) => log.id);

	await client.deviceStateEvent.deleteMany({ where: { deviceId } });
	await client.feedRequest.deleteMany({ where: { deviceId } });
	await client.feedEvent.deleteMany({ where: { deviceId } });
	await client.fishSample.deleteMany({ where: { biomassLogId: { in: biomassIds } } });
	await client.biomassLog.deleteMany({ where: { pondId } });
	await client.energyDevice.deleteMany({ where: { pondId } });
	await client.notification.deleteMany({ where: { pondId } });
	await client.pondEvent.deleteMany({ where: { pondId } });
	await client.cropCycle.deleteMany({ where: { pondId } });
	await client.pond.deleteMany({ where: { id: pondId } });
	await client.farm.deleteMany({ where: { id: DRILL.farm.id } });
	await client.membershipPermission.deleteMany({
		where: { membershipId: DRILL.membership.id },
	});
	await client.membership.deleteMany({ where: { orgId: DRILL.org.id } });
	await client.user.deleteMany({ where: { id: DRILL.user.id } });
	await client.organization.deleteMany({ where: { id: DRILL.org.id } });
}

async function seed() {
	await prisma.$transaction(async (tx) => {
		await tx.organization.create({
			data: {
				id: DRILL.org.id,
				name: DRILL.org.name,
				type: DRILL.org.type,
				status: "ACTIVE",
				createdAt: at(DRILL_TIMES.organizationCreatedAt),
				updatedAt: at(DRILL_TIMES.organizationCreatedAt),
			},
		});

		await tx.user.create({
			data: {
				id: DRILL.user.id,
				supabaseId: DRILL.user.supabaseId,
				farmId: DRILL.user.farmSlug,
				email: DRILL.user.email,
				displayName: DRILL.user.displayName,
				role: "ADMIN",
				mustChangePassword: false,
				createdAt: at(DRILL_TIMES.userCreatedAt),
				updatedAt: at(DRILL_TIMES.userCreatedAt),
			},
		});

		await tx.membership.create({
			data: {
				id: DRILL.membership.id,
				orgId: DRILL.org.id,
				userId: DRILL.user.id,
				role: "OWNER",
				createdAt: at(DRILL_TIMES.userCreatedAt),
			},
		});

		await tx.membershipPermission.create({
			data: {
				id: DRILL.membership.permissionId,
				membershipId: DRILL.membership.id,
				permission: DRILL.membership.permission,
				grantedAt: at(DRILL_TIMES.userCreatedAt),
			},
		});

		await tx.farm.create({
			data: {
				id: DRILL.farm.id,
				ownerId: DRILL.user.farmSlug,
				name: DRILL.farm.name,
				createdAt: at(DRILL_TIMES.farmCreatedAt),
				updatedAt: at(DRILL_TIMES.farmCreatedAt),
			},
		});

		// Inserting the pond also fires record_pond_ownership_event(), which
		// writes one PondOwnershipHistory row. The drill must restore that too.
		await tx.pond.create({
			data: {
				id: DRILL.pond.id,
				ownerId: DRILL.user.farmSlug,
				farmId: DRILL.farm.id,
				name: DRILL.pond.name,
				feedingRatePct: 3.5,
				feedsPerDay: 3,
				population: 1000,
				sampleIntervalDays: 14,
				scheduleStart: timeOfDay("06:00"),
				scheduleEnd: timeOfDay("18:00"),
				status: "ACTIVE",
				isFallow: false,
				createdAt: at(DRILL_TIMES.pondCreatedAt),
			},
		});

		await tx.cropCycle.create({
			data: {
				id: DRILL.cropCycle.id,
				pondId: DRILL.pond.id,
				farmId: DRILL.farm.id,
				label: DRILL.cropCycle.label,
				status: "ACTIVE",
				stockingDate: at(DRILL_TIMES.stockingDate),
				stockingCount: 1000,
				stockingAvgWeightG: 1.2,
				growOutDays: 135,
				targetHarvestDate: at(DRILL_TIMES.targetHarvestDate),
				targetHarvestWeightG: 250,
				expectedSurvivalPct: 85,
				notes: "Restore-drill fixture; not a real crop cycle.",
				createdBy: DRILL.user.id,
				createdAt: at(DRILL_TIMES.cropCycleCreatedAt),
				updatedAt: at(DRILL_TIMES.cropCycleCreatedAt),
			},
		});

		await tx.pondEvent.create({
			data: {
				id: DRILL.pondEvent.id,
				pondId: DRILL.pond.id,
				cropCycleId: DRILL.cropCycle.id,
				farmId: DRILL.farm.id,
				type: "STOCKING",
				status: "DONE",
				title: "Stocked 1,000 fingerlings",
				startsAt: at(DRILL_TIMES.pondEventStartsAt),
				allDay: true,
				source: "cycle",
				createdBy: DRILL.user.id,
				completedBy: DRILL.user.id,
				completedAt: at(DRILL_TIMES.pondEventStartsAt),
				createdAt: at(DRILL_TIMES.cropCycleCreatedAt),
				updatedAt: at(DRILL_TIMES.cropCycleCreatedAt),
			},
		});

		await tx.energyDevice.create({
			data: {
				id: DRILL.device.id,
				mac: DRILL.device.mac,
				token: DRILL.device.token,
				tokenHash: sha256(DRILL.device.token),
				label: DRILL.device.label,
				pondId: DRILL.pond.id,
				rtcOk: true,
				feederActive: false,
				isPaused: false,
				gramsPerFeeding: 150,
				buttonFeedGrams: 80,
				lastSeenAt: at(DRILL_TIMES.deviceLastSeenAt),
				createdAt: at(DRILL_TIMES.deviceCreatedAt),
				feedLevelPercent: 62.5,
				feedLevelCm: 12.4,
				feedLevelUpdatedAt: at(DRILL_TIMES.deviceLastSeenAt),
				waterTempC: 27.3,
				waterTempOk: true,
				waterTempUpdatedAt: at(DRILL_TIMES.deviceLastSeenAt),
				hopperEmptyCm: 30,
				hopperFullCm: 5,
				hopperCapacityG: 7000,
				dailyCapG: 2000,
				gramsPerSecond: 4,
				tempOffsetC: 0,
				approvalStatus: "APPROVED",
			},
		});

		for (const log of DRILL_BIOMASS_LOGS) {
			await tx.biomassLog.create({
				data: {
					id: log.id,
					pondId: DRILL.pond.id,
					sampleWeightKg: log.sampleWeightKg,
					sampleLengthCm: log.sampleLengthCm,
					sampleCount: log.sampleCount,
					avgWeightKg: log.avgWeightKg,
					batchLabel: log.batchLabel,
					source: "seed",
					recordedAt: at(log.recordedAt),
					farmId: DRILL.farm.id,
				},
			});

			for (const sample of log.samples) {
				await tx.fishSample.create({
					data: {
						id: sample.id,
						biomassLogId: log.id,
						weightGrams: sample.weightGrams,
						lengthCm: sample.lengthCm,
						farmId: DRILL.farm.id,
					},
				});
			}
		}

		for (const event of DRILL_FEED_EVENTS) {
			await tx.feedEvent.create({
				data: {
					id: event.id,
					deviceId: DRILL.device.id,
					eventId: event.eventId,
					eventType: "feed_dispensed",
					timestamp: event.timestamp,
					grams: event.grams,
					source: event.source,
					rtcOk: true,
					feederActive: true,
					receivedAt: at(event.receivedAt),
					farmId: DRILL.farm.id,
				},
			});
		}

		await tx.feedRequest.create({
			data: {
				id: DRILL.feedRequest.id,
				deviceId: DRILL.device.id,
				grams: 150,
				status: "completed",
				createdAt: at(DRILL_TIMES.feedRequestCreatedAt),
				updatedAt: at(DRILL_TIMES.feedRequestCreatedAt),
				farmId: DRILL.farm.id,
			},
		});

		await tx.notification.create({
			data: {
				id: DRILL.notifications.unread,
				pondId: DRILL.pond.id,
				tier: "WARNING",
				message: "Hopper level below 20% on drill-feeder",
				linkTo: "/en/dashboard",
				read: false,
				category: "pellet",
				createdAt: at(DRILL_TIMES.unreadNotificationCreatedAt),
				farmId: DRILL.farm.id,
			},
		});

		await tx.notification.create({
			data: {
				id: DRILL.notifications.read,
				pondId: DRILL.pond.id,
				tier: "INFO",
				message: "Restore-drill fixture seeded",
				read: true,
				category: "system",
				acknowledgedAt: at(DRILL_TIMES.readNotificationAcknowledgedAt),
				acknowledgedBy: DRILL.user.id,
				createdAt: at(DRILL_TIMES.readNotificationCreatedAt),
				farmId: DRILL.farm.id,
			},
		});

		await tx.deviceStateEvent.create({
			data: {
				id: DRILL.stateEvent.id,
				deviceId: DRILL.device.id,
				eventType: "connected",
				source: "device",
				deviceTime: "2026-02-02T06:00:00Z",
				metadata: { firmware: "drill-1.0.0" },
				createdAt: at(DRILL_TIMES.stateEventCreatedAt),
				farmId: DRILL.farm.id,
			},
		});

		await tx.deviceStateEvent.create({
			data: {
				id: DRILL.errorEvent.id,
				deviceId: DRILL.device.id,
				eventType: "command_failed",
				source: "system",
				deviceTime: "unknown",
				metadata: {
					errorCode: DRILL.errorEvent.code,
					message: "ultrasonic sensor returned no echo",
					attempts: 3,
				},
				createdAt: at(DRILL_TIMES.errorEventCreatedAt),
				farmId: DRILL.farm.id,
			},
		});
	});
}

async function summary() {
	return {
		Organization: await prisma.organization.count({ where: { id: DRILL.org.id } }),
		User: await prisma.user.count({ where: { id: DRILL.user.id } }),
		Membership: await prisma.membership.count({ where: { orgId: DRILL.org.id } }),
		MembershipPermission: await prisma.membershipPermission.count({
			where: { membershipId: DRILL.membership.id },
		}),
		Farm: await prisma.farm.count({ where: { id: DRILL.farm.id } }),
		Pond: await prisma.pond.count({ where: { id: DRILL.pond.id } }),
		CropCycle: await prisma.cropCycle.count({ where: { pondId: DRILL.pond.id } }),
		PondEvent: await prisma.pondEvent.count({ where: { pondId: DRILL.pond.id } }),
		EnergyDevice: await prisma.energyDevice.count({ where: { pondId: DRILL.pond.id } }),
		BiomassLog: await prisma.biomassLog.count({ where: { pondId: DRILL.pond.id } }),
		FishSample: await prisma.fishSample.count({ where: { id: { startsWith: "drill-sample-" } } }),
		FeedEvent: await prisma.feedEvent.count({ where: { deviceId: DRILL.device.id } }),
		FeedRequest: await prisma.feedRequest.count({ where: { deviceId: DRILL.device.id } }),
		Notification: await prisma.notification.count({ where: { pondId: DRILL.pond.id } }),
		DeviceStateEvent: await prisma.deviceStateEvent.count({
			where: { deviceId: DRILL.device.id },
		}),
		PondOwnershipHistory: await prisma.pondOwnershipHistory.count({
			where: { pondId: DRILL.pond.id },
		}),
	};
}

async function main() {
	console.log(`restore drill seed -> ${describeTarget(target)}`);
	if (!target.local) {
		console.warn("WARNING: acknowledged non-loopback target. This database will be drilled.");
	}

	if (reset) {
		await removeFixture(prisma);
		console.log("removed the previous drill fixture (--reset)");
	}

	const existing = await prisma.organization.findUnique({
		where: { id: DRILL.org.id },
		select: { id: true },
	});
	if (existing) {
		throw new Error(
			`the drill fixture already exists in ${describeTarget(target)}. Use a fresh database, or re-run with --reset to delete only the drill- rows.`,
		);
	}

	await seed();

	const counts = await summary();
	console.log("seeded rows:");
	for (const [table, count] of Object.entries(counts)) {
		console.log(`  ${table.padEnd(22)} ${count}`);
	}
	console.log(`fixture prefix: ${DRILL_PREFIX} (only these rows are owned)`);
}

main()
	.catch((error) => {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
