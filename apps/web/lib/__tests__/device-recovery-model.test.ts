import type { DeviceHealthReport } from "@/lib/device-health-model";
import {
	type BuildRecoveryPlanInput,
	type RecoveryDeviceSnapshot,
	SAFE_MODE_QUIET_DEFAULT_S,
	buildRecoveryPlan,
	compareResetHistory,
	parseResetReasons,
	quietGate,
	readRecoveryTelemetry,
	resetCause,
	resolveQuietSeconds,
	unavailableRecoveryPlan,
} from "@/lib/device-recovery-model";
import { describe, expect, it } from "vitest";

/**
 * M2 hardware recovery and diagnostics.
 *
 * The rules that matter:
 *  - a reset reason is classified from the firmware's own names, and `panic`
 *    (ESP_RST_PANIC, a controller crash) is never turned into a supply fault;
 *  - the 30-minute quiet gate is enforced on a controllable clock and cannot be
 *    satisfied by wall-clock time alone on a unit without an RTC;
 *  - another abnormal reset since the trip refuses recovery, even when the
 *    quiet window has passed;
 *  - a unit that cleared safe mode but is not verified healthy blocks the dose.
 */

const NOW = new Date("2026-11-07T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const POLICY = {
	weakAfterMs: 4 * 60_000,
	offlineAfterMs: 5 * 60_000,
	graceMs: 0,
};

function report(over: Partial<DeviceHealthReport> = {}): DeviceHealthReport {
	return {
		safeMode: false,
		faultsPresent: 0,
		faultsLatched: 0,
		lastFault: null,
		abnormalResets: 0,
		resetReasons: null,
		resetReason: null,
		uptimeS: null,
		...over,
	};
}

function row(createdAt: Date, over: Partial<DeviceHealthReport> = {}) {
	return { report: report(over), createdAt };
}

function device(over: Partial<RecoveryDeviceSnapshot> = {}): RecoveryDeviceSnapshot {
	return {
		lastSeenAt: new Date(NOW.getTime() - 30_000),
		rtcOk: true,
		wifiRssiDbm: -60,
		wifiRssiUpdatedAt: NOW,
		diag: null,
		...over,
	};
}

function plan(over: Partial<BuildRecoveryPlanInput> = {}) {
	return buildRecoveryPlan({
		now: NOW,
		device: device({ diag: { uptime_s: 10_800, fw: "1.9.0" } }),
		healthRows: [],
		firmwareVersion: "1.9.0",
		policy: POLICY,
		...over,
	});
}

/** A unit that tripped safe mode two hours ago and cleared it two hours ago. */
function clearedEpisode(over: Partial<DeviceHealthReport> = {}) {
	return [
		row(minutesAgo(120), {
			abnormalResets: 3,
			resetReasons: "panic",
			resetReason: "panic",
			...over,
		}),
		row(minutesAgo(150), {
			safeMode: true,
			abnormalResets: 3,
			resetReasons: "panic",
			resetReason: "panic",
		}),
	];
}

describe("reset-cause classification", () => {
	it("maps every on-wire reset name from fw::resetCodeName", () => {
		expect(resetCause("poweron")).toMatchObject({ class: "power_on", abnormal: false });
		expect(resetCause("external")).toMatchObject({ class: "external", abnormal: false });
		expect(resetCause("software")).toMatchObject({ class: "software", abnormal: false });
		expect(resetCause("panic")).toMatchObject({ class: "controller", abnormal: true });
		expect(resetCause("interrupt_wdt")).toMatchObject({ class: "watchdog", abnormal: true });
		expect(resetCause("task_wdt")).toMatchObject({ class: "watchdog", abnormal: true });
		expect(resetCause("wdt")).toMatchObject({ class: "watchdog", abnormal: true });
		expect(resetCause("deepsleep")).toMatchObject({ class: "deep_sleep", abnormal: false });
		expect(resetCause("brownout")).toMatchObject({ class: "power", abnormal: true });
		expect(resetCause("sdio")).toMatchObject({ class: "sdio", abnormal: false });
		expect(resetCause("unknown")).toMatchObject({ class: "unknown", abnormal: false });
	});

	it("never treats a panic as a supply fault", () => {
		expect(resetCause("panic")).toMatchObject({ class: "controller", powerRelated: false });
		expect(resetCause("brownout")).toMatchObject({ class: "power", powerRelated: true });
	});

	it("reads the aggregate brownout,panic string", () => {
		expect(parseResetReasons("brownout,panic").map((cause) => cause.class)).toEqual([
			"power",
			"controller",
		]);
		expect(parseResetReasons("none")).toEqual([]);
		expect(parseResetReasons("panic,panic")).toHaveLength(1);
		expect(parseResetReasons(null)).toEqual([]);
	});

	it("names an unknown code without inventing a cause", () => {
		expect(resetCause("mystery").class).toBe("unknown");
		expect(resetCause("").class).toBe("unknown");
	});
});

