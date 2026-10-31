import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		feedEvent: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		feedLevelLog: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		waterTempLog: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
		},
		feedRequest: {
			findMany: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		deviceStateEvent: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		notification: {
			create: vi.fn(),
			findFirst: vi.fn(),
			updateMany: vi.fn(),
		},
		$transaction: vi.fn(async (input: unknown) => {
			if (Array.isArray(input)) return Promise.all(input);
			return (input as () => Promise<unknown>)();
		}),
	},
}));

vi.mock("@/lib/notify/telegram", () => ({
	sendTelegramMessage: vi.fn().mockResolvedValue(true),
	absoluteAppUrl: vi.fn().mockReturnValue(null),
}));

import { POST } from "@/app/api/ingest/route";
import { PELLET_ALERT_WINDOW_MS } from "@/lib/constants";
import { hashToken } from "@/lib/device-auth";
import { sendTelegramMessage } from "@/lib/notify/telegram";
import prisma from "@/lib/prisma";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockFeedLevelLog = vi.mocked(prisma.feedLevelLog);
const mockWaterTempLog = vi.mocked(prisma.waterTempLog);
const mockPond = vi.mocked(prisma.pond);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockNotification = vi.mocked(prisma.notification);

const DEVICE = {
	id: "dev-1",
	mac: "AA:BB:CC:DD:EE:FF",
	lastSeenAt: null as Date | null,
	pondId: null as string | null,
	label: "Feeder A",
	// Auth goes through hash lookup (device-auth) — the mock row must carry
	// the matching hash for the "test-token" header used by ingestRequest().
	tokenHash: hashToken("test-token"),
	approvalStatus: "APPROVED",
};

function ingestRequest(body: Record<string, unknown>): Request {
	return new Request("http://test.local/api/ingest", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-device-token": "test-token",
		},
		body: JSON.stringify(body),
	});
}

function feedDispensedBody(eventId: string, feedRequestId: string | null) {
	return {
		device_id: DEVICE.mac,
		event_type: "feed_dispensed",
		event_id: eventId,
		timestamp: "2026-10-13T00:00:00+00:00",
		grams: 150,
		source: "dashboard",
		feed_request_id: feedRequestId,
	};
}

describe("POST /api/ingest — feed_dispensed dedupe (Gap #2)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findFirst.mockResolvedValue(null);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 1 } as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
	});

	it("accepts the first feed_dispensed and completes the FeedRequest", async () => {
		const res = await POST(ingestRequest(feedDispensedBody("evt-0001", "req-1")));
		expect(res.status).toBe(204);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
		expect(mockFeedRequest.updateMany).toHaveBeenCalledTimes(1);
	});

	it("treats a retry with the same requestId and a different event_id as a duplicate", async () => {
		mockFeedEvent.findFirst
			.mockResolvedValueOnce(null as never)
			.mockResolvedValueOnce({ id: "fe-1" } as never);

		const first = await POST(ingestRequest(feedDispensedBody("evt-0002", "req-2")));
		expect(first.status).toBe(204);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);

		const retry = await POST(ingestRequest(feedDispensedBody("evt-0002-retry", "req-2")));
		expect(retry.status).toBe(204);
		// No second FeedRequest row and no extra grams bookkeeping.
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
		expect(mockFeedRequest.updateMany).toHaveBeenCalledTimes(1);
	});

	it("treats a retry with the same event_id as a duplicate", async () => {
		mockFeedEvent.findFirst
			.mockResolvedValueOnce(null as never)
			.mockResolvedValueOnce({ id: "fe-2" } as never);

		const first = await POST(ingestRequest(feedDispensedBody("evt-0003", "req-3")));
		expect(first.status).toBe(204);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);

		const retry = await POST(ingestRequest(feedDispensedBody("evt-0003", "req-3")));
		expect(retry.status).toBe(204);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
	});

	it("still reconciles orphaned requests when no feed_request_id is present", async () => {
		const res = await POST(ingestRequest(feedDispensedBody("evt-0004", null)));
		expect(res.status).toBe(204);
		expect(mockFeedRequest.findMany).toHaveBeenCalledTimes(1);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
	});

	it("rejects a PENDING device with 403 (org approval policy)", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			approvalStatus: "PENDING",
		} as never);

		const res = await POST(ingestRequest(feedDispensedBody("evt-0005", "req-5")));
		expect(res.status).toBe(403);
		expect(mockFeedEvent.create).not.toHaveBeenCalled();
		expect(mockFeedRequest.updateMany).not.toHaveBeenCalled();
	});
});

