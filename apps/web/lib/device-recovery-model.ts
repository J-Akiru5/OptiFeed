/**
 * Hardware recovery and diagnostics for a unit that tripped safe mode (M2).
 *
 * Safe mode is decided by the firmware, not by this file. The firmware counts
 * abnormal resets, locks the relay and clears the lock after its quiet window
 * (`safeModeQuietS`, 30 minutes by default). M1 taught the dashboard to stop
 * offering a dose the relay would refuse. M2 turns the unit's own reset record
 * into a decision the dashboard, the operator and the firmware can all follow:
 *
 *  1. detect the cause — reset reason, safe-mode status, uptime, power evidence;
 *  2. decide whether recovery is safe — another abnormal reset since the trip
 *     means safe mode is not a thing to clear, but a thing to investigate;
 *  3. name the clear mechanism that applies to this board;
 *  4. verify hardware health before the unit is called recovered;
 *  5. only then let calibration dispense.
 *
 * Pure model: no database import, so the hardware page, the calibration action
 * and the tests all use the same rules (`device-recovery.ts` owns the reads).
 *
 * What the firmware already reports (verified against
 * `firmware/firmware-main/firmware-main.ino` `sendTelemetry()`):
 *
 *  - `safe_mode` and `diag.safe_mode`;
 *  - `reset_reason` (this boot) and `last_reset_reasons` (aggregate names);
 *  - `diag.uptime_s`, `diag.reset_abnormal_count`, `diag.reset_reason_mask`;
 *  - `diag.faults_present` / `faults_latched` / `last_fault`;
 *  - `diag.fw` (the running version, refreshed on every heartbeat).
 *
 * What it does not report, and this file therefore never claims:
 *
 *  - any voltage or current measurement. The only power evidence is a
 *    `brownout` reset, so a `panic` is classified as a controller crash and is
 *    never turned into "check the power supply";
 *  - the remaining seconds of the safe-mode quiet window
 *    (`diag.safe_mode_remaining_s` is the exact field to add; see the PR body),
 *    so the window below is derived conservatively;
 *  - whether the enclosure has the GPIO 17 Wi-Fi reset button wired. The
 *    firmware supports the 5 s hold unconditionally; only the operator can
 *    confirm the button exists, so the dashboard names it as conditional.
 */

import type { DeviceHealthReport } from "@/lib/device-health-model";
import { faultsFromMask } from "@/lib/device-health-model";
import type { DeviceStatusPolicy } from "@/lib/device-status";
import { evaluateDeviceStatus, isDeviceUnreachable, resolveRssiDbm } from "@/lib/device-status";

/** Reset-history rows read for one recovery decision (newest first). */
export const RECOVERY_HEALTH_ROWS = 6;

/** Firmware default for `safe_mode_quiet_s` (`firmware/firmware-main/config.h`). */
export const SAFE_MODE_QUIET_DEFAULT_S = 1800;
/** The firmware envelope for `safe_mode_quiet_s`; a stored value outside it is ignored. */
export const SAFE_MODE_QUIET_MIN_S = 60;
export const SAFE_MODE_QUIET_MAX_S = 86400;

/**
 * The shared health vocabulary from the roadmap. `MAINTENANCE` is part of the
 * target model but no source exists in this app yet (there is no administrative
 * maintenance flag on `EnergyDevice`), so nothing here returns it; it is listed
 * so a future surface cannot invent a seventh name.
 */
export type DeviceHealthState =
	| "HEALTHY"
	| "SAFE_MODE"
	| "RECOVERING"
	| "OFFLINE"
	| "FAULT"
	| "MAINTENANCE";

/** What a reset says about the hardware. Only `brownout` is a supply fault. */
export type ResetCauseClass =
	| "power"
	| "controller"
	| "watchdog"
	| "software"
	| "external"
	| "power_on"
	| "deep_sleep"
	| "sdio"
	| "unknown";

interface ResetCauseSpec {
	class: ResetCauseClass;
	/** Counted toward safe mode by `fw::resetIsAbnormal` (safety.h). */
	abnormal: boolean;
	/** Evidence of a supply problem. `panic` is deliberately false. */
	powerRelated: boolean;
}

