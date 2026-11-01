import { describe, expect, it } from "vitest";
import {
	type BandFact,
	CRON_DEGRADED_AFTER_MIN,
	CRON_UNKNOWN_AFTER_MIN,
	DEVICES_OFFLINE_CRITICAL_PCT,
	DEVICES_OFFLINE_DEGRADED_PCT,
	PLATFORM_FAILED_JOBS_CRITICAL,
	PLATFORM_QUEUED_JOB_CRITICAL_MIN,
	PLATFORM_QUEUED_JOB_DEGRADED_MIN,
	PLATFORM_UNRESOLVED_ERRORS_CRITICAL,
	buildBand,
	cronState,
	deviceFleetState,
	failedJobsState,
	grantExpiryState,
	lockoutState,
	mfaState,
	pendingApprovalState,
	queuedJobState,
	tenantStatusState,
	unresolvedErrorsState,
	worstState,
} from "../platform/status-band-rules";

/**
 * Status band rules for the Platform Command Center (issue #479, M3C.2).
 *
 * One test per rule, plus the two invariants the page depends on: a source that
 * did not report is never `ok`, and a band is its worst fact rather than an
 * average that could hide a failing fleet behind a healthy one.
 */

describe("worstState", () => {
	it("ranks critical above everything and never averages", () => {
		expect(worstState(["ok", "ok", "critical", "degraded"])).toBe("critical");
		expect(worstState(["ok", "degraded", "ok"])).toBe("degraded");
	});

	it("never lets an unknown source collapse into ok", () => {
		expect(worstState(["ok", "unknown"])).toBe("unknown");
		expect(worstState(["unknown", "ok", "ok"])).toBe("unknown");
	});

	it("still surfaces a known fault above an unknown", () => {
		expect(worstState(["unknown", "critical"])).toBe("critical");
		expect(worstState(["unknown", "degraded"])).toBe("degraded");
	});

	it("is ok only when every fact is ok", () => {
		expect(worstState(["ok", "ok"])).toBe("ok");
		expect(worstState([])).toBe("ok");
	});
});

describe("buildBand", () => {
	it("takes the worst fact and keeps every fact for the page", () => {
		const facts: BandFact[] = [
			{ key: "a", state: "ok", value: 0, threshold: 1 },
			{ key: "b", state: "degraded", value: 3, threshold: 1 },
		];
		const band = buildBand("platform", facts);
		expect(band.key).toBe("platform");
		expect(band.state).toBe("degraded");
		expect(band.facts.map((fact) => fact.key)).toEqual(["a", "b"]);
	});
});

describe("failed jobs", () => {
	it("is unknown when the queue did not report", () => {
		expect(failedJobsState(null)).toBe("unknown");
	});

	it("is ok with no failures, degraded with one and critical at the limit", () => {
		expect(failedJobsState(0)).toBe("ok");
		expect(failedJobsState(1)).toBe("degraded");
		expect(failedJobsState(PLATFORM_FAILED_JOBS_CRITICAL - 1)).toBe("degraded");
		expect(failedJobsState(PLATFORM_FAILED_JOBS_CRITICAL)).toBe("critical");
	});
});

describe("oldest queued job", () => {
	it("is unknown when nothing measured the queue", () => {
		expect(queuedJobState(null)).toBe("unknown");
	});

	it("separates fresh, late and stalled", () => {
		expect(queuedJobState(0)).toBe("ok");
		expect(queuedJobState(PLATFORM_QUEUED_JOB_DEGRADED_MIN)).toBe("ok");
		expect(queuedJobState(PLATFORM_QUEUED_JOB_DEGRADED_MIN + 1)).toBe("degraded");
		expect(queuedJobState(PLATFORM_QUEUED_JOB_CRITICAL_MIN)).toBe("degraded");
		expect(queuedJobState(PLATFORM_QUEUED_JOB_CRITICAL_MIN + 1)).toBe("critical");
	});
});

