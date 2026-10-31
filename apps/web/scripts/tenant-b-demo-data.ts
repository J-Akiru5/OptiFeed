import { addDays, dateOnlyToUtcDate, todayDateOnly } from "../lib/crop-cycle/dates";

/**
 * Demo dataset for the second tenant (issue #418).
 *
 * The live database already carries a `tenant2-admin` account ("Tenant B
 * Admin") that owns the "Tenant B Fisheries" organization, but it has no farm
 * and no ponds, so logging in as that account shows an empty dashboard and an
 * almost empty tenant console. This module builds the data that makes the
 * organization model visible in a presentation:
 *
 * - two members with different roles (the admin and an operator),
 * - three ponds spread over two farms, so the admin console shows a farm
 *   hierarchy instead of a single pond,
 * - a device fleet with two healthy feeders, one weak-signal feeder and one
 *   feeder that has gone silent, so the fleet-health chart is not a single
 *   uniform colour,
 * - and enough history (feeding, feed level, water temperature, biomass, FCR,
 *   crop cycles, calendar events, notifications, device events, schedule
 *   commands and calibration runs) that every chart on the dashboard and in
 *   the tenant console has something to draw.
 *
 * Everything here is a pure function of `now`: no clock reads, no randomness
 * and no database access, so the same input always produces the same dataset
 * and the unit tests can assert on it exactly.
 *
 * Rows that belong to a device are keyed by that device's MAC address
 * (`deviceMac`) rather than by its database id, because the ids are only known
 * once the runner has written the devices. The runner resolves them.
 */

/** Login slug of the tenant admin. Matches the account already in the database. */
export const TENANT_B_ADMIN_FARM_ID = "tenant2-admin";

/** Login slug of the second member created for the organization. */
export const TENANT_B_OPERATOR_FARM_ID = "tenant2-operator";

/** Id of the organization, used only when it has to be created. */
export const TENANT_B_ORG_ID = "demo-org-tenant-b";

/** Display name of the organization. */
export const TENANT_B_ORG_NAME = "Tenant B Fisheries";

/** Stable pond ids so a re-run replaces the demo rows instead of duplicating them. */
export const TENANT_B_POND_IDS = {
	alpha: "demo-tenant-b-pond-alpha",
	bravo: "demo-tenant-b-pond-bravo",
	gamma: "demo-tenant-b-pond-gamma",
} as const;

/**
 * Stable MAC addresses for the demo feeders. They are deliberately outside the
 * ranges used by the other fixtures (`DE:AD:DE:MO:00:01` for demo-farmer-1,
 * `E2:E0:00:00:00:0x` for the e2e suite) so the three sets never collide.
 */
export const TENANT_B_DEVICE_MACS = {
	alpha: "DE:AD:DE:MO:00:B1",
	bravo: "DE:AD:DE:MO:00:B2",
	gamma: "DE:AD:DE:MO:00:B3",
} as const;

/** Device tokens. Dev-only placeholders, never real feeder credentials. */
export const TENANT_B_DEVICE_TOKENS = {
	alpha: "demo-token-tenant-b-001",
	bravo: "demo-token-tenant-b-002",
	gamma: "demo-token-tenant-b-003",
} as const;

/** The three demo ponds, keyed by a short name the dataset builder uses. */
export type TenantBPondKey = keyof typeof TENANT_B_POND_IDS;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function hoursAgo(now: Date, hours: number): Date {
	return new Date(now.getTime() - hours * HOUR_MS);
}

function daysAgo(now: Date, days: number): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

/** A repeatable wobble in [-1, 1] so the series look measured, not generated. */
function wobble(seed: number, step: number): number {
	return Math.sin(seed * 1.7 + step * 0.9);
}

export type TenantBPondSeed = {
	id: string;
	key: TenantBPondKey;
	name: string;
	ownerFarmId: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population: number;
	scheduleStart: Date;
	scheduleEnd: Date;
};

