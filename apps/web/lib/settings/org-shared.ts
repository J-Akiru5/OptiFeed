import { MEMBER_ROLES, isMemberRole } from "@/lib/auth/member-rules";
import type { DeviceRegistrationMode, MemberRole } from "@prisma/client";

/**
 * Organization settings (issue #190 / decision E6).
 *
 * `OrgSetting` is a single row per organization and the row may be missing
 * entirely — every org created before the settings migration, and every org
 * that never opened the settings page, has no row. Readers therefore never
 * treat "no row" as "no configuration": `mergeOrgSettings` fills the schema
 * defaults in one pure step, so the action, the pages, ingest and the cron jobs
 * all read the same values.
 *
 * This file holds only types, bounds and pure helpers, with no database access,
 * so client components (the settings forms) can import it without pulling the
 * Prisma client into the browser bundle. The readers live in `./org`.
 */

export type OrgSettings = {
	defaultFeedingRatePct: number;
	hopperLowPct: number;
	/**
	 * Deprecated (I-97): kept for compatibility with older clients and rows.
	 * Offline alert timing now follows the platform `device.status` policy, the
	 * same window the status badge uses.
	 */
	offlineAfterMin: number;
	missedFeedingAlerts: boolean;
	alertRoles: MemberRole[];
	deviceRegistration: DeviceRegistrationMode;
};

/** Schema defaults (`prisma/schema.prisma` → model OrgSetting). */
export const ORG_SETTINGS_DEFAULTS: OrgSettings = {
	defaultFeedingRatePct: 3,
	hopperLowPct: 20,
	offlineAfterMin: 30,
	missedFeedingAlerts: true,
	alertRoles: ["OWNER", "ADMIN"],
	deviceRegistration: "ADMIN_APPROVAL",
};

/** Bounds for the settings form and the action's zod schema. */
export const ORG_DEFAULT_FEEDING_RATE_MIN = 0.5;
export const ORG_DEFAULT_FEEDING_RATE_MAX = 10;
export const ORG_HOPPER_LOW_PCT_MIN = 5;
export const ORG_HOPPER_LOW_PCT_MAX = 50;
export const ORG_OFFLINE_AFTER_MIN_MIN = 5;
export const ORG_OFFLINE_AFTER_MIN_MAX = 1440;

export const DEVICE_REGISTRATION_MODES = ["ADMIN_APPROVAL", "SELF_REGISTER"] as const;

export function isDeviceRegistrationMode(value: unknown): value is DeviceRegistrationMode {
	return (
		typeof value === "string" && (DEVICE_REGISTRATION_MODES as readonly string[]).includes(value)
	);
}

/** Partial row shape accepted from Prisma or a test double. */
export type OrgSettingRow = Partial<OrgSettings> | null | undefined;

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function alertRolesOr(value: unknown): MemberRole[] {
	if (!Array.isArray(value)) return [...ORG_SETTINGS_DEFAULTS.alertRoles];
	const roles = value.filter((role): role is MemberRole => isMemberRole(role));
	// An empty array is not a usable policy: no one would ever be alerted, and
	// the form refuses it. Treat a malformed/empty row as the default rather
	// than silently muting every alert for the org.
	return roles.length > 0 ? [...new Set(roles)] : [...ORG_SETTINGS_DEFAULTS.alertRoles];
}

/**
 * Pure merge of a stored row (or a missing row) with the schema defaults.
 *
 * Unknown or malformed values fall back to the default for that field, so a
 * hand-edited row can never make a reader crash or alert a nonexistent role.
 */
export function mergeOrgSettings(row: OrgSettingRow): OrgSettings {
	return {
		defaultFeedingRatePct: numberOr(
			row?.defaultFeedingRatePct,
			ORG_SETTINGS_DEFAULTS.defaultFeedingRatePct,
		),
		hopperLowPct: numberOr(row?.hopperLowPct, ORG_SETTINGS_DEFAULTS.hopperLowPct),
		offlineAfterMin: numberOr(row?.offlineAfterMin, ORG_SETTINGS_DEFAULTS.offlineAfterMin),
		missedFeedingAlerts:
			typeof row?.missedFeedingAlerts === "boolean"
				? row.missedFeedingAlerts
				: ORG_SETTINGS_DEFAULTS.missedFeedingAlerts,
		alertRoles: alertRolesOr(row?.alertRoles),
		deviceRegistration: isDeviceRegistrationMode(row?.deviceRegistration)
			? row.deviceRegistration
			: ORG_SETTINGS_DEFAULTS.deviceRegistration,
	};
}

/** Every active member role, used as the fail-open fallback for alerts. */
export const ALL_MEMBER_ROLES: readonly MemberRole[] = MEMBER_ROLES;

/**
 * Platform defaults for organizations that have no `OrgSetting` row yet
 * (superadmin configuration centre I-14).
 *
 * A new tenant starts from these values. The row is optional, so the reader
 * fills it from `PlatformSetting` and only then from the schema defaults.
 */
export const ORG_DEFAULTS_KEY = "org.defaults";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
	let candidate: unknown = value;
	if (typeof candidate === "string" && candidate.trim() !== "") candidate = Number(candidate);
	if (typeof candidate !== "number" || !Number.isFinite(candidate)) return fallback;
	return Math.min(Math.max(Math.round(candidate), minimum), maximum);
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
	let candidate: unknown = value;
	if (typeof candidate === "string" && candidate.trim() !== "") candidate = Number(candidate);
	if (typeof candidate !== "number" || !Number.isFinite(candidate)) return fallback;
	return Math.min(Math.max(candidate, minimum), maximum);
}

/**
 * Coerce a stored defaults object into a complete, in-range settings value.
 * Malformed fields fall back to the schema default; out-of-range numbers are
 * clamped. The same pure function backs the action and the reader.
 */
export function normalizeOrgDefaults(value: unknown): OrgSettings {
	const source = isRecord(value) ? value : {};
	const alertRoles = alertRolesOr(source.alertRoles);
	return {
		defaultFeedingRatePct: boundedNumber(
			source.defaultFeedingRatePct,
			ORG_DEFAULT_FEEDING_RATE_MIN,
			ORG_DEFAULT_FEEDING_RATE_MAX,
			ORG_SETTINGS_DEFAULTS.defaultFeedingRatePct,
		),
		hopperLowPct: boundedInt(
			source.hopperLowPct,
			ORG_HOPPER_LOW_PCT_MIN,
			ORG_HOPPER_LOW_PCT_MAX,
			ORG_SETTINGS_DEFAULTS.hopperLowPct,
		),
		offlineAfterMin: boundedInt(
			source.offlineAfterMin,
			ORG_OFFLINE_AFTER_MIN_MIN,
			ORG_OFFLINE_AFTER_MIN_MAX,
			ORG_SETTINGS_DEFAULTS.offlineAfterMin,
		),
		missedFeedingAlerts:
			typeof source.missedFeedingAlerts === "boolean"
				? source.missedFeedingAlerts
				: ORG_SETTINGS_DEFAULTS.missedFeedingAlerts,
		alertRoles,
		deviceRegistration: isDeviceRegistrationMode(source.deviceRegistration)
			? source.deviceRegistration
			: ORG_SETTINGS_DEFAULTS.deviceRegistration,
	};
}
