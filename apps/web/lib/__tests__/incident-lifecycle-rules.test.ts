import { describe, expect, it } from "vitest";
import {
	type ExistingTrackedIncident,
	INCIDENT_ACK_TARGET_MS,
	type ObservedIncidentCondition,
	type PlatformIncidentStatus,
	deviceOfflineIncidentKey,
	escalationAckDueAt,
	failedJobIncidentKey,
	faultIncidentKey,
	isAckOverdue,
	isLegalTransition,
	isOpenIncidentStatus,
	notificationIncidentKey,
	planIncidentSync,
	safeModeIncidentKey,
	sortTrackedIncidents,
	summarizeTrackedIncidents,
	targetStatusForAction,
} from "../platform/incident-lifecycle-rules";

/**
 * The incident lifecycle rules (issue #479, M3C.6).
 *
 * These pin the contract the action, the sync and the page share: which moves
 * are legal, that resolved is terminal for operators, that the acknowledgement
 * target is exactly thirty minutes, and that one condition has one stable key.
 */

const NOW = new Date("2026-11-02T12:00:00.000Z");
const MINUTE = 60 * 1000;

function condition(key: string, overrides: Partial<ObservedIncidentCondition> = {}) {
	return {
		dedupeKey: key,
		source: "DEVICE_OFFLINE" as const,
		severity: "CRITICAL" as const,
		title: "Feeder A is offline",
		summary: null,
		orgId: "org-1",
		farmId: "farm-1",
		deviceId: "dev-1",
		pondId: "pond-1",
		observedAt: NOW,
		metadata: {},
		...overrides,
	};
}

function existing(
	id: string,
	key: string,
	status: PlatformIncidentStatus,
	overrides: Partial<ExistingTrackedIncident> = {},
): ExistingTrackedIncident {
	return {
		id,
		dedupeKey: key,
		source: "DEVICE_OFFLINE",
		status,
		orgId: "org-1",
		...overrides,
	};
}

describe("operator transitions", () => {
	it("allows the lifecycle chain and escalation from an open state", () => {
		expect(isLegalTransition("NEW", "ACKNOWLEDGED")).toBe(true);
		expect(isLegalTransition("ACKNOWLEDGED", "INVESTIGATING")).toBe(true);
		expect(isLegalTransition("INVESTIGATING", "RESOLVED")).toBe(true);
		expect(isLegalTransition("NEW", "ESCALATED")).toBe(true);
		expect(isLegalTransition("ACKNOWLEDGED", "ESCALATED")).toBe(true);
		expect(isLegalTransition("INVESTIGATING", "ESCALATED")).toBe(true);
	});

	it("allows an escalated incident to be acknowledged, investigated or resolved", () => {
		expect(isLegalTransition("ESCALATED", "ACKNOWLEDGED")).toBe(true);
		expect(isLegalTransition("ESCALATED", "INVESTIGATING")).toBe(true);
		expect(isLegalTransition("ESCALATED", "RESOLVED")).toBe(true);
	});

	it("rejects backwards and terminal moves", () => {
		expect(isLegalTransition("ACKNOWLEDGED", "NEW")).toBe(false);
		expect(isLegalTransition("INVESTIGATING", "ACKNOWLEDGED")).toBe(false);
		expect(isLegalTransition("ESCALATED", "NEW")).toBe(false);
		expect(isLegalTransition("RESOLVED", "NEW")).toBe(false);
		expect(isLegalTransition("RESOLVED", "ESCALATED")).toBe(false);
		expect(isLegalTransition("RESOLVED", "RESOLVED")).toBe(false);
	});

	it("maps each action to its target or null when illegal", () => {
		expect(targetStatusForAction("acknowledge", "NEW")).toBe("ACKNOWLEDGED");
		expect(targetStatusForAction("investigate", "ACKNOWLEDGED")).toBe("INVESTIGATING");
		expect(targetStatusForAction("resolve", "INVESTIGATING")).toBe("RESOLVED");
		expect(targetStatusForAction("escalate", "NEW")).toBe("ESCALATED");
		expect(targetStatusForAction("resolve", "NEW")).toBeNull();
		expect(targetStatusForAction("acknowledge", "RESOLVED")).toBeNull();
		expect(targetStatusForAction("resolve", "RESOLVED")).toBeNull();
	});

	it("treats resolved as closed and every other status as open", () => {
		expect(isOpenIncidentStatus("RESOLVED")).toBe(false);
		for (const status of ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "ESCALATED"] as const) {
			expect(isOpenIncidentStatus(status)).toBe(true);
		}
	});
});

describe("acknowledgement target (O20)", () => {
	it("sets exactly thirty minutes", () => {
		expect(INCIDENT_ACK_TARGET_MS).toBe(30 * MINUTE);
		expect(escalationAckDueAt(NOW).getTime()).toBe(NOW.getTime() + 30 * MINUTE);
	});

	it("is overdue only for an escalated incident past its target", () => {
		const due = new Date(NOW.getTime() - MINUTE);
		expect(isAckOverdue({ status: "ESCALATED", ackDueAt: due }, NOW)).toBe(true);
		expect(isAckOverdue({ status: "ACKNOWLEDGED", ackDueAt: due }, NOW)).toBe(false);
		expect(
			isAckOverdue({ status: "ESCALATED", ackDueAt: new Date(NOW.getTime() + MINUTE) }, NOW),
		).toBe(false);
		expect(isAckOverdue({ status: "ESCALATED", ackDueAt: null }, NOW)).toBe(false);
	});
});

