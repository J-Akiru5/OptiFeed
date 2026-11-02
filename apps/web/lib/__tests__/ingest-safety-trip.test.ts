import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findUnique: vi.fn(), update: vi.fn() },
		feedEvent: { findFirst: vi.fn(), create: vi.fn() },
		feedLevelLog: { findFirst: vi.fn(), create: vi.fn() },
		waterTempLog: { findFirst: vi.fn(), create: vi.fn() },
		pond: { findUnique: vi.fn() },
		feedRequest: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
		deviceStateEvent: { findFirst: vi.fn(), create: vi.fn() },
		notification: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
		$transaction: vi.fn(async (input: unknown) => {
			if (Array.isArray(input)) return Promise.all(input);
			return (input as () => Promise<unknown>)();
		}),
	},
}));

import { POST } from "@/app/api/ingest/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";

/**
 * The once-per-trip `safety_trip` event (#455). The unit reports it whenever the
 * safety layer locks the relay into safe mode; the server stores one audit row
 * per trip and deliberately sends no notification, because the `device_health`
 * state row already raised the CRITICAL safe-mode alert.
 */

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockNotification = vi.mocked(prisma.notification);

const DEVICE = {
	id: "dev-1",
	mac: "AA:BB:CC:DD:EE:FF",
	lastSeenAt: null as Date | null,
	pondId: "pond-1" as string | null,
	label: "Feeder A",
	tokenHash: hashToken("test-token"),
	approvalStatus: "APPROVED",
};

function ingestRequest(
	body: Record<string, unknown>,
	token: string | null = "test-token",
): Request {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (token !== null) headers["x-device-token"] = token;
	return new Request("http://test.local/api/ingest", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

function tripBody(tripId: string | undefined, extra: Record<string, unknown> = {}) {
	return {
		device_id: DEVICE.mac,
		event_type: "safety_trip",
		timestamp: "2026-11-02T03:04:05+00:00",
		...(tripId === undefined ? {} : { trip_id: tripId }),
		abnormal_resets: 3,
		reset_reasons: "brownout,panic",
		reset_reason: "brownout",
		entry: "boot",
		quiet_s: 0,
		uptime_s: 12,
		firmware_version: "1.8.1",
		...extra,
	};
}

function tripWrites(): { [key: string]: unknown }[] {
	return mockDeviceStateEvent.create.mock.calls
		.map(([arg]) => (arg as { data: Record<string, unknown> }).data)
		.filter((data) => data.eventType === "safety_trip");
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEnergyDevice.findUnique.mockResolvedValue({
		...DEVICE,
		lastSeenAt: new Date(Date.now() - 5000),
	} as never);
	mockEnergyDevice.update.mockResolvedValue({} as never);
	mockDeviceStateEvent.create.mockResolvedValue({} as never);
	mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
	mockNotification.create.mockResolvedValue({} as never);
	mockNotification.findFirst.mockResolvedValue(null as never);
});

describe("POST /api/ingest - safety trip", () => {
	it("stores one safety_trip row for a valid report and marks the device seen", async () => {
		const res = await POST(ingestRequest(tripBody("trip-8f21")));

		expect(res.status).toBe(204);
		const writes = tripWrites();
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({
			deviceId: DEVICE.id,
			eventType: "safety_trip",
			source: "device",
			deviceTime: "2026-11-02T03:04:05+00:00",
		});
		expect(writes[0]?.metadata).toEqual({
			tripId: "trip-8f21",
			eventId: "trip-trip-8f21",
			abnormalResets: 3,
			resetReasons: "brownout,panic",
			resetReason: "brownout",
			entry: "boot",
			quietS: 0,
			uptimeS: 12,
			version: "1.8.1",
		});
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: DEVICE.id },
			data: { lastSeenAt: expect.any(Date) },
		});
	});

	it("accepts a report with no optional evidence", async () => {
		const res = await POST(
			ingestRequest({
				device_id: DEVICE.mac,
				event_type: "safety_trip",
				timestamp: "2026-11-02T03:04:05+00:00",
				trip_id: "trip-min",
			}),
		);

		expect(res.status).toBe(204);
		expect(tripWrites()).toHaveLength(1);
		expect(tripWrites()[0]?.metadata).toEqual({
			tripId: "trip-min",
			eventId: "trip-trip-min",
		});
	});

	it("does not write twice when the unit re-sends the same trip", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			metadata: { tripId: "trip-8f21", eventId: "trip-trip-8f21" },
		} as never);

		const res = await POST(ingestRequest(tripBody("trip-8f21")));

		expect(res.status).toBe(204);
		expect(tripWrites()).toHaveLength(0);
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		// The dedupe reads the newest trip row for this device only.
		expect(mockDeviceStateEvent.findFirst).toHaveBeenCalledWith({
			where: { deviceId: DEVICE.id, eventType: "safety_trip" },
			orderBy: { createdAt: "desc" },
			select: { metadata: true },
		});
	});

	it("writes a second row for a new trip id after an earlier trip", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			metadata: { tripId: "trip-8f21" },
		} as never);

		const res = await POST(ingestRequest(tripBody("trip-9a34")));

		expect(res.status).toBe(204);
		expect(tripWrites()).toHaveLength(1);
		expect(tripWrites()[0]?.metadata).toMatchObject({ tripId: "trip-9a34" });
	});

	it("rejects a report without a trip id", async () => {
		const res = await POST(ingestRequest(tripBody(undefined)));

		expect(res.status).toBe(422);
		expect(tripWrites()).toHaveLength(0);
	});

	it("rejects an event type outside the enum", async () => {
		const res = await POST(
			ingestRequest({ ...tripBody("trip-8f21"), event_type: "safety_trip_v2" }),
		);

		expect(res.status).toBe(422);
		expect(tripWrites()).toHaveLength(0);
	});

	it("rejects a trip id longer than the contract allows", async () => {
		const res = await POST(ingestRequest(tripBody("t".repeat(65))));

		expect(res.status).toBe(422);
		expect(tripWrites()).toHaveLength(0);
	});

	it("rejects an unknown entry phase", async () => {
		const res = await POST(ingestRequest(tripBody("trip-8f21", { entry: "manual" })));

		expect(res.status).toBe(422);
		expect(tripWrites()).toHaveLength(0);
	});

	it("refuses a request without a device token", async () => {
		const res = await POST(ingestRequest(tripBody("trip-8f21"), null));

		expect(res.status).toBe(401);
		expect(tripWrites()).toHaveLength(0);
	});

	it("refuses a token whose device does not own the reported MAC", async () => {
		const res = await POST(
			ingestRequest({ ...tripBody("trip-8f21"), device_id: "11:22:33:44:55:66" }),
		);

		expect(res.status).toBe(401);
		expect(tripWrites()).toHaveLength(0);
	});

	it("refuses a unit that is still pending approval", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			approvalStatus: "PENDING",
			lastSeenAt: new Date(Date.now() - 5000),
		} as never);

		const res = await POST(ingestRequest(tripBody("trip-8f21")));

		expect(res.status).toBe(403);
		expect(tripWrites()).toHaveLength(0);
	});

	it("rate limits two reports less than a second apart", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(),
		} as never);

		const res = await POST(ingestRequest(tripBody("trip-8f21")));

		expect(res.status).toBe(429);
		expect(tripWrites()).toHaveLength(0);
	});

	it("sends no notification, because device_health already raised the alert", async () => {
		const res = await POST(ingestRequest(tripBody("trip-8f21")));

		expect(res.status).toBe(204);
		expect(tripWrites()).toHaveLength(1);
		expect(mockNotification.create).not.toHaveBeenCalled();
	});
});
