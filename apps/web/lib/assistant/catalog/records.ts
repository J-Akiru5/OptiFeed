import { deleteBiomassLog, saveBiomassLog, updateBiomassLog } from "@/lib/actions/biomass";
import { createCropCycle } from "@/lib/actions/crop-cycle";
import {
	completePondEvent,
	createPondEvent,
	deletePondEvent,
	uncompletePondEvent,
	updatePondEvent,
} from "@/lib/actions/pond-event";
import { daysBetween, isValidDateOnly } from "@/lib/crop-cycle/dates";
import { z } from "zod";
import type { AssistantActionDefinition, AssistantExecuteResult, AssistantToolId } from "../types";
import { activePondOrError, fail, num, str } from "./shared";

/**
 * Record tools: biomass samples, calendar items and grow-out cycles.
 *
 * Split out of `catalog.ts` (issue #344's write surface took that file past
 * the per-file complexity budget). Behaviour is unchanged: every entry still
 * wraps the existing server action and keeps the same guards.
 */

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

async function executeLogBiomass(
	payload: Record<string, unknown>,
): Promise<AssistantExecuteResult> {
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult.result;

	const avgWeightG = num(payload.avgWeightG);
	const sampleCount = Math.round(num(payload.sampleCount));
	const formData = new FormData();
	formData.set("pondId", pondResult.pond.id);
	formData.set("sampleCount", String(sampleCount));
	formData.set("sampleWeightKg", String((avgWeightG / 1000) * sampleCount));
	formData.set("sampleLengthCm", "0");
	if (typeof payload.recordedAt === "string" && payload.recordedAt) {
		formData.set("recordedAt", payload.recordedAt);
	}

	const result = await saveBiomassLog(formData);
	if (!result.success) return fail(result.error);
	const effective = result.feed.effectiveGrams;
	return {
		success: true,
		message:
			effective !== null
				? `Sample saved: ${avgWeightG} g average across ${sampleCount} fish. The feeder is set to ${effective} g per meal.`
				: `Sample saved: ${avgWeightG} g average across ${sampleCount} fish.`,
	};
}