export type TenantBDeviceSeed = {
	mac: string;
	token: string;
	label: string;
	pondId: string;
	gramsPerFeeding: number;
	feedLevelPercent: number;
	feedLevelCm: number;
	waterTempC: number | null;
	wifiRssiDbm: number | null;
	hopperCapacityG: number;
	/** Minutes since the last heartbeat. A large value makes the unit read offline. */
	silenceMinutes: number;
};

export type TenantBFeedPairSeed = {
	deviceMac: string;
	grams: number;
	source: string;
	receivedAt: Date;
};

export type TenantBFeedLevelSeed = {
	deviceMac: string;
	levelPercent: number;
	distanceCm: number;
	recordedAt: Date;
};

export type TenantBWaterTempSeed = {
	deviceMac: string;
	tempC: number;
	recordedAt: Date;
};

export type TenantBBiomassSeed = {
	pondId: string;
	sampleWeightKg: number;
	sampleLengthCm: number;
	sampleCount: number;
	avgWeightKg: number;
	batchLabel: string;
	recordedAt: Date;
	fish: { weightGrams: number; lengthCm: number }[];
};

export type TenantBFcrSeed = {
	pondId: string;
	periodStart: Date;
	periodEnd: Date;
	totalFeedKg: number;
	biomassGainKg: number;
	fcrValue: number;
};

export type TenantBCropCycleSeed = {
	pondId: string;
	label: string;
	stockingDate: Date;
	stockingCount: number;
	stockingAvgWeightG: number;
	growOutDays: number;
	targetHarvestDate: Date;
	expectedSurvivalPct: number;
	notes: string;
};

export type TenantBPondEventSeed = {
	pondId: string;
	type: "HARVEST_PLANNED" | "SAMPLING" | "STOCKING";
	status: "DONE" | "PLANNED";
	title: string;
	startsAt: Date;
	notes: string;
	reminderMinutes: number[];
};

export type TenantBNotificationSeed = {
	pondId: string;
	tier: "CRITICAL" | "INFO" | "WARNING";
	message: string;
	linkTo: string;
	category: string;
	read: boolean;
	createdAt: Date;
};

export type TenantBDeviceStateEventSeed = {
	deviceMac: string;
	eventType: string;
	source: "device" | "system" | "user";
	deviceTime: string;
	createdAt: Date;
};

export type TenantBScheduleCommandSeed = {
	deviceMac: string;
	pondId: string;
	scheduleStart: Date;
	scheduleEnd: Date;
	feedsPerDay: number;
	feedingRatePct: number;
	status: "acked" | "applied" | "sent";
	appliedAt: Date;
	deviceTime: string;
	createdAt: Date;
};

export type TenantBCalibrationSeed = {
	deviceMac: string;
	sessionId: string;
	attempt: number;
	kind: "RATE_TEST" | "TARGET_CHECK";
	durationMs: number;
	targetGrams: number | null;
	measuredGrams: number;
	gramsPerSecondBefore: number;
	gramsPerSecondAfter: number;
	errorPct: number;
	accepted: boolean;
	createdAt: Date;
};

export type TenantBDemoData = {
	ponds: TenantBPondSeed[];
	devices: TenantBDeviceSeed[];
	feedPairs: TenantBFeedPairSeed[];
	feedLevelLogs: TenantBFeedLevelSeed[];
	waterTempLogs: TenantBWaterTempSeed[];
	biomassLogs: TenantBBiomassSeed[];
	fcrReports: TenantBFcrSeed[];
	cropCycles: TenantBCropCycleSeed[];
	pondEvents: TenantBPondEventSeed[];
	notifications: TenantBNotificationSeed[];
	deviceStateEvents: TenantBDeviceStateEventSeed[];
	scheduleCommands: TenantBScheduleCommandSeed[];
	calibrationRuns: TenantBCalibrationSeed[];
};

type PondProfile = {
	key: TenantBPondKey;
	id: string;
	name: string;
	ownerFarmId: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population: number;
	gramsPerFeeding: number;
	feedDays: number;
	levelPoints: number;
	/** Feed level at the oldest reading; the series declines towards it. */
	levelStart: number;
	levelEnd: number;
	waterTempBase: number;
	batchLabel: string;
};

