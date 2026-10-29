import {
	changeMemberRole,
	inviteMember,
	revealDeviceToken,
	revokeMember,
	setPondStatus,
	setUserPermission,
} from "@/lib/actions/admin";
import { deleteBiomassLog, saveBiomassLog, updateBiomassLog } from "@/lib/actions/biomass";
import { createCropCycle } from "@/lib/actions/crop-cycle";
import { requestFeed } from "@/lib/actions/energy";
import { applyGrowthPlan } from "@/lib/actions/growth-plan";
import {
	remoteFeedDevice,
	remoteSetDevicePause,
	rotateDeviceToken,
} from "@/lib/actions/platform/devices";
import { startViewAs, stopViewAs } from "@/lib/actions/platform/impersonation";
import { setOrganizationStatus } from "@/lib/actions/platform/organizations";
import {
	completePondEvent,
	createPondEvent,
	deletePondEvent,
	uncompletePondEvent,
	updatePondEvent,
} from "@/lib/actions/pond-event";
import { deleteTenantPond, moveDeviceToPond, unassignDevice } from "@/lib/actions/ponds";
import { toggleDevicePause, updateScheduleCommand } from "@/lib/actions/schedule";
import { updatePondSettings } from "@/lib/actions/settings";
import {
	createOrg,
	disablePlatformUser,
	enablePlatformUser,
	grantPlatformAdmin,
	revokePlatformAdmin,
} from "@/lib/actions/superadmin";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { daysBetween, isValidDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import {
	MAX_FEED_GRAMS_PER_REQUEST,
	feedGramsSchema,
	feedingRatePctSchema,
	feedsPerDaySchema,
} from "@/lib/limits";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import type { MemberRole } from "@prisma/client";
import { z } from "zod";
import type { AssistantActionDefinition, AssistantExecuteResult, AssistantToolId } from "./types";

/**
 * The server-side tool catalogue for the assistant (issue #194, E10).
 *
 * Every entry wraps an **existing** server action. There is deliberately no
 * write logic here: the assistant must inherit the same permission checks,
 * caps, offline/fallow blocks, rate limits and audit rows as the button a
 * person would press. `execute()` only resolves the current pond/device and
 * forwards the validated payload.
 */

const memberRoleSchema = z.enum(["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
const permissionSchema = z.enum(PERMISSIONS);

/** The same 10-character floor the platform actions enforce server-side. */
const reasonSchema = z
	.string()
	.trim()
	.min(10, "A reason of at least 10 characters is required.")
	.max(500);

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function hhmm(date: Date): string {
	return date.toISOString().slice(11, 16);
}

function fail(message: string): AssistantExecuteResult {
	return { success: false, message };
}

async function activePondOrError(): Promise<
	{ ok: true; pond: { id: string; name: string } } | { ok: false; result: AssistantExecuteResult }
> {
	const pond = await getActivePond();
	if (!pond) return { ok: false, result: fail("No active pond is assigned to this account.") };
	return { ok: true, pond: { id: pond.id as string, name: pond.name as string } };
}

async function activeDevice(pondId: string): Promise<{ id: string; label: string } | null> {
	const device = await prisma.energyDevice.findFirst({
		where: { pondId },
		orderBy: { createdAt: "asc" },
		select: { id: true, label: true },
	});
	return device ? { id: device.id, label: device.label } : null;
}

/**
 * Resolve the pond an action targets: the id the user named, otherwise the
 * active pond. Scope is *not* checked here — the server action re-resolves the
 * caller's organization, so an id from another tenant is refused there.
 */
async function pondTarget(
	payload: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { ok: false; result: AssistantExecuteResult }> {
	const pondId = str(payload.pondId);
	if (pondId) {
		return { ok: true, id: pondId, name: str(payload.pondName) || "the selected pond" };
	}
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult;
	return { ok: true, id: pondResult.pond.id, name: pondResult.pond.name };
}

/** The name a pond card should show, without pretending a named id is the active pond. */
function pondLabel(payload: Record<string, unknown>, context: { pondName: string | null }): string {
	return (
		str(payload.pondName) ||
		(str(payload.pondId) ? "the selected pond" : context.pondName) ||
		"Active pond"
	);
}

/** Resolve the device an action targets: the named one, otherwise the active pond's feeder. */
async function deviceTarget(
	payload: Record<string, unknown>,
): Promise<
	{ ok: true; id: string; label: string } | { ok: false; result: AssistantExecuteResult }
> {
	const deviceId = str(payload.deviceId);
	if (deviceId) {
		return { ok: true, id: deviceId, label: str(payload.deviceLabel) || "the selected feeder" };
	}
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult;
	const device = await activeDevice(pondResult.pond.id);
	if (!device) return { ok: false, result: fail("No feeder is linked to this pond yet.") };
	return { ok: true, id: device.id, label: device.label };
}

/**
 * Change one value of the schedule while keeping the rest as it is. This is
 * the exact call ScheduleEditor makes; the server revalidates the whole
 * schedule (caps, fallow, device limit) in `updateScheduleCommand`.
 */
async function changeSchedule(patch: {
	feedsPerDay?: number;
	feedingRatePct?: number;
}): Promise<AssistantExecuteResult> {
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult.result;
	const { pond } = pondResult;

	const device = await activeDevice(pond.id);
	const current = await resolveCurrentSchedule(pond.id, device?.id ?? null);
	const rate = patch.feedingRatePct ?? current?.feedingRatePct;
	const feeds = patch.feedsPerDay ?? current?.feedsPerDay;
	if (rate === undefined || feeds === undefined) {
		return fail("The current feeding schedule could not be read.");
	}

	if (!device) {
		// No feeder paired yet: the pond settings page is the control a person
		// would use, and it validates the same numbers.
		const result = await updatePondSettings(pond.id, rate, feeds);
		return result.success
			? {
					success: true,
					message: `Saved: ${feeds} meals/day at ${rate}% of body weight.`,
				}
			: fail(result.error ?? "Could not save the feeding settings.");
	}

	const result = await updateScheduleCommand(pond.id, device.id, {
		scheduleStart: current ? hhmm(current.scheduleStart) : "06:00",
		scheduleEnd: current ? hhmm(current.scheduleEnd) : "18:00",
		feedsPerDay: feeds,
		feedingRatePct: rate,
	});
	return result.success
		? { success: true, message: `Saved: ${feeds} meals/day at ${rate}% of body weight.` }
		: fail(result.error ?? "Could not save the feeding schedule.");
}

/** The rate/feeds value is persisted on the pond; read it for the card. */
async function pondSettings(): Promise<{
	pond: { id: string; name: string } | null;
	feedsPerDay: number | null;
	feedingRatePct: number | null;
}> {
	const pond = await getActivePond();
	if (!pond) return { pond: null, feedsPerDay: null, feedingRatePct: null };
	const row = await prisma.pond.findUnique({
		where: { id: pond.id },
		select: { feedsPerDay: true, feedingRatePct: true },
	});
	return {
		pond: { id: pond.id as string, name: pond.name as string },
		feedsPerDay: row?.feedsPerDay ?? null,
		feedingRatePct: row?.feedingRatePct ?? null,
	};
}

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

export const ASSISTANT_ACTION_DEFINITIONS: Record<AssistantToolId, AssistantActionDefinition> = {
	"feeding.set_grams": {
		id: "feeding.set_grams",
		label: "Change feed amount",
		description:
			"Change how many grams the feeder dispenses per meal. The growth-plan adjustment window, the device g/s limit and the daily cap still apply.",
		params: "grams: number (grams per meal, 1 or more)",
		schema: z.object({ grams: z.coerce.number().positive().max(MAX_FEED_GRAMS_PER_REQUEST) }),
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
};

export function getAssistantActionDefinition(id: string): AssistantActionDefinition | null {
	// Own-property check: a plain record lookup also resolves inherited members,
	// so a caller-supplied id such as "toString" or "constructor" would return a
	// function instead of null and violate the return type.
	if (!Object.hasOwn(ASSISTANT_ACTION_DEFINITIONS, id)) return null;
	return (ASSISTANT_ACTION_DEFINITIONS as Record<string, AssistantActionDefinition>)[id] ?? null;
}

/** Today in farm time, exported for the planner prompt. */
export function assistantToday(): string {
	return todayDateOnly();
}

/** Used by the proposal context for the current pond settings. */
export async function loadPondProposalSettings(): Promise<{
	pondName: string | null;
	feedsPerDay: number | null;
	feedingRatePct: number | null;
	currentGrams: number | null;
}> {
	const pondSettingsResult = await pondSettings();
	const pond = pondSettingsResult.pond;
	if (!pond) {
		return { pondName: null, feedsPerDay: null, feedingRatePct: null, currentGrams: null };
	}
	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		select: { gramsPerFeeding: true },
	});
	return {
		pondName: pond.name,
		feedsPerDay: pondSettingsResult.feedsPerDay,
		feedingRatePct: pondSettingsResult.feedingRatePct,
		currentGrams: device?.gramsPerFeeding ?? null,
	};
}
