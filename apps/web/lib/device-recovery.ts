import { getDeviceFirmwareVersion } from "@/lib/device-firmware";
import { DEVICE_HEALTH_EVENT, healthFromMetadata } from "@/lib/device-health-model";
import {
	type CalibrationGate,
	type DeviceRecoveryPlan,
	RECOVERY_HEALTH_ROWS,
	type RecoveryHealthRow,
	buildRecoveryPlan,
	unavailableRecoveryPlan,
} from "@/lib/device-recovery-model";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { getFirmwareGates } from "@/lib/settings/firmware-gates";

/**
 * Database reads for the hardware recovery rules (M2).
 *
 * The rules live in `device-recovery-model.ts`; this file only gathers evidence
 * that already exists, so no schema change is needed:
 *
 *  - `EnergyDevice.lastSeenAt` / `rtcOk` / `wifiRssi*` and the latest `diag`
 *    snapshot (written on every heartbeat by `/api/ingest`);
 *  - the newest `device_health` rows, which now also carry this boot's reset
 *    reason and uptime;
 *  - the reported firmware version (`device-firmware.ts`);
 *  - the configured `safe_mode_quiet_s` gate (default 30 minutes).
 *
 * Every read is bounded; a failed advisory read must not take a page down.
 */

export * from "@/lib/device-recovery-model";

export interface DeviceRecoveryInput {
	deviceId: string;
	now?: Date;
	/** True while a feed command is being delivered (keeps a reachable unit online). */
	inFlight?: boolean;
}

async function firmwareVersionFor(deviceId: string): Promise<string | null> {
	try {
		const firmware = await getDeviceFirmwareVersion(deviceId);
		return firmware?.version ?? null;
	} catch (error) {
		console.warn(
			"[device-recovery] firmware version read failed",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}

async function healthRowsFor(deviceId: string): Promise<RecoveryHealthRow[]> {
	try {
		const rows = await prisma.deviceStateEvent.findMany({
			where: { deviceId, eventType: DEVICE_HEALTH_EVENT },
			orderBy: { createdAt: "desc" },
			take: RECOVERY_HEALTH_ROWS,
			select: { metadata: true, createdAt: true },
		});
		return rows.map((row) => ({
			report: healthFromMetadata(row.metadata),
			createdAt: row.createdAt,
		}));
	} catch (error) {
		console.warn(
			"[device-recovery] health history read failed",
			error instanceof Error ? error.message : String(error),
		);
		return [];
	}
}

/**
 * The recovery plan for one device. Throws only when the device row itself
 * cannot be read; the advisory reads above already degrade to "no evidence".
 */
export async function getDeviceRecovery(input: DeviceRecoveryInput): Promise<DeviceRecoveryPlan> {
	const now = input.now ?? new Date();
	const [device, rows, firmwareVersion, policy, gates] = await Promise.all([
		prisma.energyDevice.findUnique({
			where: { id: input.deviceId },
			select: {
				id: true,
				lastSeenAt: true,
				rtcOk: true,
				wifiRssiDbm: true,
				wifiRssiUpdatedAt: true,
				diag: true,
			},
		}),
		healthRowsFor(input.deviceId),
		firmwareVersionFor(input.deviceId),
		getDeviceStatusPolicy(),
		getFirmwareGates(),
	]);

	if (!device) throw new Error("Device not found");

	return buildRecoveryPlan({
		now,
		device: {
			lastSeenAt: device.lastSeenAt,
			rtcOk: device.rtcOk,
			wifiRssiDbm: device.wifiRssiDbm,
			wifiRssiUpdatedAt: device.wifiRssiUpdatedAt,
			diag: device.diag,
		},
		healthRows: rows,
		firmwareVersion,
		policy,
		quietS: gates.safe_mode_quiet_s,
		inFlight: input.inFlight,
	});
}

/**
 * The recovery plan for surfaces that are about something else. A failed read
 * returns an explicit "cannot verify" plan (see the model) instead of throwing;
 * pages keep rendering and never claim the feeder is healthy.
 */
export async function getDeviceRecoverySafe(
	input: DeviceRecoveryInput,
): Promise<DeviceRecoveryPlan> {
	const now = input.now ?? new Date();
	try {
		return await getDeviceRecovery(input);
	} catch (error) {
		console.warn(
			"[device-recovery] read failed",
			error instanceof Error ? error.message : String(error),
		);
		return unavailableRecoveryPlan(now);
	}
}

/**
 * The dangerous-action gate for calibration (M1's safe-mode guard, extended by
 * M2). A failed read fails open, exactly like `getDeviceHealthSafe` did in M1:
 * the offline and safe-mode facts that can still be checked from the device row
 * are enforced by the caller before this runs.
 */
export async function getCalibrationGate(
	deviceId: string,
	now = new Date(),
): Promise<CalibrationGate> {
	const plan = await getDeviceRecoverySafe({ deviceId, now });
	return plan.calibration;
}

/**
 * The operator-facing reason a calibration dose was refused. English, like the
 * other action errors; the hardware page shows the translated copy.
 */
export function calibrationBlockError(code: CalibrationGate["code"]): string {
	switch (code) {
		case "safe_mode":
			// Kept identical to M1's message: safe mode refuses every dose in
			// firmware, so a queued test can only expire.
			return "Safe mode is on — the unit refuses every dose until it clears. Wait for 30 quiet minutes or hold the Wi-Fi reset button for 5 seconds, then run the test again.";
		case "recovering":
			return "The unit cleared safe mode but has not verified healthy yet — dose testing stays locked until its heartbeat, connection, sensors and firmware version are all fresh.";
		case "fault":
			return "The unit reports a hardware fault — dose testing stays locked until the fault clears. Check the device health panel.";
		case "maintenance":
			return "The unit is in maintenance — dose testing is unavailable until the maintenance ends.";
		case "offline":
			return "Device is offline — calibration rejected. Retry once the device reconnects.";
		default:
			return "Calibration is unavailable for this device.";
	}
}
