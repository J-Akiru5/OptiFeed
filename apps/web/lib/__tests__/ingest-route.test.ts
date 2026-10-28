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
		waterTempC?: number;
		waterTempOk?: boolean;
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
		...(opts.waterTempC !== undefined ? { water_temp_c: opts.waterTempC } : {}),
		...(opts.waterTempOk !== undefined ? { water_temp_ok: opts.waterTempOk } : {}),
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