/**
 * The on-wire reset names, copied from `fw::resetCodeName` in
 * `firmware/firmware-main/safety.h`. Keep this table in lockstep with it.
 */
const RESET_CAUSE_SPECS: Record<string, ResetCauseSpec> = {
	poweron: { class: "power_on", abnormal: false, powerRelated: false },
	external: { class: "external", abnormal: false, powerRelated: false },
	software: { class: "software", abnormal: false, powerRelated: false },
	// ESP_RST_PANIC: the controller crashed. Not a supply fault, and the copy
	// built from this classification never mentions the power supply for it.
	panic: { class: "controller", abnormal: true, powerRelated: false },
	interrupt_wdt: { class: "watchdog", abnormal: true, powerRelated: false },
	task_wdt: { class: "watchdog", abnormal: true, powerRelated: false },
	wdt: { class: "watchdog", abnormal: true, powerRelated: false },
	deepsleep: { class: "deep_sleep", abnormal: false, powerRelated: false },
	brownout: { class: "power", abnormal: true, powerRelated: true },
	sdio: { class: "sdio", abnormal: false, powerRelated: false },
	unknown: { class: "unknown", abnormal: false, powerRelated: false },
};

export interface ResetCause {
	code: string;
	class: ResetCauseClass;
	abnormal: boolean;
	powerRelated: boolean;
}

const UNKNOWN_CAUSE: ResetCause = {
	code: "unknown",
	class: "unknown",
	abnormal: false,
	powerRelated: false,
};

/** One on-wire reset name, or `unknown` for anything this build does not know. */
export function resetCause(code: string): ResetCause {
	const normalised = code.trim().toLowerCase();
	const spec = RESET_CAUSE_SPECS[normalised];
	if (!spec) return { ...UNKNOWN_CAUSE, code: normalised.slice(0, 32) || "unknown" };
	return { code: normalised, ...spec };
}

/** Split the aggregate `brownout,panic` string the heartbeat reports. */
export function parseResetReasons(value: string | null | undefined): ResetCause[] {
	if (typeof value !== "string") return [];
	const seen = new Set<string>();
	const causes: ResetCause[] = [];
	for (const part of value.split(",")) {
		const cause = resetCause(part);
		if (part.trim() === "" || cause.code === "none" || seen.has(cause.code)) continue;
		seen.add(cause.code);
		causes.push(cause);
	}
	return causes;
}

/** A distinct cause class, ordered so the operator reads the supply first. */
const CAUSE_ORDER: readonly ResetCauseClass[] = [
	"power",
	"controller",
	"watchdog",
	"software",
	"external",
	"power_on",
	"deep_sleep",
	"sdio",
	"unknown",
];

function distinctCauseClasses(causes: ResetCause[]): ResetCauseClass[] {
	const present = new Set(causes.map((cause) => cause.class));
	return CAUSE_ORDER.filter((cause) => present.has(cause));
}

function intInRange(value: unknown, min: number, max: number): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
		? value
		: null;
}

function shortText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/** The reset/health fields of the stored `EnergyDevice.diag` snapshot. */
export interface RecoveryTelemetry {
	safeMode: boolean;
	uptimeS: number | null;
	abnormalResets: number | null;
	faultsPresent: number;
	faultsLatched: number;
	lastFault: string | null;
	/** `diag.fw`: the running version, refreshed on every heartbeat. */
	firmwareVersion: string | null;
}

/**
 * Read the recovery telemetry out of a sanitised `diag` object.
 *
 * Advisory, like the rest of `diag`: a malformed field is dropped instead of
 * failing the read. A missing field becomes null, which every rule below treats
 * as "no evidence", never as "healthy".
 */
