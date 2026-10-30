import {
	DEFAULT_DEVICE_STATUS_POLICY,
	type DeviceConnectionState,
	type DeviceStatusPolicy,
	evaluateDeviceStatus,
} from "@/lib/device-status";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import type { Prisma } from "@prisma/client";

/**
 * One source for a pond's hopper reading (#263).
 *
 * Every surface (sidebar, dashboard, hardware settings, History, admin and
 * platform device lists) reads the same `EnergyDevice` row selected here:
 *
 *  - the primary device of the pond is the oldest row (`createdAt asc`), the
 *    same convention the dashboard uses for its schedule and controller;
 *  - the live value is `feedLevelPercent` + `feedLevelUpdatedAt`, never a
 *    recomputed distance or a cached snapshot;
 *  - connection state is the shared three-state rule from
 *    `lib/device-status.ts` (#388), so the last-known treatment cannot drift.
 *
 * Surfaces that already load the full device row pass it to
 * `toHopperSnapshot`; surfaces that only need the reading use
 * `loadPondHopper`.
 */

export const HOPPER_SNAPSHOT_SELECT = {
	id: true,
	feedLevelPercent: true,
	feedLevelUpdatedAt: true,
	lastSeenAt: true,
	hopperCapacityG: true,
	gramsPerFeeding: true,
} satisfies Prisma.EnergyDeviceSelect;

export interface HopperSourceRow {
	id: string;
	feedLevelPercent: number | null;
	feedLevelUpdatedAt: Date | null;
	lastSeenAt: Date | null;
	hopperCapacityG?: number | null;
	gramsPerFeeding?: number | null;
}

export interface HopperSnapshot {
	deviceId: string;
	levelPercent: number | null;
	levelUpdatedAt: Date | null;
	lastSeenAt: Date | null;
	/** The three-state connection rule from `lib/device-status.ts`. */
	status: DeviceConnectionState;
	/** True only for the full offline state; weak signal keeps its reading live. */
	isOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number | null;
}

/** Normalise a device row into the snapshot every hopper surface renders. */
export function toHopperSnapshot(
	row: HopperSourceRow,
	now: Date = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): HopperSnapshot {
	const status = evaluateDeviceStatus({ lastSeenAt: row.lastSeenAt, now, policy }).state;
	return {
		deviceId: row.id,
		levelPercent: row.feedLevelPercent,
		levelUpdatedAt: row.feedLevelUpdatedAt,
		lastSeenAt: row.lastSeenAt,
		status,
		isOffline: status === "offline",
		hopperCapacityG: row.hopperCapacityG ?? null,
		gramsPerFeeding: row.gramsPerFeeding ?? null,
	};
}

/** Read the primary device's hopper snapshot for a pond. */
export async function loadPondHopper(
	pondId: string,
	now: Date = new Date(),
): Promise<HopperSnapshot | null> {
	const [row, policy] = await Promise.all([
		prisma.energyDevice.findFirst({
			where: { pondId },
			orderBy: { createdAt: "asc" },
			select: HOPPER_SNAPSHOT_SELECT,
		}),
		getDeviceStatusPolicy(),
	]);
	return row ? toHopperSnapshot(row, now, policy) : null;
}