function heartbeatBody(
	eventId: string,
	opts: {
		rtcOk?: boolean;
		feederActive?: boolean;
		feedLevelPercent?: number;
		feedLevelCm?: number;
		waterTempC?: number;
		waterTempOk?: boolean;
		wifiRssi?: unknown;
	} = {},
) {
	return {
		device_id: DEVICE.mac,
		event_type: "heartbeat",
		event_id: eventId,
		timestamp: "2026-10-13T00:00:00+00:00",
		rtc_ok: opts.rtcOk ?? true,
		feeder_active: opts.feederActive ?? false,
		...(opts.feedLevelPercent !== undefined ? { feed_level_percent: opts.feedLevelPercent } : {}),
		...(opts.feedLevelCm !== undefined ? { feed_level_cm: opts.feedLevelCm } : {}),
		...(opts.waterTempC !== undefined ? { water_temp_c: opts.waterTempC } : {}),
		...(opts.waterTempOk !== undefined ? { water_temp_ok: opts.waterTempOk } : {}),
		...(opts.wifiRssi !== undefined ? { wifi_rssi: opts.wifiRssi } : {}),
	};
}

describe("POST /api/ingest — heartbeat dedup and thinning (1.4)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedLevelLog.findFirst.mockResolvedValue(null as never);
		mockFeedLevelLog.create.mockResolvedValue({} as never);
		mockWaterTempLog.findFirst.mockResolvedValue(null as never);
		mockWaterTempLog.create.mockResolvedValue({} as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
		mockNotification.create.mockResolvedValue({} as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
		mockPond.findUnique.mockResolvedValue(null as never);
	});

	it("100 heartbeats at 3% produce at most one CRITICAL pellet notification", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		// First heartbeat: no recent alert → fires. After that: same-tier
		// unacknowledged alert within the 6h window → suppressed.
		mockNotification.findFirst
			.mockResolvedValueOnce(null as never)
			.mockResolvedValue({ tier: "CRITICAL", createdAt: new Date() } as never);

		for (let i = 0; i < 100; i++) {
			const res = await POST(ingestRequest(heartbeatBody(`hb-crit-${i}`, { feedLevelPercent: 3 })));
			expect(res.status).toBe(204);
		}

		expect(mockNotification.create).toHaveBeenCalledTimes(1);
		expect(mockNotification.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ tier: "CRITICAL" }) }),
		);
		// pellet_low follows the same gate — one event, not 100.
		expect(mockDeviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ eventType: "pellet_low" }) }),
		);
		// Device is online — no connected events.
		const connectedCalls = mockDeviceStateEvent.create.mock.calls.filter(
			([arg]) => (arg as { data: { eventType: string } }).data.eventType === "connected",
		);
		expect(connectedCalls).toHaveLength(0);

		// 3.5: exactly one Telegram message — the same dedup that gates the
		// notification gates the fan-out (none of the 99 repeats).
		expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
		expect(sendTelegramMessage).toHaveBeenCalledWith(expect.stringContaining("nearly empty"));
	});

	it("queues one hopper alert per heartbeat (no duplicate days-remaining warning)", async () => {
		// A low reading that also leaves under two days of feed used to satisfy
		// both the tier alert and the days-remaining alert in the same heartbeat,
		// creating two pellet notifications from one reading.
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
			hopperCapacityG: 1000,
			gramsPerFeeding: 150,
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockNotification.findFirst.mockResolvedValue(null as never);
		mockPond.findUnique.mockResolvedValue({
			feedsPerDay: 2,
			ownerId: null,
			notificationPrefs: null,
		} as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-dupe-1", { feedLevelPercent: 10 })));

		expect(res.status).toBe(204);
		const pelletNotifications = mockNotification.create.mock.calls.filter(
			([arg]) => (arg as { data: { category?: string } }).data.category === "pellet",
		);
		expect(pelletNotifications).toHaveLength(1);
		expect(pelletNotifications[0][0]).toMatchObject({ data: { tier: "WARNING" } });
	});

	it("does not downgrade an outstanding CRITICAL alert to a days-remaining WARNING", async () => {
		// With a CRITICAL alert still unacknowledged, the days-remaining branch
		// used to add a WARNING from the same reading. The next heartbeat then saw
		// a WARNING as the latest alert and re-fired CRITICAL, so the two
		// alternated on every heartbeat until someone acknowledged one.
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
			hopperCapacityG: 1000,
			gramsPerFeeding: 150,
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockNotification.findFirst.mockResolvedValue({
			tier: "CRITICAL",
			createdAt: new Date(),
		} as never);
		mockPond.findUnique.mockResolvedValue({
			feedsPerDay: 2,
			ownerId: null,
			notificationPrefs: null,
		} as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-crit-dupe", { feedLevelPercent: 3 })));

		expect(res.status).toBe(204);
		expect(mockNotification.create).not.toHaveBeenCalled();
		expect(sendTelegramMessage).not.toHaveBeenCalled();
	});

	it("fires CRITICAL immediately after WARNING (tier transition, even inside window)", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockNotification.findFirst.mockResolvedValue({
			tier: "WARNING",
			createdAt: new Date(),
		} as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-transition", { feedLevelPercent: 3 })));
		expect(res.status).toBe(204);
		expect(mockNotification.create).toHaveBeenCalledTimes(1);
		expect(mockNotification.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ tier: "CRITICAL" }) }),
		);
	});

	it("does not Telegram-blast on WARNING-level pellet alerts (3.5: CRITICAL only)", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockNotification.findFirst.mockResolvedValue(null as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-warning", { feedLevelPercent: 10 })));
		expect(res.status).toBe(204);
		expect(mockNotification.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ tier: "WARNING" }) }),
		);
		expect(sendTelegramMessage).not.toHaveBeenCalled();
	});

	it("a failing Telegram sender never breaks ingest (3.5)", async () => {
		vi.mocked(sendTelegramMessage).mockResolvedValueOnce(false as never);
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockNotification.findFirst.mockResolvedValue(null as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-tg-down", { feedLevelPercent: 3 })));
		expect(res.status).toBe(204);
		expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
	});

	it("thins heartbeat FeedEvents: 100 beats with unchanged values write one row", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValueOnce(null as never).mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);

		for (let i = 0; i < 100; i++) {
			const res = await POST(ingestRequest(heartbeatBody(`hb-thin-${i}`)));
			expect(res.status).toBe(204);
		}

		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
		// 100 online beats → no extra connected events (N15).
		const connectedCalls = mockDeviceStateEvent.create.mock.calls.filter(
			([arg]) => (arg as { data: { eventType: string } }).data.eventType === "connected",
		);
		expect(connectedCalls).toHaveLength(0);
	});

	it("writes a new heartbeat row when rtcOk or feederActive changes", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);

		const res = await POST(
			ingestRequest(heartbeatBody("hb-change", { rtcOk: false, feederActive: true })),
		);
		expect(res.status).toBe(204);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
	});

	it("writes connected exactly once on offline→online reconnect", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - 16 * 60 * 1000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue(null as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-reconnect")));
		expect(res.status).toBe(204);
		const connectedCalls = mockDeviceStateEvent.create.mock.calls.filter(
			([arg]) => (arg as { data: { eventType: string } }).data.eventType === "connected",
		);
		expect(connectedCalls).toHaveLength(1);
	});

	it("records a new reported firmware version once, without a schema column", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);

		const res = await POST(
			ingestRequest({ ...heartbeatBody("hb-fw-0001"), firmware_version: "1.6.0" }),
		);

		expect(res.status).toBe(204);
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					eventType: "firmware_reported",
					source: "device",
					metadata: { version: "1.6.0" },
				}),
			}),
		);
	});

	it("does not write another firmware row when the reported version is unchanged", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			eventType: "firmware_reported",
			metadata: { version: "1.6.0" },
			createdAt: new Date(),
		} as never);

		const res = await POST(
			ingestRequest({ ...heartbeatBody("hb-fw-0002"), firmware_version: "1.6.0" }),
		);

		expect(res.status).toBe(204);
		const firmwareCalls = mockDeviceStateEvent.create.mock.calls.filter(
			([arg]) => (arg as { data: { eventType: string } }).data.eventType === "firmware_reported",
		);
		expect(firmwareCalls).toHaveLength(0);
	});
});

