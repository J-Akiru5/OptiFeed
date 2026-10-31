import type { Permission } from "@/lib/auth/permissions";
import type { z } from "zod";

/**
 * The assistant's action vocabulary (issue #194).
 *
 * A tool is defined once, on the server: its id, the parameters the model may
 * fill, the permission the caller must hold, and the existing server action it
 * runs. The model only *chooses* a tool and fills a payload; the payload is
 * validated with the tool's zod schema before it is stored, and validated
 * again when the user presses Accept.
 */
export const ASSISTANT_TOOL_IDS = [
	"feeding.set_grams",
	"feeding.set_meals",
	"feeding.set_rate",
	"feeding.pause",
	"feeding.resume",
	"feed.now",
	"records.log_biomass",
	"records.update_biomass",
	"records.delete_biomass",
	"records.add_calendar_item",
	"records.update_calendar_item",
	"records.delete_calendar_item",
	"records.start_cycle",
	"records.complete_task",
	"records.reopen_task",
	"ponds.archive",
	"ponds.restore",
	"ponds.delete",
	"ponds.move_device",
	"ponds.unassign_device",
	"admin.invite_member",
	"admin.change_role",
	"admin.set_permission",
	"admin.revoke_member",
	"admin.reveal_device_token",
	"superadmin.suspend_org",
	"superadmin.restore_org",
	"superadmin.start_view_as",
	"superadmin.stop_view_as",
	"superadmin.rotate_device_token",
	"superadmin.remote_feed",
	"superadmin.pause_device",
	"superadmin.disable_user",
	"superadmin.enable_user",
	"superadmin.grant_platform_admin",
	"superadmin.revoke_platform_admin",
	"superadmin.create_org",
] as const;

export type AssistantToolId = (typeof ASSISTANT_TOOL_IDS)[number];

/** Who is talking, in the language the help centre already uses. */
export type AssistantRole = "farmer" | "owner" | "superadmin";

export interface AssistantField {
	label: string;
	value: string;
}

export interface AssistantProposalContext {
	pondName: string | null;
	orgName: string | null;
	deviceLabel: string | null;
	currentGrams: number | null;
	currentFeedsPerDay: number | null;
	currentRatePct: number | null;
}

export interface AssistantExecuteResult {
	success: boolean;
	message: string;
}

export interface AssistantActionDefinition {
	id: AssistantToolId;
	/** Short human label, shown on the proposal card. */
	label: string;
	/** What the tool does, in the model's words. */
	description: string;
	/** The parameter shape, in the model's words. */
	params: string;
	/** The accepted payload, after coercion. */
	schema: z.ZodTypeAny;
	/** Permission the caller must hold when they Accept. */
	permission?: Permission;
	/** Platform admins only (superadmin kinds). */
	platformAdminOnly?: boolean;
	/** Tenant OWNER/ADMIN membership required (admin kinds). */
	tenantAdminOnly?: boolean;
	/** Dangerous kinds need a fresh HMAC step-up at Accept time. */
	requiresStepUp: boolean;
	describe(
		payload: Record<string, unknown>,
		context: AssistantProposalContext,
	): {
		summary: string;
		fields: AssistantField[];
	};
	execute(
		payload: Record<string, unknown>,
		context: { userId: string },
	): Promise<AssistantExecuteResult>;
}

export interface AssistantProposal {
	actionId: string;
	toolId: AssistantToolId;
	summary: string;
	fields: AssistantField[];
	expiresAt: string;
}
