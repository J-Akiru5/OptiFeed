import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findUnique: vi.fn(),
		},
		scheduleCommand: {
			findFirst: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		deviceStateEvent: {
			create: vi.fn(),
			findFirst: vi.fn(),
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
	approvalStatus: "APPROVED",
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
		mockScheduleCommand.updateMany.mockResolvedValue({ count: 1 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null);
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
		expect(await res.text()).toBe("Too Many Requests");
		// Consumed only after verification and keyed on the verified mac.
		expect(mockRateLimit).toHaveBeenCalledTimes(1);
		expect(mockRateLimit).toHaveBeenCalledWith(DEVICE.mac, "schedule");
		expect(mockScheduleCommand.findFirst).not.toHaveBeenCalled();
	});

	it("returns 401 when the token does not resolve to a device", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue(null as never);
		const res = await GET(syncRequest(DEVICE.mac, "wrong-token"));
		expect(res.status).toBe(401);
		// #330: an unverified token must not touch the named device's budget.
		expect(mockRateLimit).not.toHaveBeenCalled();
	});

	it("returns 401 when the token resolves to a different mac than device_id", async () => {
		const res = await GET(syncRequest("11:22:33:44:55:66"));
		expect(res.status).toBe(401);
		// #330: naming another device's MAC with a valid token of your own does
		// not spend that device's bucket.
		expect(mockRateLimit).not.toHaveBeenCalled();
	});

	it("#330: an unauthenticated flood cannot exhaust a verified device's bucket", async () => {
		// Mirrors the real limiter's 20/min ceiling: before the fix, attacker
		// traffic keyed on the victim MAC pushed the counter past it and the
		// real device's next poll came back 429.
		let consumed = 0;
		mockRateLimit.mockImplementation(async () => {
			consumed += 1;
			return { success: consumed <= 20, remaining: Math.max(0, 20 - consumed) } as never;
		});

		mockEnergyDevice.findUnique.mockResolvedValue(null as never);
		for (let i = 0; i < 25; i += 1) {
			const res = await GET(syncRequest(DEVICE.mac, "attacker-token"));
			expect(res.status).toBe(401);
		}
		expect(mockRateLimit).not.toHaveBeenCalled();

		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		const res = await GET(syncRequest());
		expect(res.status).toBe(200);
		expect(mockRateLimit).toHaveBeenCalledTimes(1);
		expect(mockRateLimit).toHaveBeenCalledWith(DEVICE.mac, "schedule");
	});

	it("returns 403 for a PENDING device (org approval policy)", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			approvalStatus: "PENDING",
		} as never);

		const res = await GET(syncRequest());
		expect(res.status).toBe(403);
		expect(mockScheduleCommand.findFirst).not.toHaveBeenCalled();
	});

	it("returns the current server time and no manual calibration by default", async () => {
		const res = await GET(syncRequest());
		const body = await res.json();
		expect(typeof body.server_time).toBe("string");
		expect(Number.isNaN(Date.parse(body.server_time))).toBe(false);
		expect(body.time_sync).toBeNull();
		expect(mockDeviceStateEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					deviceId: DEVICE.id,
					eventType: "set_time",
					source: "user",
					deviceTime: { not: null },
				}),
			}),
		);
		expect(mockRateLimit).toHaveBeenCalledWith(DEVICE.mac, "schedule");
	});

	it("returns a recent manual calibration so the device applies it", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			deviceTime: "2026-10-25T08:25:00.000Z",
		} as never);

		const res = await GET(syncRequest());
		const body = await res.json();
		expect(body.time_sync).toBe("2026-10-25T08:25:00.000Z");
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

		expect(mockScheduleCommand.updateMany).toHaveBeenCalledWith({
			where: { id: "cmd-1", status: "pending" },
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

	it("re-serves an already-sent command without logging command_sent again", async () => {
		// The device keeps polling until it acks; the command must stay in the
		// response, but the audit row is written once per transition.
		mockScheduleCommand.findFirst.mockResolvedValue({
			id: "cmd-2",
			status: "sent",
			scheduleStart: new Date("2024-01-01T06:00:00Z"),
			scheduleEnd: new Date("2024-01-01T18:00:00Z"),
			feedsPerDay: 4,
			feedingRatePct: 4.5,
			createdAt: new Date(),
		} as never);
		mockScheduleCommand.updateMany.mockResolvedValue({ count: 0 } as never);

		const res = await GET(syncRequest());

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.schedule_changed).toBe(true);
		expect(body.command_id).toBe("cmd-2");
		const sentEvents = mockDeviceStateEvent.create.mock.calls.filter(
			([arg]) => (arg as { data: { eventType: string } }).data.eventType === "command_sent",
		);
		expect(sentEvents).toHaveLength(0);
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