describe("POST /api/ingest — hopper sensor arbitration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
			hopperCapacityG: 1000,
			gramsPerFeeding: 150,
		} as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockPond.findUnique.mockResolvedValue({
			feedsPerDay: 2,
			ownerId: null,
			notificationPrefs: null,
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedLevelLog.findFirst.mockResolvedValue(null as never);
		mockFeedLevelLog.create.mockResolvedValue({} as never);
		mockWaterTempLog.findFirst.mockResolvedValue(null as never);
		mockWaterTempLog.create.mockResolvedValue({} as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
		mockNotification.findFirst.mockResolvedValue(null as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
	});

	function levelUpdateCalls() {
		return mockEnergyDevice.update.mock.calls.filter(
			([arg]) => "feedLevelPercent" in (arg as { data: Record<string, unknown> }).data,
		);
	}

	it("ignores the firmware's no-echo sentinel (0 % with a 0 cm distance)", async () => {
		// The HC-SR04 timeout path reports 0 % and 0 cm. Treating that as a real
		// reading overwrote the level and fired a false CRITICAL refill alert.
		const res = await POST(
			ingestRequest(heartbeatBody("hb-sentinel", { feedLevelPercent: 0, feedLevelCm: 0 })),
		);

		expect(res.status).toBe(204);
		// The heartbeat itself still lands (lastSeenAt); only the level is skipped.
		expect(mockEnergyDevice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
			}),
		);
		expect(levelUpdateCalls()).toHaveLength(0);
		expect(mockFeedLevelLog.create).not.toHaveBeenCalled();
		expect(mockNotification.create).not.toHaveBeenCalled();
		expect(sendTelegramMessage).not.toHaveBeenCalled();
	});

	it("accepts a real empty hopper (0 % but a non-zero distance)", async () => {
		const res = await POST(
			ingestRequest(heartbeatBody("hb-empty", { feedLevelPercent: 0, feedLevelCm: 28 })),
		);

		expect(res.status).toBe(204);
		expect(levelUpdateCalls()).toHaveLength(1);
		expect(mockNotification.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ tier: "CRITICAL" }) }),
		);
	});

	it("keeps the last known distance when the heartbeat omits feed_level_cm", async () => {
		const res = await POST(ingestRequest(heartbeatBody("hb-no-cm", { feedLevelPercent: 45 })));

		expect(res.status).toBe(204);
		const [update] = levelUpdateCalls();
		expect((update[0] as { data: Record<string, unknown> }).data).toEqual({
			feedLevelPercent: 45,
			feedLevelUpdatedAt: expect.any(Date),
		});
	});

	it("stores the distance when the heartbeat reports one", async () => {
		const res = await POST(
			ingestRequest(heartbeatBody("hb-with-cm", { feedLevelPercent: 45, feedLevelCm: 9.5 })),
		);

		expect(res.status).toBe(204);
		const [update] = levelUpdateCalls();
		expect((update[0] as { data: Record<string, unknown> }).data).toEqual({
			feedLevelPercent: 45,
			feedLevelCm: 9.5,
			feedLevelUpdatedAt: expect.any(Date),
		});
	});

	it("warns two days ahead using the shared days-of-feed estimate", async () => {
		// 25 % of 1,000 g = 250 g; 150 g × 2 meals = 300 g/day → 0.83 days.
		// 25 % is above the 20 % low threshold, so only the days alert fires.
		const res = await POST(
			ingestRequest(heartbeatBody("hb-days-1", { feedLevelPercent: 25, feedLevelCm: 18 })),
		);

		expect(res.status).toBe(204);
		const pellet = mockNotification.create.mock.calls.filter(
			([arg]) => (arg as { data: { category?: string } }).data.category === "pellet",
		);
		expect(pellet).toHaveLength(1);
		expect(pellet[0][0]).toMatchObject({
			data: { tier: "WARNING", message: expect.stringContaining("run out") },
		});
	});

	it("does not invent a 99-day sentinel when the device has no capacity", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
			hopperCapacityG: 0,
			gramsPerFeeding: 150,
		} as never);

		const res = await POST(
			ingestRequest(heartbeatBody("hb-no-cap", { feedLevelPercent: 25, feedLevelCm: 18 })),
		);

		expect(res.status).toBe(204);
		const pellet = mockNotification.create.mock.calls.filter(
			([arg]) => (arg as { data: { category?: string } }).data.category === "pellet",
		);
		expect(pellet).toHaveLength(0);
	});
});

