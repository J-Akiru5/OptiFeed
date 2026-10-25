import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { buildSeedEmail, resolveSupabaseUserId } from "./seed-identity";

try {
	loadEnvFile(".env");
} catch {}

const prisma = new PrismaClient();

const DEMO_FARM_ID = "demo-farmer-1";
const DEMO_EMAIL = buildSeedEmail(DEMO_FARM_ID);

async function main() {
	console.log("============================================");
	console.log("  DEV SEED — demo data only");
	console.log("  Only touches farmId:", DEMO_FARM_ID);
	console.log("  Real user data is NEVER touched.");
	console.log("============================================\n");

	// ── 1. Upsert Demo User ────────────────────────────────────────────────
	// Reuse the existing identity when the row is present; only a missing row
	// needs the Supabase Auth lookup (a placeholder id breaks sign-in).
	const existingDemoUser = await prisma.user.findUnique({
		where: { farmId: DEMO_FARM_ID },
		select: { supabaseId: true },
	});
	const demoUserId =
		existingDemoUser?.supabaseId ??
		(await resolveSupabaseUserId({
			email: DEMO_EMAIL,
			supabaseId: process.env.DEMO_SUPABASE_ID,
		}));

	const demoUser = await prisma.user.upsert({
		where: { farmId: DEMO_FARM_ID },
		update: {
			displayName: "Juan Miguel",
			role: "ADMIN",
			mustChangePassword: false,
		},
		create: {
			supabaseId: demoUserId,
			farmId: DEMO_FARM_ID,
			email: DEMO_EMAIL,
			displayName: "Juan Miguel",
			role: "ADMIN",
			mustChangePassword: false,
		},
	});
	console.log("✓ Demo user:", demoUser.farmId);

	// ── 1b. Upsert Demo Farm (exactly 1 farm per farmer) ──────────────────
	// Demo tenant org + OWNER membership. The /admin console is gated on
	// Membership.role, not User.role, so without this the demo admin is
	// correctly denied the tenant console.
	const demoOrg = await prisma.organization.upsert({
		where: { id: "demo-org-001" },
		update: { name: "Demo Farm (independent)", status: "ACTIVE" },
		create: {
			id: "demo-org-001",
			name: "Demo Farm (independent)",
			type: "INDIVIDUAL",
			status: "ACTIVE",
		},
	});
	await prisma.membership.upsert({
		where: { orgId_userId: { orgId: demoOrg.id, userId: demoUser.id } },
		update: { role: "OWNER", revokedAt: null },
		create: { orgId: demoOrg.id, userId: demoUser.id, role: "OWNER" },
	});
	console.log("Demo tenant membership:", demoOrg.id);

	const farm = await prisma.farm.upsert({
		where: { ownerId: DEMO_FARM_ID },
		update: {},
		create: {
			ownerId: DEMO_FARM_ID,
			name: `${demoUser.displayName ?? DEMO_FARM_ID} Farm`,
		},
	});
	console.log("✓ Demo farm:", farm.name, `(${farm.id})`);

	// ── 2. Upsert Demo Pond ────────────────────────────────────────────────
	const pond = await prisma.pond.upsert({
		where: { id: "demo-pond-001" },
		update: {
			farmId: farm.id,
			feedingRatePct: 4.5,
			feedsPerDay: 4,
			population: 200,
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		},
		create: {
			id: "demo-pond-001",
			ownerId: DEMO_FARM_ID,
			farmId: farm.id,
			name: "Demo Pond",
			feedingRatePct: 4.5,
			feedsPerDay: 4,
			population: 200,
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		},
	});
	console.log("✓ Demo pond:", pond.name, `(${pond.id})`);

	// ── 3. Delete only demo-owned data ─────────────────────────────────────
	//    Scoped to demo pond/devices — never touches other users' data.
	//    (The deprecated Device/FeedingEvent models are no longer written or
	//    cleaned up here — task 5.2. Live EnergyDevice rows are cleared.)
	const demoDeviceIds = (
		await prisma.energyDevice.findMany({
			where: { pondId: pond.id },
			select: { id: true },
		})
	).map((d) => d.id);

	if (demoDeviceIds.length > 0) {
		await prisma.feedLevelLog.deleteMany({ where: { deviceId: { in: demoDeviceIds } } });
		await prisma.feedRequest.deleteMany({ where: { deviceId: { in: demoDeviceIds } } });
		await prisma.feedEvent.deleteMany({ where: { deviceId: { in: demoDeviceIds } } });
		await prisma.deviceStateEvent.deleteMany({ where: { deviceId: { in: demoDeviceIds } } });
	}

	await prisma.scheduleCommand.deleteMany({ where: { pondId: pond.id } });
	await prisma.fcrReport.deleteMany({ where: { pondId: pond.id } });
	await prisma.biomassLog.deleteMany({ where: { pondId: pond.id } });
	await prisma.notification.deleteMany({ where: { pondId: pond.id } });
	await prisma.pondEvent.deleteMany({ where: { pondId: pond.id } });
	await prisma.cropCycle.deleteMany({ where: { pondId: pond.id } });
	await prisma.energyDevice.deleteMany({ where: { pondId: pond.id } });

	console.log("✓ Cleared demo data for pond:", pond.id);

	// ── 4. Re-create demo Energy Device ───────────────────────────────────
	const DEMO_MAC = "DE:AD:DE:MO:00:01";
	const DEMO_TOKEN = "demo-token-dev-only-001";

	// Clean up any existing demo device by MAC (may be on a different pond from a previous run)
	await prisma.feedLevelLog.deleteMany({ where: { device: { mac: DEMO_MAC } } });
	await prisma.feedRequest.deleteMany({ where: { device: { mac: DEMO_MAC } } });
	await prisma.feedEvent.deleteMany({ where: { device: { mac: DEMO_MAC } } });
	await prisma.energyDevice.deleteMany({ where: { mac: DEMO_MAC } });

	const energyDevice = await prisma.energyDevice.create({
		data: {
			mac: DEMO_MAC,
			token: DEMO_TOKEN,
			tokenHash: createHash("sha256").update(DEMO_TOKEN).digest("hex"),
			label: "Demo Feeder",
			pondId: pond.id,
			rtcOk: true,
			feederActive: false,
			gramsPerFeeding: 150,
			lastSeenAt: new Date(),
			feedLevelPercent: 82,
			feedLevelCm: 9.5,
			feedLevelUpdatedAt: new Date(),
			hopperFullCm: 5,
			hopperEmptyCm: 30,
			hopperCapacityG: 7000,
		},
	});
	console.log("✓ Created devices for demo pond");

	// The dashboard, schedule and hardware pages still read the deprecated
	// Device relation. Seed one row so a fresh demo database is not empty.
	await prisma.device.upsert({
		where: { id: "demo-legacy-device-001" },
		update: { lastSyncedAt: new Date(), connectivity: "online", hopperLevelPct: 82 },
		create: {
			id: "demo-legacy-device-001",
			pondId: pond.id,
			name: "Demo Feeder",
			connectivity: "online",
			isPaused: false,
			lastSyncedAt: new Date(),
			hopperLevelPct: 82,
		},
	});
	console.log("✓ Created legacy Device row for dashboard/schedule compatibility");

	// ── 5. FeedLevelLog history (45 entries over ~11 days) ─────────────────
	const now = new Date();
	for (let i = 45; i >= 1; i--) {
		const recordedAt = new Date(now.getTime() - i * 0.25 * 24 * 60 * 60 * 1000);
		const levelPercent = Math.max(8, 95 - (45 - i) * 1.8);
		const distanceCm = 5 + (95 - levelPercent) * 0.35;
		await prisma.feedLevelLog.create({
			data: { deviceId: energyDevice.id, levelPercent, distanceCm, recordedAt },
		});
	}
	console.log("✓ Created 45 feed level log entries");

	// ── 6. Biomass Logs (4 weekly entries) ─────────────────────────────────
	const logs = [];
	for (let i = 4; i >= 1; i--) {
		const recordedAt = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
		const avgWeightGrams = 2.0 + (5 - i) * 1.5;
		logs.push({
			pondId: pond.id,
			sampleWeightKg: (avgWeightGrams * 50) / 1000,
			sampleLengthCm: 5 + (5 - i) * 2,
			sampleCount: 50,
			avgWeightKg: avgWeightGrams / 1000,
			source: "seed",
			recordedAt,
		});
	}
	await prisma.biomassLog.createMany({ data: logs });
	console.log("✓ Created 4 biomass logs");

	// ── 7. FeedEvent + FeedRequest (2 weeks) ──────────────────────────────
	// (The deprecated FeedingEvent model is no longer written — task 5.2.)
	const feedSources = ["scheduled", "scheduled", "scheduled", "scheduled"];
	feedSources[3] = "dashboard";
	feedSources[1] = "button";

	for (let day = 14; day >= 1; day--) {
		for (let feed = 0; feed < 4; feed++) {
			const receivedAt = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
			receivedAt.setHours(6 + feed * 4, 0, 0, 0);

			const feedRequest = await prisma.feedRequest.create({
				data: {
					deviceId: energyDevice.id,
					grams: 1500,
					status: "completed",
					createdAt: receivedAt,
				},
			});

			await prisma.feedEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "feed_dispensed",
					timestamp: receivedAt.toISOString(),
					grams: 1500,
					source: feedSources[feed],
					feedRequestId: feedRequest.id,
					receivedAt,
				},
			});
		}
	}
	console.log("✓ Created 56 feed events + feed requests");

	// ── 9. FCR Reports ────────────────────────────────────────────────────
	await prisma.fcrReport.createMany({
		data: [
			{
				pondId: pond.id,
				periodStart: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
				periodEnd: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
				totalFeedKg: 150.5,
				biomassGainKg: 83.6,
				fcrValue: 1.8,
			},
			{
				pondId: pond.id,
				periodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
				periodEnd: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
				totalFeedKg: 180.0,
				biomassGainKg: 120.0,
				fcrValue: 1.5,
			},
			{
				pondId: pond.id,
				periodStart: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
				periodEnd: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
				totalFeedKg: 200.0,
				biomassGainKg: 153.8,
				fcrValue: 1.3,
			},
		],
	});
	console.log("✓ Created 3 FCR reports");

	// ── 10. Demo grow-out cycle + upcoming events ─────────────────────────
	const stockingDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
	stockingDate.setHours(0, 0, 0, 0);
	const targetHarvestDate = new Date(stockingDate.getTime() + 120 * 24 * 60 * 60 * 1000);
	const demoCycle = await prisma.cropCycle.create({
		data: {
			id: "demo-cycle-001",
			pondId: pond.id,
			farmId: DEMO_FARM_ID,
			label: "Batch Demo-01",
			status: "ACTIVE",
			stockingDate,
			stockingCount: 5000,
			stockingAvgWeightG: 20,
			growOutDays: 120,
			targetHarvestDate,
			targetHarvestWeightG: 250000,
			expectedSurvivalPct: 85,
			createdBy: DEMO_FARM_ID,
		},
	});
	const day = 24 * 60 * 60 * 1000;
	const eventAt = (offset: number) => {
		const date = new Date(now.getTime() + offset * day);
		date.setHours(0, 0, 0, 0);
		return date;
	};
	await prisma.pondEvent.createMany({
		data: [
			{
				pondId: pond.id,
				cropCycleId: demoCycle.id,
				farmId: DEMO_FARM_ID,
				type: "SAMPLING",
				status: "PLANNED",
				title: "Sampling due",
				startsAt: eventAt(3),
				allDay: true,
				source: "sampling",
				createdBy: DEMO_FARM_ID,
			},
			{
				pondId: pond.id,
				cropCycleId: demoCycle.id,
				farmId: DEMO_FARM_ID,
				type: "HARVEST_PLANNED",
				status: "PLANNED",
				title: "Harvest planned",
				startsAt: targetHarvestDate,
				allDay: true,
				source: "cycle",
				createdBy: DEMO_FARM_ID,
			},
			{
				pondId: pond.id,
				farmId: DEMO_FARM_ID,
				type: "MAINTENANCE",
				status: "PLANNED",
				title: "Water change",
				startsAt: eventAt(5),
				allDay: true,
				source: "manual",
				createdBy: DEMO_FARM_ID,
			},
		],
	});
	console.log("✓ Created demo grow-out cycle + upcoming events");

	console.log("\n============================================");
	console.log("  Dev seed complete! Demo data refreshed.");
	console.log("  Your real data was NOT touched.");
	console.log("============================================");
}

main()
	.catch((e) => {
		console.error("Dev seed failed:", e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
