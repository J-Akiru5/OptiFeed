import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
	console.log("Seeding database...");

	// Clean up existing data to ensure idempotent seeding
	await prisma.energyReading.deleteMany();
	await prisma.energyDevice.deleteMany();
	await prisma.notification.deleteMany();
	await prisma.fcrReport.deleteMany();
	await prisma.feedingEvent.deleteMany();
	await prisma.biomassLog.deleteMany();
	await prisma.device.deleteMany();
	await prisma.pond.deleteMany();

	// 1. Create Demo Pond
	const pond = await prisma.pond.create({
		data: {
			ownerId: "demo-farmer-1",
			name: "Demo Pond",
			feedingRatePct: 4.5,
			feedsPerDay: 4,
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		},
	});

	// 2. Create Device
	const device = await prisma.device.create({
		data: {
			pondId: pond.id,
			name: "Smart Feeder 1",
			connectivity: "online",
			hopperLevelPct: 82.0,
			lastSyncedAt: new Date(),
		},
	});

	// 2b. Create ESP32 Energy Controller (linked to the demo pond)
	await prisma.energyDevice.create({
		data: {
			mac: "A4:CF:12:7E:3B:09",
			token: "esp32-tok-cict-001",
			label: "CICT Building A Feeder",
			pondId: pond.id,
			relayState: true,
			lastSeenAt: new Date(),
		},
	});

	// 3. Create Biomass Logs (4 entries over the last month)
	const now = new Date();
	const logs = [];
	for (let i = 4; i >= 1; i--) {
		const recordedAt = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000); // 4, 3, 2, 1 weeks ago
		const avgWeightGrams = 2.0 + (5 - i) * 1.5; // e.g. 3.5, 5.0, 6.5, 8.0 grams
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

	// 4. Create ~2 weeks of Feeding Events
	const feedingEvents = [];
	let missedInserted = false;

	for (let day = 14; day >= 1; day--) {
		for (let feed = 0; feed < 4; feed++) {
			const scheduledTime = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
			scheduledTime.setHours(6 + feed * 4, 0, 0, 0); // 06:00, 10:00, 14:00, 18:00

			let status = "completed";

			// Exactly one "missed" status
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

	// 5. Create FCR Reports (trending-downward history)
	const fcrReports = [
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
	];
	await prisma.fcrReport.createMany({ data: fcrReports });

	console.log("Seeding complete!");
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
