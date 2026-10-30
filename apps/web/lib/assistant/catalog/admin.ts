import {
	changeMemberRole,
	inviteMember,
	revealDeviceToken,
	revokeMember,
	setUserPermission,
} from "@/lib/actions/admin";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { MemberRole } from "@prisma/client";
import { z } from "zod";
import { deviceTarget, fail, str } from "./shared";

const memberRoleSchema = z.enum(["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
const permissionSchema = z.enum(PERMISSIONS);
import type { AssistantActionDefinition, AssistantToolId } from "../types";

/**
 * Organization-admin tools: members, permissions and device tokens.
 *
 * Split out of `catalog.ts` (issue #344's write surface took that file past
 * the per-file complexity budget). Behaviour is unchanged: every entry still
 * wraps the existing server action and keeps the same guards.
 */

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

export const adminActions = {
	"admin.invite_member": {
		id: "admin.invite_member",
		label: "Invite a member",
		description:
			"Invite a new member to the organization. A new login is provisioned with a one-time temporary password.",
		params: 'email: string; displayName?: string; role: "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER"',
		schema: z.object({
			email: z.string().email(),
			displayName: z.string().trim().max(80).optional(),
			role: memberRoleSchema,
		}),
		permission: "manage_members",
		tenantAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Invite ${str(payload.email)} as ${str(payload.role)}. The invitee gets a one-time temporary password.`,
				fields: [
					{ label: "Email", value: str(payload.email) },
					{ label: "Role", value: str(payload.role) },
				],
			};
		},
		async execute(payload) {
			const email = str(payload.email);
			const result = await inviteMember({
				email,
				displayName:
					typeof payload.displayName === "string" && payload.displayName.trim()
						? payload.displayName
						: email.split("@")[0],
				role: payload.role as MemberRole,
			});
			if ("error" in result) return fail(result.error);
			return {
				success: true,
				message: result.temporaryPassword
					? `Invited ${email}. Share the one-time password shown in the result: ${result.temporaryPassword}`
					: `Invited ${email} to the organization.`,
			};
		},
	},

	"admin.change_role": {
		id: "admin.change_role",
		label: "Change a member role",
		description: "Change one active member's role in the organization.",
		params:
			'userId: string; role: "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER"; memberName?: string (display only)',
		schema: z.object({
			userId: z.string().min(1),
			role: memberRoleSchema,
			memberName: z.string().trim().max(80).optional(),
		}),
		permission: "manage_members",
		tenantAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `Change ${str(payload.memberName) || "the member"}'s role to ${str(payload.role)}.`,
				fields: [
					{ label: "Member", value: str(payload.memberName) || str(payload.userId) },
					{ label: "New role", value: str(payload.role) },
				],
			};
		},
		async execute(payload) {
			const result = await changeMemberRole(str(payload.userId), payload.role as MemberRole);
			return "error" in result ? fail(result.error) : { success: true, message: "Role updated." };
		},
	},

	"admin.set_permission": {
		id: "admin.set_permission",
		label: "Change a member permission",
		description: "Grant or revoke one permission for one member.",
		params:
			"userId: string; permission: string; granted: boolean; memberName?: string (display only)",
		schema: z.object({
			userId: z.string().min(1),
			permission: permissionSchema,
			granted: z.boolean(),
			memberName: z.string().trim().max(80).optional(),
		}),
		permission: "manage_members",
		tenantAdminOnly: true,
		requiresStepUp: true,
		describe(payload) {
			return {
				summary: `${payload.granted ? "Grant" : "Revoke"} ${str(payload.permission)} for ${str(payload.memberName) || "the member"}.`,
				fields: [
					{ label: "Member", value: str(payload.memberName) || str(payload.userId) },
					{ label: "Permission", value: str(payload.permission) },
					{ label: "Action", value: payload.granted ? "Grant" : "Revoke" },
				],
			};
		},
		async execute(payload) {
			const result = await setUserPermission(
				str(payload.userId),
				str(payload.permission),
				payload.granted === true,
			);
			if ("error" in result) return fail(result.error);
			return { success: true, message: "Member permission updated." };
		},
	},

	"admin.revoke_member": {
		id: "admin.revoke_member",
		label: "Remove a member",
		description:
			"Revoke one member's access to the organization. The account itself remains; the last owner cannot be removed.",
		params: "userId: string; memberName?: string (display only)",
		schema: z.object({
			userId: z.string().min(1),
			memberName: z.string().trim().max(80).optional(),
		}),
		permission: "manage_members",
		tenantAdminOnly: true,
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Remove ${str(payload.memberName) || "the member"} from the organization. Their account stays, but they lose access.`,
				fields: [{ label: "Member", value: str(payload.memberName) || str(payload.userId) }],
			};
		},
		async execute(payload) {
			const result = await revokeMember(str(payload.userId));
			return "error" in result
				? fail(result.error)
				: { success: true, message: "Member removed from the organization." };
		},
	},

	"admin.reveal_device_token": {
		id: "admin.reveal_device_token",
		label: "Show a device token",
		description:
			"Reveal the provisioning token for one approved feeder in the caller's organization. The reveal is rate-limited and audited.",
		params: "deviceId?: string; deviceLabel?: string (display only)",
		schema: z.object({
			deviceId: z.string().min(1).optional(),
			deviceLabel: z.string().trim().max(80).optional(),
		}),
		tenantAdminOnly: true,
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Show the provisioning token for ${str(payload.deviceLabel) || "the active feeder"}. The token is a credential; it is revealed once here and counted against the hourly limit.`,
				fields: [{ label: "Feeder", value: str(payload.deviceLabel) || "Active feeder" }],
			};
		},
		async execute(payload) {
			const device = await deviceTarget(payload);
			if (!device.ok) return device.result;
			const result = await revealDeviceToken(device.id);
			return result.success
				? {
						success: true,
						message: `Token for ${result.label} (MAC ${result.mac}): ${result.token}\nTreat this as a password. It is shown once and the reveal was audited.`,
					}
				: fail(result.error);
		},
	},
} satisfies AssistantActionTable;
