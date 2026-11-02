import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		platformIncident: { create: vi.fn(), updateMany: vi.fn() },
		platformIncidentEvent: { create: vi.fn() },
	};
	const db = {
		energyDevice: { findMany: vi.fn() },
		deviceStateEvent: { findMany: vi.fn() },
		backgroundJob: { findMany: vi.fn() },
		platformIncident: { findMany: vi.fn(), updateMany: vi.fn() },
		$transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/actions/platform/audit", () => ({ writePlatformAudit: vi.fn() }));
vi.mock("@/lib/settings/device-status", () => ({ getDeviceStatusPolicy: vi.fn() }));
vi.mock("@/lib/platform/tenant-resolution", () => ({ resolveFarmsToOrganizations: vi.fn() }));

import { writePlatformAudit } from "@/lib/actions/platform/audit";
import { deviceStatusPolicyFromValue } from "@/lib/device-status";
import {
	INCIDENT_SYNC_CHANGE_LIMIT,
	INCIDENT_SYNC_DEVICE_LIMIT,
	buildObservedConditions,
	syncPlatformIncidents,
} from "@/lib/platform/incident-sync";
import { resolveFarmsToOrganizations } from "@/lib/platform/tenant-resolution";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * The incident sync (issue #479, M3C.6).
 *
 * The device watch owns four conditions. These tests pin the upsert shape: one
 * row per stable key, a refresh instead of a duplicate, a reopen of the same row
 * when the condition returns, and an auto-resolve only when the source that owns
 * the condition actually reported.
 */

const NOW = new Date("2026-11-02T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number) {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function device(id: string, lastSeenAt: Date | null) {
	return {
		id,
		label: `Feeder ${id}`,
		lastSeenAt,
		pondId: "pond-1",
		pond: { id: "pond-1", name: "Pond 1", ownerId: "farm-1" },
	};
}

const OFFLINE = device("dev-1", ago(30));
const ONLINE = device("dev-1", ago(1));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getDeviceStatusPolicy).mockResolvedValue(POLICY);
	vi.mocked(resolveFarmsToOrganizations).mockResolvedValue(
		new Map([["farm-1", { id: "org-1", name: "Alpha" }]]),
	);
	vi.mocked(writePlatformAudit).mockResolvedValue(undefined);
	db.energyDevice.findMany.mockResolvedValue([OFFLINE]);
	db.deviceStateEvent.findMany.mockResolvedValue([]);
	db.backgroundJob.findMany.mockResolvedValue([]);
	db.platformIncident.findMany.mockResolvedValue([]);
	db.platformIncident.updateMany.mockReset().mockResolvedValue({ count: 1 });
	db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
	tx.platformIncident.create.mockReset().mockResolvedValue({ id: "inc-new" });
	tx.platformIncident.updateMany.mockReset().mockResolvedValue({ count: 1 });
	tx.platformIncidentEvent.create.mockReset().mockResolvedValue({});
});

function existingRow(
	id: string,
	key: string,
	status: string,
	source = "DEVICE_OFFLINE",
	orgId: string | null = "org-1",
) {
	return { id, dedupeKey: key, source, status, orgId };
}

describe("buildObservedConditions", () => {
	it("maps an offline device, safe mode, faults and a failed job to stable keys", () => {
		const conditions = buildObservedConditions({
			devices: [OFFLINE],
			healthRows: [
				{
					deviceId: "dev-1",
					createdAt: ago(10),
					metadata: { safeMode: true, faultsPresent: 2, faultsLatched: 0 },
				},
			],
			jobs: [
				{
					id: "job-1",
					type: "export_csv",
					error: "disk full",
					ownerId: "farm-1",
					createdAt: ago(20),
					finishedAt: ago(19),
				},
			],
			policy: POLICY,
			tenantByFarm: new Map([["farm-1", { id: "org-1", name: "Alpha" }]]),
			now: NOW,
		});

		expect(conditions.map((condition) => condition.dedupeKey)).toEqual([
			"device_offline:dev-1",
			"safe_mode:dev-1",
			"fault:dev-1:hopper_sensor",
			"failed_job:job-1",
		]);
		expect(conditions[0]).toMatchObject({
			source: "DEVICE_OFFLINE",
			severity: "CRITICAL",
			orgId: "org-1",
			pondId: "pond-1",
		});
		expect(conditions[1]).toMatchObject({ source: "SAFE_MODE", severity: "CRITICAL" });
		expect(conditions[2]).toMatchObject({ source: "FAULT", severity: "WARNING" });
		expect(conditions[3]).toMatchObject({ source: "FAILED_JOB", orgId: "org-1" });
	});

	it("does not call a never-seen unit offline", () => {
		const conditions = buildObservedConditions({
			devices: [device("dev-2", null)],
			healthRows: [],
			jobs: [],
			policy: POLICY,
			tenantByFarm: new Map(),
			now: NOW,
		});
		expect(conditions).toEqual([]);
	});
});