describe("POST /api/ingest — pellet alert window survives acknowledgement (#412)", () => {
	// Option A: the 6 h window is measured from the latest pellet notification
	// regardless of acknowledgement. Acknowledging silences the bell; the
	// reminder returns at most 6 h after the last warning and a tier transition
	// still fires immediately.
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
			hopperCapacityG: 1000,
			gramsPerFeeding: 150,
		} as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockPond.findUnique.mockResolvedValue({
			feedsPerDay: 2,
			ownerId: null,
			notificationPrefs: null,
		} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedLevelLog.findFirst.mockResolvedValue(null as never);
		mockFeedLevelLog.create.mockResolvedValue({} as never);
		mockWaterTempLog.findFirst.mockResolvedValue(null as never);
		mockWaterTempLog.create.mockResolvedValue({} as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
	});

	function pelletCreates() {
		return mockNotification.create.mock.calls.filter(
			([arg]) => (arg as { data: { category?: string } }).data.category === "pellet",
		);
	}

	/**
	 * A pellet notification the farmer has already acknowledged, with the
	 * lookup behaving like the database: a query that filters
	 * `acknowledgedAt: null` cannot see it. That filter is the bug (#412), so
	 * these tests fail against the old gate instead of passing on a mock that
	 * ignores its `where` clause.
	 */
	function acknowledgedPelletAlert(createdAt: Date) {
		const row = {
			tier: "WARNING",
			createdAt,
			acknowledgedAt: new Date(createdAt.getTime() + 30_000),
		};
		mockNotification.findFirst.mockImplementation((async (args: {
			where?: Record<string, unknown>;
		}) => (args?.where && "acknowledgedAt" in args.where ? null : row)) as never);
		return row;
	}

	it("does not re-arm the warning when the latest alert was acknowledged inside the window", async () => {
		// The farmer tapped Acknowledge 30 s ago; the next 5 s heartbeat must not
		// create an identical warning (the pre-#412 gate only looked at
		// unacknowledged rows, so it found nothing and fired again).
		acknowledgedPelletAlert(new Date(Date.now() - 60_000));

		const res = await POST(ingestRequest(heartbeatBody("hb-ack-1", { feedLevelPercent: 10 })));

		expect(res.status).toBe(204);
		expect(pelletCreates()).toHaveLength(0);
		// The gate reads the latest pellet row whatever its acknowledgement; the
		// `acknowledgedAt: null` filter is what re-armed the cooldown.
		expect(mockNotification.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { pondId: "pond-1", category: "pellet" } }),
		);
	});

	it("creates the reminder once the window has passed, acknowledged or not", async () => {
		mockNotification.findFirst.mockResolvedValue({
			tier: "WARNING",
			createdAt: new Date(Date.now() - PELLET_ALERT_WINDOW_MS - 60_000),
			acknowledgedAt: new Date(Date.now() - PELLET_ALERT_WINDOW_MS - 30_000),
		} as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-ack-2", { feedLevelPercent: 10 })));

		expect(res.status).toBe(204);
		const pellet = pelletCreates();
		expect(pellet).toHaveLength(1);
		expect(pellet[0][0]).toMatchObject({ data: { tier: "WARNING", category: "pellet" } });
	});

	it("still fires a tier transition inside the window", async () => {
		// WARNING → CRITICAL is new information, so the acknowledgement of the
		// WARNING does not suppress it.
		mockNotification.findFirst.mockResolvedValue({
			tier: "WARNING",
			createdAt: new Date(Date.now() - 60_000),
			acknowledgedAt: new Date(Date.now() - 30_000),
		} as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-ack-3", { feedLevelPercent: 3 })));

		expect(res.status).toBe(204);
		const pellet = pelletCreates();
		expect(pellet).toHaveLength(1);
		expect(pellet[0][0]).toMatchObject({ data: { tier: "CRITICAL", category: "pellet" } });
	});

	it("fires the reverse transition (CRITICAL → WARNING) inside the window", async () => {
		mockNotification.findFirst.mockResolvedValue({
			tier: "CRITICAL",
			createdAt: new Date(Date.now() - 60_000),
			acknowledgedAt: new Date(Date.now() - 30_000),
		} as never);

		const res = await POST(ingestRequest(heartbeatBody("hb-ack-4", { feedLevelPercent: 10 })));

		expect(res.status).toBe(204);
		const pellet = pelletCreates();
		expect(pellet).toHaveLength(1);
		expect(pellet[0][0]).toMatchObject({ data: { tier: "WARNING", category: "pellet" } });
	});

	it("does not re-fire the days-remaining warning right after it was acknowledged", async () => {
		// 25 % of 1,000 g = 250 g at 300 g/day ≈ 0.83 days: above the 20 % low
		// threshold, so only the days-remaining branch is in play. It shares the
		// same dedup state, which had the same acknowledged-row flaw.
		acknowledgedPelletAlert(new Date(Date.now() - 60_000));

		const res = await POST(
			ingestRequest(heartbeatBody("hb-ack-days-1", { feedLevelPercent: 25, feedLevelCm: 18 })),
		);

		expect(res.status).toBe(204);
		expect(pelletCreates()).toHaveLength(0);
	});

	it("re-fires the days-remaining warning once the window has passed", async () => {
		mockNotification.findFirst.mockResolvedValue({
			tier: "WARNING",
			createdAt: new Date(Date.now() - PELLET_ALERT_WINDOW_MS - 60_000),
			acknowledgedAt: new Date(Date.now() - PELLET_ALERT_WINDOW_MS - 30_000),
		} as never);

		const res = await POST(
			ingestRequest(heartbeatBody("hb-ack-days-2", { feedLevelPercent: 25, feedLevelCm: 18 })),
		);

		expect(res.status).toBe(204);
		const pellet = pelletCreates();
		expect(pellet).toHaveLength(1);
		expect(pellet[0][0]).toMatchObject({
			data: { tier: "WARNING", category: "pellet", message: expect.stringContaining("run out") },
		});
	});
});

