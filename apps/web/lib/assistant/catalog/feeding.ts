import { requestFeed } from "@/lib/actions/energy";
import { applyGrowthPlan } from "@/lib/actions/growth-plan";
import { toggleDevicePause } from "@/lib/actions/schedule";
import {
	MAX_ACCEPTED_FEED_GRAMS,
	feedGramsSchema,
	feedingRatePctSchema,
	feedsPerDaySchema,
} from "@/lib/limits";
import { z } from "zod";
import type { AssistantActionDefinition, AssistantToolId } from "../types";
import { activeDevice, activePondOrError, changeSchedule, fail, num } from "./shared";

/**
 * Feeding tools: schedule changes, pause/resume and a manual dose.
 *
 * Split out of `catalog.ts` (issue #344's write surface took that file past
 * the per-file complexity budget). Behaviour is unchanged: every entry still
 * wraps the existing server action and keeps the same guards.
 */

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

export const feedingActions = {
	"feeding.set_grams": {
		id: "feeding.set_grams",
		label: "Change feed amount",
		description:
			"Change how many grams the feeder dispenses per meal. The growth-plan adjustment window, the device g/s limit and the daily cap still apply.",
		params: "grams: number (grams per meal, 1 or more)",
		schema: z.object({ grams: z.coerce.number().positive().max(MAX_ACCEPTED_FEED_GRAMS) }),
		permission: "manage_schedule",
		requiresStepUp: false,
		describe(payload, context) {
			const grams = num(payload.grams);
			return {
				summary: `Change the feeder on ${context.pondName ?? "the active pond"} from ${context.currentGrams ?? "—"} g to ${grams} g per meal. The 15-day adjustment window and device limits still apply.`,
				fields: [
					{ label: "Pond", value: context.pondName ?? "Active pond" },
					{ label: "Current", value: `${context.currentGrams ?? "—"} g/meal` },
					{ label: "New", value: `${grams} g/meal` },
				],
			};
		},
		async execute(payload) {
			const pondResult = await activePondOrError();
			if (!pondResult.ok) return pondResult.result;
			const result = await applyGrowthPlan(pondResult.pond.id, { grams: num(payload.grams) });
			return result.success
				? {
						success: true,
						message: `Feeding amount updated to ${result.newGrams?.toFixed(1) ?? "—"} g per meal. The next adjustment is available after 15 days.`,
					}
				: fail(result.error ?? "Could not apply the feed amount.");
		},
	},

	"feeding.set_meals": {
		id: "feeding.set_meals",
		label: "Change meals per day",
		description:
			"Change how many meals the feeder dispenses each day. The whole schedule is revalidated (daily cap, device limit, fallow pond).",
		params: "mealsPerDay: integer (1–24)",
		schema: z.object({ mealsPerDay: feedsPerDaySchema }),
		permission: "manage_schedule",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Change ${context.pondName ?? "the active pond"} to ${num(payload.mealsPerDay)} feedings per day. The rest of the schedule stays as it is.`,
				fields: [
					{ label: "Pond", value: context.pondName ?? "Active pond" },
					{ label: "Current", value: `${context.currentFeedsPerDay ?? "—"} meals/day` },
					{ label: "New", value: `${num(payload.mealsPerDay)} meals/day` },
				],
			};
		},
		async execute(payload) {
			return changeSchedule({ feedsPerDay: num(payload.mealsPerDay) });
		},
	},

	"feeding.set_rate": {
		id: "feeding.set_rate",
		label: "Change feeding rate",
		description:
			"Change the feeding rate as a percentage of body weight per day. The whole schedule is revalidated (daily cap, device limit, fallow pond).",
		params: "feedingRatePct: number (percent of body weight per day)",
		schema: z.object({ feedingRatePct: feedingRatePctSchema }),
		permission: "manage_schedule",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Set the feeding rate for ${context.pondName ?? "the active pond"} to ${num(payload.feedingRatePct)}% of body weight per day.`,
				fields: [
					{ label: "Pond", value: context.pondName ?? "Active pond" },
					{ label: "Current", value: `${context.currentRatePct ?? "—"}%` },
					{ label: "New", value: `${num(payload.feedingRatePct)}%` },
				],
			};
		},
		async execute(payload) {
			return changeSchedule({ feedingRatePct: num(payload.feedingRatePct) });
		},
	},

	"feeding.pause": {
		id: "feeding.pause",
		label: "Pause the feeder",
		description: "Pause the automatic feeding schedule until it is resumed.",
		params: "{}",
		schema: z.object({}),
		permission: "control_feeder",
		requiresStepUp: false,
		describe(_payload, context) {
			return {
				summary: `Pause automatic feeding on ${context.pondName ?? "the active pond"}. No scheduled meals will run until you resume.`,
				fields: [{ label: "Pond", value: context.pondName ?? "Active pond" }],
			};
		},
		async execute() {
			const pondResult = await activePondOrError();
			if (!pondResult.ok) return pondResult.result;
			const device = await activeDevice(pondResult.pond.id);
			if (!device) return fail("No feeder is linked to this pond yet.");
			await toggleDevicePause(device.id, true);
			return { success: true, message: `Automatic feeding is paused on ${device.label}.` };
		},
	},

	"feeding.resume": {
		id: "feeding.resume",
		label: "Resume the feeder",
		description: "Resume the automatic feeding schedule after a pause.",
		params: "{}",
		schema: z.object({}),
		permission: "control_feeder",
		requiresStepUp: false,
		describe(_payload, context) {
			return {
				summary: `Resume automatic feeding on ${context.pondName ?? "the active pond"}. Scheduled meals will run again.`,
				fields: [{ label: "Pond", value: context.pondName ?? "Active pond" }],
			};
		},
		async execute() {
			const pondResult = await activePondOrError();
			if (!pondResult.ok) return pondResult.result;
			const device = await activeDevice(pondResult.pond.id);
			if (!device) return fail("No feeder is linked to this pond yet.");
			await toggleDevicePause(device.id, false);
			return { success: true, message: `Automatic feeding is resumed on ${device.label}.` };
		},
	},

	"feed.now": {
		id: "feed.now",
		label: "Feed now",
		description:
			"Dispense one manual dose now. The offline check, one-in-flight rule, device g/s limit and daily cap apply.",
		params: "grams?: number (optional; defaults to the device's per-meal amount)",
		schema: z.object({ grams: feedGramsSchema.optional() }),
		permission: "control_feeder",
		requiresStepUp: false,
		describe(payload, context) {
			const grams = typeof payload.grams === "number" ? `${payload.grams} g` : "the standard dose";
			return {
				summary: `Dispense ${grams} now on ${context.pondName ?? "the active pond"}. The device must be online, and the daily cap and one-feed-at-a-time rule still apply.`,
				fields: [
					{ label: "Pond", value: context.pondName ?? "Active pond" },
					{ label: "Feeder", value: context.deviceLabel ?? "Linked feeder" },
					{ label: "Dose", value: grams },
				],
			};
		},
		async execute(payload) {
			const pondResult = await activePondOrError();
			if (!pondResult.ok) return pondResult.result;
			const device = await activeDevice(pondResult.pond.id);
			if (!device) return fail("No feeder is linked to this pond yet.");
			const grams = typeof payload.grams === "number" ? payload.grams : undefined;
			const result = await requestFeed(device.id, grams);
			return result.success
				? {
						success: true,
						message:
							"Feed request queued. The device will dispense it as soon as it picks the request up.",
					}
				: fail(result.error ?? "Could not queue the feed request.");
		},
	},
} satisfies AssistantActionTable;
