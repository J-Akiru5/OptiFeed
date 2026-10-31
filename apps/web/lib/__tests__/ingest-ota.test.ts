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

import { POST } from "@/app/api/ingest/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);

const DEVICE = {
	id: "dev-1",
	mac: "A4:CF:12:7E:3B:09",
	lastSeenAt: null as Date | null,
	pondId: null as string | null,
	label: "Feeder A",
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

function heartbeatBody(overrides: Record<string, unknown> = {}) {
	return {
		device_id: DEVICE.mac,
		event_type: "heartbeat",
		event_id: "evt-heartbeat-0001",
		timestamp: "2026-10-26T12:00:00+00:00",
		rtc_ok: true,
		feeder_active: false,
		...overrides,
	};
}

function feedRefusedBody(overrides: Record<string, unknown> = {}) {
	return {
		device_id: DEVICE.mac,
		event_type: "feed_refused",
		event_id: "evt-refused-0001",
		timestamp: "2026-10-26T12:00:00+00:00",
		grams: 150,
		source: "dashboard",
		reason: "daily_cap",
		...overrides,
	};
}

function otaEvents() {
	return mockDeviceStateEvent.create.mock.calls
		.map(
			([arg]) => (arg as { data: { eventType: string; metadata?: Record<string, unknown> } }).data,
		)
		.filter((data) => data.eventType.startsWith("ota_"));
}

describe("POST /api/ingest — OTA diagnostics (T-12b)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findFirst.mockResolvedValue(null as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
	});

	it("keeps the old heartbeat valid when no OTA fields are sent", async () => {
		const res = await POST(ingestRequest(heartbeatBody()));
		expect(res.status).toBe(204);
		expect(mockDeviceStateEvent.findFirst).not.toHaveBeenCalled();
		expect(otaEvents()).toHaveLength(0);
	});

	it("accepts the optional firmware_version, ota_state and reset_reason", async () => {
		const res = await POST(
			ingestRequest(
				heartbeatBody({
					firmware_version: "1.4.1",
					ota_state: "valid",
					reset_reason: "poweron",
				}),
			),
		);
		expect(res.status).toBe(204);
		expect(otaEvents()).toEqual([
			expect.objectContaining({
				eventType: "ota_valid",
				source: "device",
				metadata: {
					state: "valid",
					version: "1.4.1",
					resetReason: "poweron",
				},
			}),
		]);
	});

	it("records an installed image once, with the version in metadata", async () => {
		await POST(
			ingestRequest(
				heartbeatBody({
					firmware_version: "1.4.1",
					ota_state: "installed",
					reset_reason: "software",
				}),
			),
		);
		expect(otaEvents()).toEqual([
			expect.objectContaining({
				eventType: "ota_installed",
				metadata: expect.objectContaining({ version: "1.4.1" }),
			}),
		]);

		// The same state/version on the next beat is a repeat, not a transition.
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			eventType: "ota_installed",
			metadata: { version: "1.4.1" },
		} as never);
		await POST(
			ingestRequest(
				heartbeatBody({
					firmware_version: "1.4.1",
					ota_state: "installed",
				}),
			),
		);
		expect(otaEvents()).toHaveLength(1);
	});

	it("records valid -> rolled_back as a new lifecycle row", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			eventType: "ota_valid",
			metadata: { version: "1.4.1" },
		} as never);

		const res = await POST(
			ingestRequest(
				heartbeatBody({
					firmware_version: "1.4.0",
					ota_state: "rolled_back",
					reset_reason: "software",
				}),
			),
		);
		expect(res.status).toBe(204);
		expect(otaEvents()).toEqual([
			expect.objectContaining({
				eventType: "ota_rolled_back",
				metadata: {
					state: "rolled_back",
					version: "1.4.0",
					resetReason: "software",
				},
			}),
		]);
	});

	it("records a new version even when the state string repeats", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			eventType: "ota_valid",
			metadata: { version: "1.4.0" },
		} as never);

		await POST(ingestRequest(heartbeatBody({ firmware_version: "1.4.1", ota_state: "valid" })));
		expect(otaEvents()).toEqual([
			expect.objectContaining({
				eventType: "ota_valid",
				metadata: expect.objectContaining({ version: "1.4.1" }),
			}),
		]);
	});

	it("still ingests the heartbeat when the OTA lookup fails", async () => {
		mockDeviceStateEvent.findFirst.mockRejectedValue(new Error("db down") as never);

		const res = await POST(
			ingestRequest(heartbeatBody({ firmware_version: "1.4.1", ota_state: "valid" })),
		);
		expect(res.status).toBe(204);
		expect(otaEvents()).toHaveLength(0);
		expect(mockFeedEvent.create).toHaveBeenCalledTimes(1);
	});

	it("audits a feed refused during an OTA download as ota_feed_refused", async () => {
		const res = await POST(
			ingestRequest(
				feedRefusedBody({
					reason: "ota_in_progress",
					firmware_version: "1.4.1",
				}),
			),
		);
		expect(res.status).toBe(204);
		expect(otaEvents()).toEqual([
			expect.objectContaining({
				eventType: "ota_feed_refused",
				metadata: {
					grams: 150,
					source: "dashboard",
					reason: "ota_in_progress",
					version: "1.4.1",
				},
			}),
		]);
	});

	it("falls back to the last lifecycle version when the refusal omits it", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			metadata: { version: "1.4.1" },
		} as never);

		const res = await POST(ingestRequest(feedRefusedBody({ reason: "ota_in_progress" })));
		expect(res.status).toBe(204);
		expect(otaEvents()).toEqual([
			expect.objectContaining({
				eventType: "ota_feed_refused",
				metadata: {
					grams: 150,
					source: "dashboard",
					reason: "ota_in_progress",
					version: "1.4.1",
				},
			}),
		]);
	});

	it("keeps ordinary safety refusals as feed_refused", async () => {
		const res = await POST(ingestRequest(feedRefusedBody()));
		expect(res.status).toBe(204);
		const refusals = mockDeviceStateEvent.create.mock.calls
			.map(
				([arg]) =>
					(arg as { data: { eventType: string; metadata?: Record<string, unknown> } }).data,
			)
			.filter((data) => data.eventType.includes("feed_refused"));
		expect(refusals).toEqual([
			expect.objectContaining({
				eventType: "feed_refused",
				metadata: expect.objectContaining({ reason: "daily_cap" }),
			}),
		]);
	});
});