describe("cron freshness", () => {
	it("is ok inside the healthy window and degraded once late", () => {
		expect(cronState(0)).toBe("ok");
		expect(cronState(CRON_DEGRADED_AFTER_MIN)).toBe("ok");
		expect(cronState(CRON_DEGRADED_AFTER_MIN + 1)).toBe("degraded");
	});

	it("becomes unknown once the row is too old to trust, never ok", () => {
		expect(cronState(CRON_UNKNOWN_AFTER_MIN)).toBe("degraded");
		expect(cronState(CRON_UNKNOWN_AFTER_MIN + 1)).toBe("unknown");
		expect(cronState(null)).toBe("unknown");
	});
});

describe("unresolved errors", () => {
	it("is unknown without a reading and critical at the limit", () => {
		expect(unresolvedErrorsState(null)).toBe("unknown");
		expect(unresolvedErrorsState(0)).toBe("ok");
		expect(unresolvedErrorsState(1)).toBe("degraded");
		expect(unresolvedErrorsState(PLATFORM_UNRESOLVED_ERRORS_CRITICAL)).toBe("critical");
	});
});

describe("tenant status", () => {
	it("is unknown when there is nothing to measure", () => {
		expect(tenantStatusState({ suspended: 0, pendingDeletion: 0, total: 0 })).toBe("unknown");
		expect(tenantStatusState({ suspended: null, pendingDeletion: 0, total: 5 })).toBe("unknown");
	});

	it("is ok only while every organization is active", () => {
		expect(tenantStatusState({ suspended: 0, pendingDeletion: 0, total: 4 })).toBe("ok");
		expect(tenantStatusState({ suspended: 1, pendingDeletion: 0, total: 4 })).toBe("degraded");
		expect(tenantStatusState({ suspended: 0, pendingDeletion: 1, total: 4 })).toBe("degraded");
	});
});

describe("device fleet", () => {
	it("is unknown when no unit has ever reported", () => {
		expect(deviceFleetState({ offline: 0, reporting: 0, total: 0 })).toBe("unknown");
		expect(deviceFleetState({ offline: 0, reporting: 0, total: 5 })).toBe("unknown");
		expect(deviceFleetState({ offline: null, reporting: 5, total: 5 })).toBe("unknown");
	});

	it("is ok below the degraded share", () => {
		expect(deviceFleetState({ offline: 0, reporting: 10, total: 10 })).toBe("ok");
	});

	it("is degraded at the degraded share and critical at the critical share", () => {
		expect(
			deviceFleetState({ offline: DEVICES_OFFLINE_DEGRADED_PCT, reporting: 100, total: 100 }),
		).toBe("degraded");
		expect(
			deviceFleetState({ offline: DEVICES_OFFLINE_CRITICAL_PCT, reporting: 100, total: 100 }),
		).toBe("critical");
		expect(deviceFleetState({ offline: 9, reporting: 10, total: 10 })).toBe("critical");
	});
});

describe("security facts", () => {
	it("treats an unread lockout count as unknown, and any lockout as degraded", () => {
		expect(lockoutState(null)).toBe("unknown");
		expect(lockoutState(0)).toBe("ok");
		expect(lockoutState(1)).toBe("degraded");
	});

	it("flags a temporary grant near expiry", () => {
		expect(grantExpiryState(null)).toBe("unknown");
		expect(grantExpiryState(0)).toBe("ok");
		expect(grantExpiryState(2)).toBe("degraded");
	});

	it("flags devices waiting for approval", () => {
		expect(pendingApprovalState(null)).toBe("unknown");
		expect(pendingApprovalState(0)).toBe("ok");
		expect(pendingApprovalState(1)).toBe("degraded");
	});

	it("does not call MFA a failure while enrolment is not shipped", () => {
		expect(mfaState({ unenrolled: 3, enrolled: 0 })).toBe("unknown");
		expect(mfaState({ unenrolled: null, enrolled: 0 })).toBe("unknown");
	});

	it("flags an unenrolled admin once anyone has enrolled", () => {
		expect(mfaState({ unenrolled: 0, enrolled: 2 })).toBe("ok");
		expect(mfaState({ unenrolled: 1, enrolled: 2 })).toBe("degraded");
	});
});
