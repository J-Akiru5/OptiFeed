/**
 * A safety trip: the moment a unit locked its relay off and entered safe mode.
 *
 * Pure model: no database import, so it is testable on its own. The unit's
 * current state already lives in the `device_health` stream
 * (`device-health-model.ts`); this file covers the one-off incident row, which
 * answers "when did this trip happen, and why" in the audit trail.
 *
 * The two are deliberately separate. Safe mode is a state the heartbeat repeats
 * every 5 s, and the `device_health` row already raises the CRITICAL alert; a
 * trip is one event per occurrence, so it belongs in History rather than in a
 * second notification. `enterSafeMode()` runs during `setup()` before Wi-Fi, so
 * the report is deferred and the server has to accept it whenever it arrives.
 *
 * `DeviceStateEvent` has no unique `eventId`, so the once-per-trip guarantee is
 * a read: ingest compares the newest `safety_trip` row's `metadata.tripId` with
 * the incoming `trip_id` before writing, using `isSameSafetyTrip` below.
 */

export const SAFETY_TRIP_EVENT = "safety_trip";

/** How the unit found itself in safe mode: during boot, or while running. */
export type SafetyTripEntry = "boot" | "runtime";

/** One trip, as the firmware reports it and as the event row stores it. */
export interface SafetyTripReport {
	/** Unit-generated id for this trip; stable across a retried report. */
	tripId: string;
	abnormalResets: number | null;
	/** Comma-separated reset reasons, e.g. `brownout,panic`. */
	resetReasons: string | null;
	/** The reset that tripped safe mode, when the unit names one. */
	resetReason: string | null;
	entry: SafetyTripEntry | null;
	/** Seconds without an abnormal reset when safe mode was entered. */
	quietS: number | null;
	uptimeS: number | null;
	version: string | null;
}

function shortText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function smallInt(value: unknown, max: number): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
		? value
		: null;
}

function entryOf(value: unknown): SafetyTripEntry | null {
	return value === "boot" || value === "runtime" ? value : null;
}

/**
 * The metadata stored on the `safety_trip` row. Absent values are omitted rather
 * than stored as null, so a row reads on its own without empty keys.
 */
export function safetyTripMetadata(report: SafetyTripReport): Record<string, unknown> {
	return {
		tripId: report.tripId,
		eventId: `trip-${report.tripId}`,
		...(report.abnormalResets !== null ? { abnormalResets: report.abnormalResets } : {}),
		...(report.resetReasons !== null ? { resetReasons: report.resetReasons } : {}),
		...(report.resetReason !== null ? { resetReason: report.resetReason } : {}),
		...(report.entry !== null ? { entry: report.entry } : {}),
		...(report.quietS !== null ? { quietS: report.quietS } : {}),
		...(report.uptimeS !== null ? { uptimeS: report.uptimeS } : {}),
		...(report.version !== null ? { version: report.version } : {}),
	};
}

/**
 * Read a stored row back. A row without a usable `tripId` cannot be compared
 * with a new report, so it reads as null instead of as an empty trip.
 */
export function safetyTripFromMetadata(metadata: unknown): SafetyTripReport | null {
	const raw =
		typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
	const tripId = shortText(raw.tripId, 64);
	if (!tripId) return null;

	return {
		tripId,
		abnormalResets: smallInt(raw.abnormalResets, 255),
		resetReasons: shortText(raw.resetReasons, 120),
		resetReason: shortText(raw.resetReason, 32),
		entry: entryOf(raw.entry),
		quietS: smallInt(raw.quietS, Number.MAX_SAFE_INTEGER),
		uptimeS: smallInt(raw.uptimeS, Number.MAX_SAFE_INTEGER),
		version: shortText(raw.version, 32),
	};
}

/**
 * True when a report repeats the trip already stored for this device.
 *
 * This is the whole dedupe rule: the firmware may re-send the same trip after a
 * reboot, and the unit generates one id per trip, so the id is the identity. A
 * different `trip_id` is a new incident even when every other field matches.
 */
export function isSameSafetyTrip(previous: SafetyTripReport | null, tripId: string): boolean {
	return previous !== null && previous.tripId === tripId;
}
