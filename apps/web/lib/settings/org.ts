import { MEMBER_ROLES, isMemberRole } from "@/lib/auth/member-rules";
import prisma from "@/lib/prisma";
import type { DeviceRegistrationMode, MemberRole } from "@prisma/client";
import { cache } from "react";

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
 * This module is deliberately not a server-action module: it is imported by
 * server actions, route handlers and tests. Nothing here is browser-callable.
 */

export type OrgSettings = {
	defaultFeedingRatePct: number;
	hopperLowPct: number;
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

/**
 * The platform-wide defaults for a new organization. A missing table/row or a
 * transient read failure falls back to the schema defaults.
 */
export const getOrgDefaultSettings = cache(async (): Promise<OrgSettings> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: ORG_DEFAULTS_KEY },
			select: { value: true },
		});
		return normalizeOrgDefaults(row?.value);
	} catch {
		return { ...ORG_SETTINGS_DEFAULTS };
	}
});

export type OrgSettingsContext = {
	orgId: string | null;
	settings: OrgSettings;
};

const DEFAULT_CONTEXT: OrgSettingsContext = {
	orgId: null,
	settings: ORG_SETTINGS_DEFAULTS,
};

/** One org's settings, or the platform defaults (then schema defaults) when the row does not exist. */
export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
	const row = await prisma.orgSetting.findUnique({ where: { orgId } });
	if (row) return mergeOrgSettings(row);
	return getOrgDefaultSettings();
}

/** Rows for several orgs at once; orgs without a row fall back to the platform defaults. */
export async function getOrgSettingsByOrgId(
	orgIds: readonly string[],
): Promise<Map<string, OrgSettings>> {
	const unique = [...new Set(orgIds.filter((id) => typeof id === "string" && id.length > 0))];
	if (unique.length === 0) return new Map();

	const rows = await prisma.orgSetting.findMany({ where: { orgId: { in: unique } } });
	const byOrg = new Map(rows.map((row) => [row.orgId, mergeOrgSettings(row)]));
	const missing = unique.filter((orgId) => !byOrg.has(orgId));
	if (missing.length > 0) {
		const defaults = await getOrgDefaultSettings();
		for (const orgId of missing) byOrg.set(orgId, { ...defaults });
	}
	return byOrg;
}

/**
 * Resolve the org that owns a farm and that org's settings.
 *
 * The chain mirrors `resolveOrgScope`: `Pond.ownerId` (a farm slug) → `User` →
 * active `Membership` → `ACTIVE` `Organization`. The first active membership in
 * creation order wins, matching the tenant console's single-active-org
 * assumption. With no resolvable org the caller gets the schema defaults and a
 * null orgId so it can tell "no org" apart from "default settings".
 */
export async function getOrgSettingsForFarm(
	farmId: string | null | undefined,
): Promise<OrgSettingsContext> {
	if (!farmId) return DEFAULT_CONTEXT;
	const map = await getOrgSettingsForFarms([farmId]);
	return map.get(farmId) ?? DEFAULT_CONTEXT;
}

/** Batched form of `getOrgSettingsForFarm`, keyed by farm slug. */
export async function getOrgSettingsForFarms(
	farmIds: readonly (string | null | undefined)[],
): Promise<Map<string, OrgSettingsContext>> {
	const result = new Map<string, OrgSettingsContext>();
	const unique = [
		...new Set(
			farmIds.filter((farm): farm is string => typeof farm === "string" && farm.length > 0),
		),
	];
	if (unique.length === 0) return result;

	const users = await prisma.user.findMany({
		where: { farmId: { in: unique } },
		select: { id: true, farmId: true },
		orderBy: { createdAt: "asc" },
	});
	if (users.length === 0) return result;

	const memberships = await prisma.membership.findMany({
		where: { userId: { in: users.map((user) => user.id) }, revokedAt: null },
		select: { userId: true, orgId: true },
		orderBy: { createdAt: "asc" },
	});
	if (memberships.length === 0) return result;

	const orgIds = [...new Set(memberships.map((membership) => membership.orgId))];
	const activeOrgs = await prisma.organization.findMany({
		where: { id: { in: orgIds }, status: "ACTIVE" },
		select: { id: true },
	});
	const activeOrgIds = new Set(activeOrgs.map((org) => org.id));
	if (activeOrgIds.size === 0) return result;

	const settingsByOrg = await getOrgSettingsByOrgId([...activeOrgIds]);

	const farmByUser = new Map(users.map((user) => [user.id, user.farmId]));
	for (const membership of memberships) {
		if (!activeOrgIds.has(membership.orgId)) continue;
		const farmId = farmByUser.get(membership.userId);
		if (!farmId || result.has(farmId)) continue;
		result.set(farmId, {
			orgId: membership.orgId,
			settings: settingsByOrg.get(membership.orgId) ?? ORG_SETTINGS_DEFAULTS,
		});
	}

	return result;
}

/**
 * Active member roles of one org. Used by the alert gates to decide whether a
 * pond-scoped alert has any intended recipient. A missing org yields every
 * role, which keeps legacy behaviour for a pond that cannot be linked to an
 * organization.
 */
export async function getOrgAlertRoles(orgId: string | null): Promise<MemberRole[]> {
	if (!orgId) return [...ALL_MEMBER_ROLES];

	const memberships = await prisma.membership.findMany({
		where: { orgId, revokedAt: null },
		select: { role: true },
	});
	if (memberships.length === 0) return [...ALL_MEMBER_ROLES];
	return [...new Set(memberships.map((membership) => membership.role))];
}
