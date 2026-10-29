import { changeMemberRole, inviteMember, setUserPermission } from "@/lib/actions/admin";
import { saveBiomassLog } from "@/lib/actions/biomass";
import { createCropCycle } from "@/lib/actions/crop-cycle";
import { requestFeed } from "@/lib/actions/energy";
import { applyGrowthPlan } from "@/lib/actions/growth-plan";
import { startViewAs } from "@/lib/actions/platform/impersonation";
import { setOrganizationStatus } from "@/lib/actions/platform/organizations";
import { completePondEvent, createPondEvent } from "@/lib/actions/pond-event";
import { toggleDevicePause, updateScheduleCommand } from "@/lib/actions/schedule";
import { updatePondSettings } from "@/lib/actions/settings";
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
async function loadPondProposalSettings(): Promise<{
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