describe("stable dedupe keys", () => {
	it("names one condition per device, fault and job", () => {
		expect(deviceOfflineIncidentKey("dev-1")).toBe("device_offline:dev-1");
		expect(safeModeIncidentKey("dev-1")).toBe("safe_mode:dev-1");
		expect(faultIncidentKey("dev-1", "rtc")).toBe("fault:dev-1:rtc");
		expect(failedJobIncidentKey("job-1")).toBe("failed_job:job-1");
		expect(notificationIncidentKey("pond-1", "connectivity")).toBe(
			"notification:pond-1:connectivity",
		);
		expect(notificationIncidentKey(null, null)).toBe("notification:__unassigned__:general");
	});
});

describe("sorting and summary", () => {
	function row(
		id: string,
		status: PlatformIncidentStatus,
		overrides: Partial<{
			severity: "CRITICAL" | "WARNING" | "INFO";
			openedAt: Date;
			ackDueAt: Date | null;
			resolvedAt: Date | null;
		}> = {},
	) {
		return {
			id,
			status,
			severity: overrides.severity ?? "WARNING",
			openedAt: overrides.openedAt ?? NOW,
			ackDueAt: overrides.ackDueAt ?? null,
			resolvedAt: overrides.resolvedAt ?? null,
		};
	}

	it("puts an overdue escalation first, then escalations, open work, then resolved", () => {
		const rows = [
			row("resolved", "RESOLVED", { resolvedAt: NOW }),
			row("open", "NEW"),
			row("escalated", "ESCALATED", { ackDueAt: new Date(NOW.getTime() + MINUTE) }),
			row("overdue", "ESCALATED", { ackDueAt: new Date(NOW.getTime() - MINUTE) }),
		];
		expect(sortTrackedIncidents(rows, NOW).map((entry) => entry.id)).toEqual([
			"overdue",
			"escalated",
			"open",
			"resolved",
		]);
	});

	it("summarises open severity, escalations, overdue targets and resolved rows", () => {
		const summary = summarizeTrackedIncidents(
			[
				row("a", "NEW", { severity: "CRITICAL" }),
				row("b", "ESCALATED", { severity: "WARNING", ackDueAt: new Date(NOW.getTime() - 1) }),
				row("c", "RESOLVED", { resolvedAt: NOW }),
			],
			NOW,
		);
		expect(summary).toMatchObject({
			open: 2,
			escalated: 1,
			overdue: 1,
			resolved: 1,
			counts: { CRITICAL: 1, WARNING: 1, INFO: 0 },
		});
	});
});

describe("planIncidentSync", () => {
	const available = new Set(["DEVICE_OFFLINE", "SAFE_MODE", "FAULT", "FAILED_JOB"] as const);

	it("opens a condition with no row", () => {
		const plan = planIncidentSync({
			observed: [condition("device_offline:dev-1")],
			existing: [],
			availableSources: available,
		});
		expect(plan.open.map((entry) => entry.dedupeKey)).toEqual(["device_offline:dev-1"]);
		expect(plan.refresh).toEqual([]);
		expect(plan.reopen).toEqual([]);
		expect(plan.resolve).toEqual([]);
	});

	it("refreshes an open row instead of opening a second incident", () => {
		const plan = planIncidentSync({
			observed: [condition("device_offline:dev-1")],
			existing: [existing("inc-1", "device_offline:dev-1", "ACKNOWLEDGED")],
			availableSources: available,
		});
		expect(plan.open).toEqual([]);
		expect(plan.refresh).toEqual([
			{ incidentId: "inc-1", condition: condition("device_offline:dev-1") },
		]);
	});

	it("reopens the same resolved row when the condition returns", () => {
		const plan = planIncidentSync({
			observed: [condition("device_offline:dev-1")],
			existing: [existing("inc-1", "device_offline:dev-1", "RESOLVED")],
			availableSources: available,
		});
		expect(plan.reopen).toEqual([
			{ incidentId: "inc-1", condition: condition("device_offline:dev-1") },
		]);
	});

	it("auto-resolves an open auto-managed row when its source reported and the condition is gone", () => {
		const plan = planIncidentSync({
			observed: [],
			existing: [existing("inc-1", "device_offline:dev-1", "INVESTIGATING")],
			availableSources: available,
		});
		expect(plan.resolve).toEqual([{ incidentId: "inc-1", from: "INVESTIGATING", orgId: "org-1" }]);
	});

	it("leaves rows alone when their source did not report", () => {
		const plan = planIncidentSync({
			observed: [],
			existing: [existing("inc-1", "device_offline:dev-1", "NEW")],
			availableSources: new Set(["FAILED_JOB"]),
		});
		expect(plan.resolve).toEqual([]);
	});

	it("never auto-resolves a manual or notification incident", () => {
		const plan = planIncidentSync({
			observed: [],
			existing: [
				existing("inc-1", "manual:1", "NEW", { source: "MANUAL" }),
				existing("inc-2", "notification:pond-1:feeding", "NEW", { source: "NOTIFICATION" }),
			],
			availableSources: available,
		});
		expect(plan.resolve).toEqual([]);
	});
});
