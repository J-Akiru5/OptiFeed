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
		pond: {
			findUnique: vi.fn(),
		},
		feedRequest: {
			findMany: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		deviceStateEvent: {
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

import { POST } from "@/app/api/ingest/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockFeedLevelLog = vi.mocked(prisma.feedLevelLog);
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
});

function heartbeatBody(
	eventId: string,
	opts: { rtcOk?: boolean; feederActive?: boolean; feedLevelPercent?: number } = {},
) {
	return {
		device_id: DEVICE.mac,
		event_type: "heartbeat",
		event_id: eventId,
		timestamp: "2026-10-13T00:00:00+00:00",
		rtc_ok: opts.rtcOk ?? true,
		feeder_active: opts.feederActive ?? false,
		...(opts.feedLevelPercent !== undefined ? { feed_level_percent: opts.feedLevelPercent } : {}),
	};
}

describe("POST /api/ingest — heartbeat dedup and thinning (1.4)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockFeedLevelLog.findFirst.mockResolvedValue(null as never);
		mockFeedLevelLog.create.mockResolvedValue({} as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
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
});
