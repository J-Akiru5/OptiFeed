import {
	remoteFeedDevice,
	remoteSetDevicePause,
	rotateDeviceToken,
} from "@/lib/actions/platform/devices";
import { startViewAs, stopViewAs } from "@/lib/actions/platform/impersonation";
import { setOrganizationStatus } from "@/lib/actions/platform/organizations";
import {
	createOrg,
	disablePlatformUser,
	enablePlatformUser,
	grantPlatformAdmin,
	revokePlatformAdmin,
} from "@/lib/actions/superadmin";
import { feedGramsSchema } from "@/lib/limits";
import { z } from "zod";
import { fail, num, str } from "./shared";

/** The same 10-character floor the platform actions enforce server-side. */
const reasonSchema = z
	.string()
	.trim()
	.min(10, "A reason of at least 10 characters is required.")
	.max(500);
import type { AssistantActionDefinition, AssistantToolId } from "../types";

/**
 * Platform-admin tools: organizations, impersonation, devices and users.
 *
 * Split out of `catalog.ts` (issue #344's write surface took that file past
 * the per-file complexity budget). Behaviour is unchanged: every entry still
 * wraps the existing server action and keeps the same guards.
 */

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

export const superadminActions = {
	"superadmin.suspend_org": {
		id: "superadmin.suspend_org",
		label: "Suspend an organization",
		description:
			"Suspend an organization: no member can read or write until it is restored. No data is deleted.",
		params: "orgId: string; reason: string (at least 10 characters)",
		schema: z.object({ orgId: z.string().min(1), reason: z.string().trim().min(10).max(500) }),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Suspend organization ${str(payload.orgId)}. Every member loses access until it is restored. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Organization", value: str(payload.orgId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await setOrganizationStatus({
				orgId: str(payload.orgId),
				status: "SUSPENDED",
				reason: str(payload.reason),
			});
			return "error" in result
				? fail(result.error)
				: { success: true, message: "Organization suspended." };
		},
	},

	"superadmin.restore_org": {
		id: "superadmin.restore_org",
		label: "Restore an organization",
		description: "Restore a suspended organization so its members can use the product again.",
		params: "orgId: string; reason: string (at least 10 characters)",
		schema: z.object({ orgId: z.string().min(1), reason: z.string().trim().min(10).max(500) }),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Restore organization ${str(payload.orgId)} so its members can sign in again. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Organization", value: str(payload.orgId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await setOrganizationStatus({
				orgId: str(payload.orgId),
				status: "ACTIVE",
				reason: str(payload.reason),
			});
			return "error" in result
				? fail(result.error)
				: { success: true, message: "Organization restored." };
		},
	},

	"superadmin.start_view_as": {
		id: "superadmin.start_view_as",
		label: "Open read-only view-as",
		description:
			"Open a read-only view-as session for one organization. Every write is blocked until the admin exits.",
		params: "orgId: string; reason: string (at least 10 characters)",
		schema: z.object({ orgId: z.string().min(1), reason: z.string().trim().min(10).max(500) }),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Open a read-only view-as session for organization ${str(payload.orgId)} for 30 minutes. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Organization", value: str(payload.orgId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await startViewAs({ orgId: str(payload.orgId), reason: str(payload.reason) });
			return "error" in result
				? fail(result.error)
				: {
						success: true,
						message: `Viewing ${result.orgName} read-only until ${new Date(result.expiresAt).toLocaleTimeString()}.`,
					};
		},
	},

	"superadmin.stop_view_as": {
		id: "superadmin.stop_view_as",
		label: "End read-only view-as",
		description: "End the caller's own view-as session and return to the platform console.",
		params: "{}",
		schema: z.object({}),
		platformAdminOnly: true,
		requiresStepUp: false,
		describe() {
			return {
				summary: "End the current read-only view-as session and return to the platform console.",
				fields: [],
			};
		},
		async execute() {
			const result = await stopViewAs();
			return "error" in result ? fail(result.error) : { success: true, message: "View-as ended." };
		},
	},

	"superadmin.rotate_device_token": {
		id: "superadmin.rotate_device_token",
		label: "Rotate a device token",
		description:
			"Issue a new token for a feeder on any organization. The old token stops authenticating immediately; the unit keeps failing until the new token is set on it.",
		params: "deviceId: string; deviceLabel?: string; reason: string (at least 10 characters)",
		schema: z.object({
			deviceId: z.string().min(1),
			deviceLabel: z.string().trim().max(80).optional(),
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Rotate the token for ${str(payload.deviceLabel) || "the selected feeder"}. The old credential stops working at once. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Feeder", value: str(payload.deviceLabel) || str(payload.deviceId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await rotateDeviceToken({
				deviceId: str(payload.deviceId),
				reason: str(payload.reason),
			});
			return "error" in result
				? fail(result.error)
				: {
						success: true,
						message: `New token: ${result.token}\nSet it on the unit through the setup portal. It is shown once and the rotation was audited.`,
					};
		},
	},

	"superadmin.remote_feed": {
		id: "superadmin.remote_feed",
		label: "Feed a device remotely",
		description:
			"Dispense one manual dose on any feeder on the platform. The offline check, one-in-flight rule, device g/s limit and daily cap all apply.",
		params:
			"deviceId: string; deviceLabel?: string; grams: number; reason: string (at least 10 characters)",
		schema: z.object({
			deviceId: z.string().min(1),
			deviceLabel: z.string().trim().max(80).optional(),
			grams: feedGramsSchema,
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Dispense ${num(payload.grams)} g now on ${str(payload.deviceLabel) || "the selected feeder"}. The device caps and offline rules still apply. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Feeder", value: str(payload.deviceLabel) || str(payload.deviceId) },
					{ label: "Dose", value: `${num(payload.grams)} g` },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await remoteFeedDevice({
				deviceId: str(payload.deviceId),
				grams: num(payload.grams),
				reason: str(payload.reason),
			});
			if ("error" in result) return fail(result.error);
			return {
				success: true,
				message: result.message ?? "Remote feed request queued.",
			};
		},
	},

	"superadmin.pause_device": {
		id: "superadmin.pause_device",
		label: "Pause or resume a device",
		description:
			"Pause or resume the automatic schedule on any feeder on the platform, using the same fallow-pond rules as the tenant toggle.",
		params:
			"deviceId: string; deviceLabel?: string; isPaused: boolean; reason: string (at least 10 characters)",
		schema: z.object({
			deviceId: z.string().min(1),
			deviceLabel: z.string().trim().max(80).optional(),
			isPaused: z.boolean(),
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			const verb = payload.isPaused === true ? "Pause" : "Resume";
			return {
				summary: `${verb} automatic feeding on ${str(payload.deviceLabel) || "the selected feeder"}. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Feeder", value: str(payload.deviceLabel) || str(payload.deviceId) },
					{ label: "Action", value: verb },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await remoteSetDevicePause({
				deviceId: str(payload.deviceId),
				isPaused: payload.isPaused === true,
				reason: str(payload.reason),
			});
			if ("error" in result) return fail(result.error);
			return {
				success: true,
				message: result.isPaused ? "Feeder schedule paused." : "Feeder schedule resumed.",
			};
		},
	},

	"superadmin.disable_user": {
		id: "superadmin.disable_user",
		label: "Disable a user account",
		description:
			"Safe-delete a platform user: ban the login and revoke every membership and platform grant. Nothing is purged, so it can be re-enabled.",
		params: "userId: string; confirmFarmId: string; reason: string (at least 10 characters)",
		schema: z.object({
			userId: z.string().min(1),
			confirmFarmId: z.string().trim().min(1, "Type the account's login ID to confirm."),
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Disable ${str(payload.confirmFarmId)}. The login is banned and every membership and platform grant is revoked; nothing is deleted. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Account", value: str(payload.confirmFarmId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await disablePlatformUser(
				str(payload.userId),
				str(payload.reason),
				str(payload.confirmFarmId),
			);
			return "error" in result ? fail(result.error) : { success: true, message: "User disabled." };
		},
	},

	"superadmin.enable_user": {
		id: "superadmin.enable_user",
		label: "Enable a user account",
		description: "Reverse a safe disable: unban the login and restore the memberships it revoked.",
		params: "userId: string; reason: string (at least 10 characters)",
		schema: z.object({
			userId: z.string().min(1),
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Enable user ${str(payload.userId)} again and restore the memberships and grant recorded at disable time. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "User", value: str(payload.userId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await enablePlatformUser(str(payload.userId), str(payload.reason));
			return "error" in result ? fail(result.error) : { success: true, message: "User enabled." };
		},
	},

	"superadmin.grant_platform_admin": {
		id: "superadmin.grant_platform_admin",
		label: "Grant platform admin",
		description:
			"Grant the platform-admin (god-mode) role to an existing user, optionally with an expiry date.",
		params:
			"userId: string; reason: string (at least 10 characters); expiresAt?: ISO 8601 date-time",
		schema: z.object({
			userId: z.string().min(1),
			reason: reasonSchema,
			expiresAt: z.string().datetime({ offset: true }).optional(),
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Grant platform admin to ${str(payload.userId)}${payload.expiresAt ? ` until ${str(payload.expiresAt)}` : ""}. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "User", value: str(payload.userId) },
					{ label: "Expires", value: str(payload.expiresAt) || "no expiry" },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await grantPlatformAdmin(
				str(payload.userId),
				str(payload.reason),
				typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
			);
			return "error" in result
				? fail(result.error)
				: { success: true, message: "Platform admin granted." };
		},
	},

	"superadmin.revoke_platform_admin": {
		id: "superadmin.revoke_platform_admin",
		label: "Revoke platform admin",
		description:
			"Revoke a user's platform-admin grant. The last active admin cannot be revoked, and you cannot revoke your own.",
		params: "userId: string; reason: string (at least 10 characters)",
		schema: z.object({
			userId: z.string().min(1),
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Revoke platform admin from ${str(payload.userId)}. Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "User", value: str(payload.userId) },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await revokePlatformAdmin(str(payload.userId), str(payload.reason));
			return "error" in result
				? fail(result.error)
				: { success: true, message: "Platform admin revoked." };
		},
	},

	"superadmin.create_org": {
		id: "superadmin.create_org",
		label: "Create an organization",
		description: "Create a new tenant organization on the platform.",
		params:
			'name: string; type?: "INDIVIDUAL" | "COOPERATIVE" | "COMPANY" | "LGU" | "ACADEMIC"; reason: string (at least 10 characters)',
		schema: z.object({
			name: z.string().trim().min(1).max(120),
			type: z.enum(["INDIVIDUAL", "COOPERATIVE", "COMPANY", "LGU", "ACADEMIC"]).optional(),
			reason: reasonSchema,
		}),
		platformAdminOnly: true,
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Create the organization "${str(payload.name)}" (${str(payload.type) || "INDIVIDUAL"}). Reason: ${str(payload.reason)}`,
				fields: [
					{ label: "Name", value: str(payload.name) },
					{ label: "Type", value: str(payload.type) || "INDIVIDUAL" },
					{ label: "Reason", value: str(payload.reason) },
				],
			};
		},
		async execute(payload) {
			const result = await createOrg({
				name: str(payload.name),
				type: payload.type as
					| "INDIVIDUAL"
					| "COOPERATIVE"
					| "COMPANY"
					| "LGU"
					| "ACADEMIC"
					| undefined,
				reason: str(payload.reason),
			});
			return "error" in result
				? fail(result.error)
				: { success: true, message: `Organization created (${result.orgId}).` };
		},
	},
} satisfies AssistantActionTable;
