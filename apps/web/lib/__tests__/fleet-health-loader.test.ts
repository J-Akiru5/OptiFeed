import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	deviceFindMany,
	userFindMany,
	membershipFindMany,
	organizationFindMany,
	policyMock,
	gateMock,
} = vi.hoisted(() => ({
	deviceFindMany: vi.fn(),
	userFindMany: vi.fn(),
	membershipFindMany: vi.fn(),
	organizationFindMany: vi.fn(),
	policyMock: vi.fn(),
	gateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: deviceFindMany },
		user: { findMany: userFindMany },
		membership: { findMany: membershipFindMany },
		organization: { findMany: organizationFindMany },
	},
}));
vi.mock("@/lib/settings/device-status", () => ({ getDeviceStatusPolicy: policyMock }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { deviceStatusPolicyFromValue } from "../device-status";
import { FLEET_DEVICE_LIMIT, getFleetMonitor } from "../platform/fleet-health";

/**
 * The fleet monitor loader (issue #479, M3C.4).
 *
 * These tests guard the two things the rules tests cannot see: how devices reach
 * their tenant, and what the page is given when the source fails. A broken query
 * must arrive as `sourceError` with an `unknown` summary — never as an empty,
 * healthy-looking fleet.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });
const MINUTE = 60 * 1000;

function device(id: string, farmId: string | null, lastSeenAt: Date | null) {
	return {
		id,
		label: `Feeder ${id}`,
		mac: `AA:BB:CC:DD:EE:${id}`,
		lastSeenAt,
		pond: farmId ? { name: `Pond ${id}`, ownerId: farmId } : null,
	};
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

	it("reports an unreadable device policy as unknown rather than guessing", async () => {
		policyMock.mockRejectedValue(new Error("setting unreadable"));
		const monitor = await getFleetMonitor(NOW);

		expect(monitor.sourceError).toBe(true);
		expect(monitor.summary.state).toBe("unknown");
	});

	it("groups devices by the tenant resolved from the pond owner", async () => {
		deviceFindMany.mockResolvedValue([
			device("1", "farm-1", new Date(NOW.getTime() - MINUTE)),
			device("2", "farm-1", new Date(NOW.getTime() - MINUTE)),
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
});
