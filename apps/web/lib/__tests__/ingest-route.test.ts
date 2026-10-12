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
		},
		$transaction: vi.fn(async (input: unknown) => {
			if (Array.isArray(input)) return Promise.all(input);
			return (input as () => Promise<unknown>)();
		}),
	},
}));

import { POST } from "@/app/api/ingest/route";
import prisma from "@/lib/prisma";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockNotification = vi.mocked(prisma.notification);

const DEVICE = {
	id: "dev-1",
	mac: "AA:BB:CC:DD:EE:FF",
	lastSeenAt: null as Date | null,
	pondId: null as string | null,
	label: "Feeder A",
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
