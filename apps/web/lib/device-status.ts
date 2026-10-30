/**
 * The one device-connectivity rule (issue #388).
 *
 * A feeder has three connection states, not two:
 *
 *  - **online** — a heartbeat arrived inside the weak-signal window;
 *  - **weak** — the last heartbeat is late (a missed beat) or the reported RSSI
 *    is low, but the unit is still considered reachable;
 *  - **offline** — silence passed the configured offline window **plus** a
 *    grace, so one late heartbeat never flips the whole UI to offline.
 *
 * The thresholds are platform settings (`PlatformSetting` key `device.status`),
 * editable by a platform admin in Superadmin → Settings. Readers always fall
 * back to the defaults below when the row is missing, unreadable or invalid, so
 * a bad setting can never break a device screen.
 *
 * A heartbeat may also carry the Wi-Fi RSSI (firmware 1.6.2+). `resolveRssiDbm`
 * keeps only a plausible, recent reading (older than the display offline window
 * is stale), and a low reading turns a reachable unit into "weak signal".
 * Firmware that reports no RSSI keeps the timing-only behaviour.
 *
 * Two deliberate distinctions:
 *
 *  - **Display vs safety.** `evaluateDeviceStatus` includes the grace window, so
 *    a badge stays "weak" for a little longer. `isDeviceUnreachable` is the
 *    stricter safety rule used before queueing a feed command: it uses
 *    `offlineAfterMs` without the grace, so a command is never stranded on a
 *    unit that has really been silent for the full window.
 *  - **Flapping.** A caller that re-evaluates the same device can pass
 *    `previousState`. Once offline, the unit only leaves offline after a
 *    heartbeat inside the weak window, so a measurement at the boundary cannot
 *    bounce between weak and offline.
 */

export const DEVICE_STATUS_SETTING_KEY = "device.status";

export const DEVICE_WEAK_AFTER_MIN_MIN = 1;
export const DEVICE_WEAK_AFTER_MIN_MAX = 60;
export const DEVICE_WEAK_AFTER_MIN_DEFAULT = 5;

export const DEVICE_OFFLINE_AFTER_MIN_MIN = 5;
export const DEVICE_OFFLINE_AFTER_MIN_MAX = 180;
export const DEVICE_OFFLINE_AFTER_MIN_DEFAULT = 15;

export const DEVICE_OFFLINE_GRACE_MIN_MIN = 0;
export const DEVICE_OFFLINE_GRACE_MIN_MAX = 30;
export const DEVICE_OFFLINE_GRACE_MIN_DEFAULT = 2;

/** At or below this RSSI a reachable unit is shown as "weak signal". */
export const DEVICE_WEAK_RSSI_DBM = -80;

/** The range an ESP32 can report from `WiFi.RSSI()` (0 is effectively "no signal"). */
export const DEVICE_RSSI_DBM_MIN = -127;
export const DEVICE_RSSI_DBM_MAX = 0;

const MINUTE_MS = 60 * 1000;

export type DeviceConnectionState = "online" | "weak" | "offline";

/** The stored JSON shape (whole minutes, which is what an admin edits). */
export interface DeviceStatusSettingValue {
	weakAfterMin: number;
	offlineAfterMin: number;
	graceMin: number;
}

/** The resolved millisecond policy every reader uses. */
export interface DeviceStatusPolicy {
	weakAfterMs: number;
	offlineAfterMs: number;
	graceMs: number;
}

export const DEVICE_STATUS_DEFAULT_VALUE: DeviceStatusSettingValue = {
	weakAfterMin: DEVICE_WEAK_AFTER_MIN_DEFAULT,
	offlineAfterMin: DEVICE_OFFLINE_AFTER_MIN_DEFAULT,
	graceMin: DEVICE_OFFLINE_GRACE_MIN_DEFAULT,
};

export function deviceStatusPolicyFromValue(value: DeviceStatusSettingValue): DeviceStatusPolicy {
	return {
		weakAfterMs: value.weakAfterMin * MINUTE_MS,
		offlineAfterMs: value.offlineAfterMin * MINUTE_MS,
		graceMs: value.graceMin * MINUTE_MS,
	};
}