export const recordsActions = {
	"records.log_biomass": {
		id: "records.log_biomass",
		label: "Log a biomass sample",
		description:
			"Log a biomass sample: the average weight of the sampled fish and how many were weighed. The sample drives the feeding recommendation.",
		params:
			"avgWeightG: number (average weight of one sampled fish, grams); sampleCount: integer (fish weighed); recordedAt?: YYYY-MM-DD",
		schema: z.object({
			avgWeightG: z.coerce.number().positive().max(100_000),
			sampleCount: z.coerce.number().int().min(1).max(10_000),
			recordedAt: z.string().refine(isValidDateOnly, "Use YYYY-MM-DD").optional(),
		}),
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Log a biomass sample for ${context.pondName ?? "the active pond"}: average ${num(payload.avgWeightG)} g across ${Math.round(num(payload.sampleCount))} fish.`,
				fields: [
					{ label: "Pond", value: context.pondName ?? "Active pond" },
					{ label: "Average weight", value: `${num(payload.avgWeightG)} g/fish` },
					{ label: "Sample size", value: `${Math.round(num(payload.sampleCount))} fish` },
					{
						label: "Date",
						value: typeof payload.recordedAt === "string" ? payload.recordedAt : "today",
					},
				],
			};
		},
		execute: executeLogBiomass,
	},

	"records.update_biomass": {
		id: "records.update_biomass",
		label: "Change a biomass sample",
		description:
			"Correct the average weight, fish count, length or date of one logged biomass sample. The feeding plan recalculates from the edited aggregate.",
		params:
			"logId: string; avgWeightG: number; sampleCount: integer; sampleLengthCm?: number; batchLabel?: string; recordedAt?: YYYY-MM-DD",
		schema: z.object({
			logId: z.string().min(1),
			avgWeightG: z.coerce.number().positive().max(100_000),
			sampleCount: z.coerce.number().int().min(1).max(10_000),
			sampleLengthCm: z.coerce.number().min(0).max(200).optional(),
			batchLabel: z.string().trim().max(80).optional(),
			recordedAt: z.string().refine(isValidDateOnly, "Use YYYY-MM-DD").optional(),
		}),
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Correct the biomass sample to ${num(payload.avgWeightG)} g average across ${Math.round(num(payload.sampleCount))} fish.`,
				fields: [
					{ label: "Sample", value: str(payload.logId) },
					{ label: "Average weight", value: `${num(payload.avgWeightG)} g/fish` },
					{ label: "Sample size", value: `${Math.round(num(payload.sampleCount))} fish` },
				],
			};
		},
		async execute(payload) {
			const sampleCount = Math.round(num(payload.sampleCount));
			const result = await updateBiomassLog({
				id: str(payload.logId),
				sampleCount,
				sampleWeightKg: (num(payload.avgWeightG) / 1000) * sampleCount,
				sampleLengthCm: typeof payload.sampleLengthCm === "number" ? payload.sampleLengthCm : 0,
				batchLabel: typeof payload.batchLabel === "string" ? payload.batchLabel : null,
				...(typeof payload.recordedAt === "string" ? { recordedAt: payload.recordedAt } : {}),
			});
			return result.success
				? { success: true, message: "Biomass sample updated." }
				: fail(result.error);
		},
	},

	"records.delete_biomass": {
		id: "records.delete_biomass",
		label: "Delete a biomass sample",
		description:
			"Delete one logged biomass sample by id. Use the id from the recent samples list; the sample's effect on the feeding plan is removed.",
		params: "logId: string; sampleDate?: YYYY-MM-DD (display only)",
		schema: z.object({
			logId: z.string().min(1),
			sampleDate: z.string().refine(isValidDateOnly, "Use YYYY-MM-DD").optional(),
		}),
		requiresStepUp: false,
		describe(payload) {
			return {
				summary: `Delete the biomass sample${payload.sampleDate ? ` from ${str(payload.sampleDate)}` : ""}. This removes it from the feeding plan history.`,
				fields: [
					{ label: "Sample", value: str(payload.logId) },
					{ label: "Date", value: str(payload.sampleDate) || "as logged" },
				],
			};
		},
		async execute(payload) {
			const result = await deleteBiomassLog(str(payload.logId));
			return result.success
				? { success: true, message: "Biomass sample deleted." }
				: fail(result.error);
		},
	},

	"records.add_calendar_item": {
		id: "records.add_calendar_item",
		label: "Add a calendar item",
		description:
			"Add an event (a time range) or a task (a checkbox with a due date) to the pond calendar.",
		params:
			'kind: "EVENT" | "TASK"; title: string; startsAt: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (farm time); allDay?: boolean; notes?: string',
		schema: z.object({
			kind: z.enum(["EVENT", "TASK"]).default("EVENT"),
			title: z.string().trim().min(1).max(80),
			startsAt: z.string().min(1),
			allDay: z.boolean().optional(),
			notes: z.string().trim().max(1000).optional(),
		}),
		permission: "manage_crop_cycle",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Add a ${str(payload.kind).toLowerCase()} "${str(payload.title)}" on ${str(payload.startsAt)} to the ${context.pondName ?? "pond"} calendar.`,
				fields: [
					{ label: "Type", value: str(payload.kind) },
					{ label: "Title", value: str(payload.title) },
					{ label: "When", value: str(payload.startsAt) },
				],
			};
		},
		async execute(payload) {
			const pondResult = await activePondOrError();
			if (!pondResult.ok) return pondResult.result;
			const allDay =
				typeof payload.allDay === "boolean" ? payload.allDay : !str(payload.startsAt).includes("T");
			const result = await createPondEvent({
				pondId: pondResult.pond.id,
				kind: payload.kind as "EVENT" | "TASK",
				type: "MAINTENANCE",
				title: str(payload.title),
				allDay,
				startsAt: str(payload.startsAt),
				notes: typeof payload.notes === "string" ? payload.notes : null,
			});
			return result.success
				? { success: true, message: "Calendar item added." }
				: fail(result.error);
		},
	},

	"records.update_calendar_item": {
		id: "records.update_calendar_item",
		label: "Change a calendar item",
		description:
			"Change a manual calendar event or task: its title, date/time, notes or kind. Use the id from the upcoming calendar list.",
		params:
			'eventId: string; title?: string; startsAt?: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"; allDay?: boolean; notes?: string; kind?: "EVENT" | "TASK"',
		schema: z
			.object({
				eventId: z.string().min(1),
				title: z.string().trim().min(1).max(80).optional(),
				startsAt: z.string().min(1).optional(),
				allDay: z.boolean().optional(),
				notes: z.string().trim().max(1000).nullable().optional(),
				kind: z.enum(["EVENT", "TASK"]).optional(),
			})
			.refine(
				(value) =>
					value.title !== undefined ||
					value.startsAt !== undefined ||
					value.notes !== undefined ||
					value.kind !== undefined,
				"Name at least one thing to change.",
			),
		permission: "manage_crop_cycle",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Change the calendar item on ${context.pondName ?? "the active pond"}${payload.title ? ` to "${str(payload.title)}"` : ""}${payload.startsAt ? ` at ${str(payload.startsAt)}` : ""}.`,
				fields: [
					{ label: "Item", value: str(payload.eventId) },
					{ label: "Title", value: str(payload.title) || "unchanged" },
					{ label: "When", value: str(payload.startsAt) || "unchanged" },
				],
			};
		},
		async execute(payload) {
			const startsAt = typeof payload.startsAt === "string" ? payload.startsAt : undefined;
			const result = await updatePondEvent({
				id: str(payload.eventId),
				...(typeof payload.title === "string" ? { title: payload.title } : {}),
				...(startsAt
					? {
							startsAt,
							allDay:
								typeof payload.allDay === "boolean" ? payload.allDay : !startsAt.includes("T"),
						}
					: {}),
				...(payload.notes !== undefined
					? { notes: typeof payload.notes === "string" ? payload.notes : null }
					: {}),
				...(typeof payload.kind === "string" ? { kind: payload.kind as "EVENT" | "TASK" } : {}),
			});
			return result.success
				? { success: true, message: "Calendar item updated." }
				: fail(result.error);
		},
	},

	"records.delete_calendar_item": {
		id: "records.delete_calendar_item",
		label: "Delete a calendar item",
		description:
			"Delete a manual calendar event or task, or one occurrence of a recurring series. Cycle-generated events cannot be deleted here.",
		params: "eventId: string; occurrence?: ISO date-time (only for a recurring series)",
		schema: z.object({
			eventId: z.string().min(1),
			occurrence: z.string().datetime({ offset: true }).optional(),
		}),
		permission: "manage_crop_cycle",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Delete the calendar item on ${context.pondName ?? "the active pond"}${payload.occurrence ? ` for ${str(payload.occurrence)}` : ""}.`,
				fields: [
					{ label: "Item", value: str(payload.eventId) },
					{
						label: "Occurrence",
						value: typeof payload.occurrence === "string" ? payload.occurrence : "the whole item",
					},
				],
			};
		},
		async execute(payload) {
			const result = await deletePondEvent({
				id: str(payload.eventId),
				occurrence: typeof payload.occurrence === "string" ? payload.occurrence : null,
			});
			return result.success
				? { success: true, message: "Calendar item deleted." }
				: fail(result.error);
		},
	},

	"records.start_cycle": {
		id: "records.start_cycle",
		label: "Start a grow-out cycle",
		description:
			"Start a grow-out (batch) cycle with its stocking date, count and target harvest. This also creates the stocking and harvest calendar events.",
		params:
			"label?: string; stockingDate: YYYY-MM-DD; stockingCount: integer; stockingAvgWeightG?: number; targetHarvestDate: YYYY-MM-DD; targetHarvestWeightG?: number; expectedSurvivalPct?: number",
		schema: z.object({
			label: z.string().trim().max(64).optional(),
			stockingDate: z.string().refine(isValidDateOnly, "Use YYYY-MM-DD"),
			stockingCount: z.coerce.number().int().min(1).max(1_000_000),
			stockingAvgWeightG: z.coerce.number().positive().max(10_000).optional(),
			targetHarvestDate: z.string().refine(isValidDateOnly, "Use YYYY-MM-DD"),
			targetHarvestWeightG: z.coerce.number().positive().max(10_000).optional(),
			expectedSurvivalPct: z.coerce.number().min(1).max(100).optional(),
		}),
		permission: "manage_crop_cycle",
		requiresStepUp: false,
		describe(payload, context) {
			const stockingDate = str(payload.stockingDate);
			const harvestDate = str(payload.targetHarvestDate);
			const days =
				isValidDateOnly(stockingDate) && isValidDateOnly(harvestDate)
					? daysBetween(stockingDate, harvestDate)
					: null;
			return {
				summary: `Start a grow-out cycle on ${context.pondName ?? "the active pond"}: ${stockingDate} → ${harvestDate}${days !== null ? ` (${days} days)` : ""}, ${num(payload.stockingCount)} fish${payload.targetHarvestWeightG ? `, target ${num(payload.targetHarvestWeightG)} g` : ""}.`,
				fields: [
					{ label: "Pond", value: context.pondName ?? "Active pond" },
					{ label: "Stocking", value: stockingDate },
					{ label: "Harvest", value: harvestDate },
					{ label: "Fish", value: String(Math.round(num(payload.stockingCount))) },
					{
						label: "Target",
						value: payload.targetHarvestWeightG
							? `${num(payload.targetHarvestWeightG)} g/fish`
							: "not set",
					},
				],
			};
		},
		async execute(payload) {
			const pondResult = await activePondOrError();
			if (!pondResult.ok) return pondResult.result;
			const stockingDate = str(payload.stockingDate);
			const targetHarvestDate = str(payload.targetHarvestDate);
			const result = await createCropCycle({
				pondId: pondResult.pond.id,
				label: typeof payload.label === "string" ? payload.label : null,
				stockingDate,
				stockingCount: Math.round(num(payload.stockingCount)),
				stockingAvgWeightG:
					typeof payload.stockingAvgWeightG === "number" ? payload.stockingAvgWeightG : null,
				growOutDays: daysBetween(stockingDate, targetHarvestDate),
				targetHarvestDate,
				targetHarvestWeightG:
					typeof payload.targetHarvestWeightG === "number" ? payload.targetHarvestWeightG : null,
				expectedSurvivalPct:
					typeof payload.expectedSurvivalPct === "number" ? payload.expectedSurvivalPct : 85,
				notes: null,
			});
			return result.success
				? { success: true, message: "Grow-out cycle started. The calendar events were added." }
				: fail(result.error);
		},
	},

	"records.complete_task": {
		id: "records.complete_task",
		label: "Mark a task done",
		description: "Tick a calendar task as done. Provide the task id shown in the calendar.",
		params: "eventId: string; occurrence?: ISO date-time (only for a recurring series)",
		schema: z.object({
			eventId: z.string().min(1),
			occurrence: z.string().datetime({ offset: true }).optional(),
		}),
		permission: "manage_crop_cycle",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Mark the task on ${context.pondName ?? "the active pond"} as done.`,
				fields: [{ label: "Task", value: str(payload.eventId) }],
			};
		},
		async execute(payload) {
			const result = await completePondEvent({
				id: str(payload.eventId),
				occurrence: typeof payload.occurrence === "string" ? payload.occurrence : null,
			});
			return result.success ? { success: true, message: "Task marked done." } : fail(result.error);
		},
	},

	"records.reopen_task": {
		id: "records.reopen_task",
		label: "Reopen a completed task",
		description: "Undo a mistaken task check and put the calendar task back to planned.",
		params: "eventId: string; occurrence?: ISO date-time (only for a recurring series)",
		schema: z.object({
			eventId: z.string().min(1),
			occurrence: z.string().datetime({ offset: true }).optional(),
		}),
		permission: "manage_crop_cycle",
		requiresStepUp: false,
		describe(payload, context) {
			return {
				summary: `Reopen the task on ${context.pondName ?? "the active pond"}.`,
				fields: [{ label: "Task", value: str(payload.eventId) }],
			};
		},
		async execute(payload) {
			const result = await uncompletePondEvent({
				id: str(payload.eventId),
				occurrence: typeof payload.occurrence === "string" ? payload.occurrence : null,
			});
			return result.success ? { success: true, message: "Task reopened." } : fail(result.error);
		},
	},
} satisfies AssistantActionTable;
