/**
 * Command-center action catalog (plan M3C.7).
 *
 * One list of every platform action that can destroy, disable, or reach beyond
 * the platform's own settings, with the guard each one carries. The security
 * panel renders this list and the test suite asserts it against the source, so
 * a new destructive action cannot ship without appearing here.
 *
 * Two requirements exist:
 * - `step-up`: the caller re-enters their password (five minute signed cookie)
 *   before the write. Used for anything that reaches a tenant's devices, data or
 *   people.
 * - `reason-and-audit`: a platform-wide setting change. It carries a mandatory
 *   written reason and an audit entry with before/after, is reversible, and does
 *   not require re-authentication. Every entry here states why.
 *
 * Pure data and pure functions only: no Prisma, no auth, no React.
 */

export type SensitiveActionSurface =
	| "devices"
	| "organizations"
	| "members"
	| "users"
	| "impersonation"
	| "data"
	| "settings"
	| "announcements";

export type StepUpRequirement = "step-up" | "reason-and-audit";

export interface SensitiveAction {
	/** Stable id, also the message key under `superadmin.security.actions`. */
	id: string;
	surface: SensitiveActionSurface;
	/** Exported server action or route handler name, used by the source test. */
	action: string;
	/** Path from `apps/web`, used by the source test. */
	module: string;
	/** Audit action codes this action writes. May be empty for read-side routes. */
	auditActions: string[];
	requirement: StepUpRequirement;
	/** Required when `requirement` is `reason-and-audit`. Message key `notes.<id>`. */
	note?: string;
}

export const SENSITIVE_ACTIONS: readonly SensitiveAction[] = [
	{
		id: "remoteFeed",
		surface: "devices",
		action: "remoteFeedDevice",
		module: "lib/actions/platform/devices.ts",
		auditActions: ["platform.device.feed", "platform.device.feed_refused"],
		requirement: "step-up",
	},
	{
		id: "remotePause",
		surface: "devices",
		action: "remoteSetDevicePause",
		module: "lib/actions/platform/devices.ts",
		auditActions: ["platform.device.pause", "platform.device.pause_refused"],
		requirement: "step-up",
	},
	{
		id: "rotateDeviceToken",
		surface: "devices",
		action: "rotateDeviceToken",
		module: "lib/actions/platform/devices.ts",
		auditActions: ["platform.device.rotate_token"],
		requirement: "step-up",
	},
	{
		id: "registerDevice",
		surface: "devices",
		action: "registerDevice",
		module: "lib/actions/platform/devices.ts",
		auditActions: ["platform.device.create"],
		requirement: "step-up",
	},
	{
		id: "setOrganizationStatus",
		surface: "organizations",
		action: "setOrganizationStatus",
		module: "lib/actions/platform/organizations.ts",
		auditActions: ["platform.organization.suspend", "platform.organization.restore"],
		requirement: "step-up",
	},
	{
		id: "inviteOrgMember",
		surface: "members",
		action: "inviteOrgMember",
		module: "lib/actions/platform/members.ts",
		auditActions: ["platform.membership.invite"],
		requirement: "step-up",
	},
	{
		id: "changeOrgMemberRole",
		surface: "members",
		action: "changeOrgMemberRole",
		module: "lib/actions/platform/members.ts",
		auditActions: ["platform.membership.role"],
		requirement: "step-up",
	},
	{
		id: "setOrgMemberPermission",
		surface: "members",
		action: "setOrgMemberPermission",
		module: "lib/actions/platform/members.ts",
		auditActions: ["platform.membership.permission"],
		requirement: "step-up",
	},
	{
		id: "revokeOrgMembership",
		surface: "members",
		action: "revokeOrgMembership",
		module: "lib/actions/platform/members.ts",
		auditActions: ["platform.membership.revoke"],
		requirement: "step-up",
	},
	{
		id: "updatePlatformUser",
		surface: "users",
		action: "updatePlatformUser",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.user.update"],
		requirement: "step-up",
	},
	{
		id: "disablePlatformUser",
		surface: "users",
		action: "disablePlatformUser",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.user.disable"],
		requirement: "step-up",
	},
	{
		id: "enablePlatformUser",
		surface: "users",
		action: "enablePlatformUser",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.user.enable"],
		requirement: "step-up",
	},
	{
		id: "resetPlatformUserPassword",
		surface: "users",
		action: "resetPlatformUserPassword",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.user.reset_password"],
		requirement: "step-up",
	},
	{
		id: "grantPlatformAdmin",
		surface: "users",
		action: "grantPlatformAdmin",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.admin.grant"],
		requirement: "step-up",
	},
	{
		id: "revokePlatformAdmin",
		surface: "users",
		action: "revokePlatformAdmin",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.admin.revoke"],
		requirement: "step-up",
	},
	{
		id: "startViewAs",
		surface: "impersonation",
		action: "startViewAs",
		module: "lib/actions/platform/impersonation.ts",
		auditActions: ["platform.impersonation.start", "platform.impersonation.stop"],
		requirement: "step-up",
	},
	{
		id: "backupExport",
		surface: "data",
		action: "POST",
		module: "app/api/superadmin/backup/export/route.ts",
		auditActions: [],
		requirement: "step-up",
	},
	{
		id: "setFeedingSafetyCaps",
		surface: "settings",
		action: "setFeedingSafetyCaps",
		module: "lib/actions/platform/config.ts",
		auditActions: ["platform.settings.feeding_caps"],
		requirement: "reason-and-audit",
		note: "feedingCaps",
	},
	{
		id: "setFeatureFlag",
		surface: "settings",
		action: "setFeatureFlag",
		module: "lib/actions/platform/config.ts",
		auditActions: ["platform.settings.feature_flag"],
		requirement: "reason-and-audit",
		note: "featureFlag",
	},
	{
		id: "setFirmwareGates",
		surface: "settings",
		action: "setFirmwareGates",
		module: "lib/actions/platform/settings.ts",
		auditActions: ["platform.settings.firmware_gates"],
		requirement: "reason-and-audit",
		note: "firmwareGates",
	},
	{
		id: "setOrgDefaults",
		surface: "settings",
		action: "setOrgDefaults",
		module: "lib/actions/platform/config.ts",
		auditActions: ["platform.settings.org_defaults"],
		requirement: "reason-and-audit",
		note: "orgDefaults",
	},
	{
		id: "setDeviceStatusThresholds",
		surface: "settings",
		action: "setDeviceStatusThresholds",
		module: "lib/actions/platform/settings.ts",
		auditActions: ["platform.settings.device_status"],
		requirement: "reason-and-audit",
		note: "deviceStatus",
	},
	{
		id: "publishAnnouncement",
		surface: "announcements",
		action: "publishAnnouncement",
		module: "lib/actions/platform/announcements.ts",
		auditActions: ["platform.announcement.publish"],
		requirement: "reason-and-audit",
		note: "announcement",
	},
	{
		id: "clearAnnouncement",
		surface: "announcements",
		action: "clearAnnouncement",
		module: "lib/actions/platform/announcements.ts",
		auditActions: ["platform.announcement.clear"],
		requirement: "reason-and-audit",
		note: "announcement",
	},
	{
		id: "createOrg",
		surface: "organizations",
		action: "createOrg",
		module: "lib/actions/superadmin.ts",
		auditActions: ["platform.org.create"],
		requirement: "reason-and-audit",
		note: "createOrg",
	},
] as const;

