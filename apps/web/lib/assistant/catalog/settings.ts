import { assistantSettingSchema, getSettingDefinition } from "../settings/registry";
import type { AssistantActionDefinition, AssistantToolId } from "../types";

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

/**
 * The settings tool (RBAC settings plan, Phase 1).
 *
 * The model may only name a key from `SETTING_DEFINITIONS`; the value schema,
 * permission, owner rule and execution all come from that registry. The static
 * `control_feeder` permission matches the only registered setting today. When a
 * setting with another permission is added, give the tool `availableTo` and
 * rely on `resolvePermission` instead of the static field.
 */
export const settingsActions = {
	"settings.propose": {
		id: "settings.propose",
		label: "Change a saved setting",
		description:
			"Change a saved farm setting. The change applies only after the user presses Accept.",
		params: 'setting: "daily_feed_cap"; value: number (grams per day)',
		schema: assistantSettingSchema,
		permission: "control_feeder",
		requiresStepUp: false,
		resolvePermission(payload) {
			return getSettingDefinition(String(payload.setting))?.permission ?? null;
		},
		resolveOwnerOnly(payload) {
			return getSettingDefinition(String(payload.setting))?.ownerOnly ?? false;
		},
		describe(payload, context) {
			const definition = getSettingDefinition(String(payload.setting));
			if (!definition) return { summary: "Change a farm setting.", fields: [] };
			return definition.describe(payload.value, context);
		},
		async execute(payload, _context) {
			const definition = getSettingDefinition(String(payload.setting));
			if (!definition) {
				return { success: false, message: "That setting is not supported." };
			}
			return definition.execute(payload.value);
		},
	},
} satisfies AssistantActionTable;
