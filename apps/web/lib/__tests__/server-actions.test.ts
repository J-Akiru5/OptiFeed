import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
		},
		feedRequest: {
			create: vi.fn(),
			findFirst: vi.fn(),
			updateMany: vi.fn(),
		},
		deviceStateEvent: {
			create: vi.fn(),
		},
		scheduleCommand: {
			create: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
		},
		biomassLog: {
			create: vi.fn(),
		},
		fishSample: {
			createMany: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
		},
		$transaction: vi.fn((fns: (() => Promise<unknown>)[]) =>
			fns.reduce<Promise<unknown>>((prev, fn) => prev.then(() => fn()), Promise.resolve()),
		),
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	getCurrentPondOwnerIdSafe: vi.fn().mockResolvedValue("test-farm"),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn().mockResolvedValue("en"),
}));

import prisma from "@/lib/prisma";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockScheduleCommand = vi.mocked(prisma.scheduleCommand);

describe("requestFeed", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns error when device not found", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);
		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");
		expect(result).toEqual({ success: false, error: "Device not found" });
	});

	it("creates a feed request with default grams", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockEnergyDevice.findFirst.mockResolvedValue({ gramsPerFeeding: 150 } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.create.mockResolvedValue({ id: "req-1" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({ success: true });
		expect(mockFeedRequest.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				grams: 150,
				status: "pending",
			},
		});
	});

	it("returns message when feed already pending", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockEnergyDevice.findFirst.mockResolvedValue({ gramsPerFeeding: 150 } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.findFirst.mockResolvedValue({ id: "existing-req" } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({ success: true, message: "Feed already pending" });
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("uses custom grams when provided", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockEnergyDevice.findFirst.mockResolvedValue({ gramsPerFeeding: 150 } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.create.mockResolvedValue({ id: "req-1" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1", 200);

		expect(result).toEqual({ success: true });
		expect(mockFeedRequest.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				grams: 200,
				status: "pending",
			},
		});
	});
});

describe("updateScheduleCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns error when device not found", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);
		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 3,
			feedingRatePct: 3.0,
		});
		expect(result).toEqual({ success: false, error: "Device not found or access denied" });
	});

	it("creates a schedule command successfully", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockEnergyDevice.findFirst.mockResolvedValue({ id: "device-1" } as any);
		mockScheduleCommand.findMany.mockResolvedValue([]);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockScheduleCommand.create.mockResolvedValue({ id: "cmd-1" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 3,
			feedingRatePct: 3.0,
		});

		expect(result.success).toBe(true);
		expect(result.commandId).toBe("cmd-1");
		expect(mockScheduleCommand.create).toHaveBeenCalled();
	});

	it("expires stale sent commands before creating new one", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockEnergyDevice.findFirst.mockResolvedValue({ id: "device-1" } as any);
		mockScheduleCommand.findMany.mockResolvedValue([
			{ id: "stale-cmd-1", scheduleStart: new Date(), scheduleEnd: new Date() },
		] as never[]);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockScheduleCommand.update.mockResolvedValue({} as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockScheduleCommand.create.mockResolvedValue({ id: "cmd-2" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "07:00",
			scheduleEnd: "19:00",
			feedsPerDay: 2,
			feedingRatePct: 4.0,
		});

		expect(result.success).toBe(true);
		expect(mockScheduleCommand.update).toHaveBeenCalledWith({
			where: { id: "stale-cmd-1" },
			data: { status: "failed" },
		});
	});
});
