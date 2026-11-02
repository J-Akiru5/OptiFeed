import { getLatestHealthKey } from "@/lib/device-health";
import { type DeviceSensorFault, faultsFromMask } from "@/lib/device-health-model";
import {
	DEFAULT_DEVICE_STATUS_POLICY,
	type DeviceConnectionState,
	type DeviceStatusPolicy,
	evaluateDeviceStatus,
	resolveRssiDbm,
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
	wifiRssiDbm: true,
	wifiRssiUpdatedAt: true,
} satisfies Prisma.EnergyDeviceSelect;

export interface HopperSourceRow {
	id: string;
	feedLevelPercent: number | null;
	feedLevelUpdatedAt: Date | null;
	lastSeenAt: Date | null;
	hopperCapacityG?: number | null;
	gramsPerFeeding?: number | null;
	/** Last reported Wi-Fi RSSI in dBm (firmware 1.6.2+), null on old units. */
	wifiRssiDbm?: number | null;
	wifiRssiUpdatedAt?: Date | null;
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
	/**
	 * True when the unit is online but its hopper sensor is not answering (#574).
	 * The reading keeps its last known value and is presented as stale.
	 */
	sensorOffline: boolean;
	/** Safe mode and active faults as last reported, or null when never reported. */
	health: HopperHealth | null;
	/** Fresh, plausible RSSI in dBm, or null when none/old firmware/stale. */
	rssiDbm: number | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number | null;
}

/** The health fields the dashboard chrome reads (#575). */
export interface HopperHealth {
	safeMode: boolean;
	faults: DeviceSensorFault[];
}

/** Firmware fault name for the HC-SR04 hopper sensor (`firmware-main/status.h`). */
export const HOPPER_SENSOR_FAULT = "hopper_sensor";

/**
 * #574: decide whether the hopper sensor, rather than the whole unit, is down.
 *
 * Two independent signals:
 *  - the firmware's `hopper_sensor` fault, set after three consecutive no-echo
 *    checks (~15 s while online, ~3 min while offline);
 *  - a level that has not been refreshed for twice the offline window while the
 *    unit itself is online. That is the fallback for firmware older than 1.6.0
 *    (no `diag` block) and for a heartbeat whose feed-level fields were omitted.
 *
 * A device that is fully offline is deliberately not "sensor offline": the
 * reader already says Offline, and naming the sensor would blame the wrong part.
 */
export function resolveHopperSensorOffline(input: {
	deviceOffline: boolean;
	levelUpdatedAt: Date | null;
	sensorFault?: boolean;
	now?: Date;
	policy?: DeviceStatusPolicy;
}): boolean {
	const {
		deviceOffline,
		levelUpdatedAt,
		sensorFault = false,
		now = new Date(),
		policy = DEFAULT_DEVICE_STATUS_POLICY,
	} = input;
	if (deviceOffline) return false;
	if (sensorFault) return true;
	if (levelUpdatedAt === null) return false;
	return now.getTime() - levelUpdatedAt.getTime() > policy.offlineAfterMs * 2;
}

/** Normalise a device row into the snapshot every hopper surface renders. */
export function toHopperSnapshot(
	row: HopperSourceRow,
	now: Date = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
	sensorFault = false,
	health: HopperHealth | null = null,
): HopperSnapshot {
	// I-97: the stored signal feeds the same rule; a stale reading is dropped so
	// a silent unit is not shown as a current "weak signal".
	const rssiDbm = resolveRssiDbm({
		rssiDbm: row.wifiRssiDbm,
		updatedAt: row.wifiRssiUpdatedAt,
		now,
		policy,
	});
	const status = evaluateDeviceStatus({ lastSeenAt: row.lastSeenAt, now, policy, rssiDbm }).state;
	const isOffline = status === "offline";
	return {
		deviceId: row.id,
		levelPercent: row.feedLevelPercent,
		levelUpdatedAt: row.feedLevelUpdatedAt,
		lastSeenAt: row.lastSeenAt,
		status,
		isOffline,
		sensorOffline: resolveHopperSensorOffline({
			deviceOffline: isOffline,
			levelUpdatedAt: row.feedLevelUpdatedAt,
			sensorFault,
			now,
			policy,
		}),
		health,
		rssiDbm,
		hopperCapacityG: row.hopperCapacityG ?? null,
		gramsPerFeeding: row.gramsPerFeeding ?? null,
	};
}

/**
 * The newest `device_health` row carries both the sensor fault and the state the
 * dashboard chrome shows (#575). A failed read is advisory and must not take the
 * hopper surface down (same rule as `getDeviceHealthSafe`).
 */
async function readHopperHealth(deviceId: string): Promise<HopperHealth | null> {
	try {
		const key = await getLatestHealthKey(deviceId);
		if (!key) return null;
		return {
			safeMode: key.safeMode,
			faults: faultsFromMask(key.faultsPresent).filter(
				(fault): fault is DeviceSensorFault => fault !== "safe_mode",
			),
		};
	} catch (error) {
		console.warn(
			"[device-hopper] health read failed",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
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
	if (!row) return null;
	// One health read feeds both the sensor state (#574) and the sidebar badge (#575).
	const health = await readHopperHealth(row.id);
	const sensorFault = health?.faults.includes(HOPPER_SENSOR_FAULT) ?? false;
	return toHopperSnapshot(row, now, policy, sensorFault, health);
}
