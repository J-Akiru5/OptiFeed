import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx, gate, audit } = vi.hoisted(() => {
	const tx = {
		platformIncident: { updateMany: vi.fn() },
		platformIncidentEvent: { create: vi.fn() },
	};
	const db = {
		platformIncident: { findUnique: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return {
		db,
		tx,
		gate: vi.fn(),
		audit: { writePlatformAudit: vi.fn(), actorContext: vi.fn() },
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gate }));
vi.mock("@/lib/actions/platform/audit", () => ({
	writePlatformAudit: audit.writePlatformAudit,
	actorContext: audit.actorContext,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
	acknowledgePlatformIncident,
	escalatePlatformIncident,
	investigatePlatformIncident,
	resolvePlatformIncident,
} from "@/lib/actions/platform/incidents";
import { INCIDENT_ACK_TARGET_MS } from "@/lib/platform/incident-lifecycle-rules";

/**
 * Operator incident actions (issue #479, M3C.6).
 *
 * Every test asserts one of the contract's promises: the platform-admin gate
 * runs first, an illegal or terminal transition writes nothing, a legal one
 * writes exactly one timeline event and one audit row, and escalation sets the
 * named owner plus the 30-minute acknowledgement target without any external
 * channel.
 */

const NOW = new Date("2026-11-02T12:00:00.000Z");
const REASON = "Checked the feeder logs with the site operator";
const ADMIN = "admin-1";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.clearAllMocks();
	gate.mockResolvedValue(undefined);
	audit.actorContext.mockResolvedValue({ id: ADMIN, temporaryGrant: false });
	audit.writePlatformAudit.mockResolvedValue(undefined);
	db.platformIncident.findUnique.mockResolvedValue({
		id: "inc-1",
		status: "NEW",
		orgId: "org-1",
	});
	db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
	db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
	tx.platformIncident.updateMany.mockReset().mockResolvedValue({ count: 1 });
	tx.platformIncidentEvent.create.mockReset().mockResolvedValue({});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("permission gate", () => {
	it("denies a non-platform-admin before reading or writing an incident", async () => {
		gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(
			acknowledgePlatformIncident({ incidentId: "inc-1", reason: REASON }),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(db.platformIncident.findUnique).not.toHaveBeenCalled();
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
	});
});

describe("validation", () => {
	it("requires a reason of at least ten characters", async () => {
		const result = await acknowledgePlatformIncident({ incidentId: "inc-1", reason: "short" });
		expect(result).toEqual({ code: "reason", error: expect.stringContaining("10") });
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
	});

	it("rejects an illegal transition from a resolved incident", async () => {
		db.platformIncident.findUnique.mockResolvedValue({
			id: "inc-1",
			status: "RESOLVED",
			orgId: "org-1",
		});

		const result = await acknowledgePlatformIncident({ incidentId: "inc-1", reason: REASON });

		expect(result).toMatchObject({ code: "invalid_transition" });
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
		expect(audit.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("rejects an unknown incident", async () => {
		db.platformIncident.findUnique.mockResolvedValue(null);
		expect(await acknowledgePlatformIncident({ incidentId: "gone", reason: REASON })).toEqual({
			code: "not_found",
			error: expect.any(String),
		});
	});
});

describe("legal transitions", () => {
	it("acknowledges a new incident with one event and one audit row", async () => {
		const result = await acknowledgePlatformIncident({ incidentId: "inc-1", reason: REASON });

		expect(result).toEqual({ success: true, status: "ACKNOWLEDGED" });
		expect(tx.platformIncident.updateMany).toHaveBeenCalledWith({
			where: { id: "inc-1", status: "NEW" },
			data: { status: "ACKNOWLEDGED", acknowledgedAt: NOW },
		});
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledTimes(1);
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					incidentId: "inc-1",
					type: "ACKNOWLEDGED",
					fromStatus: "NEW",
					toStatus: "ACKNOWLEDGED",
					actorId: ADMIN,
					note: REASON,
				}),
			}),
		);
		expect(audit.writePlatformAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				actorUserId: ADMIN,
				action: "platform.incident.acknowledge",
				targetType: "platform_incident",
				targetId: "inc-1",
				reason: REASON,
				before: { status: "NEW" },
				after: { status: "ACKNOWLEDGED" },
			}),
		);
	});

	it("moves an acknowledged incident to investigating", async () => {
		db.platformIncident.findUnique.mockResolvedValue({
			id: "inc-1",
			status: "ACKNOWLEDGED",
			orgId: "org-1",
		});

		const result = await investigatePlatformIncident({ incidentId: "inc-1", reason: REASON });

		expect(result).toEqual({ success: true, status: "INVESTIGATING" });
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ type: "INVESTIGATING", toStatus: "INVESTIGATING" }),
			}),
		);
	});

	it("resolves an escalated incident, which the contract explicitly allows", async () => {
		db.platformIncident.findUnique.mockResolvedValue({
			id: "inc-1",
			status: "ESCALATED",
			orgId: "org-1",
		});

		const result = await resolvePlatformIncident({ incidentId: "inc-1", reason: REASON });

		expect(result).toEqual({ success: true, status: "RESOLVED" });
		expect(tx.platformIncident.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "inc-1", status: "ESCALATED" },
				data: { status: "RESOLVED", resolvedAt: NOW },
			}),
		);
	});

	it("reports a concurrent change without claiming success", async () => {
		tx.platformIncident.updateMany.mockResolvedValue({ count: 0 });

		const result = await acknowledgePlatformIncident({ incidentId: "inc-1", reason: REASON });

		expect(result).toMatchObject({ code: "conflict" });
		expect(audit.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("reports an unexpected write failure without claiming success", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
		tx.platformIncident.updateMany.mockRejectedValue(new Error("db down"));

		const result = await acknowledgePlatformIncident({ incidentId: "inc-1", reason: REASON });

		expect(result).toMatchObject({ code: "invalid_transition" });
		expect(audit.writePlatformAudit).not.toHaveBeenCalled();
		errorLog.mockRestore();
	});
});