const POND_PROFILES: PondProfile[] = [
	{
		key: "alpha",
		id: TENANT_B_POND_IDS.alpha,
		name: "Tenant B Pond Alpha",
		ownerFarmId: TENANT_B_ADMIN_FARM_ID,
		feedingRatePct: 3.5,
		feedsPerDay: 4,
		population: 1200,
		gramsPerFeeding: 150,
		feedDays: 14,
		levelPoints: 45,
		levelStart: 94,
		levelEnd: 41,
		waterTempBase: 28.4,
		batchLabel: "Batch 2026-08",
	},
	{
		key: "bravo",
		id: TENANT_B_POND_IDS.bravo,
		name: "Tenant B Pond Bravo",
		ownerFarmId: TENANT_B_ADMIN_FARM_ID,
		feedingRatePct: 3,
		feedsPerDay: 3,
		population: 800,
		gramsPerFeeding: 120,
		feedDays: 14,
		levelPoints: 45,
		levelStart: 88,
		levelEnd: 33,
		waterTempBase: 27.9,
		batchLabel: "Batch 2026-09",
	},
	{
		key: "gamma",
		id: TENANT_B_POND_IDS.gamma,
		name: "Tenant B Pond Gamma",
		ownerFarmId: TENANT_B_OPERATOR_FARM_ID,
		feedingRatePct: 2.5,
		feedsPerDay: 2,
		population: 400,
		gramsPerFeeding: 100,
		feedDays: 7,
		levelPoints: 20,
		levelStart: 71,
		levelEnd: 18,
		waterTempBase: 28.9,
		batchLabel: "Batch 2026-10",
	},
];

type DeviceProfile = {
	mac: string;
	token: string;
	label: string;
	pondId: string;
	gramsPerFeeding: number;
	feedLevelPercent: number;
	feedLevelCm: number;
	waterTempC: number | null;
	wifiRssiDbm: number | null;
	hopperCapacityG: number;
	silenceMinutes: number;
};

const DEVICE_PROFILES: Record<TenantBPondKey, DeviceProfile> = {
	alpha: {
		mac: TENANT_B_DEVICE_MACS.alpha,
		token: TENANT_B_DEVICE_TOKENS.alpha,
		label: "Tenant B Feeder Alpha",
		pondId: TENANT_B_POND_IDS.alpha,
		gramsPerFeeding: 150,
		feedLevelPercent: 62,
		feedLevelCm: 12.4,
		waterTempC: 28.6,
		wifiRssiDbm: -58,
		hopperCapacityG: 7000,
		silenceMinutes: 2,
	},
	bravo: {
		mac: TENANT_B_DEVICE_MACS.bravo,
		token: TENANT_B_DEVICE_TOKENS.bravo,
		label: "Tenant B Feeder Bravo",
		pondId: TENANT_B_POND_IDS.bravo,
		gramsPerFeeding: 120,
		feedLevelPercent: 45,
		feedLevelCm: 15.1,
		waterTempC: 27.8,
		wifiRssiDbm: -84,
		hopperCapacityG: 5000,
		silenceMinutes: 3,
	},
	gamma: {
		mac: TENANT_B_DEVICE_MACS.gamma,
		token: TENANT_B_DEVICE_TOKENS.gamma,
		label: "Tenant B Feeder Gamma",
		pondId: TENANT_B_POND_IDS.gamma,
		gramsPerFeeding: 100,
		feedLevelPercent: 19,
		feedLevelCm: 22.7,
		waterTempC: null,
		wifiRssiDbm: null,
		hopperCapacityG: 4000,
		silenceMinutes: 45,
	},
};

/** The date the device last reported, derived from its silence window. */
export function deviceLastSeenAt(device: TenantBDeviceSeed, now: Date): Date {
	return new Date(now.getTime() - device.silenceMinutes * 60 * 1000);
}

function buildPonds(): TenantBPondSeed[] {
	return POND_PROFILES.map((profile) => ({
		id: profile.id,
		key: profile.key,
		name: profile.name,
		ownerFarmId: profile.ownerFarmId,
		feedingRatePct: profile.feedingRatePct,
		feedsPerDay: profile.feedsPerDay,
		population: profile.population,
		scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
		scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
	}));
}