export const DEFAULT_DEVICE_STATUS_POLICY: DeviceStatusPolicy = deviceStatusPolicyFromValue(
	DEVICE_STATUS_DEFAULT_VALUE,
);

function readInt(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
	if (value < min || value > max) return fallback;
	return value;
}

/**
 * Coerce a stored JSON value to a usable setting. An out-of-range field falls
 * back to its default; `weakAfterMin` is then kept strictly below
 * `offlineAfterMin` so the weak band can never swallow the offline window.
 */
export function normalizeDeviceStatusValue(value: unknown): DeviceStatusSettingValue {
	const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

	const offlineAfterMin = readInt(
		raw.offlineAfterMin,
		DEVICE_OFFLINE_AFTER_MIN_MIN,
		DEVICE_OFFLINE_AFTER_MIN_MAX,
		DEVICE_OFFLINE_AFTER_MIN_DEFAULT,
	);
	const graceMin = readInt(
		raw.graceMin,
		DEVICE_OFFLINE_GRACE_MIN_MIN,
		DEVICE_OFFLINE_GRACE_MIN_MAX,
		DEVICE_OFFLINE_GRACE_MIN_DEFAULT,
	);
	const requestedWeak = readInt(
		raw.weakAfterMin,
		DEVICE_WEAK_AFTER_MIN_MIN,
		DEVICE_WEAK_AFTER_MIN_MAX,
		DEVICE_WEAK_AFTER_MIN_DEFAULT,
	);

	// A weak window at or beyond the offline window would make "weak" unreachable
	// or leave no online band at all. Keep it one minute below, never below 1.
	const weakAfterMin = Math.max(
		DEVICE_WEAK_AFTER_MIN_MIN,
		Math.min(requestedWeak, offlineAfterMin - 1),
	);

	return { weakAfterMin, offlineAfterMin, graceMin };
}

/** True when a submitted setting is internally consistent and in range. */
export function isValidDeviceStatusValue(value: DeviceStatusSettingValue): boolean {
	return (
		Number.isInteger(value.weakAfterMin) &&
		value.weakAfterMin >= DEVICE_WEAK_AFTER_MIN_MIN &&
		value.weakAfterMin <= DEVICE_WEAK_AFTER_MIN_MAX &&
		Number.isInteger(value.offlineAfterMin) &&
		value.offlineAfterMin >= DEVICE_OFFLINE_AFTER_MIN_MIN &&
		value.offlineAfterMin <= DEVICE_OFFLINE_AFTER_MIN_MAX &&
		Number.isInteger(value.graceMin) &&
		value.graceMin >= DEVICE_OFFLINE_GRACE_MIN_MIN &&
		value.graceMin <= DEVICE_OFFLINE_GRACE_MIN_MAX &&
		value.weakAfterMin < value.offlineAfterMin
	);
}

/**
 * True for a plausible integer RSSI in dBm. Anything else (a string, a float, a
 * sentinel outside the ESP32 range) is treated as "not reported".
 */
export function isValidRssiDbm(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= DEVICE_RSSI_DBM_MIN &&
		value <= DEVICE_RSSI_DBM_MAX
	);
}

export interface ResolveRssiInput {
	/** The stored `EnergyDevice.wifiRssiDbm`. */
	rssiDbm: number | null | undefined;
	/** The stored `EnergyDevice.wifiRssiUpdatedAt`. */
	updatedAt: Date | null | undefined;
	now?: Date;
	policy?: DeviceStatusPolicy;
}

/**
 * The RSSI to feed into `evaluateDeviceStatus`, or null when it cannot be
 * trusted. A reading older than the display offline window (offline plus grace)
 * describes a unit that is no longer reporting, so showing it as the current
 * signal would be misleading. Old firmware never reports RSSI at all, so null
 * keeps the timing-only rule (issue #388).
 */
export function resolveRssiDbm({
	rssiDbm,
	updatedAt,
	now = new Date(),
	policy = DEFAULT_DEVICE_STATUS_POLICY,
}: ResolveRssiInput): number | null {
	if (!isValidRssiDbm(rssiDbm)) return null;
	if (!updatedAt) return null;
	const ageMs = now.getTime() - updatedAt.getTime();
	if (!Number.isFinite(ageMs)) return null;
	if (ageMs > policy.offlineAfterMs + policy.graceMs) return null;
	return rssiDbm;
}