describe("readRecoveryTelemetry", () => {
	it("reads the 1.8.x/1.9.x diag fields", () => {
		expect(
			readRecoveryTelemetry({
				safe_mode: true,
				uptime_s: 120,
				reset_abnormal_count: 3,
				faults_present: 16,
				faults_latched: 16,
				last_fault: "safe_mode",
				fw: "1.9.0",
			}),
		).toEqual({
			safeMode: true,
			uptimeS: 120,
			abnormalResets: 3,
			faultsPresent: 16,
			faultsLatched: 16,
			lastFault: "safe_mode",
			firmwareVersion: "1.9.0",
		});
	});

	it("drops malformed values instead of trusting them", () => {
		expect(
			readRecoveryTelemetry({
				safe_mode: "yes",
				uptime_s: -4,
				reset_abnormal_count: 99_999,
				faults_present: "lots",
				fw: 7,
			}),
		).toEqual({
			safeMode: false,
			uptimeS: null,
			abnormalResets: null,
			faultsPresent: 0,
			faultsLatched: 0,
			lastFault: null,
			firmwareVersion: null,
		});
		expect(readRecoveryTelemetry(null).uptimeS).toBeNull();
	});
});

describe("quiet window", () => {
	it("uses the firmware default of 30 minutes", () => {
		expect(resolveQuietSeconds(null)).toBe(SAFE_MODE_QUIET_DEFAULT_S);
		expect(resolveQuietSeconds(90)).toBe(90);
		expect(resolveQuietSeconds(10)).toBe(SAFE_MODE_QUIET_DEFAULT_S);
	});

	it("is not satisfied one second before 30 quiet minutes", () => {
		const gate = quietGate({
			now: NOW,
			startedAt: new Date(NOW.getTime() - (30 * 60_000 - 1000)),
			uptimeS: 7200,
			rtcOk: true,
		});
		expect(gate.satisfied).toBe(false);
		expect(gate.remainingMs).toBe(1000);
		expect(gate.basis).toBe("wall_clock");
	});

	it("is satisfied at exactly 30 quiet minutes", () => {
		const gate = quietGate({
			now: NOW,
			startedAt: minutesAgo(30),
			uptimeS: 7200,
			rtcOk: true,
		});
		expect(gate).toMatchObject({
			satisfied: true,
			remainingMs: 0,
			requiredMs: 30 * 60_000,
		});
	});

	it("caps wall-clock time by uptime on a unit without an RTC", () => {
		// The firmware restarts its window on every boot without a clock, so two
		// hours since the trip proves nothing while uptime is five minutes.
		const gate = quietGate({
			now: NOW,
			startedAt: minutesAgo(120),
			uptimeS: 300,
			rtcOk: false,
		});
		expect(gate).toMatchObject({ satisfied: false, basis: "uptime", elapsedMs: 300_000 });

		const later = quietGate({
			now: NOW,
			startedAt: minutesAgo(120),
			uptimeS: 45 * 60,
			rtcOk: false,
		});
		expect(later).toMatchObject({ satisfied: true, basis: "uptime" });
	});

	it("does not claim a quiet window without evidence", () => {
		const gate = quietGate({
			now: NOW,
			startedAt: null,
			uptimeS: null,
			rtcOk: false,
		});
		expect(gate).toMatchObject({ satisfied: false, basis: "unknown", elapsedMs: 0 });
	});
});

