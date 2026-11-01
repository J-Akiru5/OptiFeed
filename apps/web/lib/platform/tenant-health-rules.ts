import { type DeviceStatusPolicy, evaluateDeviceStatus } from "@/lib/device-status";
import { resolvePagination } from "@/lib/pagination";
import {
	BAND_STATE_ORDER,
	type BandState,
	deviceFleetState,
	worstState,
} from "@/lib/platform/status-band-rules";

/**
 * Tenant health rules (issue #479, M3C.3).
 *
 * One row per organization, worst first, so the command center answers "which
 * tenants are not serving their farmers, and why" without opening each one.
 *
 * A row's state is the **worst of two facts that already have a rule**:
 *
 *  - the tenant's device fleet, through `deviceFleetState` — the same 20 % / 50 %
 *    offline thresholds the status bands and the fleet monitor use, applied to
 *    `evaluateDeviceStatus` per unit;
 *  - the organization's own status: a suspended or pending-deletion tenant is
 *    `degraded`, because it has deliberately stopped serving even if its feeders
 *    are still online.
 *
 * No composite score, no weighted average, and one invariant that matters more
 * than the rest: **a tenant with nothing to measure is `unknown`, never `ok`.**
 * An organization with no ponds, or with ponds whose units never reported, has
 * not been shown to be healthy, so the page cannot say it is.
 *
 * Pure so ranking, grouping and paging can be tested without a database; the
 * loader in `tenant-health.ts` only queries and maps.
 */

export interface TenantHealthDeviceInput {
	id: string;
	lastSeenAt: Date | null;
}

export interface TenantHealthInput {
	orgId: string;
	orgName: string;
	/** `OrgStatus`: ACTIVE, SUSPENDED, PENDING_DELETION, PURGED. */
	orgStatus: string;
	/** Memberships that are not revoked. */
	members: number;
	/** Ponds that resolve to this tenant. */
	ponds: number;
	devices: readonly TenantHealthDeviceInput[];
	/** Unacknowledged, not auto-cleared notifications on this tenant's ponds. */
	openAlerts: number;
}

export interface TenantHealthRow {
	orgId: string;
	orgName: string;
	orgStatus: string;
	members: number;
	ponds: number;
	devices: number;
	/** Units that have ever reported a heartbeat. */
	reporting: number;
	offline: number;
	/** Offline share of the reporting units; null when none ever reported. */
	offlinePct: number | null;
	lastHeartbeatAt: Date | null;
	openAlerts: number;
	/** The fleet fact alone, kept visible so the page can explain the state. */
	deviceState: BandState;
	state: BandState;
}

/** An organization that is not ACTIVE has stopped serving by decision or schedule. */
function orgStatusState(status: string): BandState {
	return status === "ACTIVE" ? "ok" : "degraded";
}

export function buildTenantHealthRows(
	inputs: readonly TenantHealthInput[],
	now: Date,
	policy: DeviceStatusPolicy,
): TenantHealthRow[] {
	const rows = inputs.map((input) => {
		let offline = 0;
		let reporting = 0;
		let lastHeartbeatAt: Date | null = null;

		for (const device of input.devices) {
			if (device.lastSeenAt) {
				reporting += 1;
				if (!lastHeartbeatAt || device.lastSeenAt > lastHeartbeatAt) {
					lastHeartbeatAt = device.lastSeenAt;
				}
			}
			if (evaluateDeviceStatus({ lastSeenAt: device.lastSeenAt, now, policy }).isOffline) {
				offline += 1;
			}
		}

		const deviceState = deviceFleetState({
			offline,
			reporting,
			total: input.devices.length,
		});

		return {
			orgId: input.orgId,
			orgName: input.orgName,
			orgStatus: input.orgStatus,
			members: input.members,
			ponds: input.ponds,
			devices: input.devices.length,
			reporting,
			offline,
			offlinePct: reporting > 0 ? Math.round((offline / reporting) * 1000) / 10 : null,
			lastHeartbeatAt,
			openAlerts: input.openAlerts,
			deviceState,
			state: worstState([deviceState, orgStatusState(input.orgStatus)]),
		} satisfies TenantHealthRow;
	});

	return sortTenantHealthRows(rows);
}

/** Worst first, then by name so the order is stable between renders. */
export function sortTenantHealthRows(rows: readonly TenantHealthRow[]): TenantHealthRow[] {
	return [...rows].sort((a, b) => {
		const rank = BAND_STATE_ORDER[a.state] - BAND_STATE_ORDER[b.state];
		if (rank !== 0) return rank;
		return a.orgName.localeCompare(b.orgName, undefined, { sensitivity: "base" });
	});
}

export interface TenantHealthSummary {
	state: BandState;
	counts: Record<BandState, number>;
	total: number;
}

/**
 * The platform verdict across tenants: the worst tenant, never an average. An
 * empty tenant list has been measured as nothing, which is `unknown` — a
 * platform with no organizations is not a healthy platform.
 */
export function summarizeTenants(rows: readonly TenantHealthRow[]): TenantHealthSummary {
	const counts: Record<BandState, number> = { ok: 0, degraded: 0, critical: 0, unknown: 0 };
	for (const row of rows) counts[row.state] += 1;

	return {
		state: rows.length === 0 ? "unknown" : worstState(rows.map((row) => row.state)),
		counts,
		total: rows.length,
	};
}

/**
 * Page the already-ranked rows. Ranking happens before slicing on purpose: the
 * first page must hold the worst tenants, not the tenants whose names sort first.
 * `resolvePagination` clamps a stale `?page=99` to the last real page.
 */
export function paginateTenantRows(
	rows: readonly TenantHealthRow[],
	page: number,
	pageSize: number,
): { rows: TenantHealthRow[]; pagination: ReturnType<typeof resolvePagination> } {
	const pagination = resolvePagination(page, pageSize, rows.length);
	return {
		rows: rows.slice(pagination.offset, pagination.offset + pagination.pageSize),
		pagination,
	};
}