export function readRecoveryTelemetry(diag: unknown): RecoveryTelemetry {
	const raw =
		typeof diag === "object" && diag !== null && !Array.isArray(diag)
			? (diag as Record<string, unknown>)
			: {};
	const faultsPresent = intInRange(raw.faults_present, 0, 0xff) ?? 0;
	const faultsLatched = intInRange(raw.faults_latched, 0, 0xff) ?? 0;
	return {
		safeMode: raw.safe_mode === true,
		// millis()/1000 on a 32-bit ESP32; anything larger is not an uptime.
		uptimeS: intInRange(raw.uptime_s, 0, 0xffffffff),
		abnormalResets: intInRange(raw.reset_abnormal_count, 0, 255),
		faultsPresent,
		faultsLatched,
		lastFault: shortText(raw.last_fault, 32),
		firmwareVersion: shortText(raw.fw, 32),
	};
}

/** One `device_health` row, newest first. */
export interface RecoveryHealthRow {
	report: DeviceHealthReport;
	createdAt: Date;
}

/** The device fields the recovery rules read; all already on `EnergyDevice`. */
export interface RecoveryDeviceSnapshot {
	lastSeenAt: Date | null;
	rtcOk: boolean;
	wifiRssiDbm: number | null;
	wifiRssiUpdatedAt: Date | null;
	diag: unknown;
}

export interface BuildRecoveryPlanInput {
	now: Date;
	device: RecoveryDeviceSnapshot;
	/** Newest first. A row is written on every health change and every boot. */
	healthRows: RecoveryHealthRow[];
	/** Newest reported version from `device-firmware.ts`; `diag.fw` wins when present. */
	firmwareVersion: string | null;
	policy: DeviceStatusPolicy;
	/** The configured `safe_mode_quiet_s`. Out of envelope or absent = default. */
	quietS?: number | null;
	/** True while a feed command is being delivered (keeps a reachable unit online). */
	inFlight?: boolean;
}

/** How much of the safe-mode quiet window the server can prove has passed. */
export interface QuietGate {
	requiredMs: number;
	elapsedMs: number;
	remainingMs: number;
	satisfied: boolean;
	/**
	 * `wall_clock` when the unit has a valid RTC (the firmware window survives a
	 * reboot), `uptime` when the window had to be capped by uptime, `unknown`
	 * when there is no evidence at all.
	 */
	basis: "wall_clock" | "uptime" | "unknown";
}

export interface QuietGateInput {
	now: Date;
	/** When the current safe-mode episode was first reported, or null. */
	startedAt: Date | null;
	uptimeS: number | null;
	rtcOk: boolean;
	quietS?: number | null;
}

/** Clamp a configured quiet window into the firmware's own envelope. */
export function resolveQuietSeconds(value: number | null | undefined): number {
	if (typeof value !== "number" || !Number.isInteger(value)) return SAFE_MODE_QUIET_DEFAULT_S;
	if (value < SAFE_MODE_QUIET_MIN_S || value > SAFE_MODE_QUIET_MAX_S) {
		return SAFE_MODE_QUIET_DEFAULT_S;
	}
	return value;
}

/**
 * The 30-minute quiet gate (configurable, 1.6.0+).
 *
 * Without a valid RTC the firmware restarts its window on every boot
 * (`fw::SafeModeWindow::resume` anchors on `millis()`), so a server-side "safe
 * mode started two hours ago" is not proof of two quiet hours. Uptime caps it.
 * With an RTC the window end is an epoch persisted in NVS, so wall-clock time
 * since the trip is the firmware's own measure.
 */
export function quietGate(input: QuietGateInput): QuietGate {
	const quietS = resolveQuietSeconds(input.quietS);
	const requiredMs = quietS * 1000;
	if (!input.startedAt) {
		return {
			requiredMs,
			elapsedMs: 0,
			remainingMs: requiredMs,
			satisfied: false,
			basis: "unknown",
		};
	}

	const wallClockMs = Math.max(0, input.now.getTime() - input.startedAt.getTime());
	let elapsedMs = wallClockMs;
	let basis: QuietGate["basis"] = "wall_clock";

	if (!input.rtcOk) {
		if (input.uptimeS === null) {
			elapsedMs = 0;
			basis = "unknown";
		} else {
			elapsedMs = Math.min(wallClockMs, input.uptimeS * 1000);
			basis = "uptime";
		}
	}

	// A unit that never reported uptime but has a clock still has the wall clock.
	return {
		requiredMs,
		elapsedMs,
		remainingMs: Math.max(0, requiredMs - elapsedMs),
		satisfied: elapsedMs >= requiredMs,
		basis,
	};
}