describe("compareResetHistory", () => {
	const baseline = {
		now: NOW,
		baselineAt: minutesAgo(120),
		baselineAbnormalResets: 3,
		baselineReasons: "brownout",
	};

	it("sees no new reset when nothing changed", () => {
		expect(
			compareResetHistory({
				...baseline,
				currentAbnormalResets: 3,
				currentReasons: "brownout",
				uptimeS: 10_800,
			}),
		).toMatchObject({ abnormalSince: false, resetSince: false });
	});

	it("refuses recovery when the abnormal counter grew", () => {
		expect(
			compareResetHistory({
				...baseline,
				currentAbnormalResets: 4,
				currentReasons: "brownout,panic",
				uptimeS: 10_800,
			}),
		).toMatchObject({ abnormalSince: true, resetSince: true, newReasons: ["panic"] });
	});

	it("refuses recovery when a new reason appears even if the count is equal", () => {
		expect(
			compareResetHistory({
				...baseline,
				currentAbnormalResets: 3,
				currentReasons: "brownout,task_wdt",
				uptimeS: 10_800,
			}),
		).toMatchObject({ abnormalSince: true, newReasons: ["task_wdt"] });
	});

	it("treats a smaller counter as a cleared history, not a new fault", () => {
		expect(
			compareResetHistory({
				...baseline,
				currentAbnormalResets: 0,
				currentReasons: "none",
				uptimeS: 10_800,
			}),
		).toMatchObject({ abnormalSince: false, historyCleared: true, newReasons: [] });
	});

	it("catches a crash after a power-on cleared the counter", () => {
		// A clean power-on cleared the history, then one panic: the baseline is
		// the zero row, so 0 -> 1 is growth even though the trip count was 3.
		expect(
			compareResetHistory({
				now: NOW,
				baselineAt: minutesAgo(20),
				baselineAbnormalResets: 0,
				baselineReasons: "none",
				currentAbnormalResets: 1,
				currentReasons: "panic",
				uptimeS: 120,
			}),
		).toMatchObject({ abnormalSince: true, historyCleared: false, newReasons: ["panic"] });
	});
});