/**
 * Signal bars (0-4) for a known RSSI, mirroring the firmware portal ladder
 * (`signalBarsForRssi`), so the app and the setup page agree. 0 means "no
 * reading", never "no signal".
 */
export function deviceSignalBars(rssiDbm: number | null | undefined): number {
	if (!isValidRssiDbm(rssiDbm)) return 0;
	if (rssiDbm > -55) return 4;
	if (rssiDbm > -67) return 3;
	if (rssiDbm > -78) return 2;
	return 1;
}

export interface EvaluateDeviceStatusInput {
	lastSeenAt: Date | null | undefined;
	now?: Date;
	policy?: DeviceStatusPolicy;
	/** Last reported Wi-Fi RSSI in dBm, when the firmware reports one. */
	rssiDbm?: number | null;
	/**
	 * True while a feed/calibration command is being delivered. A unit that is
	 * mid-command must never be presented as offline (issue #388).
	 */
	inFlight?: boolean;
	/** The state shown on the previous render, used for hysteresis. */
	previousState?: DeviceConnectionState | null;
}

export interface DeviceStatusResult {
	state: DeviceConnectionState;
	/** Silence since the last heartbeat; `Infinity` when there was never one. */
	silenceMs: number;
	isOnline: boolean;
	isWeak: boolean;
	isOffline: boolean;
	/** True when the reading is held online because a command is in flight. */
	inFlight: boolean;
	/** True when a known RSSI forced the weak state. */
	lowSignal: boolean;
}

/**
 * Resolve the connection state.
 *
 * Boundaries are inclusive on the healthier side: exactly `weakAfterMs` is
 * still online, exactly `offlineAfterMs + graceMs` is still weak, and the next
 * millisecond is offline.
 */
export function evaluateDeviceStatus({
	lastSeenAt,
	now = new Date(),
	policy = DEFAULT_DEVICE_STATUS_POLICY,
	rssiDbm = null,
	inFlight = false,
	previousState = null,
}: EvaluateDeviceStatusInput): DeviceStatusResult {
	const silenceMs = lastSeenAt
		? Math.max(0, now.getTime() - lastSeenAt.getTime())
		: Number.POSITIVE_INFINITY;

	if (inFlight) {
		return {
			state: "online",
			silenceMs,
			isOnline: true,
			isWeak: false,
			isOffline: false,
			inFlight: true,
			lowSignal: false,
		};
	}

	const hardOfflineAt = policy.offlineAfterMs + policy.graceMs;
	const lowSignal =
		typeof rssiDbm === "number" && Number.isFinite(rssiDbm) && rssiDbm <= DEVICE_WEAK_RSSI_DBM;

	let state: DeviceConnectionState;
	if (!lastSeenAt || silenceMs > hardOfflineAt) {
		state = "offline";
	} else if (previousState === "offline" && silenceMs > policy.weakAfterMs) {
		// Hysteresis: a unit that was already offline stays offline until a
		// heartbeat is clearly back inside the healthy window.
		state = "offline";
	} else if (lowSignal) {
		state = "weak";
	} else if (silenceMs <= policy.weakAfterMs) {
		state = "online";
	} else {
		state = "weak";
	}

	return {
		state,
		silenceMs,
		isOnline: state === "online",
		isWeak: state === "weak",
		isOffline: state === "offline",
		inFlight: false,
		lowSignal,
	};
}

/**
 * The strict safety rule for command acceptance: offline once the configured
 * window has passed, without the display grace. No heartbeat at all is offline.
 */
export function isDeviceUnreachable(
	lastSeenAt: Date | null | undefined,
	now: Date = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): boolean {
	if (!lastSeenAt) return true;
	return now.getTime() - lastSeenAt.getTime() > policy.offlineAfterMs;
}

/** Display shorthand: true only for the full offline state. */
export function isDeviceOffline(
	lastSeenAt: Date | null | undefined,
	now: Date = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): boolean {
	return evaluateDeviceStatus({ lastSeenAt, now, policy }).isOffline;
}
