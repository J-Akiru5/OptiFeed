import {
	type DeviceHealthReport,
	type DeviceSensorFault,
	faultsFromMask,
	healthFromMetadata,
} from "@/lib/device-health-model";
import {
	type DeviceConnectionState,
	type DeviceStatusPolicy,
	evaluateDeviceStatus,
	isValidRssiDbm,
	resolveRssiDbm,
} from "@/lib/device-status";
import {
	BAND_STATE_ORDER,
	type BandState,
	deviceFleetState,
	worstState,
} from "@/lib/platform/status-band-rules";

/**
 * Fleet monitor rules (issue #479, M3C.4 and M3C.4b).
 *
 * The monitor answers one question per tenant: *is this tenant's fleet healthy,
 * and if not, why?* It does that by reusing, not copying, the single device
 * connectivity rule: `evaluateDeviceStatus` with the configured `device.status`
 * policy decides each unit's state, and `deviceFleetState` turns a tenant's
 * counts into a band state with the same thresholds the status bands already
 * use (20 % offline → degraded, 50 % → critical).
 *
 * M3C.4b adds the evidence underneath that verdict: one row per unit with the
 * heartbeat, the RSSI the unit reported, firmware, the last machine dispense and
 * the freshness of the hopper and water readings, plus faults and safe mode.
 * Three rules keep that honest:
 *
 *  - **A missing reading is missing.** `null` never becomes `0`, `""` or a green
 *    state; the page renders "Not reported", "Unknown" or "Never".
 *  - **No new freshness threshold.** A reading is stale exactly when a heartbeat
 *    of that age would be offline, which is the configured `device.status`
 *    window (`offlineAfterMs` plus `graceMs`) applied by the one connectivity
 *    rule (`readingFreshness`).
 *  - **A unit that never reported health is not healthy.** No `device_health`
 *    row means `health: null`, not "no faults and not in safe mode".
 *
 * The invariants above the device list are the bands' invariants:
 *
 *  - a tenant whose units have never reported is `unknown`, not `ok` — an
 *    unmeasured fleet is never called healthy;
 *  - the fleet total is the worst tenant, never an average, so one failing
 *    tenant cannot be hidden by nine healthy ones;
 *  - nothing here invents a score or a threshold.
 *
 * Pure on purpose: the loader in `fleet-health.ts` only queries and maps rows.
 */

/** A device as the monitor needs it, already joined to its tenant. */
export interface FleetDeviceInput {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	tenantId: string | null;
	tenantName: string | null;
	pondName: string | null;
	// ---------------------------------------------------------------------
	// M3C.4b telemetry. Every field is optional so a caller that only has the
	// connectivity columns still builds a row; an absent field reads as "not
	// reported" everywhere below.
	// ---------------------------------------------------------------------
	/** Latest sanitised heartbeat diagnostics (`EnergyDevice.diag`, #454). */
	diag?: unknown;
	/** Last Wi-Fi RSSI the unit reported, and when that reading arrived. */
	rssiDbm?: number | null;
	rssiUpdatedAt?: Date | null;
	/** Last hopper level reading. */
	feedLevelPercent?: number | null;
	feedLevelUpdatedAt?: Date | null;
	/** Last water-temperature reading, whether the probe answered, and when. */
	waterTempC?: number | null;
	waterTempOk?: boolean | null;
	waterTempUpdatedAt?: Date | null;
	/** Newest version-carrying state event for the unit, when one exists. */
	firmwareEvent?: { version: string | null; createdAt: Date } | null;
	/** Newest machine dispense the unit reported (server receipt time). */
	lastFeedAt?: Date | null;
	/** Newest stored `device_health` row, when the unit ever reported one. */
	health?: { metadata: unknown; createdAt: Date } | null;
}

/** How current a stored reading is. `none` means it was never reported. */
export type ReadingFreshness = "fresh" | "stale" | "none";

/**
 * Whether a stored reading is still current.
 *
 * The window is not re-declared here. `evaluateDeviceStatus` is the single
 * connectivity rule, so a reading is stale exactly when a heartbeat of that age
 * would be offline — the configured `offlineAfterMs` plus `graceMs`. A reading
 * can therefore never be fresh while the unit that produced it is offline, and
 * changing the platform policy moves this rule with it.
 */
export function readingFreshness(
	at: Date | null | undefined,
	now: Date,
	policy: DeviceStatusPolicy,
): ReadingFreshness {
	if (!at || !Number.isFinite(at.getTime())) return "none";
	return evaluateDeviceStatus({ lastSeenAt: at, now, policy }).isOffline ? "stale" : "fresh";
}

/**
 * The cap `versionFromMetadata` applies in `lib/device-firmware.ts`; the
 * heartbeat-side check below keeps the same bound so one stored string cannot
 * widen a console cell.
 */
export const FIRMWARE_VERSION_MAX_LENGTH = 32;

/** `EnergyDevice.diag.fw` as firmware 1.6.0+ sends it, or null. */
export function firmwareFromDiag(diag: unknown): string | null {
	if (typeof diag !== "object" || diag === null) return null;
	const value = (diag as Record<string, unknown>).fw;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= FIRMWARE_VERSION_MAX_LENGTH ? trimmed : null;
}

