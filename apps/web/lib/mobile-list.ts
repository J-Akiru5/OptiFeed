/**
 * Presentation helpers for the mobile list patterns (mission E26).
 *
 * The status strip, the chips row and the large list cards are a mobile
 * affordance, so they live below `lg` and never change what the desktop tables
 * show. Everything here is pure and synchronous: the pages pass the rows they
 * already fetched and these helpers only count, filter and order them.
 *
 * Because the list actions (`getPonds`, `getDevices`, `listPlatformDevices`)
 * stay untouched, the strip filters **the rows on the current page**. The pages
 * say so under the chips instead of implying a global count.
 */

import {
	DEFAULT_DEVICE_STATUS_POLICY,
	type DeviceStatusPolicy,
	evaluateDeviceStatus,
} from "@/lib/device-status";

/** The three states the strip can show, plus "all". */
export type DeviceListStatus = "online" | "alarm" | "offline";
export type DeviceStatusFilter = "all" | DeviceListStatus;

/** Order of the strip, worst first is used by the `status` ordering. */
export const DEVICE_STATUS_FILTERS: readonly DeviceStatusFilter[] = [
	"all",
	"online",
	"alarm",
	"offline",
] as const;

/** Hopper level at or below this is treated as an alarm (OrgSetting default). */
export const LOW_HOPPER_PCT = 20;

export type ListOrder = "newest" | "name" | "status";

export const LIST_ORDERS: readonly ListOrder[] = ["newest", "name", "status"] as const;

/** Anything with a heartbeat and a hopper reading can be graded. */
export interface DeviceStatusInput {
	lastSeenAt: Date | string | null;
	feedLevelPercent: number | null;
	approvalStatus?: string | null;
}

function toTime(value: Date | string | null): number | null {
	if (!value) return null;
	const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
}

/** Accept only the values the strip offers; anything else means "all". */
export function parseDeviceStatusFilter(
	value: string | string[] | undefined | null,
): DeviceStatusFilter {
	const raw = Array.isArray(value) ? value[0] : value;
	return DEVICE_STATUS_FILTERS.includes(raw as DeviceStatusFilter)
		? (raw as DeviceStatusFilter)
		: "all";
}

/** Accept only the values the chips offer; anything else keeps the server order. */
export function parseListOrder(value: string | string[] | undefined | null): ListOrder {
	const raw = Array.isArray(value) ? value[0] : value;
	return LIST_ORDERS.includes(raw as ListOrder) ? (raw as ListOrder) : "newest";
}

/** `1` / `true` means "only what needs attention". */
export function parseAttention(value: string | string[] | undefined | null): boolean {
	const raw = Array.isArray(value) ? value[0] : value;
	return raw === "1" || raw === "true";
}

/**
 * Grade one device.
 *
 * Offline wins: a stale reading is not a trustworthy level, so the last known
 * value never turns a silent feeder into a green dot (decision E4). A pending
 * registration is not reporting yet, so it is offline too. A live unit with a
 * hopper at or below `LOW_HOPPER_PCT` needs attention.
 *
 * The strip keeps three tiles (All / Online / Alarm / Offline). A weak-signal
 * unit is still reachable, so it counts as `online` here; the detailed
 * Online / Weak signal / Offline badge is shown on the device rows themselves.
 */
export function deviceListStatus(
	device: DeviceStatusInput,
	now: Date = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): DeviceListStatus {
	if (device.approvalStatus === "PENDING" || device.approvalStatus === "REJECTED") {
		return "offline";
	}
	const seen = toTime(device.lastSeenAt);
	const state = evaluateDeviceStatus({
		lastSeenAt: seen === null ? null : new Date(seen),
		now,
		policy,
	}).state;
	if (state === "offline") return "offline";
	if (device.feedLevelPercent !== null && device.feedLevelPercent <= LOW_HOPPER_PCT) return "alarm";
	return "online";
}

/**
 * Grade a pond by its feeders: no feeder is offline, any feeder that needs
 * attention makes the pond an alarm, otherwise online when one is reporting.
 * An archived pond is never "online" — it is not in operation.
 */
export function pondListStatus(
	devices: DeviceStatusInput[],
	now: Date = new Date(),
	archived = false,
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): DeviceListStatus {
	if (archived) return "offline";
	const statuses = devices.map((device) => deviceListStatus(device, now, policy));
	if (statuses.includes("alarm")) return "alarm";
	if (statuses.includes("online")) return "online";
	return "offline";
}

/** Counts for the strip, including every filtered state. */
export function summarizeStatuses(
	statuses: DeviceListStatus[],
): Record<DeviceStatusFilter, number> {
	return {
		all: statuses.length,
		online: statuses.filter((status) => status === "online").length,
		alarm: statuses.filter((status) => status === "alarm").length,
		offline: statuses.filter((status) => status === "offline").length,
	};
}

/** Keep the rows the reader asked for. `all` keeps everything. */
export function filterByStatus<T>(
	rows: T[],
	status: DeviceStatusFilter,
	statusOf: (row: T) => DeviceListStatus,
): T[] {
	if (status === "all") return rows;
	return rows.filter((row) => statusOf(row) === status);
}

/** "Needs attention" is the two states that ask the reader to act. */
export function isAttention(status: DeviceListStatus): boolean {
	return status !== "online";
}

const STATUS_RANK: Record<DeviceListStatus, number> = {
	alarm: 0,
	offline: 1,
	online: 2,
};

/**
 * Order the visible rows without touching the database order.
 *
 * `newest` keeps what the action returned (createdAt desc). `name` sorts A→Z
 * with the locale's own collation. `status` puts what needs a decision first.
 */
export function orderRows<T>(
	rows: T[],
	order: ListOrder,
	keys: (row: T) => { name: string; status: DeviceListStatus },
	locale = "en",
): T[] {
	if (order === "newest") return rows;
	const decorated = rows.map((row) => ({ row, ...keys(row) }));
	decorated.sort((a, b) => {
		if (order === "status" && STATUS_RANK[a.status] !== STATUS_RANK[b.status]) {
			return STATUS_RANK[a.status] - STATUS_RANK[b.status];
		}
		return a.name.localeCompare(b.name, locale, { sensitivity: "base", numeric: true });
	});
	return decorated.map((entry) => entry.row);
}
