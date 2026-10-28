import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findFirst: vi.fn() },
		feedEvent: { aggregate: vi.fn() },
		biomassLog: { findFirst: vi.fn() },
		fcrReport: { findFirst: vi.fn() },
	},
}));

vi.mock("@/lib/device-firmware", () => ({
	getDeviceFirmwareVersion: vi.fn(),
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prediction", () => ({
	computeDeterministicPrediction: vi.fn(() => ({
		grams: null,
		confidence: "low",
		reasoning: "",
	})),
}));

import { getDeviceFirmwareVersion } from "@/lib/device-firmware";
import { loadFeederHero } from "@/lib/feeder-hero";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockBiomassLog = vi.mocked(prisma.biomassLog);
const mockFcrReport = vi.mocked(prisma.fcrReport);
const mockFirmware = vi.mocked(getDeviceFirmwareVersion);
const mockSchedule = vi.mocked(resolveCurrentSchedule);

/** A `@db.Time` value read back by Prisma: the wall clock sits in UTC. */
function time(hours: number, minutes = 0): Date {
	return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
}

describe("loadFeederHero — next feed is farm wall clock", () => {
	it("uses Manila time on the hero regardless of the host timezone", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue({
			id: "dev-1",
			label: "Feeder A",
			lastSeenAt: new Date("2026-10-27T14:00:00.000Z"),
			isPaused: false,
			feedLevelPercent: 80,
			feedLevelUpdatedAt: new Date("2026-10-27T14:00:00.000Z"),
			waterTempC: null,
			waterTempOk: false,
			waterTempUpdatedAt: null,
			gramsPerFeeding: 150,
			hopperCapacityG: 1000,
			dailyCapG: 2000,
		} as never);
		mockFeedEvent.aggregate.mockResolvedValue({ _sum: { grams: 0 } } as never);
		mockBiomassLog.findFirst.mockResolvedValue(null as never);
		mockFcrReport.findFirst.mockResolvedValue(null as never);
		mockFirmware.mockResolvedValue(null);
		mockSchedule.mockResolvedValue({
			scheduleStart: time(6),
			scheduleEnd: time(16),
			feedsPerDay: 3,
			feedingRatePct: 3,
		});

		// 14:30 UTC is 22:30 in Manila, after the last 16:00 feed. A host-local
		// (UTC) comparison would still claim today's 16:00 slot; the farm wall
		// clock correctly rolls over to 06:00 tomorrow.
		const hero = await loadFeederHero({
			pond: {
				id: "pond-1",
				isFallow: false,
				population: 300,
				feedingRatePct: 5,
				feedsPerDay: 2,
				scheduleStart: time(6),
				scheduleEnd: time(16),
			},
			deviceId: "dev-1",
			now: new Date("2026-10-27T14:30:00.000Z"),
		});

		expect(hero?.nextFeedSlot).toEqual({ hours: 6, minutes: 0, dayOffset: 1 });
	});
});
