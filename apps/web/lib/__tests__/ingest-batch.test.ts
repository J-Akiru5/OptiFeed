import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		feedEvent: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			create: vi.fn(),
			createMany: vi.fn(),
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
			createMany: vi.fn(),
		},
		notification: {
			create: vi.fn(),
			createMany: vi.fn(),
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
import { absoluteAppUrl, sendTelegramMessage } from "@/lib/notify/telegram";
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
	pondId: "pond-1",
	label: "Feeder A",
	tokenHash: hashToken("test-token"),
};

const TS = "2026-10-24T00:00:00+00:00";

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

function batchBody(events: unknown[], deviceId = DEVICE.mac) {
	return ingestRequest({
		device_id: deviceId,
		event_type: "batch",
		timestamp: TS,
		events,
	});
}

function queuedEvent(eventId: string, extra: Record<string, unknown> = {}) {
	return {
		event_id: eventId,
		timestamp: TS,
		grams: 150,
		source: "button",
		feed_request_id: null,
		...extra,
	};
}

async function acks(res: Response) {
	expect(res.status).toBe(200);
	const body = (await res.json()) as { results: { event_id: string; status: string }[] };
	return new Map(body.results.map((result) => [result.event_id, result.status]));
}

describe("POST /api/ingest — batch offline-queue flush", () => {
	beforeEach(() => {
		// reset (not clear): queued mockResolvedValueOnce implementations from a
		// previous test would otherwise leak into this one's query order.
		vi.resetAllMocks();
		vi.mocked(sendTelegramMessage).mockResolvedValue(true as never);
		vi.mocked(absoluteAppUrl).mockReturnValue(null as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findMany.mockResolvedValue([] as never);
		mockFeedEvent.createMany.mockResolvedValue({ count: 0 } as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockFeedRequest.update.mockResolvedValue({} as never);
		mockDeviceStateEvent.createMany.mockResolvedValue({ count: 0 } as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.createMany.mockResolvedValue({ count: 0 } as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
		mockNotification.findFirst.mockResolvedValue(null as never);
		mockFeedEvent.findFirst.mockResolvedValue(null as never);
	});

	it("stores every event in a fresh batch and acks them individually", async () => {
		const res = await POST(
			batchBody([
				queuedEvent("evt-batch-1"),
				queuedEvent("evt-batch-2"),
				queuedEvent("evt-batch-3", { source: "scheduled" }),
			]),
		);

		expect(await acks(res)).toEqual(
			new Map([
				["evt-batch-1", "stored"],
				["evt-batch-2", "stored"],
				["evt-batch-3", "stored"],
			]),
		);

		// One insert for the whole batch, riding the (deviceId, eventId) unique.
		expect(mockFeedEvent.createMany).toHaveBeenCalledTimes(1);
		const createArgs = mockFeedEvent.createMany.mock.calls[0][0] as {
			data: { eventId: string; deviceId: string }[];
			skipDuplicates: boolean;
		};
		expect(createArgs.data).toHaveLength(3);
		expect(createArgs.skipDuplicates).toBe(true);
		expect(createArgs.data.every((row) => row.deviceId === DEVICE.id)).toBe(true);
		expect(mockDeviceStateEvent.createMany).toHaveBeenCalledTimes(1);
		// Replayed feeds that never left the device still refresh lastSeenAt.
		expect(mockEnergyDevice.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ lastSeenAt: expect.any(Date) }) }),
		);
	});

	it("replays an already-stored batch without creating a second row", async () => {
		// Keyed on the query shape, not call order: the ids lookup and the
		// feed_request_id lookup are distinguishable by their `where`.
		(mockFeedEvent.findMany as unknown as Mock).mockImplementation(
			async (args: { where?: Record<string, unknown> }) => {
				if (args.where?.eventId) return [{ eventId: "evt-batch-1" }, { eventId: "evt-batch-2" }];
				return [];
			},
		);

		const res = await POST(batchBody([queuedEvent("evt-batch-1"), queuedEvent("evt-batch-2")]));

		expect(await acks(res)).toEqual(
			new Map([
				["evt-batch-1", "duplicate"],
				["evt-batch-2", "duplicate"],
			]),
		);
		expect(mockFeedEvent.createMany).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.createMany).not.toHaveBeenCalled();
		expect(mockNotification.createMany).not.toHaveBeenCalled();
	});

	it("acks a mixed batch event by event", async () => {
		(mockFeedEvent.findMany as unknown as Mock).mockImplementation(
			async (args: { where?: Record<string, unknown> }) => {
				if (args.where?.eventId) return [{ eventId: "evt-old-0001" }];
				return [];
			},
		);

		const res = await POST(batchBody([queuedEvent("evt-old-0001"), queuedEvent("evt-new-0001")]));

		expect(await acks(res)).toEqual(
			new Map([
				["evt-old-0001", "duplicate"],
				["evt-new-0001", "stored"],
			]),
		);
		expect(mockFeedEvent.createMany).toHaveBeenCalledTimes(1);
		const createArgs = mockFeedEvent.createMany.mock.calls[0][0] as {
			data: { eventId: string }[];
		};
		expect(createArgs.data.map((row) => row.eventId)).toEqual(["evt-new-0001"]);
	});

	it("rejects only the malformed record and stores the rest", async () => {
		const res = await POST(
			batchBody([
				queuedEvent("evt-good-1"),
				queuedEvent("evt-bad-0001", { grams: -10 }),
				queuedEvent("evt-good-2"),
			]),
		);

		expect(await acks(res)).toEqual(
			new Map([
				["evt-good-1", "stored"],
				["evt-bad-0001", "rejected"],
				["evt-good-2", "stored"],
			]),
		);
		const createArgs = mockFeedEvent.createMany.mock.calls[0][0] as {
			data: { eventId: string }[];
		};
		expect(createArgs.data.map((row) => row.eventId)).toEqual(["evt-good-1", "evt-good-2"]);
	});

	it("treats a retry with a regenerated event_id but the same feed_request_id as a duplicate", async () => {
		(mockFeedEvent.findMany as unknown as Mock).mockImplementation(
			async (args: { where?: Record<string, unknown> }) => {
				if (args.where?.feedRequestId) {
					return [{ feedRequestId: "req-7", source: "dashboard" }];
				}
				return [];
			},
		);

		const res = await POST(
			batchBody([queuedEvent("evt-regen", { source: "dashboard", feed_request_id: "req-7" })]),
		);

		expect(await acks(res)).toEqual(new Map([["evt-regen", "duplicate"]]));
		expect(mockFeedEvent.createMany).not.toHaveBeenCalled();
	});

	it("stores the same event_id only once when it appears twice in one payload", async () => {
		const res = await POST(batchBody([queuedEvent("evt-dupe"), queuedEvent("evt-dupe")]));

		const result = (await res.json()) as { results: { event_id: string; status: string }[] };
		expect(result.results).toEqual([
			{ event_id: "evt-dupe", status: "stored" },
			{ event_id: "evt-dupe", status: "duplicate" },
		]);
		const createArgs = mockFeedEvent.createMany.mock.calls[0][0] as {
			data: { eventId: string }[];
		};
		expect(createArgs.data).toHaveLength(1);
	});

	it("rejects a batch for a device other than the token's", async () => {
		const res = await POST(batchBody([queuedEvent("evt-foreign")], "11:22:33:44:55:66"));
		expect(res.status).toBe(401);
		expect(mockFeedEvent.createMany).not.toHaveBeenCalled();
	});

	it("rejects a batch larger than BATCH_MAX_EVENTS with 422", async () => {
		const events = Array.from({ length: 21 }, (_, i) => queuedEvent(`evt-long-${i}`));
		const res = await POST(batchBody(events));
		expect(res.status).toBe(422);
		expect(mockFeedEvent.createMany).not.toHaveBeenCalled();
	});

	it("requires a device token", async () => {
		const res = await new Request("http://test.local/api/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				device_id: DEVICE.mac,
				event_type: "batch",
				timestamp: TS,
				events: [queuedEvent("evt-unauth")],
			}),
		});
		expect(await POST(res)).toMatchObject({ status: 401 });
	});
});