function buildDevices(): TenantBDeviceSeed[] {
	return POND_PROFILES.map((profile) => {
		const device = DEVICE_PROFILES[profile.key];
		return {
			mac: device.mac,
			token: device.token,
			label: device.label,
			pondId: device.pondId,
			gramsPerFeeding: device.gramsPerFeeding,
			feedLevelPercent: device.feedLevelPercent,
			feedLevelCm: device.feedLevelCm,
			waterTempC: device.waterTempC,
			wifiRssiDbm: device.wifiRssiDbm,
			hopperCapacityG: device.hopperCapacityG,
			silenceMinutes: device.silenceMinutes,
		};
	});
}

function buildFeedPairs(now: Date): TenantBFeedPairSeed[] {
	const pairs: TenantBFeedPairSeed[] = [];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		for (let day = profile.feedDays; day >= 1; day--) {
			for (let feed = 0; feed < profile.feedsPerDay; feed++) {
				const receivedAt = daysAgo(now, day);
				receivedAt.setUTCHours(6 + feed * 4, 0, 0, 0);
				// One manual feed and one dashboard feed per pond, so the feed
				// chart is not a single flat "scheduled" band.
				const source =
					feed === profile.feedsPerDay - 1
						? "dashboard"
						: feed === 1 && profile.feedsPerDay > 2
							? "button"
							: "scheduled";
				pairs.push({
					deviceMac: device.mac,
					grams: profile.gramsPerFeeding,
					source,
					receivedAt,
				});
			}
		}
	}

	return pairs;
}

function buildFeedLevelLogs(now: Date): TenantBFeedLevelSeed[] {
	const logs: TenantBFeedLevelSeed[] = [];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		for (let i = profile.levelPoints; i >= 1; i--) {
			const progress = (profile.levelPoints - i) / (profile.levelPoints - 1);
			const levelPercent = Math.max(
				profile.levelEnd,
				profile.levelStart - (profile.levelStart - profile.levelEnd) * progress,
			);
			logs.push({
				deviceMac: device.mac,
				levelPercent: Number(levelPercent.toFixed(1)),
				distanceCm: Number((5 + (profile.levelStart - levelPercent) * 0.35).toFixed(2)),
				recordedAt: daysAgo(now, i * 0.25),
			});
		}
	}

	return logs;
}

function buildWaterTempLogs(now: Date): TenantBWaterTempSeed[] {
	const logs: TenantBWaterTempSeed[] = [];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		if (device.waterTempC === null) continue;
		for (let day = 13; day >= 0; day--) {
			for (const hour of [6, 12, 18]) {
				const recordedAt = daysAgo(now, day);
				recordedAt.setUTCHours(hour, 0, 0, 0);
				const tempC = profile.waterTempBase + wobble(profile.feedsPerDay, day + hour) * 0.9;
				logs.push({
					deviceMac: device.mac,
					tempC: Number(tempC.toFixed(2)),
					recordedAt,
				});
			}
		}
	}

	return logs;
}

function buildBiomassLogs(now: Date): TenantBBiomassSeed[] {
	const logs: TenantBBiomassSeed[] = [];

	for (const profile of POND_PROFILES) {
		const weeks = profile.key === "gamma" ? 2 : 4;
		for (let week = weeks; week >= 1; week--) {
			const avgWeightGrams = 90 + (weeks - week + 1) * 55;
			const recordedAt = daysAgo(now, week * 7);
			const sampleCount = 4;
			const fish = Array.from({ length: sampleCount }, (_, index) => {
				const spread = wobble(profile.feedsPerDay + index, week) * 0.12;
				return {
					weightGrams: Number((avgWeightGrams * (1 + spread)).toFixed(1)),
					lengthCm: Number((8 + (avgWeightGrams / 45) * (1 + spread)).toFixed(1)),
				};
			});
			logs.push({
				pondId: profile.id,
				sampleWeightKg: Number(((avgWeightGrams * sampleCount) / 1000).toFixed(3)),
				sampleLengthCm: Number(
					(fish.reduce((sum, entry) => sum + entry.lengthCm, 0) / sampleCount).toFixed(1),
				),
				sampleCount,
				avgWeightKg: Number((avgWeightGrams / 1000).toFixed(3)),
				batchLabel: profile.batchLabel,
				recordedAt,
				fish,
			});
		}
	}

	return logs;
}

