import prisma from "@/lib/prisma";

/**
 * What a unit echoes back about the config it applied.
 *
 * The dashboard writes per-device values into the 5-second poll response's
 * `config` object, but a write is only a promise: the unit may be offline, may
 * not have polled yet, or may refuse the whole object when a value leaves the
 * envelope, in which case it keeps its last-good copy. Firmware 1.7.0+
 * therefore echoes `config_rev` (a hash of the whole config it applied) and
 * `config_source` (`server` / `nvs` / `default`) on every heartbeat, and the
 * ingest route records a `config_applied` state event whenever that revision
 * changes.
 *
 * That is the only device-side evidence the platform has: one revision for the
 * whole config, never per-key values. "Applied" therefore means "this unit
 * echoed a config after the last recorded change", not "this unit reports
 * these numbers". A unit that never echoed one is shown as never reported
 * rather than assumed applied.
 *
 * The OTA policy card (#660) and the hopper filter card (#659) share this one
 * classifier so their wording of "applied" cannot drift apart.
 */

/** `DeviceStateEvent` type the ingest route writes when a unit echoes a config. */
export const CONFIG_APPLIED_EVENT = "config_applied";

/** The firmware's documented `config_source` values. */
export type ConfigSource = "server" | "nvs" | "default";

/**
 * - `applied`: echoed a config after the last recorded change.
 * - `pending`: last config echo predates that change.
 * - `reported`: no change is recorded, so there is nothing to compare.
 * - `never_reported`: no `config_applied` row exists (pre-1.7.0 or never polled).
 */
export type ConfigEchoState = "applied" | "pending" | "reported" | "never_reported";

export interface DeviceConfigEcho {
	/** False when the reads failed; the card then says so instead of guessing. */
	available: boolean;
	/** Newest `config_applied` row for the device, or null when there is none. */
	reportedAt: Date | null;
	/** `diag.config_rev` echoed on the last heartbeat, or null when absent. */
	reportedRev: number | null;
	/** `diag.config_source` echoed on the last heartbeat, or null when absent. */
	configSource: ConfigSource | null;
}

/** True when the value came from the firmware's documented `config_source`. */
export function readConfigSource(value: unknown): ConfigSource | null {
	return value === "server" || value === "nvs" || value === "default" ? value : null;
}

/** `diag.config_rev` as a finite non-negative integer, or null. */
export function readConfigRev(diag: unknown): number | null {
	if (typeof diag !== "object" || diag === null || Array.isArray(diag)) return null;
	const value = (diag as Record<string, unknown>).config_rev;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** `diag.config_source` as a documented value, or null. */
export function readDiagSource(diag: unknown): ConfigSource | null {
	if (typeof diag !== "object" || diag === null || Array.isArray(diag)) return null;
	return readConfigSource((diag as Record<string, unknown>).config_source);
}

/** Classify one unit against the last recorded change. */
export function configEchoState(reportedAt: Date | null, changedAt: Date | null): ConfigEchoState {
	if (!reportedAt) return "never_reported";
	if (!changedAt) return "reported";
	return reportedAt.getTime() >= changedAt.getTime() ? "applied" : "pending";
}

/** Read one device's config echo. Never throws: a settings page must render. */
export async function loadDeviceConfigEcho(deviceId: string): Promise<DeviceConfigEcho> {
	try {
		const [device, applied] = await Promise.all([
			prisma.energyDevice.findUnique({
				where: { id: deviceId },
				select: { diag: true },
			}),
			prisma.deviceStateEvent.findFirst({
				where: { deviceId, eventType: CONFIG_APPLIED_EVENT },
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			}),
		]);
		return {
			available: true,
			reportedAt: applied?.createdAt ?? null,
			reportedRev: readConfigRev(device?.diag),
			configSource: readDiagSource(device?.diag),
		};
	} catch (error) {
		// A read failure is "not proven", never "nothing changed".
		console.warn(
			"[config-echo] the device's config report could not be read",
			error instanceof Error ? error.message : String(error),
		);
		return { available: false, reportedAt: null, reportedRev: null, configSource: null };
	}
}

/** When the newest state event of one type was recorded, or null. Never throws. */
export async function loadDeviceEventAt(deviceId: string, eventType: string): Promise<Date | null> {
	try {
		const row = await prisma.deviceStateEvent.findFirst({
			where: { deviceId, eventType },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true },
		});
		return row?.createdAt ?? null;
	} catch (error) {
		console.warn(
			`[config-echo] the newest ${eventType} event could not be read`,
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}
