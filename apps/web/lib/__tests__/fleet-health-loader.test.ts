import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	deviceFindMany,
	userFindMany,
	membershipFindMany,
	organizationFindMany,
	feedGroupBy,
	queryRaw,
	policyMock,
	gateMock,
} = vi.hoisted(() => ({
	deviceFindMany: vi.fn(),
	userFindMany: vi.fn(),
	membershipFindMany: vi.fn(),
	organizationFindMany: vi.fn(),
	feedGroupBy: vi.fn(),
	queryRaw: vi.fn(),
	policyMock: vi.fn(),
	gateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: deviceFindMany },
		user: { findMany: userFindMany },
		membership: { findMany: membershipFindMany },
		organization: { findMany: organizationFindMany },
		feedEvent: { groupBy: feedGroupBy },
		$queryRaw: queryRaw,
	},
}));
vi.mock("@/lib/settings/device-status", () => ({ getDeviceStatusPolicy: policyMock }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { deviceStatusPolicyFromValue } from "../device-status";
import { MACHINE_FEED_SOURCES } from "../feed-figures";
import { FLEET_DEVICE_LIMIT, getFleetMonitor } from "../platform/fleet-health";

/**
 * The fleet monitor loader (issue #479, M3C.4 and M3C.4b).
 *
 * These tests guard what the rules tests cannot see: how devices reach their
 * tenant, what the page is given when a source fails, and that the per-device
 * telemetry is read from the fields the platform already stores — bounded, with
 * no token column and no invented default.
 *
 * A broken query must arrive as `sourceError` with an `unknown` summary — never
 * as an empty, healthy-looking fleet.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });
const MINUTE = 60 * 1000;

function ago(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function device(
	id: string,
	farmId: string | null,
	lastSeenAt: Date | null,
	extra: Record<string, unknown> = {},
) {
	return {
		id,
		label: `Feeder ${id}`,
		mac: `AA:BB:CC:DD:EE:${id}`,
		lastSeenAt,
		wifiRssiDbm: null,
		wifiRssiUpdatedAt: null,
		feedLevelPercent: null,
		feedLevelUpdatedAt: null,
		waterTempC: null,
		waterTempOk: false,
		waterTempUpdatedAt: null,
		diag: null,
		pond: farmId ? { name: `Pond ${id}`, ownerId: farmId } : null,
		...extra,
	};
}

/** Resolve the two raw event reads by the SQL they ask for. */
function routeRawEvents({
	health = [],
	firmware = [],
}: {
	health?: unknown[];
	firmware?: unknown[];
}) {
	queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
		const sql = strings.join("?");
		if (sql.includes('"eventType" = ')) return health;
		if (sql.includes('"eventType" IN')) return firmware;
		return [];
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	policyMock.mockResolvedValue(POLICY);
	gateMock.mockResolvedValue({
		id: "admin-1",
		userId: "user-1",
		role: "ADMIN",
	});
	userFindMany.mockResolvedValue([]);
	membershipFindMany.mockResolvedValue([]);
	organizationFindMany.mockResolvedValue([]);
	deviceFindMany.mockResolvedValue([]);
	feedGroupBy.mockResolvedValue([]);
	queryRaw.mockResolvedValue([]);
});

describe("getFleetMonitor", () => {
	it("never renders a failed source as a healthy fleet", async () => {
		deviceFindMany.mockRejectedValue(new Error("db down"));
		const monitor = await getFleetMonitor(NOW);

		expect(monitor.sourceError).toBe(true);
		expect(monitor.summary.state).toBe("unknown");
		expect(monitor.summary.state).not.toBe("ok");
		expect(monitor.rows).toEqual([]);
		expect(monitor.policy).toBeNull();
	});

	it("reports a failed telemetry read the same way, not as a fleet with no faults", async () => {
		deviceFindMany.mockResolvedValue([device("1", null, ago(1))]);
		feedGroupBy.mockRejectedValue(new Error("feed table unreadable"));

		const monitor = await getFleetMonitor(NOW);

		expect(monitor.sourceError).toBe(true);
		expect(monitor.summary.state).toBe("unknown");
		expect(monitor.rows).toEqual([]);
	});

	it("reports an unreadable device policy as unknown rather than guessing", async () => {
		policyMock.mockRejectedValue(new Error("setting unreadable"));
		const monitor = await getFleetMonitor(NOW);

		expect(monitor.sourceError).toBe(true);
		expect(monitor.summary.state).toBe("unknown");
	});

	it("groups devices by the tenant resolved from the pond owner", async () => {
		deviceFindMany.mockResolvedValue([
			device("1", "farm-1", ago(1)),
			device("2", "farm-1", ago(1)),
		]);
		userFindMany.mockResolvedValue([{ id: "user-1", farmId: "farm-1" }]);
		membershipFindMany.mockResolvedValue([{ userId: "user-1", orgId: "org-1" }]);
		organizationFindMany.mockResolvedValue([{ id: "org-1", name: "Alpha" }]);

		const monitor = await getFleetMonitor(NOW);

		expect(monitor.sourceError).toBe(false);
		expect(monitor.totalDevices).toBe(2);
		expect(monitor.rows).toHaveLength(1);
		expect(monitor.rows[0]).toMatchObject({
			tenantId: "org-1",
			tenantName: "Alpha",
			total: 2,
			reporting: 2,
			state: "ok",
		});
		expect(monitor.summary.state).toBe("ok");
	});

	it("keeps a device with no pond in the unassigned row, and a silent tenant unknown", async () => {
		deviceFindMany.mockResolvedValue([device("9", null, null)]);

		const monitor = await getFleetMonitor(NOW);

		expect(monitor.rows).toHaveLength(1);
		expect(monitor.rows[0]).toMatchObject({ tenantId: null, reporting: 0, state: "unknown" });
		expect(monitor.summary.state).toBe("unknown");
	});

	it("skips the org lookups when no device has a pond", async () => {
		deviceFindMany.mockResolvedValue([device("9", null, NOW)]);

		await getFleetMonitor(NOW);

		expect(userFindMany).not.toHaveBeenCalled();
		expect(membershipFindMany).not.toHaveBeenCalled();
		expect(organizationFindMany).not.toHaveBeenCalled();
	});

	it("cuts the device list at the limit and says so", async () => {
		const many = Array.from({ length: FLEET_DEVICE_LIMIT + 1 }, (_, index) =>
			device(String(index), null, NOW),
		);
		deviceFindMany.mockResolvedValue(many);

		const monitor = await getFleetMonitor(NOW);

		expect(monitor.truncated).toBe(true);
		expect(monitor.totalDevices).toBe(FLEET_DEVICE_LIMIT);
		// The row past the limit is cut, not counted.
		expect(monitor.rows).toHaveLength(1);
		expect(monitor.rows[0]?.total).toBe(FLEET_DEVICE_LIMIT);
	});

	it("gates the read on the platform-admin check", async () => {
		await getFleetMonitor(NOW);
		expect(gateMock).toHaveBeenCalled();
	});

	it("selects telemetry from the device row and never a token column", async () => {
		await getFleetMonitor(NOW);

		const query = deviceFindMany.mock.calls[0]?.[0] as {
			take: number;
			select: Record<string, unknown>;
		};
		expect(query.take).toBe(FLEET_DEVICE_LIMIT + 1);
		expect(Object.keys(query.select)).toEqual(
			expect.arrayContaining([
				"lastSeenAt",
				"wifiRssiDbm",
				"wifiRssiUpdatedAt",
				"feedLevelPercent",
				"feedLevelUpdatedAt",
				"waterTempC",
				"waterTempOk",
				"waterTempUpdatedAt",
				"diag",
			]),
		);
		expect(query.select).not.toHaveProperty("token");
		expect(query.select).not.toHaveProperty("tokenHash");
	});

	it("carries the readings the unit already reported, with health and the last feed", async () => {
		deviceFindMany.mockResolvedValue([
			device("1", "farm-1", ago(1), {
				wifiRssiDbm: -61,
				wifiRssiUpdatedAt: ago(1),
				feedLevelPercent: 55,
				feedLevelUpdatedAt: ago(2),
				waterTempC: 26.5,
				waterTempOk: true,
				waterTempUpdatedAt: ago(2),
				diag: { fw: "1.6.2" },
			}),
		]);
		userFindMany.mockResolvedValue([{ id: "user-1", farmId: "farm-1" }]);
		membershipFindMany.mockResolvedValue([{ userId: "user-1", orgId: "org-1" }]);
		organizationFindMany.mockResolvedValue([{ id: "org-1", name: "Alpha" }]);
		feedGroupBy.mockResolvedValue([{ deviceId: "1", _max: { receivedAt: ago(45) } }]);
		routeRawEvents({
			health: [
				{
					deviceId: "1",
					eventType: "device_health",
					metadata: { safeMode: true, faultsPresent: 4, faultsLatched: 4 },
					createdAt: ago(10),
				},
			],
		});

		const monitor = await getFleetMonitor(NOW);
		const unit = monitor.rows[0]?.devices[0];

		expect(unit).toMatchObject({
			id: "1",
			connection: "online",
			rssiDbm: -61,
			rssiFreshness: "fresh",
			firmware: { version: "1.6.2", source: "diag" },
			lastFeedAt: ago(45),
			feedLevel: { percent: 55, freshness: "fresh" },
			waterTemp: { celsius: 26.5, freshness: "fresh", probeOk: true },
			health: { safeMode: true, faults: ["rtc"], since: ago(10) },
		});
	});

	it("falls back to the newest version event when the heartbeat carries no diagnostics", async () => {
		deviceFindMany.mockResolvedValue([device("2", null, ago(1))]);
		routeRawEvents({
			firmware: [
				{
					deviceId: "2",
					eventType: "firmware_reported",
					metadata: { version: "1.4.0" },
					createdAt: ago(600),
				},
			],
		});

		const monitor = await getFleetMonitor(NOW);

		expect(monitor.rows[0]?.devices[0]?.firmware).toEqual({
			version: "1.4.0",
			at: ago(600),
			source: "event",
		});
	});

	it("counts only machine dispenses as the last successful feed", async () => {
		deviceFindMany.mockResolvedValue([device("3", null, ago(1))]);

		await getFleetMonitor(NOW);

		expect(feedGroupBy).toHaveBeenCalledWith(
			expect.objectContaining({
				by: ["deviceId"],
				where: expect.objectContaining({
					eventType: "feed_dispensed",
					source: { in: [...MACHINE_FEED_SOURCES] },
				}),
			}),
		);
	});

	it("leaves a unit with no telemetry missing, never zero", async () => {
		deviceFindMany.mockResolvedValue([device("4", null, null)]);

		const monitor = await getFleetMonitor(NOW);
		const unit = monitor.rows[0]?.devices[0];

		expect(unit).toMatchObject({
			rssiDbm: null,
			firmware: { version: null, source: null },
			lastFeedAt: null,
			feedLevel: { percent: null, freshness: "none" },
			waterTemp: null,
			health: null,
		});
	});

	it("runs no telemetry reads when the fleet is empty", async () => {
		await getFleetMonitor(NOW);

		expect(feedGroupBy).not.toHaveBeenCalled();
		expect(queryRaw).not.toHaveBeenCalled();
	});

	it("reads the newest health row per unit, from the event stream only", async () => {
		deviceFindMany.mockResolvedValue([device("5", null, ago(1))]);

		await getFleetMonitor(NOW);

		expect(queryRaw).toHaveBeenCalledTimes(2);
		const sql = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
		expect(sql).toContain('DISTINCT ON ("deviceId")');
		expect(sql).toContain("DeviceStateEvent");
	});
});