function buildFcrReports(now: Date): TenantBFcrSeed[] {
	const reports: TenantBFcrSeed[] = [];

	for (const profile of POND_PROFILES) {
		const periods = profile.key === "gamma" ? 1 : 3;
		for (let period = periods; period >= 1; period--) {
			const fcrValue = Number((1.9 - (periods - period) * 0.2).toFixed(2));
			const totalFeedKg = Number((150 + period * 20).toFixed(1));
			reports.push({
				pondId: profile.id,
				periodStart: daysAgo(now, period * 10 + 10),
				periodEnd: daysAgo(now, period * 10),
				totalFeedKg,
				biomassGainKg: Number((totalFeedKg / fcrValue).toFixed(1)),
				fcrValue,
			});
		}
	}

	return reports;
}

function buildCropCycles(now: Date): TenantBCropCycleSeed[] {
	const today = todayDateOnly(now);
	const growOutDays = 135;

	return POND_PROFILES.map((profile) => {
		const stockedDaysAgo = profile.key === "gamma" ? 12 : 46;
		const stockingDate = addDays(today, -stockedDaysAgo);
		return {
			pondId: profile.id,
			label: profile.batchLabel,
			stockingDate: dateOnlyToUtcDate(stockingDate),
			stockingCount: profile.population,
			stockingAvgWeightG: profile.key === "gamma" ? 38 : 45,
			growOutDays,
			targetHarvestDate: dateOnlyToUtcDate(addDays(stockingDate, growOutDays)),
			expectedSurvivalPct: 92,
			notes: "Demo grow-out cycle for the Tenant B presentation.",
		};
	});
}

function buildPondEvents(now: Date): TenantBPondEventSeed[] {
	const today = todayDateOnly(now);
	const events: TenantBPondEventSeed[] = [];

	for (const profile of POND_PROFILES) {
		const stockedDaysAgo = profile.key === "gamma" ? 12 : 46;
		const stockingDate = addDays(today, -stockedDaysAgo);
		events.push({
			pondId: profile.id,
			type: "STOCKING",
			status: "DONE",
			title: "Stocking",
			startsAt: dateOnlyToUtcDate(stockingDate),
			notes: `Stocked ${profile.population} fingerlings.`,
			reminderMinutes: [],
		});
		events.push({
			pondId: profile.id,
			type: "SAMPLING",
			status: "PLANNED",
			title: "Sampling",
			startsAt: dateOnlyToUtcDate(addDays(today, 5)),
			notes: "Weight sample to update the growth projection.",
			reminderMinutes: [1440],
		});
		events.push({
			pondId: profile.id,
			type: "HARVEST_PLANNED",
			status: "PLANNED",
			title: "Harvest planned",
			startsAt: dateOnlyToUtcDate(addDays(stockingDate, 135)),
			notes: "Target harvest date for the current grow-out cycle.",
			reminderMinutes: [1440, 60],
		});
	}

	return events;
}

function buildNotifications(now: Date): TenantBNotificationSeed[] {
	const notifications: TenantBNotificationSeed[] = [];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		if (device.wifiRssiDbm === null) {
			notifications.push({
				pondId: profile.id,
				tier: "CRITICAL",
				message: `${device.label} has not reported for 45 minutes. Feeding is paused until it reconnects.`,
				linkTo: "/dashboard",
				category: "connectivity",
				read: false,
				createdAt: hoursAgo(now, 44),
			});
			continue;
		}
		notifications.push({
			pondId: profile.id,
			tier: "WARNING",
			message: `${device.label} is running low on feed. Refill before the next scheduled meal.`,
			linkTo: "/dashboard",
			category: "pellet",
			read: false,
			createdAt: hoursAgo(now, 6),
		});
		notifications.push({
			pondId: profile.id,
			tier: "INFO",
			message: `Feeding schedule applied for ${profile.name}. ${profile.feedsPerDay} meals a day.`,
			linkTo: "/dashboard/schedule",
			category: "schedule",
			read: true,
			createdAt: daysAgo(now, 1),
		});
	}

	return notifications;
}