/** Everything the monitor shows for one unit, with no value invented. */
export interface DeviceTelemetryRow {
	id: string;
	label: string;
	mac: string;
	pondName: string | null;
	tenantId: string | null;
	tenantName: string | null;
	/** The shared connectivity state (`evaluateDeviceStatus`). */
	connection: DeviceConnectionState;
	lastHeartbeatAt: Date | null;
	/** A fresh reading only; a timed-out one is kept out of this field. */
	rssiDbm: number | null;
	rssiFreshness: ReadingFreshness;
	/** When the stored signal reading arrived, so a stale one can be dated. */
	rssiAt: Date | null;
	/**
	 * `diag` wins because it rides the current heartbeat; the newest
	 * version-carrying event is the fallback for older firmware. `source` is
	 * null when a row exists but carries no usable version.
	 */
	firmware: { version: string | null; at: Date | null; source: "diag" | "event" | null };
	/** Newest machine dispense; null means the unit has never dispensed. */
	lastFeedAt: Date | null;
	feedLevel: { percent: number | null; at: Date | null; freshness: ReadingFreshness };
	/** Null when the probe has never reported a temperature. */
	waterTemp: {
		celsius: number;
		at: Date | null;
		freshness: ReadingFreshness;
		probeOk: boolean | null;
	} | null;
	/** Null when the unit has never sent a `device_health` row: not "clear". */
	health: { safeMode: boolean; faults: DeviceSensorFault[]; since: Date } | null;
}

export interface TenantFleetRow {
	tenantId: string | null;
	tenantName: string | null;
	total: number;
	/** Units that have ever reported a heartbeat. */
	reporting: number;
	online: number;
	weak: number;
	offline: number;
	/** Offline share of the units that report; null when none ever did. */
	offlinePct: number | null;
	lastHeartbeatAt: Date | null;
	state: BandState;
	/** The units themselves, worst first (M3C.4b). */
	devices: DeviceTelemetryRow[];
}

/** Worst first: the shared band order, so every console list ranks alike. */
export const FLEET_STATE_ORDER: Record<BandState, number> = BAND_STATE_ORDER;

/** Worst first for units: silence outranks a weak signal. */
export const DEVICE_STATE_ORDER: Record<DeviceConnectionState, number> = {
	offline: 0,
	weak: 1,
	online: 2,
};

function groupKey(device: FleetDeviceInput): string {
	return device.tenantId ?? "__unassigned__";
}