describe("POST /api/ingest — water temperature history (I-06)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockPond.findUnique.mockResolvedValue({ farmId: "farm-1" } as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockWaterTempLog.findFirst.mockResolvedValue(null as never);
		mockWaterTempLog.create.mockResolvedValue({} as never);
	});

	it("writes a WaterTempLog row for an accepted probe reading", async () => {
		const res = await POST(
			ingestRequest(heartbeatBody("hb-temp-1", { waterTempC: 28.4, waterTempOk: true })),
		);

		expect(res.status).toBe(204);
		expect(mockWaterTempLog.create).toHaveBeenCalledTimes(1);
		expect(mockWaterTempLog.create).toHaveBeenCalledWith({
			data: { deviceId: DEVICE.id, tempC: 28.4, farmId: "farm-1" },
		});
	});

	it("throttles to one row per device per 5 minutes", async () => {
		// Last row 2 minutes ago → still inside the window, no new row.
		mockWaterTempLog.findFirst.mockResolvedValue({
			recordedAt: new Date(Date.now() - 2 * 60 * 1000),
		} as never);
		const recent = await POST(
			ingestRequest(heartbeatBody("hb-temp-2", { waterTempC: 27.9, waterTempOk: true })),
		);
		expect(recent.status).toBe(204);
		expect(mockWaterTempLog.create).not.toHaveBeenCalled();

		// Last row 6 minutes ago → due again.
		mockWaterTempLog.findFirst.mockResolvedValue({
			recordedAt: new Date(Date.now() - 6 * 60 * 1000),
		} as never);
		const due = await POST(
			ingestRequest(heartbeatBody("hb-temp-3", { waterTempC: 28.1, waterTempOk: true })),
		);
		expect(due.status).toBe(204);
		expect(mockWaterTempLog.create).toHaveBeenCalledTimes(1);
		expect(mockWaterTempLog.create).toHaveBeenCalledWith({
			data: { deviceId: DEVICE.id, tempC: 28.1, farmId: "farm-1" },
		});
	});

	it("writes no row when the probe is undetected, and flags the device offline", async () => {
		const res = await POST(
			ingestRequest(heartbeatBody("hb-temp-bad", { waterTempC: -127, waterTempOk: false })),
		);

		expect(res.status).toBe(204);
		expect(mockWaterTempLog.create).not.toHaveBeenCalled();
		expect(mockEnergyDevice.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ waterTempOk: false }) }),
		);
	});

	it("writes no row when the heartbeat omits the probe fields", async () => {
		const res = await POST(ingestRequest(heartbeatBody("hb-temp-absent")));

		expect(res.status).toBe(204);
		expect(mockWaterTempLog.create).not.toHaveBeenCalled();
	});
});

