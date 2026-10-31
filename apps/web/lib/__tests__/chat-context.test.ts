import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	pondFindFirst: vi.fn(),
	energyDeviceFindFirst: vi.fn(),
	feedEventFindMany: vi.fn(),
	fcrReportFindFirst: vi.fn(),
	biomassLogFindFirst: vi.fn(),
	scheduleCommandFindFirst: vi.fn(),
	cropCycleFindFirst: vi.fn(),
	feedLevelLogFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findFirst: mocks.pondFindFirst },
		energyDevice: { findFirst: mocks.energyDeviceFindFirst },
		feedEvent: { findMany: mocks.feedEventFindMany },
		fcrReport: { findFirst: mocks.fcrReportFindFirst },
		biomassLog: { findFirst: mocks.biomassLogFindFirst },
		scheduleCommand: { findFirst: mocks.scheduleCommandFindFirst },
		cropCycle: { findFirst: mocks.cropCycleFindFirst },
		feedLevelLog: { findMany: mocks.feedLevelLogFindMany },
	},
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
}));

vi.mock("@/lib/growth-plan-loader", () => ({
	loadGrowthPlanForPond: vi.fn(async () => null),
}));

import { buildChatContext } from "../chat/context";

describe("buildChatContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 20:00 UTC on 27 Oct is 04:00 on 28 Oct in Asia/Manila, so the farm day
		// started at 16:00 UTC on 27 Oct.
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-27T20:00:00.000Z"));

		mocks.pondFindFirst.mockResolvedValue({
			id: "pond-1",
			ownerId: "owner-1",
			name: "Pond A",
			population: 1000,
			feedingRatePct: 3,
			feedsPerDay: 3,
			scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
			scheduleEnd: new Date("1970-01-01T16:00:00.000Z"),
			isFallow: false,
			devices: [],
		});
		mocks.energyDeviceFindFirst.mockResolvedValue({
			id: "device-1",
			isPaused: false,
			feedLevelPercent: 80,
			waterTempC: 28,
			waterTempOk: true,
			lastSeenAt: new Date("2026-10-27T19:59:00.000Z"),
			gramsPerFeeding: 100,
			hopperCapacityG: 5000,
		});
		mocks.feedEventFindMany.mockResolvedValue([]);
		mocks.fcrReportFindFirst.mockResolvedValue(null);
		mocks.biomassLogFindFirst.mockResolvedValue(null);
		mocks.scheduleCommandFindFirst.mockResolvedValue(null);
		mocks.cropCycleFindFirst.mockResolvedValue(null);
		mocks.feedLevelLogFindMany.mockResolvedValue([]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("counts today's feedings from the farm day, not the server day", async () => {
		await buildChatContext("owner-1");

		const todayCall = mocks.feedEventFindMany.mock.calls.find(
			([args]) => args?.select?.grams === undefined,
		);
		expect(todayCall).toBeDefined();
		expect(todayCall?.[0].where.receivedAt.gte).toEqual(new Date("2026-10-27T16:00:00.000Z"));
	});

	it("counts only machine feedings, never an imported hand-fed daily total", async () => {
		await buildChatContext("owner-1");

		for (const [args] of mocks.feedEventFindMany.mock.calls) {
			expect(args.where.source).toEqual({ in: ["scheduled", "dashboard", "button"] });
		}
	});
});
