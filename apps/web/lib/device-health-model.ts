/**
 * Device faults and safe mode, as the unit reports them on its heartbeat.
 *
 * Pure model: no database import, so the client hero can use it. The reads
 * live in `device-health.ts`.
 *
 * Firmware 1.6.0+ sends `safe_mode`, `last_reset_reasons` and a `diag` object
 * (`faults_present`, `faults_latched`, `last_fault`, `reset_abnormal_count`).
 * The ingest schema used to strip all of it, so a unit that locked its relay
 * after repeated brownouts looked online and healthy on the dashboard.
 *
 * Like the firmware version (`device-firmware.ts`), the state lives in the
 * existing `DeviceStateEvent` stream: ingest writes one `device_health` row
 * each time the reported state changes, and the newest row is the current
 * state. No schema change. No row means the unit has never reported a fault.
 */

export const DEVICE_HEALTH_EVENT = "device_health";

/**
 * Fault names in firmware bit order: bit n of `faults_present` is `fw::Fault`
 * n (`firmware/firmware-main/status.h`; 0 is NONE and has no bit).
 */
const FAULT_BITS = {
	hopper_sensor: 1 << 1,
	rtc: 1 << 2,
	relay_overrun: 1 << 3,
	safe_mode: 1 << 4,
} as const;

export type DeviceFault = keyof typeof FAULT_BITS;

/** Faults other than safe mode, which has its own flag and wording. */
export type DeviceSensorFault = Exclude<DeviceFault, "safe_mode">;

/** Names of the faults set in a firmware mask (unknown bits are ignored). */
export function faultsFromMask(mask: number): DeviceFault[] {
	if (!Number.isInteger(mask) || mask <= 0) return [];
	return (Object.keys(FAULT_BITS) as DeviceFault[]).filter(
		(name) => (mask & FAULT_BITS[name]) !== 0,
	);
}

/** What one heartbeat says about the unit's health. */
export interface DeviceHealthReport {
	safeMode: boolean;
	/** Faults that are true right now. */
	faultsPresent: number;
	/** Faults that are true or latched until an operator acknowledges them. */
	faultsLatched: number;
	lastFault: string | null;
	abnormalResets: number;
	resetReasons: string | null;
}

const MAX_MASK = 0xff;

function maskOf(value: unknown): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_MASK
		? value
		: 0;
}

function shortText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/**
 * Read the health fields of a raw heartbeat body.
 *
 * Advisory by design: a malformed field is dropped instead of failing the
 * heartbeat, so one buggy field can never cost a unit its connectivity.
 * Returns null when the heartbeat carries no health information at all (older
 * firmware), which must not be mistaken for "all clear".
 */
export function parseDeviceHealthReport(body: unknown): DeviceHealthReport | null {
	if (typeof body !== "object" || body === null) return null;
	const raw = body as Record<string, unknown>;
	const diag =
		typeof raw.diag === "object" && raw.diag !== null ? (raw.diag as Record<string, unknown>) : {};

	const reportedSafeMode =
		typeof raw.safe_mode === "boolean"
			? raw.safe_mode
			: typeof diag.safe_mode === "boolean"
				? diag.safe_mode
				: null;
	const hasMasks = "faults_present" in diag || "faults_latched" in diag;
	if (reportedSafeMode === null && !hasMasks) return null;

	const abnormal = diag.reset_abnormal_count;
	return {
		safeMode: reportedSafeMode === true,
		faultsPresent: maskOf(diag.faults_present),
		faultsLatched: maskOf(diag.faults_latched),
		lastFault: shortText(diag.last_fault, 32),
		abnormalResets:
			typeof abnormal === "number" && Number.isInteger(abnormal) && abnormal >= 0 && abnormal <= 255
				? abnormal
				: 0,
		resetReasons: shortText(raw.last_reset_reasons, 64),
	};
}

/** The part of a report that decides whether a new row is written. */
export interface DeviceHealthKey {
	safeMode: boolean;
	faultsPresent: number;
	faultsLatched: number;
}

export function isHealthClear(key: DeviceHealthKey): boolean {
	return !key.safeMode && key.faultsPresent === 0 && key.faultsLatched === 0;
}

/** True when `next` differs from `previous` in anything an operator would act on. */
export function healthChanged(previous: DeviceHealthKey | null, next: DeviceHealthKey): boolean {
	if (!previous) return !isHealthClear(next);
	return (
		previous.safeMode !== next.safeMode ||
		previous.faultsPresent !== next.faultsPresent ||
		previous.faultsLatched !== next.faultsLatched
	);
}

