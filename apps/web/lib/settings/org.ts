import prisma from "@/lib/prisma";
import type { MemberRole } from "@prisma/client";
import { cache } from "react";
import {
	ALL_MEMBER_ROLES,
	ORG_DEFAULTS_KEY,
	ORG_SETTINGS_DEFAULTS,
	type OrgSettings,
	mergeOrgSettings,
	normalizeOrgDefaults,
} from "./org-shared";

// Pure types, bounds and helpers live in ./org-shared so client components can
// import them without the database client; server code keeps importing ./org.
export * from "./org-shared";

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