export interface ResetComparisonInput {
	now: Date;
	/** The newest row that resets the baseline: the trip, or a later zero-count row. */
	baselineAt: Date;
	baselineAbnormalResets: number | null;
	currentAbnormalResets: number | null;
	baselineReasons: string | null;
	currentReasons: string | null;
	uptimeS: number | null;
}

export interface ResetComparison {
	/** The unit rebooted after the episode started. */
	resetSince: boolean;
	/** A reset the firmware counts as abnormal happened after the baseline. */
	abnormalSince: boolean;
	/** The reset history went backwards, i.e. a power-on or reset hold cleared it. */
	historyCleared: boolean;
	/** Reason codes that were not in the history when the baseline was taken. */
	newReasons: string[];
	bootedAfterBaseline: boolean;
}

/**
 * "Has the unit had another abnormal reset since the last clear?" — the whole
 * of step 2. A growing counter or a new reason code is a new abnormal reset. A
 * counter that went *down* is a cleared history (clean power-on, the documented
 * reset hold, or the firmware's own healthy window), not a new fault. Boot time
 * says whether the baseline predates this boot.
 */
export function compareResetHistory(input: ResetComparisonInput): ResetComparison {
	const baseline = input.baselineAbnormalResets;
	const current = input.currentAbnormalResets;
	const historyCleared = baseline !== null && current !== null && current < baseline;
	const grew = baseline !== null && current !== null && current > baseline;
	const bootedAfterBaseline =
		input.uptimeS !== null &&
		input.now.getTime() - input.uptimeS * 1000 > input.baselineAt.getTime();

	const previous = new Set(parseResetReasons(input.baselineReasons).map((cause) => cause.code));
	const newReasons = historyCleared
		? []
		: parseResetReasons(input.currentReasons)
				.map((cause) => cause.code)
				.filter((code) => !previous.has(code));

	return {
		resetSince: grew || bootedAfterBaseline,
		abnormalSince: grew || newReasons.length > 0,
		historyCleared,
		newReasons,
		bootedAfterBaseline,
	};
}

export type RecoveryCheckId = "heartbeat" | "connectivity" | "sensors" | "firmware";
export type RecoveryCheckStatus = "pass" | "fail" | "unknown";

/** One item of step 4 ("verify hardware health"). */
export interface RecoveryCheck {
	id: RecoveryCheckId;
	status: RecoveryCheckStatus;
	/** The measured value the copy quotes, or null when there is none. */
	value: number | null;
}

export type CalibrationBlockCode = "safe_mode" | "recovering" | "fault" | "offline" | "maintenance";

export interface CalibrationGate {
	allowed: boolean;
	code: CalibrationBlockCode | null;
}

export interface RecoveryDiagnosis {
	safeMode: boolean;
	uptimeS: number | null;
	abnormalResets: number | null;
	/** Aggregate names the unit recorded, e.g. `["panic"]`. */
	resetReasons: string[];
	/** This boot's reset reason, when a health row written this boot carries it. */
	bootResetReason: string | null;
	/** Distinct cause classes, a power cause first. */
	causes: ResetCauseClass[];
	primaryCause: ResetCauseClass | null;
	/** True only when a `brownout` is among the recorded causes. */
	powerRelated: boolean;
	episodeStartedAt: Date | null;
	/** When the latest safe-mode episode cleared, or null while it is still on. */
	clearedAt: Date | null;
}