/** The event row metadata for a report. Names are stored next to the masks so a row reads on its own. */
export function healthEventMetadata(report: DeviceHealthReport): Record<string, unknown> {
	return {
		safeMode: report.safeMode,
		faultsPresent: report.faultsPresent,
		faultsLatched: report.faultsLatched,
		present: faultsFromMask(report.faultsPresent),
		lastFault: report.lastFault,
		abnormalResets: report.abnormalResets,
		resetReasons: report.resetReasons,
	};
}

/** Read a stored row back. A row that cannot be read counts as clear. */
export function healthFromMetadata(metadata: unknown): DeviceHealthReport {
	const raw =
		typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
	return {
		safeMode: raw.safeMode === true,
		faultsPresent: maskOf(raw.faultsPresent),
		faultsLatched: maskOf(raw.faultsLatched),
		lastFault: shortText(raw.lastFault, 32),
		abnormalResets: maskOf(raw.abnormalResets),
		resetReasons: shortText(raw.resetReasons, 64),
	};
}

/** A dose the firmware refused, shown so "why did it not feed" has an answer. */
export interface DeviceRefusal {
	reason: string;
	source: string | null;
	grams: number | null;
	at: Date;
}

/** What the dashboard shows about one device's health. */
export interface DeviceHealthView {
	safeMode: boolean;
	/** Active faults, safe mode excluded. */
	faults: DeviceSensorFault[];
	abnormalResets: number;
	resetReasons: string | null;
	/** When the current state was first reported, or null when it is all clear. */
	since: Date | null;
	/** The newest refused dose inside the lookback, if any. */
	lastRefusal: DeviceRefusal | null;
}

/** How far back a refused dose still counts as news. */
export const REFUSAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const HEALTHY_VIEW: DeviceHealthView = {
	safeMode: false,
	faults: [],
	abnormalResets: 0,
	resetReasons: null,
	since: null,
	lastRefusal: null,
};

export function deviceNeedsAttention(view: DeviceHealthView): boolean {
	return view.safeMode || view.faults.length > 0;
}

/** Pure part of `getDeviceHealth`, so the rules are testable without a database. */
export function buildHealthView(input: {
	health: { metadata: unknown; createdAt: Date } | null;
	refusal: { metadata: unknown; createdAt: Date } | null;
	now: Date;
}): DeviceHealthView {
	const report = input.health ? healthFromMetadata(input.health.metadata) : null;
	const active = report !== null && !isHealthClear(report);

	let lastRefusal: DeviceRefusal | null = null;
	if (
		input.refusal &&
		input.now.getTime() - input.refusal.createdAt.getTime() <= REFUSAL_LOOKBACK_MS
	) {
		const meta =
			typeof input.refusal.metadata === "object" && input.refusal.metadata !== null
				? (input.refusal.metadata as Record<string, unknown>)
				: {};
		const reason = shortText(meta.reason, 40);
		if (reason) {
			lastRefusal = {
				reason,
				source: shortText(meta.source, 16),
				grams: typeof meta.grams === "number" && Number.isFinite(meta.grams) ? meta.grams : null,
				at: input.refusal.createdAt,
			};
		}
	}

	return {
		safeMode: report?.safeMode ?? false,
		faults: report
			? (faultsFromMask(report.faultsPresent).filter(
					(f) => f !== "safe_mode",
				) as DeviceSensorFault[])
			: [],
		abnormalResets: report?.abnormalResets ?? 0,
		resetReasons: report?.resetReasons ?? null,
		since: active && input.health ? input.health.createdAt : null,
		lastRefusal,
	};
}

const FAULT_PHRASES: Record<DeviceSensorFault, string> = {
	hopper_sensor: "the hopper sensor is not answering",
	rtc: "the clock is not answering",
	relay_overrun: "a dose ran past its time",
};

/**
 * The in-app alert for a state change, or null when nothing new needs saying.
 * Only a state that just became true alerts: staying in safe mode, or a fault
 * clearing, writes the event row but no second notification.
 */
export function healthAlertFor(
	label: string,
	previous: DeviceHealthKey | null,
	next: DeviceHealthReport,
): { tier: "CRITICAL" | "WARNING"; message: string } | null {
	if (next.safeMode && !previous?.safeMode) {
		return {
			tier: "CRITICAL",
			message: `${label} is in safe mode: its relay is locked off after repeated resets, so doses are refused. Check the power supply.`,
		};
	}
	const before = previous?.faultsPresent ?? 0;
	const added = faultsFromMask(next.faultsPresent & ~before).filter(
		(fault): fault is DeviceSensorFault => fault !== "safe_mode",
	);
	if (added.length === 0) return null;
	return {
		tier: "WARNING",
		message: `${label} needs a check: ${added.map((fault) => FAULT_PHRASES[fault]).join(", ")}.`,
	};
}
