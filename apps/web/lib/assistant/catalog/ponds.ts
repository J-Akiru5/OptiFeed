import { setPondStatus } from "@/lib/actions/admin";
import { deleteTenantPond, moveDeviceToPond, unassignDevice } from "@/lib/actions/ponds";
import { z } from "zod";
import type { AssistantActionDefinition, AssistantToolId } from "../types";
import { deviceTarget, fail, pondLabel, pondTarget, str } from "./shared";

/**
 * Pond tools: archive/restore/delete and moving or unassigning a feeder.
 *
 * Split out of `catalog.ts` (issue #344's write surface took that file past
 * the per-file complexity budget). Behaviour is unchanged: every entry still
 * wraps the existing server action and keeps the same guards.
 */

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

export const pondsActions = {
	"ponds.archive": {
		id: "ponds.archive",
		label: "Archive a pond",
		description:
			"Archive the active pond (or one named by id). Archived ponds keep their history but drop out of farmer-facing screens.",
		params: "pondId?: string; pondName?: string (display only)",
		schema: z.object({
			pondId: z.string().min(1).optional(),
			pondName: z.string().trim().max(80).optional(),
		}),
		permission: "manage_farms_ponds",
		tenantAdminOnly: true,
		requiresStepUp: false,
		describe(payload, context) {
			const pond = pondLabel(payload, context);
			return {
				summary: `Archive ${pond}. It disappears from the farmer's pond selector; nothing is deleted.`,
				fields: [{ label: "Pond", value: pond }],
			};
		},
		async execute(payload) {
			const target = await pondTarget(payload);
			if (!target.ok) return target.result;
			const result = await setPondStatus(target.id, "ARCHIVED");
			return "error" in result
				? fail(result.error)
				: { success: true, message: `${target.name} archived.` };
		},
	},

	"ponds.restore": {
		id: "ponds.restore",
		label: "Restore a pond",
		description: "Restore an archived pond so it appears in the farmer's pond selector again.",
		params: "pondId?: string; pondName?: string (display only)",
		schema: z.object({
			pondId: z.string().min(1).optional(),
			pondName: z.string().trim().max(80).optional(),
		}),
		permission: "manage_farms_ponds",
		tenantAdminOnly: true,
		requiresStepUp: false,
		describe(payload, context) {
			const pond = pondLabel(payload, context);
			return {
				summary: `Restore ${pond} so the farmer can use it again.`,
				fields: [{ label: "Pond", value: pond }],
			};
		},
		async execute(payload) {
			const target = await pondTarget(payload);
			if (!target.ok) return target.result;
			const result = await setPondStatus(target.id, "ACTIVE");
			return "error" in result
				? fail(result.error)
				: { success: true, message: `${target.name} restored.` };
		},
	},

	"ponds.delete": {
		id: "ponds.delete",
		label: "Delete an empty pond",
		description:
			"Permanently delete an empty pond. A pond with any sample, feed event, cycle, device or other history cannot be deleted; archive it instead.",
		params: "pondId?: string; pondName?: string (display only); confirmName: string",
		schema: z.object({
			pondId: z.string().min(1).optional(),
			pondName: z.string().trim().max(80).optional(),
			confirmName: z.string().trim().min(1, "Type the pond name exactly to confirm."),
		}),
		permission: "manage_farms_ponds",
		tenantAdminOnly: true,
		requiresStepUp: true,
		describe(payload, context) {
			const pond = pondLabel(payload, context);
			return {
				summary: `Permanently delete the empty pond ${pond}. This cannot be undone.`,
				fields: [
					{ label: "Pond", value: pond },
					{ label: "Confirm", value: str(payload.confirmName) },
				],
			};
		},
		async execute(payload) {
			const target = await pondTarget(payload);
			if (!target.ok) return target.result;
			const result = await deleteTenantPond({
				pondId: target.id,
				confirmName: str(payload.confirmName),
			});
			return "error" in result
				? fail(result.error)
				: { success: true, message: `${target.name} deleted.` };
		},
	},

	"ponds.move_device": {
		id: "ponds.move_device",
		label: "Move a feeder to another pond",
		description:
			"Move a feeder from its current pond to another pond in the same organization. The target pond must be in scope.",
		params:
			"targetPondId: string; targetPondName?: string; deviceId?: string; deviceLabel?: string",
		schema: z.object({
			targetPondId: z.string().min(1),
			targetPondName: z.string().trim().max(80).optional(),
			deviceId: z.string().min(1).optional(),
			deviceLabel: z.string().trim().max(80).optional(),
		}),
		permission: "manage_farms_ponds",
		tenantAdminOnly: true,
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Move ${str(payload.deviceLabel) || "the active feeder"} to ${str(payload.targetPondName) || "the selected pond"}.`,
				fields: [
					{ label: "Feeder", value: str(payload.deviceLabel) || "Active feeder" },
					{ label: "Target", value: str(payload.targetPondName) || str(payload.targetPondId) },
				],
			};
		},
		async execute(payload) {
			const device = await deviceTarget(payload);
			if (!device.ok) return device.result;
			const result = await moveDeviceToPond({
				deviceId: device.id,
				targetPondId: str(payload.targetPondId),
			});
			return "error" in result
				? fail(result.error)
				: { success: true, message: `${device.label} moved.` };
		},
	},

	"ponds.unassign_device": {
		id: "ponds.unassign_device",
		label: "Unassign a feeder",
		description:
			"Detach a feeder from its pond. A pond-less feeder receives no schedule until it is assigned again.",
		params: "deviceId?: string; deviceLabel?: string (display only)",
		schema: z.object({
			deviceId: z.string().min(1).optional(),
			deviceLabel: z.string().trim().max(80).optional(),
		}),
		permission: "manage_farms_ponds",
		tenantAdminOnly: true,
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Detach ${str(payload.deviceLabel) || "the active feeder"} from its pond. It will stop receiving a schedule.`,
				fields: [{ label: "Feeder", value: str(payload.deviceLabel) || "Active feeder" }],
			};
		},
		async execute(payload) {
			const device = await deviceTarget(payload);
			if (!device.ok) return device.result;
			const result = await unassignDevice(device.id);
			return "error" in result
				? fail(result.error)
				: { success: true, message: `${device.label} unassigned.` };
		},
	},
} satisfies AssistantActionTable;
