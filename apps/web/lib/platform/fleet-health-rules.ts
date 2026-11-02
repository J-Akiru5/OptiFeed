import { type DeviceStatusPolicy, evaluateDeviceStatus } from "@/lib/device-status";
import {
	BAND_STATE_ORDER,
	type BandState,
	deviceFleetState,
	worstState,
} from "@/lib/platform/status-band-rules";

/**
 * Fleet monitor rules (issue #479, M3C.4).
 *
 * The monitor answers one question per tenant: *is this tenant's fleet healthy,
 * and if not, why?* It does that by reusing, not copying, the single device
 * connectivity rule: `evaluateDeviceStatus` with the configured `device.status`
 * policy decides each unit's state, and `deviceFleetState` turns a tenant's
 * counts into a band state with the same thresholds the status bands already
 * use (20 % offline → degraded, 50 % → critical).
 *
 * The invariants are the bands' invariants:
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
}

/** Worst first: the shared band order, so every console list ranks alike. */
export const FLEET_STATE_ORDER: Record<BandState, number> = BAND_STATE_ORDER;

function groupKey(device: FleetDeviceInput): string {
	return device.tenantId ?? "__unassigned__";
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

		for (const device of bucket) {
			if (device.lastSeenAt) {
				reporting += 1;
				if (!lastHeartbeatAt || device.lastSeenAt > lastHeartbeatAt) {
					lastHeartbeatAt = device.lastSeenAt;
				}
			}
			const status = evaluateDeviceStatus({ lastSeenAt: device.lastSeenAt, now, policy });
			if (status.isOffline) offline += 1;
			else if (status.isWeak) weak += 1;
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
