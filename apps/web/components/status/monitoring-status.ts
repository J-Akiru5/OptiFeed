import type { DeviceSensorFault } from "@/lib/device-health-model";
import type { DeviceConnectionState } from "@/lib/device-status";

/**
 * The quick-view monitoring state for the sidebar card and the mobile HUD
 * (issue #575).
 *
 * One rule decides which colour an operator sees:
 *
 *  - **offline** — red, because the unit is not reporting;
 *  - **safe mode / active fault** — yellow, because the unit is reporting a
 *    problem the operator has to act on;
 *  - **online / weak signal** — high-contrast orange, because the unit is
 *    alive and this is the normal "at a glance" state;
 *  - **no feeder paired** — neutral, because there is no device state to show.
 *
 * Health is resolved separately from connectivity so an offline unit that is
 * also in safe mode still shows both: red wins the primary badge, and the
 * yellow health line stays visible underneath. Colour is never the only
 * signal — every caller renders the matching icon and translated label too.
 */

export type MonitoringConnection = DeviceConnectionState | "missing";

export type MonitoringTone = "active" | "attention" | "offline" | "neutral";

export type MonitoringStatusKind =
	| "online"
	| "weak"
	| "offline"
	| "safe_mode"
	| "fault"
	| "missing";

/** The health fields the quick view actually reads, so no extra data crosses the RSC boundary. */
export interface MonitoringHealth {
	safeMode: boolean;
	faults: readonly DeviceSensorFault[];
}

export type MonitoringHealthState = "safe_mode" | "fault" | "clear" | "unknown";

export function monitoringHealthState(
	health: MonitoringHealth | null | undefined,
): MonitoringHealthState {
	if (!health) return "unknown";
	if (health.safeMode) return "safe_mode";
	if (health.faults.length > 0) return "fault";
	return "clear";
}

export interface MonitoringSummary {
	kind: MonitoringStatusKind;
	tone: MonitoringTone;
	faultCount: number;
	/**
	 * A health warning the primary badge outranks. Only an offline unit can
	 * produce this: the red badge reports the connection, and this keeps the
	 * yellow fault/safe-mode row from disappearing.
	 */
	secondaryHealth: "safe_mode" | "fault" | null;
}

export function summarizeMonitoring(input: {
	connection: MonitoringConnection;
	health?: MonitoringHealth | null;
}): MonitoringSummary {
	const healthState = monitoringHealthState(input.health);
	const faultCount = input.health?.faults.length ?? 0;
	const healthWarning = healthState === "safe_mode" || healthState === "fault" ? healthState : null;

	if (input.connection === "offline") {
		return {
			kind: "offline",
			tone: "offline",
			faultCount,
			secondaryHealth: healthWarning,
		};
	}

	if (healthWarning) {
		return {
			kind: healthWarning,
			tone: "attention",
			faultCount,
			secondaryHealth: null,
		};
	}

	if (input.connection === "missing") {
		return { kind: "missing", tone: "neutral", faultCount: 0, secondaryHealth: null };
	}

	if (input.connection === "weak") {
		return { kind: "weak", tone: "active", faultCount: 0, secondaryHealth: null };
	}

	return { kind: "online", tone: "active", faultCount: 0, secondaryHealth: null };
}

/** The catalogue key (and plural count) for the primary status label. */
export type MonitoringStatusMessage =
	| { key: "statusFault"; count: number }
	| {
			key: "statusOnline" | "statusWeak" | "statusOffline" | "statusSafeMode" | "statusNoDevice";
	  };

export function monitoringStatusMessage(summary: MonitoringSummary): MonitoringStatusMessage {
	switch (summary.kind) {
		case "fault":
			return { key: "statusFault", count: summary.faultCount };
		case "safe_mode":
			return { key: "statusSafeMode" };
		case "offline":
			return { key: "statusOffline" };
		case "weak":
			return { key: "statusWeak" };
		case "missing":
			return { key: "statusNoDevice" };
		default:
			return { key: "statusOnline" };
	}
}

/** The catalogue key (and plural count) for the health detail line. */
export type MonitoringHealthMessage =
	| { key: "healthSafeMode" }
	| { key: "healthFaults"; count: number }
	| { key: "healthClear" }
	| null;

export function monitoringHealthMessage(
	health: MonitoringHealth | null | undefined,
): MonitoringHealthMessage {
	const state = monitoringHealthState(health);
	if (state === "safe_mode") return { key: "healthSafeMode" };
	if (state === "fault") return { key: "healthFaults", count: health?.faults.length ?? 0 };
	if (state === "clear") return { key: "healthClear" };
	return null;
}