describe("syncPlatformIncidents", () => {
	it("opens one incident and writes a timeline event plus an audit row", async () => {
		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ opened: 1, failed: false });
		expect(tx.platformIncident.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					dedupeKey: "device_offline:dev-1",
					source: "DEVICE_OFFLINE",
					status: "NEW",
					orgId: "org-1",
				}),
			}),
		);
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					incidentId: "inc-new",
					type: "AUTO_OPENED",
					actorId: null,
					fromStatus: null,
					toStatus: "NEW",
				}),
			}),
		);
		expect(writePlatformAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				action: "platform.incident.auto_open",
				targetId: "inc-new",
				actorUserId: "system",
				orgId: "org-1",
			}),
		);
	});

	it("refreshes an open incident instead of opening a second one", async () => {
		db.platformIncident.findMany.mockResolvedValue([
			existingRow("inc-1", "device_offline:dev-1", "ACKNOWLEDGED"),
		]);

		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ opened: 0, refreshed: 1, failed: false });
		expect(tx.platformIncident.create).not.toHaveBeenCalled();
		expect(db.platformIncident.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "inc-1" },
				data: expect.objectContaining({ lastSeenAt: NOW }),
			}),
		);
	});

	it("auto-resolves an open incident when the device reports again", async () => {
		db.energyDevice.findMany.mockResolvedValue([ONLINE]);
		db.platformIncident.findMany.mockResolvedValue([
			existingRow("inc-1", "device_offline:dev-1", "INVESTIGATING"),
		]);

		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ resolved: 1, failed: false });
		expect(tx.platformIncident.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "inc-1", status: "INVESTIGATING" },
				data: { status: "RESOLVED", resolvedAt: NOW },
			}),
		);
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					type: "AUTO_RESOLVED",
					actorId: null,
					fromStatus: "INVESTIGATING",
					toStatus: "RESOLVED",
				}),
			}),
		);
		expect(writePlatformAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({ action: "platform.incident.auto_resolve" }),
		);
	});

	it("auto-resolves a failed-job incident when the job is no longer failed", async () => {
		db.energyDevice.findMany.mockResolvedValue([]);
		db.backgroundJob.findMany.mockResolvedValue([]);
		db.platformIncident.findMany.mockResolvedValue([
			existingRow("inc-2", "failed_job:job-1", "NEW", "FAILED_JOB", null),
		]);

		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ resolved: 1, failed: false });
		expect(tx.platformIncident.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "inc-2", status: "NEW" },
				data: { status: "RESOLVED", resolvedAt: NOW },
			}),
		);
	});

	it("reopens the same resolved row when the condition returns", async () => {
		db.platformIncident.findMany.mockResolvedValue([
			existingRow("inc-1", "device_offline:dev-1", "RESOLVED"),
		]);

		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ reopened: 1, opened: 0, failed: false });
		expect(tx.platformIncident.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "inc-1", status: "RESOLVED" },
				data: expect.objectContaining({
					status: "NEW",
					resolvedAt: null,
					ownerId: null,
					ackDueAt: null,
				}),
			}),
		);
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ type: "AUTO_OPENED", fromStatus: "RESOLVED" }),
			}),
		);
	});

	it("never auto-resolves a source that failed to report", async () => {
		db.energyDevice.findMany.mockRejectedValue(new Error("db down"));
		db.platformIncident.findMany.mockResolvedValue([
			existingRow("inc-1", "device_offline:dev-1", "NEW"),
		]);

		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ resolved: 0, failed: false });
		expect(result.sources.device).toBe(false);
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
	});

	it("does not auto-resolve from a source that hit its read cap", async () => {
		db.energyDevice.findMany.mockResolvedValue(
			Array.from({ length: INCIDENT_SYNC_DEVICE_LIMIT + 1 }, (_, index) =>
				device(`dev-${index}`, ago(1)),
			),
		);
		db.platformIncident.findMany.mockResolvedValue([
			existingRow("inc-1", "device_offline:dev-1", "NEW"),
		]);

		const result = await syncPlatformIncidents(NOW);

		expect(result).toMatchObject({ resolved: 0, failed: false, truncated: true });
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
	});

	it("stops at the per-run write budget and reports the rest as deferred", async () => {
		db.energyDevice.findMany.mockResolvedValue(
			Array.from({ length: INCIDENT_SYNC_CHANGE_LIMIT + 10 }, (_, index) =>
				device(`dev-${index}`, ago(30)),
			),
		);

		const result = await syncPlatformIncidents(NOW);

		expect(result.opened).toBe(INCIDENT_SYNC_CHANGE_LIMIT);
		expect(result.deferred).toBe(10);
		expect(result.failed).toBe(false);
	});

	it("reports a failed write as failed instead of a partial success", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		tx.platformIncident.create.mockRejectedValue(new Error("insert failed"));

		const result = await syncPlatformIncidents(NOW);

		expect(result.failed).toBe(true);
		expect(result.opened).toBe(0);
		warn.mockRestore();
	});

	it("reports a failed incident read as failed, never as an empty success", async () => {
		db.platformIncident.findMany.mockRejectedValue(new Error("incident table missing"));

		const result = await syncPlatformIncidents(NOW);

		expect(result.failed).toBe(true);
		expect(result.opened).toBe(0);
		expect(tx.platformIncident.create).not.toHaveBeenCalled();
	});
});