describe("escalation (O20)", () => {
	it("assigns the named platform-admin owner and the thirty-minute target", async () => {
		const result = await escalatePlatformIncident({
			incidentId: "inc-1",
			ownerId: "admin-2",
			reason: REASON,
		});

		expect(result).toEqual({ success: true, status: "ESCALATED" });
		expect(db.platformAdmin.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { userId: "admin-2" } }),
		);
		expect(tx.platformIncident.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "ESCALATED",
					ownerId: "admin-2",
					escalatedAt: NOW,
					ackDueAt: new Date(NOW.getTime() + INCIDENT_ACK_TARGET_MS),
				}),
			}),
		);
		// One transition event and one in-app notification event; no external channel.
		expect(tx.platformIncidentEvent.create).toHaveBeenCalledTimes(2);
		expect(tx.platformIncidentEvent.create).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				data: expect.objectContaining({ type: "ESCALATED", toStatus: "ESCALATED" }),
			}),
		);
		expect(tx.platformIncidentEvent.create).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				data: expect.objectContaining({
					type: "NOTIFIED",
					metadata: expect.objectContaining({
						channel: "in_app",
						audience: "platform_admin",
						ownerId: "admin-2",
					}),
				}),
			}),
		);
		expect(audit.writePlatformAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				action: "platform.incident.escalate",
				after: expect.objectContaining({
					status: "ESCALATED",
					ownerId: "admin-2",
					ackDueAt: new Date(NOW.getTime() + INCIDENT_ACK_TARGET_MS).toISOString(),
				}),
			}),
		);
	});

	it("requires an owner", async () => {
		const result = await escalatePlatformIncident({
			incidentId: "inc-1",
			ownerId: "",
			reason: REASON,
		});
		expect(result).toMatchObject({ code: "owner_required" });
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
	});

	it("refuses an owner without an active platform-admin grant", async () => {
		db.platformAdmin.findUnique.mockResolvedValue({
			revokedAt: new Date("2026-10-01T00:00:00.000Z"),
			expiresAt: null,
		});

		const result = await escalatePlatformIncident({
			incidentId: "inc-1",
			ownerId: "admin-2",
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "owner_invalid" });
		expect(tx.platformIncident.updateMany).not.toHaveBeenCalled();
	});
});