function finiteOrNull(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveFirmware(device: FleetDeviceInput): DeviceTelemetryRow["firmware"] {
	const fromDiag = firmwareFromDiag(device.diag);
	if (fromDiag) {
		// Diagnostics arrive with the heartbeat, so this is the unit's own current
		// statement about what it is running.
		return { version: fromDiag, at: device.lastSeenAt ?? null, source: "diag" };
	}

	const event = device.firmwareEvent ?? null;
	if (!event) return { version: null, at: null, source: null };
	return { version: event.version, at: event.createdAt, source: event.version ? "event" : null };
}

function resolveHealth(device: FleetDeviceInput): DeviceTelemetryRow["health"] {
	const row = device.health ?? null;
	if (!row) return null;

	const report: DeviceHealthReport = healthFromMetadata(row.metadata);
	return {
		safeMode: report.safeMode,
		// Same view the tenant surfaces show: faults that are true right now, with
		// safe mode carried by its own flag and wording.
		faults: faultsFromMask(report.faultsPresent).filter(
			(fault): fault is DeviceSensorFault => fault !== "safe_mode",
		),
		since: row.createdAt,
	};
}

function resolveRssi(
	device: FleetDeviceInput,
	now: Date,
	policy: DeviceStatusPolicy,
): { rssiDbm: number | null; rssiFreshness: ReadingFreshness; rssiAt: Date | null } {
	// `resolveRssiDbm` already drops a reading older than the display offline
	// window, so a timed-out value never renders as the current signal.
	const fresh = resolveRssiDbm({
		rssiDbm: device.rssiDbm,
		updatedAt: device.rssiUpdatedAt,
		now,
		policy,
	});
	if (fresh !== null)
		return { rssiDbm: fresh, rssiFreshness: "fresh", rssiAt: device.rssiUpdatedAt ?? null };
	if (!isValidRssiDbm(device.rssiDbm))
		return { rssiDbm: null, rssiFreshness: "none", rssiAt: null };
	return {
		rssiDbm: null,
		rssiFreshness: readingFreshness(device.rssiUpdatedAt, now, policy),
		rssiAt: device.rssiUpdatedAt ?? null,
	};
}

/** One unit's telemetry. Absent inputs stay null instead of becoming zero. */
export function buildDeviceTelemetryRow(
	device: FleetDeviceInput,
	now: Date,
	policy: DeviceStatusPolicy,
): DeviceTelemetryRow {
	const status = evaluateDeviceStatus({ lastSeenAt: device.lastSeenAt, now, policy });
	const rssi = resolveRssi(device, now, policy);
	const feedLevelPercent = finiteOrNull(device.feedLevelPercent);
	const celsius = finiteOrNull(device.waterTempC);

	return {
		id: device.id,
		label: device.label,
		mac: device.mac,
		pondName: device.pondName,
		tenantId: device.tenantId,
		tenantName: device.tenantName,
		connection: status.state,
		lastHeartbeatAt: device.lastSeenAt,
		rssiDbm: rssi.rssiDbm,
		rssiFreshness: rssi.rssiFreshness,
		rssiAt: rssi.rssiAt,
		firmware: resolveFirmware(device),
		lastFeedAt: device.lastFeedAt ?? null,
		feedLevel: {
			percent: feedLevelPercent,
			at: device.feedLevelUpdatedAt ?? null,
			freshness:
				feedLevelPercent === null
					? "none"
					: readingFreshness(device.feedLevelUpdatedAt, now, policy),
		},
		waterTemp:
			celsius === null
				? null
				: {
						celsius,
						at: device.waterTempUpdatedAt ?? null,
						freshness: readingFreshness(device.waterTempUpdatedAt, now, policy),
						probeOk: typeof device.waterTempOk === "boolean" ? device.waterTempOk : null,
					},
		health: resolveHealth(device),
	};
}

/** One row per tenant that has at least one device. */
export function buildTenantFleetRows(
	devices: readonly FleetDeviceInput[],
	now: Date,
	policy: DeviceStatusPolicy,
): TenantFleetRow[] {
	const groups = new Map<string, FleetDeviceInput[]>();
	for (const device of devices) {
		const key = groupKey(device);
		const bucket = groups.get(key);
		if (bucket) bucket.push(device);
		else groups.set(key, [device]);
	}

	const rows: TenantFleetRow[] = [];
	for (const bucket of groups.values()) {
		let online = 0;
		let weak = 0;
		let offline = 0;
		let reporting = 0;
		let lastHeartbeatAt: Date | null = null;
		const deviceRows: DeviceTelemetryRow[] = [];

		for (const device of bucket) {
			// One evaluation per unit: the tenant counts and the device row can never
			// disagree about the same heartbeat.
			const row = buildDeviceTelemetryRow(device, now, policy);
			deviceRows.push(row);

			if (device.lastSeenAt) {
				reporting += 1;
				if (!lastHeartbeatAt || device.lastSeenAt > lastHeartbeatAt) {
					lastHeartbeatAt = device.lastSeenAt;
				}
			}
			if (row.connection === "offline") offline += 1;
			else if (row.connection === "weak") weak += 1;
			else online += 1;
		}

		const first = bucket[0] as FleetDeviceInput;
		rows.push({
			tenantId: first.tenantId,
			tenantName: first.tenantName,
			total: bucket.length,
			reporting,
			online,
			weak,
			offline,
			offlinePct: reporting > 0 ? Math.round((offline / reporting) * 1000) / 10 : null,
			lastHeartbeatAt,
			state: deviceFleetState({ offline, reporting, total: bucket.length }),
			devices: sortDeviceTelemetryRows(deviceRows),
		});
	}

	return sortFleetRows(rows);
}

/** Worst first, then by name so the order is stable between renders. */
export function sortFleetRows(rows: readonly TenantFleetRow[]): TenantFleetRow[] {
	return [...rows].sort((a, b) => {
		const rank = FLEET_STATE_ORDER[a.state] - FLEET_STATE_ORDER[b.state];
		if (rank !== 0) return rank;
		const left = a.tenantName ?? "";
		const right = b.tenantName ?? "";
		return left.localeCompare(right, undefined, { sensitivity: "base" });
	});
}

/** Worst first, then by label: silence, then a weak signal, then healthy units. */
export function sortDeviceTelemetryRows(rows: readonly DeviceTelemetryRow[]): DeviceTelemetryRow[] {
	return [...rows].sort((a, b) => {
		const rank = DEVICE_STATE_ORDER[a.connection] - DEVICE_STATE_ORDER[b.connection];
		if (rank !== 0) return rank;
		return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
	});
}

/** Every unit across the tenants, worst first (the page's per-device table). */
export function worstDevices(rows: readonly TenantFleetRow[]): DeviceTelemetryRow[] {
	return sortDeviceTelemetryRows(rows.flatMap((row) => row.devices));
}

export interface FleetSummary {
	state: BandState;
	counts: Record<BandState, number>;
}

/**
 * The fleet total: the worst tenant, plus how many tenants sit in each state.
 * With no devices at all there is nothing to measure, so the total is `unknown`.
 */
export function summarizeFleet(rows: readonly TenantFleetRow[]): FleetSummary {
	const counts: Record<BandState, number> = { ok: 0, degraded: 0, critical: 0, unknown: 0 };
	for (const row of rows) counts[row.state] += 1;

	return {
		state: rows.length === 0 ? "unknown" : worstState(rows.map((row) => row.state)),
		counts,
	};
}

/** A tenant whose units have never reported: the "unmeasured" case, spelled out. */
export function isUnmeasured(row: TenantFleetRow): boolean {
	return row.reporting === 0;
}