function buildDeviceStateEvents(now: Date): TenantBDeviceStateEventSeed[] {
	const events: TenantBDeviceStateEventSeed[] = [];
	const cycle = [
		"connected",
		"schedule_applied",
		"command_sent",
		"command_acked",
		"feed_dispensed",
		"pge_reading",
	];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		const count = profile.key === "gamma" ? 6 : 24;
		for (let i = count; i >= 1; i--) {
			const createdAt = daysAgo(now, i * 0.5);
			events.push({
				deviceMac: device.mac,
				eventType: cycle[i % cycle.length],
				source: "device",
				deviceTime: createdAt.toISOString(),
				createdAt,
			});
		}
	}

	return events;
}

function buildScheduleCommands(now: Date): TenantBScheduleCommandSeed[] {
	const commands: TenantBScheduleCommandSeed[] = [];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		for (const [index, status] of ["applied", "acked"].entries()) {
			const createdAt = daysAgo(now, index + 2);
			commands.push({
				deviceMac: device.mac,
				pondId: profile.id,
				scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
				scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
				feedsPerDay: profile.feedsPerDay,
				feedingRatePct: profile.feedingRatePct,
				status: status as "acked" | "applied",
				appliedAt: createdAt,
				deviceTime: createdAt.toISOString(),
				createdAt,
			});
		}
	}

	return commands;
}

function buildCalibrationRuns(now: Date): TenantBCalibrationSeed[] {
	const runs: TenantBCalibrationSeed[] = [];

	for (const profile of POND_PROFILES) {
		const device = DEVICE_PROFILES[profile.key];
		const before = 4;
		const after = Number((4 + wobble(profile.feedsPerDay, 1) * 0.15).toFixed(2));
		const targetGrams = 150;
		const measuredGrams = Number(
			(targetGrams * (1 + wobble(profile.feedsPerDay, 2) * 0.06)).toFixed(1),
		);
		runs.push({
			deviceMac: device.mac,
			sessionId: `demo-tenant-b-cal-${profile.key}`,
			attempt: 1,
			kind: "RATE_TEST",
			durationMs: 37_500,
			targetGrams: null,
			measuredGrams: 150,
			gramsPerSecondBefore: before,
			gramsPerSecondAfter: after,
			errorPct: 0,
			accepted: true,
			createdAt: daysAgo(now, 9),
		});
		runs.push({
			deviceMac: device.mac,
			sessionId: `demo-tenant-b-cal-${profile.key}`,
			attempt: 2,
			kind: "TARGET_CHECK",
			durationMs: 9_200,
			targetGrams,
			measuredGrams,
			gramsPerSecondBefore: after,
			gramsPerSecondAfter: after,
			errorPct: Number(((Math.abs(measuredGrams - targetGrams) / targetGrams) * 100).toFixed(1)),
			accepted: true,
			createdAt: daysAgo(now, 8),
		});
	}

	return runs;
}

/**
 * Build the whole Tenant B demo dataset.
 *
 * `now` is injected so the dataset is reproducible and so the tests can assert
 * on exact dates.
 */
export function buildTenantBDemoData(now: Date): TenantBDemoData {
	return {
		ponds: buildPonds(),
		devices: buildDevices(),
		feedPairs: buildFeedPairs(now),
		feedLevelLogs: buildFeedLevelLogs(now),
		waterTempLogs: buildWaterTempLogs(now),
		biomassLogs: buildBiomassLogs(now),
		fcrReports: buildFcrReports(now),
		cropCycles: buildCropCycles(now),
		pondEvents: buildPondEvents(now),
		notifications: buildNotifications(now),
		deviceStateEvents: buildDeviceStateEvents(now),
		scheduleCommands: buildScheduleCommands(now),
		calibrationRuns: buildCalibrationRuns(now),
	};
}
