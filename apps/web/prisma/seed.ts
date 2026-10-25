import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildSeedEmail, resolveSupabaseUserId } from "./seed-identity";

const prisma = new PrismaClient();

const DEMO_FARM_ID = "demo-farmer-1";
const DEMO_EMAIL = buildSeedEmail(DEMO_FARM_ID);

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} env var is required for seeding. See HANDOFF.md.`);
	}
	return value;
}

async function main() {
	console.log("Seeding database...");

	// Clean up existing data to ensure idempotent seeding
	await prisma.feedLevelLog.deleteMany();
	await prisma.feedRequest.deleteMany();
	await prisma.feedEvent.deleteMany();
	await prisma.deviceStateEvent.deleteMany();
	await prisma.scheduleCommand.deleteMany();
	await prisma.energyDevice.deleteMany();
	await prisma.notification.deleteMany();
	await prisma.fcrReport.deleteMany();
	await prisma.feedingEvent.deleteMany();
	await prisma.biomassLog.deleteMany();
	await prisma.device.deleteMany();
	await prisma.pond.deleteMany();
	await prisma.farm.deleteMany();
	await prisma.user.deleteMany();

	// 0. Create Demo User (admin) + their single Farm
	// Supabase Auth owns the user id; seed from it instead of inventing one.
	const demoUserId = await resolveSupabaseUserId({
		email: DEMO_EMAIL,
		supabaseId: process.env.DEMO_SUPABASE_ID,
	});
	const demoUser = await prisma.user.create({
		data: {
			supabaseId: demoUserId,
			farmId: DEMO_FARM_ID,
			email: DEMO_EMAIL,
			displayName: "Juan Miguel",
			role: "ADMIN",
			mustChangePassword: false,
			farm: {
				create: { name: "Juan Miguel Farm" },
			},
		},
		include: { farm: true },
	});
	if (!demoUser.farm) throw new Error("Failed to create demo farm");

	// 1. Create Demo Pond (under the farmer's farm)
	const pond = await prisma.pond.create({
		data: {
			ownerId: demoUser.farmId,
			farmId: demoUser.farm.id,
			name: "Demo Pond",
			feedingRatePct: 4.5,
			feedsPerDay: 4,
			population: 200,
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		},
	});

	// 2. Create ESP32 Energy Controller (linked to the demo pond)
	// (The deprecated Device model is no longer written — task 5.2.)
	const deviceToken = process.env.DEVICE_TOKEN ?? "demo-device-token-001";
	const energyDevice = await prisma.energyDevice.create({
		data: {
			mac: "A4:CF:12:7E:3B:09",
			token: deviceToken,
			tokenHash: createHash("sha256").update(deviceToken).digest("hex"),
			label: "CICT Building A Feeder",
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

	// 3. Create Biomass Logs (4 entries over the last month)
	const now = new Date();

	// 3a. Create FeedLevelLog history (45 entries over ~11 days showing gradual decline)
	for (let i = 45; i >= 1; i--) {
		const recordedAt = new Date(now.getTime() - i * 0.25 * 24 * 60 * 60 * 1000);
		const levelPercent = Math.max(8, 95 - (45 - i) * 1.8);
		const distanceCm = 5 + (95 - levelPercent) * 0.35;
		await prisma.feedLevelLog.create({
			data: {
				deviceId: energyDevice.id,
				levelPercent,
				distanceCm,
				recordedAt,
			},
		});
	}

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
			source: "seed",
			recordedAt,
		});
	}
	await prisma.biomassLog.createMany({ data: logs });

	// 4. Create ~2 weeks of live dispense history
	// (FeedEvent + FeedRequest — read by /dashboard/history. The deprecated
	// FeedingEvent model is no longer written — task 5.2.)
	const feedSources = ["scheduled", "scheduled", "scheduled", "scheduled"];
	feedSources[3] = "dashboard"; // latest feed was a dashboard "Feed Now"
	feedSources[1] = "button"; // one feed via physical button

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
