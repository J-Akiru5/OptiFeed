import { describe, expect, it } from "vitest";
import { deviceStatusPolicyFromValue } from "../device-status";
import {
	type Incident,
	type IncidentCandidate,
	bandSeverity,
	buildDeviceIncidents,
	buildErrorIncidents,
	buildJobIncidents,
	buildNotificationIncidents,
	dedupeIncidents,
	deviceIncidentKey,
	errorEventSeverity,
	incidentAgeMs,
	notificationIncidentKey,
	notificationSeverity,
	sortIncidents,
	summarizeIncidents,
} from "../platform/incident-rules";

/**
 * The incident read model (issue #479, M3C.5).
 *
 * These tests pin the three claims the page makes: one condition is one row
 * even when two sources report it, severity comes from the shared band rule
 * rather than a new threshold, and a queue with a missing source can never be
 * summarised as `ok`.
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
		pondId,
		pondName: pondId ? `Pond ${pondId}` : null,
		tenantName: pondId ? "Alpha" : null,
		lastSeenAt,
	};
}

describe("severity from the existing sources", () => {
	it("maps band states without inventing a fifth one", () => {
		expect(bandSeverity("critical")).toBe("critical");
		expect(bandSeverity("degraded")).toBe("warning");
		expect(bandSeverity("unknown")).toBe("info");
		expect(bandSeverity("ok")).toBeNull();
	});

	it("maps notification tiers and error severities", () => {
		expect(notificationSeverity("CRITICAL")).toBe("critical");
		expect(notificationSeverity("WARNING")).toBe("warning");
		expect(notificationSeverity("INFO")).toBe("info");
		expect(notificationSeverity("SUCCESS")).toBe("info");

		// ErrorSeverity has no critical member, so an ERROR is a warning here.
		expect(errorEventSeverity("ERROR")).toBe("warning");
		expect(errorEventSeverity("WARNING")).toBe("warning");
		expect(errorEventSeverity("INFO")).toBe("info");
	});
});

describe("dedupe keys", () => {
	it("gives a connectivity notification the same key as the pond's fleet", () => {
		expect(notificationIncidentKey("pond-1", "connectivity")).toBe(deviceIncidentKey("pond-1"));
		expect(notificationIncidentKey("pond-1", "feeding")).not.toBe(deviceIncidentKey("pond-1"));
		expect(notificationIncidentKey(null, "feeding")).not.toBe(
			notificationIncidentKey("pond-1", "feeding"),
		);
	});
});

describe("buildDeviceIncidents", () => {
	it("crosses the band thresholds, not new ones", () => {
		// One of four offline is 25 % → degraded → warning.
		const [one] = buildDeviceIncidents(
			[
				device("1", "p1", ago(30)),
				device("2", "p1", ago(1)),
				device("3", "p1", ago(1)),
				device("4", "p1", ago(1)),
			],
			NOW,
			POLICY,
		);
		expect(one?.severity).toBe("warning");
		expect(one?.detail).toEqual({ offline: 1, total: 4 });

		// Two of four is 50 % → critical.
		const [two] = buildDeviceIncidents(
			[
				device("1", "p1", ago(30)),
				device("2", "p1", ago(30)),
				device("3", "p1", ago(1)),
				device("4", "p1", ago(1)),
			],
			NOW,
			POLICY,
		);
		expect(two?.severity).toBe("critical");
	});

	it("says nothing when the pond is healthy", () => {
		expect(
			buildDeviceIncidents([device("1", "p1", ago(1)), device("2", "p1", ago(2))], NOW, POLICY),
		).toEqual([]);
	});

	it("calls a pond that never reported unmeasured, not critical and not ok", () => {
		const [row] = buildDeviceIncidents([device("1", "p1", null)], NOW, POLICY);
		expect(row?.severity).toBe("info");
		expect(row?.since).toBeNull();
	});

	it("ages from the first unit that went quiet", () => {
		const [row] = buildDeviceIncidents(
			[device("1", "p1", ago(120)), device("2", "p1", ago(30)), device("3", "p1", ago(1))],
			NOW,
			POLICY,
		);
		expect(row?.since?.toISOString()).toBe(ago(120).toISOString());
	});
});

describe("dedupe and order", () => {
	const alert: IncidentCandidate = {
		source: "notification",
		key: deviceIncidentKey("p1"),
		title: "Pond 1 has been offline for 10 minutes",
		tenantName: "Alpha",
		pondName: "Pond 1",
		severity: "critical",
		since: ago(10),
		count: 1,
		href: null,
		detail: null,
	};
	const fleet: IncidentCandidate = {
		source: "device",
		key: deviceIncidentKey("p1"),
		title: null,
		tenantName: "Alpha",
		pondName: "Pond 1",
		severity: "warning",
		since: ago(40),
		count: 4,
		href: "/superadmin/devices",
		detail: { offline: 2, total: 4 },
	};

	it("collapses a connectivity alert and the silent fleet behind it into one row", () => {
		const [merged] = dedupeIncidents([fleet, alert]);
		expect(merged?.sources).toEqual(["device", "notification"]);
		expect(merged?.severity).toBe("critical");
		expect(merged?.since?.toISOString()).toBe(ago(40).toISOString());
		expect(merged?.count).toBe(5);
		expect(merged?.title).toBe(alert.title);
		expect(merged?.detail).toEqual({ offline: 2, total: 4 });
	});

	it("keeps unrelated conditions apart", () => {
		const feeding = buildNotificationIncidents([
			{
				id: "n2",
				pondId: "p1",
				pondName: "Pond 1",
				tenantName: "Alpha",
				tier: "WARNING",
				category: "feeding",
				message: "Feed skipped",
				createdAt: ago(3),
			},
		]);
		expect(dedupeIncidents([fleet, ...feeding])).toHaveLength(2);
	});

	it("puts the worst first, then the longest-standing", () => {
		const incidents = dedupeIncidents([
			{ ...fleet, key: "device:p2", severity: "warning", since: ago(10) },
			{ ...fleet, key: "device:p3", severity: "critical", since: ago(5) },
			{ ...fleet, key: "device:p4", severity: "critical", since: ago(60) },
		]);
		expect(incidents.map((incident) => incident.key)).toEqual([
			"device:p4",
			"device:p3",
			"device:p2",
		]);
	});

	it("sorts an undated incident after the dated ones in its severity", () => {
		const base: Incident = {
			key: "k",
			title: "x",
			tenantName: null,
			pondName: null,
			severity: "info",
			since: ago(5),
			count: 1,
			href: null,
			detail: null,
			sources: ["error"],
		};
		const sorted = sortIncidents([{ ...base, key: "undated", since: null }, base]);
		expect(sorted.map((incident) => incident.key)).toEqual(["k", "undated"]);
	});

	it("builds error and job rows with their own keys", () => {
		const [error] = buildErrorIncidents([
			{ id: "e1", message: "boom", severity: "ERROR", firstSeenAt: ago(20), count: 7 },
		]);
		expect(error?.severity).toBe("warning");
		expect(error?.count).toBe(7);

		const [job] = buildJobIncidents([
			{ id: "j1", type: "export_csv", error: "disk full", createdAt: ago(9), finishedAt: ago(8) },
		]);
		expect(job?.title).toBe("export_csv: disk full");
		expect(job?.since?.toISOString()).toBe(ago(8).toISOString());
	});
});

describe("summarizeIncidents", () => {
	const make = (severity: Incident["severity"]): Incident => ({
		key: `k-${severity}`,
		title: null,
		tenantName: null,
		pondName: null,
		severity,
		since: NOW,
		count: 1,
		href: null,
		detail: null,
		sources: ["job"],
	});

	it("is ok only when every source reported and nothing is open", () => {
		expect(summarizeIncidents([], []).state).toBe("ok");
	});

	it("is unknown when a source did not report, even with nothing open", () => {
		const summary = summarizeIncidents([], ["error"]);
		expect(summary.state).toBe("unknown");
		expect(summary.state).not.toBe("ok");
		expect(summary.failedSources).toEqual(["error"]);
	});

	it("still lets a real condition outrank a missing source", () => {
		expect(summarizeIncidents([make("warning")], ["job"]).state).toBe("degraded");
		expect(summarizeIncidents([make("critical")], ["job"]).state).toBe("critical");
		// An unmeasured pond alone is info, so a missing source stays the worse fact.
		expect(summarizeIncidents([make("info")], ["job"]).state).toBe("unknown");
	});

	it("counts by severity and reports the open total", () => {
		const summary = summarizeIncidents([make("critical"), make("warning"), make("info")], []);
		expect(summary.open).toBe(3);
		expect(summary.counts).toEqual({ critical: 1, warning: 1, info: 1 });
	});
});

describe("incidentAgeMs", () => {
	it("is null when the source cannot date the condition", () => {
		expect(incidentAgeMs(null, NOW)).toBeNull();
	});

	it("never reports a negative age", () => {
		expect(incidentAgeMs(new Date(NOW.getTime() + MINUTE), NOW)).toBe(0);
		expect(incidentAgeMs(ago(30), NOW)).toBe(30 * MINUTE);
	});
});