export const SENSITIVE_ACTION_SURFACES: readonly SensitiveActionSurface[] = [
	"devices",
	"organizations",
	"members",
	"users",
	"impersonation",
	"data",
	"settings",
	"announcements",
] as const;

export interface SensitiveActionSummary {
	total: number;
	stepUp: number;
	reasonAndAudit: number;
	surfaces: number;
	auditActions: number;
}

export function summarizeSensitiveActions(
	actions: readonly SensitiveAction[] = SENSITIVE_ACTIONS,
): SensitiveActionSummary {
	const audit = new Set<string>();
	const surfaces = new Set<SensitiveActionSurface>();
	for (const action of actions) {
		surfaces.add(action.surface);
		for (const code of action.auditActions) audit.add(code);
	}
	return {
		total: actions.length,
		stepUp: actions.filter((action) => action.requirement === "step-up").length,
		reasonAndAudit: actions.filter((action) => action.requirement === "reason-and-audit").length,
		surfaces: surfaces.size,
		auditActions: audit.size,
	};
}

/** Actions that do not re-authenticate; each carries its own justification. */
export function reasonOnlyActions(
	actions: readonly SensitiveAction[] = SENSITIVE_ACTIONS,
): SensitiveAction[] {
	return actions.filter((action) => action.requirement === "reason-and-audit");
}

/** Unique audit codes the catalog can write, for the oversight read. */
export function sensitiveAuditActions(
	actions: readonly SensitiveAction[] = SENSITIVE_ACTIONS,
): string[] {
	const codes = new Set<string>();
	for (const action of actions) for (const code of action.auditActions) codes.add(code);
	return [...codes].sort();
}

/** Groups the catalog by surface in the fixed display order, skipping empties. */
export function groupBySurface(
	actions: readonly SensitiveAction[] = SENSITIVE_ACTIONS,
): { surface: SensitiveActionSurface; actions: SensitiveAction[] }[] {
	return SENSITIVE_ACTION_SURFACES.flatMap((surface) => {
		const grouped = actions.filter((action) => action.surface === surface);
		return grouped.length > 0 ? [{ surface, actions: grouped }] : [];
	});
}

/** Finds the catalog entry that writes an audit code, if any. */
export function actionForAuditCode(
	code: string,
	actions: readonly SensitiveAction[] = SENSITIVE_ACTIONS,
): SensitiveAction | undefined {
	return actions.find((action) => action.auditActions.includes(code));
}
