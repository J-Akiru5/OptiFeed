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

vi.mock("@/lib/settings/org", async () => {
	const actual = await vi.importActual<typeof import("@/lib/settings/org")>("@/lib/settings/org");
	return {
		...actual,
		getOrgSettingsForFarm: vi.fn(async () => ({
			orgId: null,
			settings: actual.ORG_SETTINGS_DEFAULTS,
		})),
		getOrgAlertRoles: vi.fn(async () => ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]),
	};
});

import { POST } from "@/app/api/ingest/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";

/**
 * Faults, safe mode and refused dashboard feeds on the ingest route. The unit
 * reports both on the routes it already calls; the server records the state
 * and closes the request, so the dashboard no longer shows a locked-out feeder
 * as healthy and "feeding".
 */

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
	pondId: "pond-1" as string | null,
	label: "Feeder A",
	tokenHash: hashToken("test-token"),
	approvalStatus: "APPROVED",
};

function ingestRequest(body: Record<string, unknown>): Request {
	return new Request("http://test.local/api/ingest", {
		method: "POST",
		headers: { "content-type": "application/json", "x-device-token": "test-token" },
		body: JSON.stringify(body),
	});
}

function heartbeatBody(eventId: string, extra: Record<string, unknown> = {}) {
	return {
		device_id: DEVICE.mac,
		event_type: "heartbeat",
		event_id: eventId,
		timestamp: "2026-11-01T00:00:00+00:00",
		rtc_ok: true,
		feeder_active: false,
		...extra,
	};
}

const safeModeHeartbeat = (id: string) =>
	heartbeatBody(id, {
		safe_mode: true,
		last_reset_reasons: "brownout",
		diag: { safe_mode: true, faults_present: 16, faults_latched: 16, reset_abnormal_count: 3 },
	});

function healthEventWrites(): { metadata: Record<string, unknown> }[] {
	return mockDeviceStateEvent.create.mock.calls
		.map(
			([arg]) => (arg as { data: { eventType: string; metadata: Record<string, unknown> } }).data,
		)
		.filter((data) => data.eventType === "device_health");
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
	mockWaterTempLog.findFirst.mockResolvedValue(null as never);
	mockFeedRequest.findMany.mockResolvedValue([] as never);
	mockFeedRequest.updateMany.mockResolvedValue({ count: 1 } as never);
	mockDeviceStateEvent.create.mockResolvedValue({} as never);
	mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
	mockNotification.create.mockResolvedValue({} as never);
	mockNotification.findFirst.mockResolvedValue(null as never);
	mockPond.findUnique.mockResolvedValue({ ownerId: "farm-1", notificationPrefs: null } as never);
});

describe("POST /api/ingest - device health", () => {
	it("records safe mode as a device_health row and alerts the pond", async () => {
		const res = await POST(ingestRequest(safeModeHeartbeat("hb-health-1")));

		expect(res.status).toBe(204);
		const writes = healthEventWrites();
		expect(writes).toHaveLength(1);
		expect(writes[0]?.metadata).toMatchObject({
			safeMode: true,
			present: ["safe_mode"],
			abnormalResets: 3,
			resetReasons: "brownout",
		});
		expect(mockNotification.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ pondId: "pond-1", tier: "CRITICAL", category: "system" }),
			}),
		);
	});

	it("writes nothing new while the stored state is unchanged", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			metadata: { safeMode: true, faultsPresent: 16, faultsLatched: 16 },
		} as never);

		const res = await POST(ingestRequest(safeModeHeartbeat("hb-health-2")));

		expect(res.status).toBe(204);
		expect(healthEventWrites()).toHaveLength(0);
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("records the clear so the dashboard stops warning, without a new alert", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({
			metadata: { safeMode: true, faultsPresent: 16, faultsLatched: 16 },
		} as never);

		const res = await POST(
			ingestRequest(
				heartbeatBody("hb-health-3", {
					safe_mode: false,
					diag: { safe_mode: false, faults_present: 0, faults_latched: 0 },
				}),
			),
		);

		expect(res.status).toBe(204);
		expect(healthEventWrites()).toHaveLength(1);
		expect(healthEventWrites()[0]?.metadata).toMatchObject({ safeMode: false, faultsPresent: 0 });
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("still stores the row when the alert lookup fails", async () => {
		mockPond.findUnique.mockRejectedValue(new Error("db down") as never);

		const res = await POST(ingestRequest(safeModeHeartbeat("hb-health-4")));

		expect(res.status).toBe(204);
		expect(healthEventWrites()).toHaveLength(1);
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("still accepts the heartbeat when the health lookup fails", async () => {
		mockDeviceStateEvent.findFirst.mockRejectedValue(new Error("db down") as never);

		const res = await POST(ingestRequest(safeModeHeartbeat("hb-health-5")));

		expect(res.status).toBe(204);
		expect(healthEventWrites()).toHaveLength(0);
	});

	it("accepts a heartbeat with garbage health fields and stores nothing", async () => {
		const res = await POST(
			ingestRequest(
				heartbeatBody("hb-health-6", {
					safe_mode: "maybe",
					diag: { faults_present: "x", faults_latched: {} },
				}),
			),
		);

		expect(res.status).toBe(204);
		expect(healthEventWrites()).toHaveLength(0);
	});

	it("writes no health row for a unit on older firmware", async () => {
		const res = await POST(ingestRequest(heartbeatBody("hb-health-7")));

		expect(res.status).toBe(204);
		expect(healthEventWrites()).toHaveLength(0);
	});
});

describe("POST /api/ingest - refused dashboard feeds", () => {
	const refused = (source: string, id: string) =>
		ingestRequest({
			device_id: DEVICE.mac,
			event_type: "feed_refused",
			event_id: id,
			timestamp: "2026-11-01T00:00:00+00:00",
			grams: 150,
			source,
			reason: "safe_mode",
		});

	it("closes the dispatched dashboard request when the unit refuses the dose", async () => {
		const res = await POST(refused("dashboard", "evt-refused-dash"));

		expect(res.status).toBe(204);
		expect(mockFeedRequest.updateMany).toHaveBeenCalledWith({
			where: { deviceId: DEVICE.id, status: "dispatched", kind: "feed" },
			data: { status: "refused" },
		});
	});

	it("leaves feed requests alone when a button or scheduled dose is refused", async () => {
		for (const source of ["button", "scheduled"]) {
			const res = await POST(refused(source, `evt-refused-${source}`));
			expect(res.status).toBe(204);
		}

		expect(mockFeedRequest.updateMany).not.toHaveBeenCalled();
	});
});