export interface DeviceRecoveryPlan {
	/**
	 * Null means "cannot verify": the read failed or the unit reports no health
	 * fields. It is not a device state, so no surface may present it as healthy.
	 */
	state: DeviceHealthState | null;
	/**
	 * Why `state` is null, when it is. `unsupported` means the unit predates the
	 * health fields (nothing to show, not a fault); `unavailable` means the read
	 * failed (show "cannot verify").
	 */
	readState: "ok" | "unsupported" | "unavailable";
	diagnosis: RecoveryDiagnosis;
	quiet: QuietGate;
	repeatReset: ResetComparison | null;
	/** Step 2's answer. False while the quiet window is short or a reset repeated. */
	safeToRecover: boolean;
	blockedBy: "quiet_window" | "repeat_reset" | null;
	checks: RecoveryCheck[];
	/** Step 4: every check passed. */
	verified: boolean;
	/** Step 5: dose testing becomes available only when this is allowed. */
	calibration: CalibrationGate;
}

function mostSevere(causes: ResetCause[]): ResetCauseClass | null {
	const [first] = distinctCauseClasses(causes);
	return first ?? null;
}

/**
 * Step 5's gate. A switch over the whole vocabulary (rather than a ternary on
 * the value just computed) so a future MAINTENANCE source cannot silently skip
 * the dose lock.
 */
function calibrationGateForState(state: DeviceHealthState): CalibrationGate {
	switch (state) {
		case "SAFE_MODE":
			return { allowed: false, code: "safe_mode" };
		case "RECOVERING":
			return { allowed: false, code: "recovering" };
		case "FAULT":
			return { allowed: false, code: "fault" };
		case "OFFLINE":
			return { allowed: false, code: "offline" };
		case "MAINTENANCE":
			return { allowed: false, code: "maintenance" };
		default:
			return { allowed: true, code: null };
	}
}

function primaryCause(
	boot: ResetCause | null,
	history: ResetCause[],
	distinct: ResetCauseClass[],
): ResetCauseClass | null {
	// The reason for *this* boot is the most recent fact, so it leads the copy
	// whenever it is abnormal. A panic boot therefore reads "controller crash"
	// even if an older brownout is still in the aggregate mask.
	if (boot?.abnormal) return boot.class;
	if (distinct.includes("power")) return "power";
	if (distinct.includes("controller")) return "controller";
	if (distinct.includes("watchdog")) return "watchdog";
	if (boot) return boot.class;
	return mostSevere(history);
}

function healthChecks(input: {
	now: Date;
	device: RecoveryDeviceSnapshot;
	policy: DeviceStatusPolicy;
	connection: ReturnType<typeof evaluateDeviceStatus>;
	rssiDbm: number | null;
	report: DeviceHealthReport | null;
	faults: ReturnType<typeof faultsFromMask>;
	latched: ReturnType<typeof faultsFromMask>;
	version: string | null;
}): RecoveryCheck[] {
	const silenceMs = input.device.lastSeenAt
		? Math.max(0, input.now.getTime() - input.device.lastSeenAt.getTime())
		: null;

	const heartbeat: RecoveryCheck = {
		id: "heartbeat",
		status:
			silenceMs !== null && silenceMs <= input.policy.weakAfterMs
				? "pass"
				: silenceMs === null
					? "unknown"
					: "fail",
		value: silenceMs === null ? null : Math.floor(silenceMs / 60000),
	};

	const connectivity: RecoveryCheck = {
		id: "connectivity",
		// Weak is not a link a recovery can be verified on: the unit may answer
		// now and drop the confirmation of a dose.
		status: input.connection.isOnline ? "pass" : "fail",
		value: input.rssiDbm,
	};

	// Safe mode is the lockout, not a sensor fault; it is already reported by
	// the state. A latched sensor fault means nobody acknowledged the cause yet.
	const sensorFaults = [...input.faults, ...input.latched].filter((fault) => fault !== "safe_mode");
	const sensors: RecoveryCheck = {
		id: "sensors",
		status: input.report === null ? "unknown" : sensorFaults.length > 0 ? "fail" : "pass",
		value: input.report === null ? null : input.report.faultsPresent,
	};

	const firmware: RecoveryCheck = {
		id: "firmware",
		status: input.version ? "pass" : "unknown",
		value: null,
	};

	return [heartbeat, connectivity, sensors, firmware];
}