describe("recovery plan", () => {
	it("is healthy when the trip is old, quiet and verified", () => {
		const result = plan({ healthRows: clearedEpisode() });
		expect(result.state).toBe("HEALTHY");
		expect(result.readState).toBe("ok");
		expect(result.verified).toBe(true);
		expect(result.calibration).toEqual({ allowed: true, code: null });
		expect(result.safeToRecover).toBe(true);
	});

	it("reports safe mode and names the controller crash, not the PSU", () => {
		const result = plan({
			healthRows: [
				row(minutesAgo(5), {
					safeMode: true,
					faultsPresent: 16,
					faultsLatched: 16,
					abnormalResets: 3,
					resetReasons: "panic",
					resetReason: "panic",
				}),
			],
		});
		expect(result.state).toBe("SAFE_MODE");
		expect(result.calibration).toEqual({ allowed: false, code: "safe_mode" });
		expect(result.diagnosis).toMatchObject({
			primaryCause: "controller",
			powerRelated: false,
			bootResetReason: "panic",
		});
		expect(result.diagnosis.causes).toEqual(["controller"]);
	});

	it("reports a brownout as a power cause", () => {
		const result = plan({
			healthRows: [
				row(minutesAgo(5), {
					safeMode: true,
					abnormalResets: 3,
					resetReasons: "brownout",
					resetReason: "brownout",
				}),
			],
		});
		expect(result.diagnosis).toMatchObject({ primaryCause: "power", powerRelated: true });
	});

	it("does not let safe mode clear before the quiet window", () => {
		const result = plan({
			device: device({ diag: { uptime_s: 300, fw: "1.9.0" } }),
			healthRows: [
				row(minutesAgo(5), {
					safeMode: true,
					faultsPresent: 16,
					faultsLatched: 16,
					abnormalResets: 1,
					resetReasons: "panic",
					resetReason: "panic",
				}),
			],
		});
		expect(result.state).toBe("SAFE_MODE");
		expect(result.quiet.satisfied).toBe(false);
		expect(result.safeToRecover).toBe(false);
		expect(result.blockedBy).toBe("quiet_window");
		expect(result.calibration).toEqual({ allowed: false, code: "safe_mode" });
	});

	it("allows recovery once the 30-minute quiet window has passed", () => {
		const result = plan({
			device: device({ diag: { uptime_s: 2000, fw: "1.9.0" } }),
			healthRows: [
				row(minutesAgo(31), {
					safeMode: true,
					faultsPresent: 16,
					faultsLatched: 16,
					abnormalResets: 1,
					resetReasons: "panic",
					resetReason: "panic",
				}),
			],
		});
		expect(result.quiet.satisfied).toBe(true);
		expect(result.safeToRecover).toBe(true);
		expect(result.blockedBy).toBeNull();
	});

	it("treats the documented reset hold as the alternative to the quiet window", () => {
		// A clean boot with the reset history gone is the operator's deliberate
		// clear (Wi-Fi reset hold or a power cycle), not a crash: verification is
		// the remaining gate, not another 30 minutes.
		const result = plan({
			device: device({ diag: { uptime_s: 300, fw: "1.9.0" } }),
			healthRows: [
				row(minutesAgo(5), {
					abnormalResets: 0,
					resetReasons: "none",
					resetReason: "software",
				}),
				row(minutesAgo(10), {
					safeMode: true,
					abnormalResets: 3,
					resetReasons: "panic",
					resetReason: "panic",
				}),
			],
		});
		expect(result.state).toBe("HEALTHY");
		expect(result.safeToRecover).toBe(true);
		expect(result.calibration).toEqual({ allowed: true, code: null });
	});

	it("refuses recovery after another abnormal reset, even with a full quiet window", () => {
		const result = plan({
			healthRows: [
				row(minutesAgo(120), { abnormalResets: 4, resetReasons: "panic", resetReason: "panic" }),
				row(minutesAgo(150), { safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
			],
		});
		expect(result.quiet.satisfied).toBe(true);
		expect(result.repeatReset?.abnormalSince).toBe(true);
		expect(result.safeToRecover).toBe(false);
		expect(result.blockedBy).toBe("repeat_reset");
		expect(result.state).toBe("RECOVERING");
		expect(result.calibration).toEqual({ allowed: false, code: "recovering" });
	});

	it("keeps the 30-minute clock after a crash even when the counter was cleared", () => {
		// The firmware clears its history after 10 healthy minutes, but this boot
		// is still the one that crashed. It must not skip the quiet window.
		const result = plan({
			device: device({ diag: { uptime_s: 300, fw: "1.9.0" } }),
			healthRows: [
				row(minutesAgo(5), { abnormalResets: 0, resetReasons: "none", resetReason: "panic" }),
				row(minutesAgo(20), { abnormalResets: 1, resetReasons: "panic", resetReason: "panic" }),
				row(minutesAgo(30), { safeMode: true, abnormalResets: 0, resetReasons: "none" }),
			],
		});
		expect(result.repeatReset?.abnormalSince).toBe(false);
		expect(result.quiet.satisfied).toBe(false);
		expect(result.state).toBe("RECOVERING");
		expect(result.blockedBy).toBe("quiet_window");
	});

	it("blocks the dose when safe mode cleared but the unit is not healthy yet", () => {
		// No firmware version is reported, so the firmware check cannot pass.
		const result = plan({
			device: device({ diag: { uptime_s: 10_800 } }),
			firmwareVersion: null,
			healthRows: clearedEpisode(),
		});
		expect(result.checks.find((check) => check.id === "firmware")?.status).toBe("unknown");
		expect(result.verified).toBe(false);
		expect(result.state).toBe("RECOVERING");
		expect(result.calibration).toEqual({ allowed: false, code: "recovering" });
	});

	it("fails the heartbeat and connectivity checks on a late beat", () => {
		const result = plan({
			device: device({ lastSeenAt: minutesAgo(4.5) }),
			healthRows: clearedEpisode(),
		});
		expect(result.checks.find((check) => check.id === "heartbeat")?.status).toBe("fail");
		expect(result.checks.find((check) => check.id === "connectivity")?.status).toBe("fail");
		expect(result.state).toBe("RECOVERING");
	});

	it("reports FAULT and blocks the dose while a sensor fault is present", () => {
		const result = plan({
			healthRows: [
				row(minutesAgo(1), { faultsPresent: 1 << 1, faultsLatched: 1 << 1 }),
				...clearedEpisode(),
			],
		});
		expect(result.state).toBe("FAULT");
		expect(result.diagnosis.causes).toEqual([]);
		expect(result.calibration).toEqual({ allowed: false, code: "fault" });
	});

	it("reports OFFLINE when no heartbeat is recent", () => {
		const result = plan({
			device: device({ lastSeenAt: minutesAgo(30) }),
			healthRows: clearedEpisode(),
		});
		expect(result.state).toBe("OFFLINE");
		expect(result.calibration).toEqual({ allowed: false, code: "offline" });
	});

	it("does not invent a state for a unit that reports no health fields", () => {
		const result = plan({ healthRows: [], device: device({ diag: null }) });
		expect(result.state).toBeNull();
		// Older firmware: nothing to show, and nothing to block either.
		expect(result.readState).toBe("unsupported");
		expect(result.calibration.allowed).toBe(true);
	});

	it("describes a failed read as unavailable and fails open for the action", () => {
		const result = unavailableRecoveryPlan(NOW);
		expect(result.state).toBeNull();
		expect(result.readState).toBe("unavailable");
		expect(result.calibration.allowed).toBe(true);
		expect(result.safeToRecover).toBe(false);
	});
});