describe("POST /api/ingest - firmware 1.6.0 fail-safe diagnostics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			pondId: "pond-1",
			lastSeenAt: null,
		} as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findFirst.mockResolvedValue(null as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedLevelLog.findFirst.mockResolvedValue(null as never);
		mockFeedLevelLog.create.mockResolvedValue({} as never);
		mockWaterTempLog.findFirst.mockResolvedValue(null as never);
		mockWaterTempLog.create.mockResolvedValue({} as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
		mockNotification.findFirst.mockResolvedValue(null as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
		mockPond.findUnique.mockResolvedValue({ farmId: "farm-1" } as never);
	});

	it("accepts the extra heartbeat keys and strips them from the persisted row", async () => {
		// The firmware sends safe_mode, last_reset_reasons and a nested diag
		// object. The Zod schema strips everything it does not declare, so the
		// heartbeat must still parse (204) and the FeedEvent row keeps its shape.
		const res = await POST(
			ingestRequest({
				...heartbeatBody("hb-failsafe-1"),
				firmware_version: "1.6.0",
				safe_mode: true,
				last_reset_reasons: "task_wdt,brownout",
				diag: {
					fw: "1.6.0",
					safe_mode: true,
					relay_overruns: 1,
					queue_drops: 0,
					refusals_by_reason: { too_soon: 2 },
				},
			}),
		);

		expect(res.status).toBe(204);
		const call = mockFeedEvent.create.mock.calls[0];
		expect(call).toBeDefined();
		const data = (call?.[0] as { data: Record<string, unknown> }).data;
		expect(data).not.toHaveProperty("safe_mode");
		expect(data).not.toHaveProperty("diag");
		expect(data).toMatchObject({ eventType: "heartbeat", rtcOk: true, feederActive: false });
	});

	it("accepts every new refusal reason on the unchanged feed_refused contract", async () => {
		const reasons = ["too_soon", "hourly_limit", "safe_mode", "brownout_hold", "relay_overrun"];
		for (const reason of reasons) {
			const res = await POST(
				ingestRequest({
					device_id: DEVICE.mac,
					event_type: "feed_refused",
					event_id: `evt-${reason}`,
					timestamp: "2026-10-28T00:00:00+00:00",
					grams: 80,
					source: "button",
					reason,
				}),
			);
			expect(res.status).toBe(204);
		}

		const recorded = mockDeviceStateEvent.create.mock.calls.map(
			(call) =>
				(call[0] as unknown as { data: { metadata: { reason: string } } }).data.metadata.reason,
		);
		expect(recorded).toEqual(reasons);
	});
});