/**
 * The whole recovery decision. Every rule is a function of the reported state,
 * so the same plan is produced by the hardware page, the calibration action and
 * the tests.
 */
export function buildRecoveryPlan(input: BuildRecoveryPlanInput): DeviceRecoveryPlan {
	const { now, device, policy } = input;
	const rows = input.healthRows;
	const current = rows[0] ?? null;
	const report = current?.report ?? null;
	const telemetry = readRecoveryTelemetry(device.diag);
	const rssiDbm = resolveRssiDbm({
		rssiDbm: device.wifiRssiDbm,
		updatedAt: device.wifiRssiUpdatedAt,
		now,
		policy,
	});
	const connection = evaluateDeviceStatus({
		lastSeenAt: device.lastSeenAt,
		now,
		policy,
		rssiDbm,
		inFlight: input.inFlight ?? false,
	});
	const offline = isDeviceUnreachable(device.lastSeenAt, now, policy);

	// The newest `device_health` row is the authority for safe mode and faults
	// (M1); `diag` is the freshest snapshot of the counters and the version.
	const safeMode = report ? report.safeMode : telemetry.safeMode;
	const faultsPresent = report ? report.faultsPresent : telemetry.faultsPresent;
	const faultsLatched = report ? report.faultsLatched : telemetry.faultsLatched;
	const faults = faultsFromMask(faultsPresent).filter((fault) => fault !== "safe_mode");
	const latched = faultsFromMask(faultsLatched).filter((fault) => fault !== "safe_mode");
	const version = telemetry.firmwareVersion ?? input.firmwareVersion;
	const bootReset = report?.resetReason ? resetCause(report.resetReason) : null;
	// `diag` is refreshed every heartbeat; the health row keeps the last value
	// for a unit whose diag the ingest had to drop.
	const uptimeS = telemetry.uptimeS ?? report?.uptimeS ?? null;

	const episodeIndex = rows.findIndex((row) => row.report.safeMode);
	const episode = episodeIndex >= 0 ? rows[episodeIndex] : null;
	// Rows are written only on a change, so the row immediately newer than the
	// first safe-mode row is the one that recorded the clear.
	const clearedAt =
		episode && !rows[0]?.report.safeMode && episodeIndex > 0
			? (rows[episodeIndex - 1]?.createdAt ?? null)
			: null;

	// The comparison baseline is the trip, unless a newer row shows the reset
	// history was already cleared (a clean power-on, the reset hold, or the
	// firmware's healthy window). Comparing against that row is what stops a
	// crash after a clear from hiding behind the older trip count.
	const baselineRow =
		rows.slice(0, Math.max(episodeIndex, 0)).find((row) => row.report.abnormalResets === 0) ??
		episode;
	const currentAbnormalResets = telemetry.abnormalResets ?? report?.abnormalResets ?? null;

	const historyCauses = parseResetReasons(report?.resetReasons);
	const causes = [...(bootReset ? [bootReset] : []), ...historyCauses];
	const distinct = distinctCauseClasses(causes);

	const diagnosis: RecoveryDiagnosis = {
		safeMode,
		uptimeS,
		abnormalResets: currentAbnormalResets,
		resetReasons: historyCauses.map((cause) => cause.code),
		bootResetReason: report?.resetReason ?? null,
		causes: distinct,
		primaryCause: primaryCause(bootReset, historyCauses, distinct),
		powerRelated: causes.some((cause) => cause.powerRelated),
		episodeStartedAt: episode?.createdAt ?? null,
		clearedAt,
	};

	const repeatReset = episode
		? compareResetHistory({
				now,
				baselineAt: baselineRow?.createdAt ?? episode.createdAt,
				baselineAbnormalResets: baselineRow?.report.abnormalResets ?? null,
				currentAbnormalResets,
				baselineReasons: baselineRow?.report.resetReasons ?? null,
				currentReasons: report?.resetReasons ?? null,
				uptimeS,
			})
		: null;

	// A crash makes the quiet clock restart: 30 minutes of uptime from the boot
	// that crashed, not 30 minutes since the original trip. A clear by the
	// documented hold (clean boot, history gone) is the operator's alternative
	// to the quiet window and does not get a second 30 minutes imposed on it.
	const bootAt = uptimeS !== null ? new Date(now.getTime() - uptimeS * 1000) : null;
	const bootWasAbnormal = bootReset?.abnormal === true;
	const clearedDeliberately =
		!safeMode &&
		bootReset !== null &&
		!bootWasAbnormal &&
		currentAbnormalResets === 0 &&
		(episode?.report.abnormalResets ?? 0) > 0;
	const quietStartedAt =
		bootWasAbnormal && bootAt
			? new Date(Math.max(episode?.createdAt.getTime() ?? 0, bootAt.getTime()))
			: (episode?.createdAt ?? null);
	const quietBase = quietGate({
		now,
		startedAt: quietStartedAt,
		uptimeS,
		rtcOk: device.rtcOk,
		quietS: input.quietS,
	});
	const quiet: QuietGate = clearedDeliberately
		? { ...quietBase, elapsedMs: quietBase.requiredMs, remainingMs: 0, satisfied: true }
		: quietBase;

	const checks = healthChecks({
		now,
		device,
		policy,
		connection,
		rssiDbm,
		report,
		faults,
		latched,
		version,
	});
	const verified = checks.every((check) => check.status === "pass");

	// No safe-mode episode means nothing to recover from. The checks still run,
	// so a unit with a fault or an unverifiable read is never called healthy.
	const needsRecovery = episode !== null;
	const recoveryComplete =
		!safeMode && quiet.satisfied && repeatReset?.abnormalSince !== true && verified;

	let state: DeviceHealthState;
	if (offline) state = "OFFLINE";
	else if (safeMode) state = "SAFE_MODE";
	else if (faults.length > 0) state = "FAULT";
	else if (needsRecovery && !recoveryComplete) state = "RECOVERING";
	else state = "HEALTHY";

	const calibration: CalibrationGate = calibrationGateForState(state);

	const safeToRecover = !needsRecovery || (quiet.satisfied && repeatReset?.abnormalSince !== true);
	const blockedBy: DeviceRecoveryPlan["blockedBy"] = !needsRecovery
		? null
		: repeatReset?.abnormalSince
			? "repeat_reset"
			: quiet.satisfied
				? null
				: "quiet_window";

	// A unit that reports no health fields at all (older firmware) has no
	// recovery state to show. Keep the state honest rather than guessing, and
	// do not let a read that found nothing block a dose it never warned about.
	const reportsHealth = report !== null || safeMode;

	return {
		state: reportsHealth ? state : null,
		readState: reportsHealth ? "ok" : "unsupported",
		diagnosis,
		quiet,
		repeatReset,
		safeToRecover,
		blockedBy,
		checks,
		verified,
		calibration: reportsHealth ? calibration : { allowed: true, code: null },
	};
}

/**
 * The plan returned when the recovery read itself failed (#624 precedent).
 *
 * It is not a healthy unit and it is not a state: `state: null` makes every
 * surface render "cannot verify". Calibration stays allowed, exactly like M1's
 * health guard, because the offline and safe-mode checks that can be made from
 * the device row still run in the action.
 */
export function unavailableRecoveryPlan(now: Date): DeviceRecoveryPlan {
	return {
		state: null,
		readState: "unavailable",
		diagnosis: {
			safeMode: false,
			uptimeS: null,
			abnormalResets: null,
			resetReasons: [],
			bootResetReason: null,
			causes: [],
			primaryCause: null,
			powerRelated: false,
			episodeStartedAt: null,
			clearedAt: null,
		},
		quiet: {
			requiredMs: SAFE_MODE_QUIET_DEFAULT_S * 1000,
			elapsedMs: 0,
			remainingMs: SAFE_MODE_QUIET_DEFAULT_S * 1000,
			satisfied: false,
			basis: "unknown",
		},
		repeatReset: null,
		safeToRecover: false,
		blockedBy: null,
		checks: [],
		verified: false,
		calibration: { allowed: true, code: null },
	};
}