describe("POST /api/ingest — heartbeat queue reporting", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(sendTelegramMessage).mockResolvedValue(true as never);
		vi.mocked(absoluteAppUrl).mockReturnValue(null as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findFirst.mockResolvedValue(null as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
		mockNotification.updateMany.mockResolvedValue({ count: 0 } as never);
	});

	it("writes the device-reported queue depth on every beat", async () => {
		const res = await POST(
			ingestRequest({
				device_id: DEVICE.mac,
				event_type: "heartbeat",
				event_id: "evt-hb-queue-1",
				timestamp: TS,
				rtc_ok: true,
				feeder_active: false,
				queued_events: 7,
				queued_dropped: 2,
			}),
		);

		expect(res.status).toBe(204);
		expect(mockEnergyDevice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					pendingQueuedEvents: 7,
					queuedDropped: 2,
				}),
			}),
		);
	});

	it("leaves the reported counters untouched when a firmware without them beats", async () => {
		const res = await POST(
			ingestRequest({
				device_id: DEVICE.mac,
				event_type: "heartbeat",
				event_id: "evt-hb-queue-2",
				timestamp: TS,
				rtc_ok: true,
				feeder_active: false,
			}),
		);

		expect(res.status).toBe(204);
		const withCounters = mockEnergyDevice.update.mock.calls.filter(
			([arg]) =>
				"pendingQueuedEvents" in ((arg as { data?: Record<string, unknown> }).data ?? {}) ||
				"queuedDropped" in ((arg as { data?: Record<string, unknown> }).data ?? {}),
		);
		expect(withCounters).toHaveLength(0);
	});
});