describe("POST /api/ingest — firmware config revision (I-100)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
		mockFeedEvent.findFirst.mockResolvedValue(null as never);
		mockFeedEvent.create.mockResolvedValue({} as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
	});

	function configEvents() {
		return mockDeviceStateEvent.create.mock.calls
			.map(
				([arg]) =>
					(arg as { data: { eventType: string; metadata?: Record<string, unknown> } }).data,
			)
			.filter((data) => data.eventType === "config_applied");
	}

	it("records the applied config revision once per change", async () => {
		const res = await POST(
			ingestRequest(heartbeatBody({ firmware_version: "1.7.0", config_rev: 12345 })),
		);
		expect(res.status).toBe(204);
		expect(configEvents()).toEqual([
			expect.objectContaining({
				eventType: "config_applied",
				source: "device",
				metadata: { configRev: 12345, version: "1.7.0" },
			}),
		]);
	});

	it("does not repeat the row when the device reports the same revision", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			eventType: "config_applied",
			metadata: { configRev: 12345 },
		} as never);
		await POST(ingestRequest(heartbeatBody({ config_rev: 12345 })));
		expect(configEvents()).toHaveLength(0);
	});

	it("drops a malformed config_rev instead of failing the heartbeat", async () => {
		const res = await POST(ingestRequest(heartbeatBody({ config_rev: "not-a-number" })));
		expect(res.status).toBe(204);
		expect(configEvents()).toHaveLength(0);
	});
});
