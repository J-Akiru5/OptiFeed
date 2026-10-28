import { isDeviceOffline } from "@/lib/feed-level-display";
import prisma from "@/lib/prisma";
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
 *  - offline is the shared `OFFLINE_THRESHOLD_MS` rule from
 *    `lib/feed-level-display.ts`, so the last-known treatment cannot drift.
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
	isOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number | null;
}

/** Normalise a device row into the snapshot every hopper surface renders. */
export function toHopperSnapshot(row: HopperSourceRow, now: Date = new Date()): HopperSnapshot {
	return {
		deviceId: row.id,
		levelPercent: row.feedLevelPercent,
		levelUpdatedAt: row.feedLevelUpdatedAt,
		lastSeenAt: row.lastSeenAt,
		isOffline: isDeviceOffline(row.lastSeenAt, now),
		hopperCapacityG: row.hopperCapacityG ?? null,
		gramsPerFeeding: row.gramsPerFeeding ?? null,
	};
}

/** Read the primary device's hopper snapshot for a pond. */
export async function loadPondHopper(
	pondId: string,
	now: Date = new Date(),
): Promise<HopperSnapshot | null> {
	const row = await prisma.energyDevice.findFirst({
		where: { pondId },
		orderBy: { createdAt: "asc" },
		select: HOPPER_SNAPSHOT_SELECT,
	});
	return row ? toHopperSnapshot(row, now) : null;
}
