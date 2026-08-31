import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_FARM_ID = "demo-farmer-1";

async function main() {
	console.log("============================================");
	console.log("  DEV SEED — demo data only");
	console.log("  Only touches farmId:", DEMO_FARM_ID);
	console.log("  Real user data is NEVER touched.");
	console.log("============================================\n");

	// ── 1. Upsert Demo User ────────────────────────────────────────────────
	const demoUser = await prisma.user.upsert({
		where: { farmId: DEMO_FARM_ID },
		update: {
			displayName: "Juan Miguel",
			role: "ADMIN",
		},
		create: {
			supabaseId: "00000000-0000-0000-0000-000000000001",
			farmId: DEMO_FARM_ID,
			email: "demo-farmer-1@pond.optifeed.local",
			displayName: "Juan Miguel",
			role: "ADMIN",
		},
	});
	console.log("✓ Demo user:", demoUser.farmId);

	// ── 2. Upsert Demo Pond ────────────────────────────────────────────────
	const pond = await prisma.pond.upsert({
		where: { id: "demo-pond-001" },
		update: {
			feedingRatePct: 4.5,
			feedsPerDay: 4,
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		},
		create: {
			id: "demo-pond-001",
			ownerId: DEMO_FARM_ID,
			name: "Demo Pond",
			feedingRatePct: 4.5,
			feedsPerDay: 4,
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		},
	});
	console.log("✓ Demo pond:", pond.name, `(${pond.id})`);

	// ── 3. Delete only demo-owned data ─────────────────────────────────────
	//    Scoped to demo pond/devices — never touches other users' data.
	const demoDeviceIds = (
		await prisma.energyDevice.findMany({
			where: { pondId: pond.id },
			select: { id: true },
		})
	).map((d) => d.id);

	const legacyDeviceIds = (
		await prisma.device.findMany({
			where: { pondId: pond.id },
			select: { id: true },
		})
	).map((d) => d.id);

	const allDeviceIds = [...demoDeviceIds, ...legacyDeviceIds];

	if (allDeviceIds.length > 0) {
		await prisma.feedLevelLog.deleteMany({ where: { deviceId: { in: allDeviceIds } } });
		await prisma.feedRequest.deleteMany({ where: { deviceId: { in: allDeviceIds } } });
		await prisma.feedEvent.deleteMany({ where: { deviceId: { in: allDeviceIds } } });
		await prisma.deviceStateEvent.deleteMany({ where: { deviceId: { in: allDeviceIds } } });
	}

	await prisma.scheduleCommand.deleteMany({ where: { pondId: pond.id } });
	await prisma.fcrReport.deleteMany({ where: { pondId: pond.id } });
	await prisma.biomassLog.deleteMany({ where: { pondId: pond.id } });
	await prisma.feedingEvent.deleteMany({ where: { deviceId: { in: allDeviceIds } } });
	await prisma.notification.deleteMany({ where: { pondId: pond.id } });
	await prisma.energyDevice.deleteMany({ where: { pondId: pond.id } });
	await prisma.device.deleteMany({ where: { pondId: pond.id } });

	console.log("✓ Cleared demo data for pond:", pond.id);

	// ── 4. Re-create Devices ───────────────────────────────────────────────
	const device = await prisma.device.create({
		data: {
			pondId: pond.id,
			name: "Smart Feeder 1",
			connectivity: "online",
			hopperLevelPct: 82.0,
			lastSyncedAt: new Date(),
		},
	});

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
			recordedAt,
		});
	}
	await prisma.biomassLog.createMany({ data: logs });
	console.log("✓ Created 4 biomass logs");

	// ── 7. Feeding Events (2 weeks) ───────────────────────────────────────
	const feedingEvents = [];
	let missedInserted = false;
	for (let day = 14; day >= 1; day--) {
		for (let feed = 0; feed < 4; feed++) {
			const scheduledTime = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
			scheduledTime.setHours(6 + feed * 4, 0, 0, 0);
			let status = "completed";
			if (!missedInserted && day === 5 && feed === 2) {
				status = "missed";
				missedInserted = true;
			}
			feedingEvents.push({
				deviceId: device.id,
				scheduledTime,
				dispensedVolumeG: status === "completed" ? 1500 : 0,
				status,
				createdAt: scheduledTime,
			});
		}
	}
	await prisma.feedingEvent.createMany({ data: feedingEvents });
	console.log("✓ Created 56 feeding events");

	// ── 8. FeedEvent + FeedRequest (2 weeks) ──────────────────────────────
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
