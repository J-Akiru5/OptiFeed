import { FIRMWARE_OTA_POLICY_AUDIT_ACTION } from "@/lib/firmware/config";
import prisma from "@/lib/prisma";

/**
 * What the fleet reports back about the OTA rollout policy (issue #660).
 *
 * The dashboard can write the ten `ota_*` keys, but a write is only a promise:
 * the firmware keeps its last-good config when the object is malformed or out
 * of envelope, and an unreachable unit never polls at all. Firmware 1.7.0+
 * therefore echoes `config_rev` (a hash of the whole config it applied) and
 * `config_source` (`server` / `nvs` / `default`) on every heartbeat, and the
 * ingest route records a `config_applied` state event whenever that revision
 * changes.
 *
 * That is the only device-side evidence the platform has: the firmware reports
 * one revision for the whole config, never per-key values. So "applied" here
 * means "this unit echoed a config after the last recorded policy change", not
 * "this unit reports these ten numbers". A unit that never echoed one is shown
 * as never reported rather than assumed applied.
 *
 * Read-only and platform-gated by its caller (the superadmin settings page
 * already runs behind `requirePlatformAdmin` through the layout).
 */

/** Devices read per page load; a larger fleet is reported as truncated. */
export const OTA_POLICY_DEVICE_LIMIT = 500;

/** Rows rendered in the settings card; the counts still cover every device. */
export const OTA_POLICY_ROW_LIMIT = 8;

export type OtaConfigSource = "server" | "nvs" | "default";

/**
 * - `applied`: echoed a config after the last recorded policy change.
 * - `pending`: last config echo predates that change.
 * - `reported`: no policy change is recorded, so there is nothing to compare.
 * - `never_reported`: no `config_applied` row exists (pre-1.7.0 or never polled).
 */
export type OtaConfirmationState = "applied" | "pending" | "reported" | "never_reported";

export interface OtaDeviceReport {
	id: string;
	label: string;
	lastSeenAt: Date | null;
	/** `diag.config_rev` echoed on the last heartbeat, or null when absent. */
	reportedRev: number | null;
	/** `diag.config_source` echoed on the last heartbeat, or null when absent. */
	configSource: OtaConfigSource | null;
	/** Newest `config_applied` row for the device, or null when there is none. */
	reportedAt: Date | null;
}

export interface OtaPolicyDevice extends OtaDeviceReport {
	state: OtaConfirmationState;
}

export interface OtaPolicyStatus {
	/** False when the reads failed; the card then says so instead of showing zero. */
	available: boolean;
	devicesTruncated: boolean;
	/** When the OTA policy was last written through the console, or null. */
	changedAt: Date | null;
	/** Devices needing attention first, capped at `OTA_POLICY_ROW_LIMIT`. */
	devices: OtaPolicyDevice[];
	total: number;
	appliedCount: number;
	pendingCount: number;
	reportedCount: number;
	neverReportedCount: number;
}

const STATE_ORDER: Record<OtaConfirmationState, number> = {
	pending: 0,
	never_reported: 1,
	reported: 2,
	applied: 3,
};

/** True when the value came from the firmware's documented `config_source`. */
function readConfigSource(value: unknown): OtaConfigSource | null {
	return value === "server" || value === "nvs" || value === "default" ? value : null;
}

/** `diag.config_rev` as a finite non-negative integer, or null. */
function readConfigRev(diag: unknown): number | null {
	if (typeof diag !== "object" || diag === null || Array.isArray(diag)) return null;
	const value = (diag as Record<string, unknown>).config_rev;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readDiagSource(diag: unknown): OtaConfigSource | null {
	if (typeof diag !== "object" || diag === null || Array.isArray(diag)) return null;
	return readConfigSource((diag as Record<string, unknown>).config_source);
}

/** Classify one unit against the last recorded policy change. */
export function otaConfirmationState(
	reportedAt: Date | null,
	changedAt: Date | null,
): OtaConfirmationState {
	if (!reportedAt) return "never_reported";
	if (!changedAt) return "reported";
	return reportedAt.getTime() >= changedAt.getTime() ? "applied" : "pending";
}

/**
 * Reduce the device reports to the card's summary.
 *
 * Pure so the classification is testable without a database: the caller passes
 * the audit timestamp and one entry per device.
 */
export function summarizeOtaPolicy(input: {
	reports: readonly OtaDeviceReport[];
	changedAt: Date | null;
	devicesTruncated?: boolean;
}): OtaPolicyStatus {
	const classified = input.reports.map((report) => ({
		...report,
		state: otaConfirmationState(report.reportedAt, input.changedAt),
	}));

	const count = (state: OtaConfirmationState) =>
		classified.filter((device) => device.state === state).length;

	const devices = [...classified]
		.sort(
			(a, b) =>
				STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
				(b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
		)
		.slice(0, OTA_POLICY_ROW_LIMIT);

	return {
		available: true,
		devicesTruncated: input.devicesTruncated ?? false,
		changedAt: input.changedAt,
		devices,
		total: classified.length,
		appliedCount: count("applied"),
		pendingCount: count("pending"),
		reportedCount: count("reported"),
		neverReportedCount: count("never_reported"),
	};
}

function unavailable(): OtaPolicyStatus {
	return {
		available: false,
		devicesTruncated: false,
		changedAt: null,
		devices: [],
		total: 0,
		appliedCount: 0,
		pendingCount: 0,
		reportedCount: 0,
		neverReportedCount: 0,
	};
}

/** Read the fleet's config echoes. Never throws: the settings page must render. */
export async function getOtaPolicyStatus(): Promise<OtaPolicyStatus> {
	try {
		const [change, deviceRows, appliedGroups] = await Promise.all([
			prisma.platformAuditLog.findFirst({
				where: { action: FIRMWARE_OTA_POLICY_AUDIT_ACTION },
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			}),
			prisma.energyDevice.findMany({
				orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { label: "asc" }],
				take: OTA_POLICY_DEVICE_LIMIT + 1,
				select: { id: true, label: true, lastSeenAt: true, diag: true },
			}),
			prisma.deviceStateEvent.groupBy({
				by: ["deviceId"],
				where: { eventType: "config_applied" },
				_max: { createdAt: true },
			}),
		]);

		const reportedAtByDevice = new Map<string, Date | null>();
		for (const group of appliedGroups) {
			reportedAtByDevice.set(group.deviceId, group._max.createdAt ?? null);
		}

		const reports = deviceRows.slice(0, OTA_POLICY_DEVICE_LIMIT).map((row) => ({
			id: row.id,
			label: row.label,
			lastSeenAt: row.lastSeenAt,
			reportedRev: readConfigRev(row.diag),
			configSource: readDiagSource(row.diag),
			reportedAt: reportedAtByDevice.get(row.id) ?? null,
		}));

		return summarizeOtaPolicy({
			reports,
			changedAt: change?.createdAt ?? null,
			devicesTruncated: deviceRows.length > OTA_POLICY_DEVICE_LIMIT,
		});
	} catch (error) {
		// A read failure is "not proven", never "nothing changed".
		console.warn(
			"[ota-policy] device config reports could not be read",
			error instanceof Error ? error.message : String(error),
		);
		return unavailable();
	}
}
