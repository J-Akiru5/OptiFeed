import { updateDeviceDailyCap } from "@/lib/actions/settings";
import type { Permission } from "@/lib/auth/permissions";
import { dailyCapSchema } from "@/lib/limits";
import { z } from "zod";
import { deviceTarget } from "../catalog/shared";
import type { AssistantExecuteResult, AssistantField, AssistantProposalContext } from "../types";

/**
 * The closed setting registry for `settings.propose`.
 *
 * A setting is defined once here: its value schema, the permission that owns
 * it, its scope, whether it needs an owner, whether it is safe while the device
 * is offline, and the existing server action that saves it. The assistant never
 * writes a setting directly; it stores a proposal and Accept runs the action.
 *
 * Phase 1 registers `daily_feed_cap` only. Adding a setting means adding one
 * entry here — never a free-form key from the model.
 */

export const ASSISTANT_SETTING_KEYS = ["daily_feed_cap"] as const;
export type AssistantSettingKey = (typeof ASSISTANT_SETTING_KEYS)[number];

export type AssistantSettingScope = "personal" | "pond" | "org";

export interface AssistantSettingDefinition {
	key: AssistantSettingKey;
	label: string;
	scope: AssistantSettingScope;
	/** Value schema, also used by the tool's payload schema. */
	schema: z.ZodTypeAny;
	permission: Permission;
	ownerOnly: boolean;
	requiresStepUp: boolean;
	/**
	 * True for a command that needs a live device or an active cycle. Those are
	 * never proposed while the precondition fails; a saved setting is.
	 */
	requiresLiveDevice: boolean;
	describe(
		value: unknown,
		context: AssistantProposalContext,
	): { summary: string; fields: AssistantField[] };
	execute(value: unknown): Promise<AssistantExecuteResult>;
}

const dailyFeedCap: AssistantSettingDefinition = {
	key: "daily_feed_cap",
	label: "Daily feed ceiling",
	scope: "pond",
	// Coerce "4500" from the model, then apply the same bounds as the action.
	schema: z.coerce.number().pipe(dailyCapSchema),
	permission: "control_feeder",
	ownerOnly: false,
	requiresStepUp: false,
	// It saves now and applies when the device reconnects, so it is proposed
	// even while the feeder is offline, with a one-line heads-up.
	requiresLiveDevice: false,
	describe(value, context) {
		const next = dailyCapSchema.parse(value);
		const current = context.currentDailyCapG;
		const from = current === null ? "not set" : `${current} g/day`;
		const headsUp =
			context.deviceOnline === false
				? " The feeder is offline right now; the new ceiling saves immediately and applies when it reconnects."
				: "";
		return {
			summary: `Change the daily feed ceiling from ${from} to ${next} g/day.${headsUp}`,
			fields: [
				{ label: "Setting", value: "Daily feed ceiling" },
				{ label: "From", value: from },
				{ label: "To", value: `${next} g/day` },
			],
		};
	},
	async execute(value) {
		const next = dailyCapSchema.parse(value);
		const device = await deviceTarget({});
		if (!device.ok) return device.result;

		const result = await updateDeviceDailyCap(device.id, next);
		if (!result.success) {
			return {
				success: false,
				message: result.error ?? "Could not save the daily feed ceiling.",
			};
		}
		// Confirm from the action's own result rather than assuming the value.
		return {
			success: true,
			message: `Daily feed ceiling is now ${result.dailyCapG ?? next} g/day.`,
		};
	},
};

export const SETTING_DEFINITIONS: Record<AssistantSettingKey, AssistantSettingDefinition> = {
	daily_feed_cap: dailyFeedCap,
};

export function getSettingDefinition(key: string): AssistantSettingDefinition | null {
	if (!Object.hasOwn(SETTING_DEFINITIONS, key)) return null;
	return SETTING_DEFINITIONS[key as AssistantSettingKey] ?? null;
}

/** The payload schema for `settings.propose`, built from the registry. */
export const assistantSettingSchema = z.union(
	ASSISTANT_SETTING_KEYS.map((key) =>
		z.object({
			setting: z.literal(key),
			value: SETTING_DEFINITIONS[key].schema,
		}),
	),
);
