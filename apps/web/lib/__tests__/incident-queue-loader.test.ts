import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	deviceFindMany,
	notificationFindMany,
	errorFindMany,
	jobFindMany,
	userFindMany,
	membershipFindMany,
	organizationFindMany,
	policyMock,
	gateMock,
} = vi.hoisted(() => ({
	deviceFindMany: vi.fn(),
	notificationFindMany: vi.fn(),
	errorFindMany: vi.fn(),
	jobFindMany: vi.fn(),
	userFindMany: vi.fn(),
	membershipFindMany: vi.fn(),
	organizationFindMany: vi.fn(),
	policyMock: vi.fn(),
	gateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: deviceFindMany },
		notification: { findMany: notificationFindMany },
		errorEvent: { findMany: errorFindMany },
		backgroundJob: { findMany: jobFindMany },
		user: { findMany: userFindMany },
		membership: { findMany: membershipFindMany },
		organization: { findMany: organizationFindMany },
	},
}));
vi.mock("@/lib/settings/device-status", () => ({ getDeviceStatusPolicy: policyMock }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { deviceStatusPolicyFromValue } from "../device-status";
import { INCIDENT_LIMIT } from "../platform/incidents";
import { getIncidentQueue } from "../platform/incidents";

/**
 * The incident queue loader (issue #479, M3C.5).
 *
 * The rules tests cover the merging; these cover what the page is actually
 * given: four independent readers, one of which failing must name itself and
 * must not leave the queue looking clear, plus the tenant attribution shared
 * with the fleet monitor.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number) {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function device(id: string, pondId: string | null, lastSeenAt: Date | null) {
	return {
		id,
		label: `Feeder ${id}`,
		lastSeenAt,
		pond: pondId ? { id: pondId, name: `Pond ${pondId}`, ownerId: `farm-${pondId}` } : null,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	gateMock.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
	policyMock.mockResolvedValue(POLICY);
	deviceFindMany.mockResolvedValue([]);
	notificationFindMany.mockResolvedValue([]);
	errorFindMany.mockResolvedValue([]);
	jobFindMany.mockResolvedValue([]);
	userFindMany.mockResolvedValue([]);
	membershipFindMany.mockResolvedValue([]);
	organizationFindMany.mockResolvedValue([]);
});

describe("getIncidentQueue", () => {
	it("reads all four sources and merges the fleet with its connectivity alert", async () => {
		deviceFindMany.mockResolvedValue([device("1", "p1", ago(60)), device("2", "p1", ago(60))]);
		notificationFindMany.mockResolvedValue([
			{
				id: "n1",
				pondId: "p1",
				tier: "CRITICAL",
				category: "connectivity",
				message: "Pond 1 is offline",
				createdAt: ago(50),
				pond: { id: "p1", name: "Pond 1", ownerId: "farm-p1" },
			},
		]);
		errorFindMany.mockResolvedValue([
			{ id: "e1", message: "boom", severity: "ERROR", firstSeenAt: ago(20), count: 3 },
		]);
		jobFindMany.mockResolvedValue([
			{ id: "j1", type: "export_csv", error: "disk full", createdAt: ago(9), finishedAt: ago(8) },
		]);
		userFindMany.mockResolvedValue([{ id: "u1", farmId: "farm-p1" }]);
		membershipFindMany.mockResolvedValue([{ userId: "u1", orgId: "org-1" }]);
		organizationFindMany.mockResolvedValue([{ id: "org-1", name: "Alpha" }]);

		const queue = await getIncidentQueue(NOW);

		// One device row (pond + notification merged), one error, one job.
		expect(queue.incidents).toHaveLength(3);
		const pond = queue.incidents.find((incident) => incident.key === "device:p1");
		expect(pond?.sources).toEqual(["device", "notification"]);
		expect(pond?.severity).toBe("critical");
		expect(pond?.title).toBe("Pond 1 is offline");
		expect(pond?.tenantName).toBe("Alpha");
		expect(queue.summary.state).toBe("critical");
		expect(queue.sourceStates).toEqual({
			device: true,
			notification: true,
			error: true,
			job: true,
		});
		expect(queue.policyAvailable).toBe(true);
		expect(queue.truncated).toBe(false);
	});

	it("names a failed source and refuses to call the queue healthy", async () => {
		errorFindMany.mockRejectedValue(new Error("db down"));

		const queue = await getIncidentQueue(NOW);

		expect(queue.sourceStates.error).toBe(false);
		expect(queue.summary.failedSources).toEqual(["error"]);
		expect(queue.summary.state).toBe("unknown");
		expect(queue.summary.state).not.toBe("ok");
	});

	it("treats an unreadable device policy as a device-source failure, not a guess", async () => {
		policyMock.mockRejectedValue(new Error("setting unreadable"));
		deviceFindMany.mockResolvedValue([device("1", "p1", ago(60))]);

		const queue = await getIncidentQueue(NOW);

		expect(queue.policyAvailable).toBe(false);
		expect(queue.sourceStates.device).toBe(false);
		expect(queue.incidents).toEqual([]);
		expect(queue.summary.state).toBe("unknown");
	});

	it("keeps the failures of two readers independent", async () => {
		policyMock.mockRejectedValue(new Error("x"));
		jobFindMany.mockRejectedValue(new Error("y"));

		const queue = await getIncidentQueue(NOW);

		expect(queue.sourceStates).toEqual({
			device: false,
			notification: true,
			error: true,
			job: false,
		});
		expect(queue.summary.failedSources).toEqual(["device", "job"]);
	});

	it("does not name a tenant it could not resolve", async () => {
		deviceFindMany.mockResolvedValue([device("1", "p1", ago(60))]);
		userFindMany.mockRejectedValue(new Error("db down"));

		const queue = await getIncidentQueue(NOW);

		expect(queue.incidents[0]?.tenantName).toBeNull();
		expect(queue.sourceStates.device).toBe(false);
	});

	it("says when a source was cut at its cap", async () => {
		notificationFindMany.mockResolvedValue(
			Array.from({ length: INCIDENT_LIMIT + 1 }, (_, index) => ({
				id: `n${index}`,
				pondId: "p1",
				tier: "INFO",
				category: "feeding",
				message: `Note ${index}`,
				createdAt: ago(index + 1),
				pond: { id: "p1", name: "Pond 1", ownerId: "farm-p1" },
			})),
		);

		const queue = await getIncidentQueue(NOW);

		expect(queue.truncated).toBe(true);
		// The whole batch is one condition per (pond, category), so one row.
		expect(queue.incidents).toHaveLength(1);
		expect(queue.incidents[0]?.count).toBe(INCIDENT_LIMIT);
	});

	it("gates the read on the platform-admin check", async () => {
		await getIncidentQueue(NOW);
		expect(gateMock).toHaveBeenCalled();
	});
});
