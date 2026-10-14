import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findUnique: vi.fn(),
		},
		scheduleCommand: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		deviceStateEvent: {
			create: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
		},
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkDeviceRateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { GET } from "@/app/api/schedule-sync/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockScheduleCommand = vi.mocked(prisma.scheduleCommand);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockPond = vi.mocked(prisma.pond);
const mockRateLimit = vi.mocked(checkDeviceRateLimit);

const DEVICE = {
	id: "dev-1",
	mac: "AA:BB:CC:DD:EE:FF",
	pondId: "pond-1",
	gramsPerFeeding: 150,
	buttonFeedGrams: 80,
	hopperEmptyCm: 30,
	hopperFullCm: 5,
	gramsPerSecond: 4,
	tempOffsetC: 0,
	tokenHash: hashToken("test-token"),
};

function syncRequest(deviceId: string = DEVICE.mac, token = "test-token"): Request {
	const url = `http://test.local/api/schedule-sync?device_id=${deviceId}`;
	return new Request(url, {
		method: "GET",
		headers: token !== undefined ? { "x-device-token": token } : {},
	});
}

describe("GET /api/schedule-sync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRateLimit.mockResolvedValue({ success: true } as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockScheduleCommand.findFirst.mockResolvedValue(null);
		mockScheduleCommand.update.mockResolvedValue({} as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockPond.findUnique.mockResolvedValue(null);
	});

	it("returns 401 when the device token header is missing", async () => {
		const res = await GET(
			new Request(`http://test.local/api/schedule-sync?device_id=${DEVICE.mac}`, {
				method: "GET",
			}),
		);
		expect(res.status).toBe(401);
	});

	it("returns 422 when device_id is missing", async () => {
		const res = await GET(
			new Request("http://test.local/api/schedule-sync", {
				method: "GET",
				headers: { "x-device-token": "test-token" },
			}),
		);
		expect(res.status).toBe(422);
	});

	it("returns 429 when the device rate limit is exceeded", async () => {
		mockRateLimit.mockResolvedValue({ success: false } as never);
		const res = await GET(syncRequest());
		expect(res.status).toBe(429);
	});

	it("returns 401 when the token does not resolve to a device", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue(null as never);
		const res = await GET(syncRequest(DEVICE.mac, "wrong-token"));
		expect(res.status).toBe(401);
	});

	it("returns a null baseline when the device has no pond", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE, pondId: null } as never);
		const res = await GET(syncRequest());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.schedule_changed).toBe(false);
		expect(body.command_id).toBeNull();
		expect(body.schedule_start).toBeNull();
		expect(body.feeds_per_day).toBeNull();
	});

	it("marks a pending command as sent and logs a command_sent event", async () => {
		const pending = {
			id: "cmd-1",
			status: "pending",
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
			feedsPerDay: 4,
			feedingRatePct: 4.5,
			createdAt: new Date(),
		};
		mockScheduleCommand.findFirst.mockResolvedValue(pending as never);

		const res = await GET(syncRequest());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.schedule_changed).toBe(true);
		expect(body.command_id).toBe("cmd-1");
		expect(body.schedule_start).toBe("06:00");
		expect(body.schedule_end).toBe("18:00");
		expect(body.feeds_per_day).toBe(4);
		expect(body.feeding_rate_pct).toBe(4.5);

		expect(mockScheduleCommand.update).toHaveBeenCalledWith({
			where: { id: "cmd-1" },
			data: { status: "sent" },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				deviceId: DEVICE.id,
				eventType: "command_sent",
				source: "system",
				metadata: expect.objectContaining({ commandId: "cmd-1" }),
			}),
		});
	});

	it("returns the current pond settings as baseline when no command is pending", async () => {
		mockPond.findUnique.mockResolvedValue({
			scheduleStart: new Date("2024-01-01T07:30:00Z"),
			scheduleEnd: new Date("2024-01-01T17:00:00Z"),
			feedsPerDay: 3,
			feedingRatePct: 3.5,
		} as never);

		const res = await GET(syncRequest());
		const body = await res.json();
		expect(body.schedule_changed).toBe(false);
		expect(body.command_id).toBeNull();
		expect(body.schedule_start).toBe("07:30");
		expect(body.schedule_end).toBe("17:00");
		expect(body.feeds_per_day).toBe(3);
		expect(body.feeding_rate_pct).toBe(3.5);
		expect(mockScheduleCommand.update).not.toHaveBeenCalled();
	});

	it("clamps out-of-range schedule values from a command", async () => {
		mockScheduleCommand.findFirst.mockResolvedValue({
			id: "cmd-2",
			status: "pending",
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
			feedsPerDay: 999,
			feedingRatePct: 0.01,
			createdAt: new Date(),
		} as never);

		const res = await GET(syncRequest());
		const body = await res.json();
		// Clamped to FEEDS_PER_DAY_MAX (24) and FEEDING_RATE_PCT_MIN (0.1)
		expect(body.feeds_per_day).toBe(24);
		expect(body.feeding_rate_pct).toBe(0.1);
	});

	it("returns safe default schedule when the route throws", async () => {
		mockEnergyDevice.findUnique.mockRejectedValue(new Error("db down") as never);
		const res = await GET(syncRequest());
		const body = await res.json();
		expect(body.schedule_changed).toBe(false);
		expect(body.command_id).toBeNull();
		expect(body.feeds_per_day).toBeNull();
		expect(body.grams_per_feeding).toBe(150);
		expect(body.grams_per_second).toBe(4.0);
	});
});
