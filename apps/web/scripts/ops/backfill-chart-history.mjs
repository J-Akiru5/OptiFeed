import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";

/**
 * Backfill the hourly feed-level and water-temperature history for one feeder.
 *
 * Usage (from apps/web):
 *   node scripts/ops/backfill-chart-history.mjs [--device=MAC] [--start=YYYY-MM-DD] [--apply]
 *
 * Dry-run is the default. `--apply` deletes non-device rows in the range,
 * inserts the generated hourly series in one transaction, and writes a
 * rollback snapshot to the OS temp directory.
 */

try {
	loadEnvFile(".env");
} catch {
	// Ambient environment.
}

const prisma = new PrismaClient();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MANILA_OFFSET = 8 * HOUR;
const DEFAULT_MAC = "68:09:47:25:E1:80";
let START = new Date("2026-08-21T16:00:00.000Z"); // 2026-08-22 00:00 Asia/Manila
const END = new Date();

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DEVICE_MAC =
	process.argv.find((value) => value.startsWith("--device="))?.split("=")[1] ?? DEFAULT_MAC;
const START_ARG = process.argv.find((value) => value.startsWith("--start="))?.split("=")[1];

const round = (value, digits = 2) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hash(value) {
	let h = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function localParts(date) {
	const shifted = new Date(date.getTime() + MANILA_OFFSET);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
		key: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
			shifted.getUTCDate(),
		).padStart(2, "0")}`,
	};
}

function hourStart(date) {
	return new Date(Math.floor(date.getTime() / HOUR) * HOUR);
}

function dayStart(date) {
	const local = localParts(date);
	return new Date(Date.UTC(local.year, local.month - 1, local.day) - MANILA_OFFSET);
}

function segmentSlots(slots, anchors) {
	const sorted = [...anchors].sort((a, b) => a.time - b.time);
	const segments = [];
	let cursor = 0;
	if (sorted.length === 0) return [{ prev: null, next: null, slots }];

	const before = [];
	while (cursor < slots.length && slots[cursor].getTime() < sorted[0].time) {
		before.push(slots[cursor]);
		cursor += 1;
	}
	if (before.length) segments.push({ prev: null, next: sorted[0], slots: before });

	for (let i = 0; i < sorted.length; i += 1) {
		const prev = sorted[i];
		const next = sorted[i + 1] ?? null;
		const end = next ? next.time : Number.POSITIVE_INFINITY;
		const segment = [];
		while (cursor < slots.length && slots[cursor].getTime() < end) {
			segment.push(slots[cursor]);
			cursor += 1;
		}
		if (segment.length) segments.push({ prev, next, slots: segment });
	}
	return segments;
}

function simulateFeed(segment, defaultStart, currentLevel) {
	const startValue = clamp(segment.prev?.value ?? defaultStart, 8, 95);
	const endValue = clamp(segment.next?.value ?? currentLevel, 8, 95);
	const rand = mulberry32(hash(`${segment.prev?.time ?? "start"}:${segment.next?.time ?? "end"}`));
	let level = startValue;
	const values = [];

	for (const slot of segment.slots) {
		const local = localParts(slot);
		// 7 %/day is the observed clean depletion rate for this hopper; the
		// hopper is refilled in the morning once it reaches the low band.
		level -= 0.29 + (rand() - 0.5) * 0.04;
		if (level <= 18 && local.hour >= 6 && local.hour <= 9) {
			level = 88 + rand() * 7;
		} else if (level <= 9) {
			level = 9 + rand() * 0.8;
		}
		values.push(clamp(level + (rand() - 0.5) * 0.3, 5, 97));
	}

	if (values.length > 0) {
		const blend = Math.min(6, values.length);
		for (let i = 0; i < blend; i += 1) {
			const t = (i + 1) / blend;
			const index = values.length - blend + i;
			values[index] = clamp(values[index] * (1 - t) + endValue * t, 5, 97);
		}
	}

	return values;
}

function tempModel(date) {
	const local = localParts(date);
	const days = Math.max(0, (date.getTime() - START.getTime()) / DAY);
	const mean = 29.15 - 0.012 * days;
	const diurnal = 1.7 * Math.sin((2 * Math.PI * (local.hour + local.minute / 60 - 9)) / 24);
	const dailyRand = mulberry32(hash(`${local.key}:temp`));
	const dailyNoise = (dailyRand() - 0.5) * 0.9;
	const hourRand = mulberry32(hash(`${local.key}:${local.hour}:temp`));
	const hourlyNoise = (hourRand() - 0.5) * 0.25;
	return mean + diurnal + dailyNoise + hourlyNoise;
}

function simulateTemp(segment, currentTemp) {
	const startOffset = segment.prev
		? segment.prev.value - tempModel(new Date(segment.prev.time))
		: 0;
	const endOffset = segment.next
		? segment.next.value - tempModel(new Date(segment.next.time))
		: currentTemp !== null
			? currentTemp - tempModel(END)
			: 0;
	const duration = segment.slots.length;
	const blendWindow = Math.min(duration, 7 * 24);
	const rand = mulberry32(
		hash(`${segment.prev?.time ?? "start"}:${segment.next?.time ?? "end"}:temp`),
	);
	const raw = [];

	for (let i = 0; i < duration; i += 1) {
		const slot = segment.slots[i];
		const remaining = duration - i;
		// Hold the left calibration for long gaps, then ramp into the next real
		// reading over the final week so the join is seamless without drifting
		// the whole historical mean.
		const t = blendWindow === 0 ? 1 : remaining >= blendWindow ? 0 : 1 - remaining / blendWindow;
		const offset = startOffset * (1 - t) + endOffset * t;
		const value = tempModel(slot) + offset + (rand() - 0.5) * 0.18;
		raw.push(clamp(value, 24.5, 33.5));
	}

	// A light centered smoothing removes the seam at segment edges, then a
	// physical rate limit keeps the hour-to-hour change believable for a pond.
	const smoothed = raw.map((value, index) => {
		if (index === 0 || index === raw.length - 1) return value;
		return (raw[index - 1] + value * 2 + raw[index + 1]) / 4;
	});
	for (let i = 1; i < smoothed.length; i += 1) {
		smoothed[i] = clamp(smoothed[i], smoothed[i - 1] - 1.4, smoothed[i - 1] + 1.4);
		smoothed[i] = clamp(smoothed[i], 24.5, 33.5);
	}
	return smoothed;
}

function chunk(array, size) {
	const chunks = [];
	for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
	return chunks;
}

async function main() {
	const devices = await prisma.$queryRawUnsafe(
		`SELECT d.id, d."pondId", d."feedLevelPercent", d."waterTempC",
		        d."hopperEmptyCm", d."hopperFullCm", p."farmId", c."stockingDate"
		 FROM "EnergyDevice" d
		 JOIN "Pond" p ON p.id = d."pondId"
		 LEFT JOIN LATERAL (
			SELECT "stockingDate"
			FROM "CropCycle"
			WHERE "pondId" = d."pondId" AND status = 'ACTIVE'
			ORDER BY "createdAt" DESC
			LIMIT 1
		 ) c ON true
		 WHERE d.mac = $1
		 LIMIT 1`,
		DEVICE_MAC,
	);
	const device = devices[0];
	if (!device) throw new Error(`No device found for ${DEVICE_MAC}`);

	if (START_ARG) {
		const parsed = new Date(`${START_ARG}T00:00:00+08:00`);
		if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid --start date: ${START_ARG}`);
		START = parsed;
	} else if (device.stockingDate) {
		START = dayStart(new Date(device.stockingDate));
	} else {
		throw new Error("No active cycle. Pass --start=YYYY-MM-DD.");
	}

	const [feedRows, tempRows] = await Promise.all([
		prisma.$queryRawUnsafe(
			`SELECT id, "recordedAt", "levelPercent", "distanceCm", "dataSource"
			 FROM "FeedLevelLog"
			 WHERE "deviceId" = $1 AND "recordedAt" >= $2 AND "recordedAt" <= $3
			 ORDER BY "recordedAt"`,
			device.id,
			START,
			END,
		),
		prisma.$queryRawUnsafe(
			`SELECT id, "recordedAt", "tempC", "dataSource"
			 FROM "WaterTempLog"
			 WHERE "deviceId" = $1 AND "recordedAt" >= $2 AND "recordedAt" <= $3
			 ORDER BY "recordedAt"`,
			device.id,
			START,
			END,
		),
	]);

	const feedReal = feedRows.filter((row) => row.dataSource === "device");
	const feedReplace = feedRows.filter((row) => row.dataSource !== "device");
	const tempReal = tempRows.filter((row) => row.dataSource === "device");
	const tempReplace = tempRows.filter((row) => row.dataSource !== "device");

	const realFeedHours = new Set(feedReal.map((row) => hourStart(row.recordedAt).toISOString()));
	const realTempHours = new Set(tempReal.map((row) => hourStart(row.recordedAt).toISOString()));

	const endSlot = hourStart(END);
	const slots = [];
	for (let t = START.getTime(); t <= endSlot.getTime(); t += HOUR) {
		const slot = new Date(t);
		// Do not write into the current minute; the live reading already owns it.
		if (slot.getTime() + 60_000 > END.getTime()) continue;
		slots.push(slot);
	}

	const feedMissingSlots = slots.filter((slot) => !realFeedHours.has(slot.toISOString()));
	const tempMissingSlots = slots.filter((slot) => !realTempHours.has(slot.toISOString()));
	const feedAnchors = feedReal.map((row) => ({
		time: row.recordedAt.getTime(),
		value: row.levelPercent,
	}));
	const tempAnchors = tempReal.map((row) => ({ time: row.recordedAt.getTime(), value: row.tempC }));

	const feedSegments = segmentSlots(feedMissingSlots, feedAnchors);
	const tempSegments = segmentSlots(tempMissingSlots, tempAnchors);

	const feedGenerated = [];
	for (const segment of feedSegments) {
		const values = simulateFeed(segment, 60, device.feedLevelPercent ?? 50);
		segment.slots.forEach((slot, index) => {
			const level = values[index];
			const distance =
				device.hopperEmptyCm != null && device.hopperFullCm != null
					? device.hopperEmptyCm -
						(level / 100) * (device.hopperEmptyCm - device.hopperFullCm) +
						(level - 50) * 0.002
					: 0;
			feedGenerated.push({
				id: randomUUID(),
				deviceId: device.id,
				levelPercent: round(level, 1),
				distanceCm: round(clamp(distance, 1.5, 27), 2),
				recordedAt: new Date(slot.getTime() + 60_000),
				dataSource: "synthetic",
				farmId: device.farmId,
			});
		});
	}

	const tempGenerated = [];
	for (const segment of tempSegments) {
		const values = simulateTemp(segment, device.waterTempC ?? null);
		segment.slots.forEach((slot, index) => {
			tempGenerated.push({
				id: randomUUID(),
				deviceId: device.id,
				tempC: round(values[index], 2),
				recordedAt: new Date(slot.getTime() + 60_000),
				dataSource: "synthetic",
				farmId: device.farmId,
			});
		});
	}

	const feedRefills = feedGenerated.filter((row, index) => {
		const prev = feedGenerated[index - 1];
		return prev && row.levelPercent - prev.levelPercent > 20;
	}).length;
	const tempDeltas = tempGenerated
		.slice(1)
		.map((row, index) => Math.abs(row.tempC - tempGenerated[index].tempC));
	const maxTempDelta = tempDeltas.length ? Math.max(...tempDeltas) : 0;

	const summary = {
		mode: APPLY ? "apply" : "dry-run",
		device: { id: device.id, mac: DEVICE_MAC, pondId: device.pondId, farmId: device.farmId },
		range: { start: START.toISOString(), end: END.toISOString() },
		feed: {
			existingReal: feedReal.length,
			existingReplaced: feedReplace.length,
			missingHours: feedMissingSlots.length,
			willInsert: feedGenerated.length,
			refills: feedRefills,
			min: feedGenerated.length ? Math.min(...feedGenerated.map((row) => row.levelPercent)) : null,
			max: feedGenerated.length ? Math.max(...feedGenerated.map((row) => row.levelPercent)) : null,
			avg: feedGenerated.length
				? round(
						feedGenerated.reduce((sum, row) => sum + row.levelPercent, 0) / feedGenerated.length,
						1,
					)
				: null,
		},
		temp: {
			existingReal: tempReal.length,
			existingReplaced: tempReplace.length,
			missingHours: tempMissingSlots.length,
			willInsert: tempGenerated.length,
			min: tempGenerated.length ? Math.min(...tempGenerated.map((row) => row.tempC)) : null,
			max: tempGenerated.length ? Math.max(...tempGenerated.map((row) => row.tempC)) : null,
			avg: tempGenerated.length
				? round(tempGenerated.reduce((sum, row) => sum + row.tempC, 0) / tempGenerated.length, 2)
				: null,
			maxHourDelta: round(maxTempDelta, 2),
		},
	};

	console.log(JSON.stringify(summary, null, 2));
	console.log(
		"feed samples:",
		JSON.stringify(
			feedGenerated.slice(0, 5).map((row) => [row.recordedAt.toISOString(), row.levelPercent]),
		),
		JSON.stringify(
			feedGenerated.slice(-5).map((row) => [row.recordedAt.toISOString(), row.levelPercent]),
		),
	);
	console.log(
		"temp samples:",
		JSON.stringify(
			tempGenerated.slice(0, 5).map((row) => [row.recordedAt.toISOString(), row.tempC]),
		),
		JSON.stringify(tempGenerated.slice(-5).map((row) => [row.recordedAt.toISOString(), row.tempC])),
	);

	if (!APPLY) return;

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupDir = path.join(os.tmpdir(), "opencode");
	fs.mkdirSync(backupDir, { recursive: true });
	const backupPath = path.join(backupDir, `chart-backfill-${stamp}.json`);
	fs.writeFileSync(
		backupPath,
		JSON.stringify(
			{
				createdAt: new Date().toISOString(),
				device,
				deletedFeed: feedReplace,
				deletedTemp: tempReplace,
				insertedFeedIds: feedGenerated.map((row) => row.id),
				insertedTempIds: tempGenerated.map((row) => row.id),
			},
			null,
			2,
		),
	);

	await prisma.$transaction(
		async (tx) => {
			if (feedReplace.length) {
				await tx.feedLevelLog.deleteMany({
					where: { id: { in: feedReplace.map((row) => row.id) } },
				});
			}
			if (tempReplace.length) {
				await tx.waterTempLog.deleteMany({
					where: { id: { in: tempReplace.map((row) => row.id) } },
				});
			}
			for (const batch of chunk(feedGenerated, 500)) {
				await tx.feedLevelLog.createMany({ data: batch });
			}
			for (const batch of chunk(tempGenerated, 500)) {
				await tx.waterTempLog.createMany({ data: batch });
			}
		},
		{ timeout: 120_000 },
	);

	const counts = await prisma.$queryRawUnsafe(
		`SELECT 'feed' AS kind, COUNT(*)::int AS total,
		        COUNT(*) FILTER (WHERE "dataSource" = 'device')::int AS device,
		        COUNT(*) FILTER (WHERE "dataSource" = 'synthetic')::int AS synthetic
		 FROM "FeedLevelLog" WHERE "deviceId" = $1 AND "recordedAt" >= $2 AND "recordedAt" <= $3
		 UNION ALL
		 SELECT 'temp', COUNT(*)::int,
		        COUNT(*) FILTER (WHERE "dataSource" = 'device')::int,
		        COUNT(*) FILTER (WHERE "dataSource" = 'synthetic')::int
		 FROM "WaterTempLog" WHERE "deviceId" = $1 AND "recordedAt" >= $2 AND "recordedAt" <= $3`,
		device.id,
		START,
		END,
	);

	const coverage = await prisma.$queryRawUnsafe(
		`WITH hours AS (
			SELECT generate_series(date_trunc('hour', $2::timestamptz), date_trunc('hour', $3::timestamptz), '1 hour') AS h
		)
		SELECT 'feed' AS kind, COUNT(*)::int AS missing
		FROM hours h
		WHERE NOT EXISTS (
			SELECT 1 FROM "FeedLevelLog" f
			WHERE f."deviceId" = $1 AND f."recordedAt" >= h.h AND f."recordedAt" < h.h + interval '1 hour'
		)
		UNION ALL
		SELECT 'temp', COUNT(*)::int
		FROM hours h
		WHERE NOT EXISTS (
			SELECT 1 FROM "WaterTempLog" w
			WHERE w."deviceId" = $1 AND w."recordedAt" >= h.h AND w."recordedAt" < h.h + interval '1 hour'
		)`,
		device.id,
		START,
		END,
	);

	console.log(JSON.stringify({ backupPath, counts, coverage }, null, 2));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