describe("POST /api/ingest — heartbeat Wi-Fi RSSI (I-97)", () => {
	function wifiWrites(): Record<string, unknown>[] {
		return mockEnergyDevice.update.mock.calls
			.map(([arg]) => (arg as { data: Record<string, unknown> }).data)
			.filter((data) => "wifiRssiDbm" in data);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findFirst.mockResolvedValue({
			receivedAt: new Date(),
			rtcOk: true,
			feederActive: false,
		} as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedLevelLog.findFirst.mockResolvedValue(null as never);
		mockFeedLevelLog.create.mockResolvedValue({} as never);
		mockWaterTempLog.findFirst.mockResolvedValue(null as never);
		mockWaterTempLog.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
		mockNotification.create.mockResolvedValue({} as never);
		mockNotification.findFirst.mockResolvedValue(null as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
		mockPond.findUnique.mockResolvedValue(null as never);
	});

	it("stores a plausible RSSI with the heartbeat write already made", async () => {
		const res = await POST(ingestRequest(heartbeatBody("hb-rssi-1", { wifiRssi: -72 })));

		expect(res.status).toBe(204);
		const writes = wifiWrites();
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({
			lastSeenAt: expect.any(Date),
			wifiRssiDbm: -72,
			wifiRssiUpdatedAt: expect.any(Date),
		});
	});

	it("accepts both ends of the ESP32 range", async () => {
		for (const dbm of [-127, 0, -80]) {
			vi.clearAllMocks();
			mockEnergyDevice.update.mockResolvedValue({} as never);
			mockFeedEvent.findFirst.mockResolvedValue(null as never);
			mockFeedEvent.create.mockResolvedValue({} as never);
			mockEnergyDevice.findUnique.mockResolvedValue({
				...DEVICE,
				lastSeenAt: new Date(Date.now() - 5000),
			} as never);

			const res = await POST(ingestRequest(heartbeatBody(`hb-rssi-ok-${dbm}`, { wifiRssi: dbm })));
			expect(res.status).toBe(204);
			expect(wifiWrites()[0]).toMatchObject({ wifiRssiDbm: dbm });
		}
	});

	it.each([
		["below the range", -128],
		["above the range", 1],
		["a non-integer", -72.5],
		["a string", "-72"],
		["null", null],
		["a boolean", true],
	])("ignores %s without failing the heartbeat", async (_label, value) => {
		const res = await POST(ingestRequest(heartbeatBody("hb-rssi-bad", { wifiRssi: value })));

		// The heartbeat itself is still accepted and still refreshes lastSeenAt.
		expect(res.status).toBe(204);
		expect(wifiWrites()).toHaveLength(0);
		expect(mockEnergyDevice.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ lastSeenAt: expect.any(Date) }) }),
		);
	});

	it("leaves the stored signal untouched when old firmware omits the field", async () => {
		const res = await POST(ingestRequest(heartbeatBody("hb-rssi-old")));

		expect(res.status).toBe(204);
		expect(wifiWrites()).toHaveLength(0);
	});
});
