import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the assistant tool catalogue: the proposal-card text, the
 * shared "no active pond" guard, every failure branch that has to surface a
 * readable message, and the proposal-context helper the route uses.
 *
 * The happy-path wiring (which server action each tool calls) is covered by
 * `assistant-catalog.test.ts`; this file asserts the rules around it.
 */

const mocks = vi.hoisted(() => ({
	applyGrowthPlan: vi.fn(),
	toggleDevicePause: vi.fn(),
	updateScheduleCommand: vi.fn(),
	updatePondSettings: vi.fn(),
	requestFeed: vi.fn(),
	saveBiomassLog: vi.fn(),
	createPondEvent: vi.fn(),
	completePondEvent: vi.fn(),
	createCropCycle: vi.fn(),
	inviteMember: vi.fn(),
	changeMemberRole: vi.fn(),
	setUserPermission: vi.fn(),
	setOrganizationStatus: vi.fn(),
	startViewAs: vi.fn(),
	getActivePond: vi.fn(),
	resolveCurrentSchedule: vi.fn(),
	deviceFindFirst: vi.fn(),
	pondFindUnique: vi.fn(),
}));

vi.mock("@/lib/actions/growth-plan", () => ({ applyGrowthPlan: mocks.applyGrowthPlan }));
vi.mock("@/lib/actions/schedule", () => ({
	toggleDevicePause: mocks.toggleDevicePause,
	updateScheduleCommand: mocks.updateScheduleCommand,
}));
vi.mock("@/lib/actions/settings", () => ({ updatePondSettings: mocks.updatePondSettings }));
vi.mock("@/lib/actions/energy", () => ({ requestFeed: mocks.requestFeed }));
vi.mock("@/lib/actions/biomass", () => ({ saveBiomassLog: mocks.saveBiomassLog }));
vi.mock("@/lib/actions/pond-event", () => ({
	createPondEvent: mocks.createPondEvent,
	completePondEvent: mocks.completePondEvent,
}));
vi.mock("@/lib/actions/crop-cycle", () => ({ createCropCycle: mocks.createCropCycle }));
vi.mock("@/lib/actions/admin", () => ({
	inviteMember: mocks.inviteMember,
	changeMemberRole: mocks.changeMemberRole,
	setUserPermission: mocks.setUserPermission,
}));
vi.mock("@/lib/actions/platform/organizations", () => ({
	setOrganizationStatus: mocks.setOrganizationStatus,
}));
vi.mock("@/lib/actions/platform/impersonation", () => ({ startViewAs: mocks.startViewAs }));
vi.mock("@/lib/pond-selection", () => ({ getActivePond: mocks.getActivePond }));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: mocks.resolveCurrentSchedule,
}));
vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findFirst: mocks.deviceFindFirst },
		pond: { findUnique: mocks.pondFindUnique },
	},
}));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
	ASSISTANT_ACTION_DEFINITIONS,
	assistantToday,
	getAssistantActionDefinition,
} from "../assistant/catalog";
import type { AssistantProposalContext, AssistantToolId } from "../assistant/types";

const ctx = { userId: "user-1" };

const EMPTY_CONTEXT: AssistantProposalContext = {
	pondName: null,
	orgName: null,
	deviceLabel: null,
	currentGrams: null,
	currentFeedsPerDay: null,
	currentRatePct: null,
};

const FULL_CONTEXT: AssistantProposalContext = {
	pondName: "Pond A",
	orgName: "Org A",
	deviceLabel: "Feeder A",
	currentGrams: 120,
	currentFeedsPerDay: 3,
	currentRatePct: 2.5,
};

/** Every server action the catalogue can reach. */
const ACTION_SPIES = [
	mocks.applyGrowthPlan,
	mocks.toggleDevicePause,
	mocks.updateScheduleCommand,
	mocks.updatePondSettings,
	mocks.requestFeed,
	mocks.saveBiomassLog,
	mocks.createPondEvent,
	mocks.completePondEvent,
	mocks.createCropCycle,
	mocks.inviteMember,
	mocks.changeMemberRole,
	mocks.setUserPermission,
	mocks.setOrganizationStatus,
	mocks.startViewAs,
];

/** A payload that passes each schema, so only the pond guard can reject it. */
const POND_SCOPED_PAYLOADS: Array<[AssistantToolId, Record<string, unknown>]> = [
	["feeding.set_grams", { grams: 95 }],
	["feeding.set_meals", { mealsPerDay: 4 }],
	["feeding.set_rate", { feedingRatePct: 2.5 }],
	["feeding.pause", {}],
	["feeding.resume", {}],
	["feed.now", { grams: 120 }],
	["records.log_biomass", { avgWeightG: 150, sampleCount: 10 }],
	["records.add_calendar_item", { kind: "TASK", title: "Clean the net", startsAt: "2026-10-30" }],
	[
		"records.start_cycle",
		{ stockingDate: "2026-05-01", targetHarvestDate: "2026-08-29", stockingCount: 1000 },
	],
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getActivePond.mockResolvedValue({ id: "pond-1", name: "Pond A" });
	mocks.deviceFindFirst.mockResolvedValue({ id: "device-1", label: "Feeder A" });
	mocks.resolveCurrentSchedule.mockResolvedValue({
		scheduleStart: new Date("2026-01-01T06:00:00Z"),
		scheduleEnd: new Date("2026-01-01T18:00:00Z"),
		feedsPerDay: 3,
		feedingRatePct: 3,
	});
	mocks.applyGrowthPlan.mockResolvedValue({ success: true, newGrams: 95 });
	mocks.toggleDevicePause.mockResolvedValue(undefined);
	mocks.updateScheduleCommand.mockResolvedValue({ success: true, commandId: "cmd-1" });
	mocks.updatePondSettings.mockResolvedValue({ success: true });
	mocks.requestFeed.mockResolvedValue({ success: true });
	mocks.saveBiomassLog.mockResolvedValue({ success: true, feed: { effectiveGrams: 95 } });
	mocks.createPondEvent.mockResolvedValue({ success: true, eventId: "event-1" });
	mocks.completePondEvent.mockResolvedValue({ success: true, eventId: "event-1" });
	mocks.createCropCycle.mockResolvedValue({ success: true, cycleId: "cycle-1" });
	mocks.inviteMember.mockResolvedValue({
		success: true,
		membershipId: "m1",
		userId: "u2",
		loginEmail: "new@pond.optifeed.local",
		temporaryPassword: "Temp-1234",
		createdUser: true,
		inviteEmailSent: false,
	});
	mocks.changeMemberRole.mockResolvedValue({ success: true });
	mocks.setUserPermission.mockResolvedValue({ success: true });
	mocks.setOrganizationStatus.mockResolvedValue({ success: true, status: "SUSPENDED" });
	mocks.startViewAs.mockResolvedValue({
		success: true,
		orgId: "org-1",
		orgName: "Org A",
		farmId: "farm-1",
		expiresAt: "2026-10-27T12:30:00.000Z",
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("proposal cards describe the change in the caller's words", () => {
	it("names the pond and both feed amounts, falling back to placeholder text", () => {
		const withPond = ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].describe(
			{ grams: 95 },
			FULL_CONTEXT,
		);
		expect(withPond.summary).toBe(
			"Change the feeder on Pond A from 120 g to 95 g per meal. The 15-day adjustment window and device limits still apply.",
		);
		expect(withPond.fields).toEqual([
			{ label: "Pond", value: "Pond A" },
			{ label: "Current", value: "120 g/meal" },
			{ label: "New", value: "95 g/meal" },
		]);

		const withoutPond = ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].describe(
			{ grams: 95 },
			EMPTY_CONTEXT,
		);
		expect(withoutPond.summary).toContain("the active pond from — g to 95 g per meal");
		expect(withoutPond.fields).toEqual([
			{ label: "Pond", value: "Active pond" },
			{ label: "Current", value: "— g/meal" },
			{ label: "New", value: "95 g/meal" },
		]);
	});

	it("shows the current and requested meals per day", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["feeding.set_meals"].describe(
			{ mealsPerDay: 4 },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe(
			"Change Pond A to 4 feedings per day. The rest of the schedule stays as it is.",
		);
		expect(card.fields).toEqual([
			{ label: "Pond", value: "Pond A" },
			{ label: "Current", value: "3 meals/day" },
			{ label: "New", value: "4 meals/day" },
		]);
	});

	it("shows the current and requested feeding rate as a percentage", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["feeding.set_rate"].describe(
			{ feedingRatePct: 2.5 },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe("Set the feeding rate for Pond A to 2.5% of body weight per day.");
		expect(card.fields).toEqual([
			{ label: "Pond", value: "Pond A" },
			{ label: "Current", value: "2.5%" },
			{ label: "New", value: "2.5%" },
		]);
	});

	it("spells out that pausing stops scheduled meals and resuming restarts them", () => {
		const pause = ASSISTANT_ACTION_DEFINITIONS["feeding.pause"].describe({}, FULL_CONTEXT);
		expect(pause.summary).toBe(
			"Pause automatic feeding on Pond A. No scheduled meals will run until you resume.",
		);
		expect(pause.fields).toEqual([{ label: "Pond", value: "Pond A" }]);

		const resume = ASSISTANT_ACTION_DEFINITIONS["feeding.resume"].describe({}, FULL_CONTEXT);
		expect(resume.summary).toBe(
			"Resume automatic feeding on Pond A. Scheduled meals will run again.",
		);
		expect(resume.fields).toEqual([{ label: "Pond", value: "Pond A" }]);
	});

	it("calls an omitted feed.now dose the standard dose", () => {
		const withGrams = ASSISTANT_ACTION_DEFINITIONS["feed.now"].describe(
			{ grams: 120 },
			FULL_CONTEXT,
		);
		expect(withGrams.summary).toBe(
			"Dispense 120 g now on Pond A. The device must be online, and the daily cap and one-feed-at-a-time rule still apply.",
		);
		expect(withGrams.fields).toEqual([
			{ label: "Pond", value: "Pond A" },
			{ label: "Feeder", value: "Feeder A" },
			{ label: "Dose", value: "120 g" },
		]);

		const withoutGrams = ASSISTANT_ACTION_DEFINITIONS["feed.now"].describe({}, EMPTY_CONTEXT);
		expect(withoutGrams.summary).toContain("Dispense the standard dose now");
		expect(withoutGrams.fields[1]).toEqual({ label: "Feeder", value: "Linked feeder" });
		expect(withoutGrams.fields[2]).toEqual({ label: "Dose", value: "the standard dose" });
	});

	it("rounds the biomass sample size and dates the card", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].describe(
			{ avgWeightG: 150, sampleCount: 10.4 },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe("Log a biomass sample for Pond A: average 150 g across 10 fish.");
		expect(card.fields).toEqual([
			{ label: "Pond", value: "Pond A" },
			{ label: "Average weight", value: "150 g/fish" },
			{ label: "Sample size", value: "10 fish" },
			{ label: "Date", value: "today" },
		]);

		const dated = ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].describe(
			{ avgWeightG: 150, sampleCount: 10, recordedAt: "2026-10-01" },
			FULL_CONTEXT,
		);
		expect(dated.fields.at(-1)).toEqual({ label: "Date", value: "2026-10-01" });
	});

	it("lower-cases the calendar kind in the sentence but keeps the raw kind in the field", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].describe(
			{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30" },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe('Add a task "Clean the net" on 2026-10-30 to the Pond A calendar.');
		expect(card.fields).toEqual([
			{ label: "Type", value: "TASK" },
			{ label: "Title", value: "Clean the net" },
			{ label: "When", value: "2026-10-30" },
		]);
	});

	it("computes the grow-out length from the two dates and marks a missing target", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].describe(
			{
				stockingDate: "2026-05-01",
				targetHarvestDate: "2026-08-29",
				stockingCount: 1000,
				targetHarvestWeightG: 330,
			},
			FULL_CONTEXT,
		);
		expect(card.summary).toBe(
			"Start a grow-out cycle on Pond A: 2026-05-01 → 2026-08-29 (120 days), 1000 fish, target 330 g.",
		);
		expect(card.fields).toEqual([
			{ label: "Pond", value: "Pond A" },
			{ label: "Stocking", value: "2026-05-01" },
			{ label: "Harvest", value: "2026-08-29" },
			{ label: "Fish", value: "1000" },
			{ label: "Target", value: "330 g/fish" },
		]);

		const noTarget = ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].describe(
			{ stockingDate: "2026-05-01", targetHarvestDate: "2026-08-29", stockingCount: 1000 },
			FULL_CONTEXT,
		);
		expect(noTarget.summary).toBe(
			"Start a grow-out cycle on Pond A: 2026-05-01 → 2026-08-29 (120 days), 1000 fish.",
		);
		expect(noTarget.fields.at(-1)).toEqual({ label: "Target", value: "not set" });
	});

	it("omits the day count instead of inventing one when a date is malformed", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].describe(
			{ stockingDate: "2026-05-01", targetHarvestDate: "next spring", stockingCount: 1000 },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe(
			"Start a grow-out cycle on Pond A: 2026-05-01 → next spring, 1000 fish.",
		);
	});

	it("names the task id on the complete-task card", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.complete_task"].describe(
			{ eventId: "event-1" },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe("Mark the task on Pond A as done.");
		expect(card.fields).toEqual([{ label: "Task", value: "event-1" }]);
	});

	it("warns that an invite issues a one-time password", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].describe(
			{ email: "new@example.com", role: "OPERATOR" },
			FULL_CONTEXT,
		);
		expect(card.summary).toBe(
			"Invite new@example.com as OPERATOR. The invitee gets a one-time temporary password.",
		);
		expect(card.fields).toEqual([
			{ label: "Email", value: "new@example.com" },
			{ label: "Role", value: "OPERATOR" },
		]);
	});

	it("prefers the member's display name and falls back to the id", () => {
		const named = ASSISTANT_ACTION_DEFINITIONS["admin.change_role"].describe(
			{ userId: "member-1", role: "ADMIN", memberName: "Ana" },
			FULL_CONTEXT,
		);
		expect(named.summary).toBe("Change Ana's role to ADMIN.");
		expect(named.fields).toEqual([
			{ label: "Member", value: "Ana" },
			{ label: "New role", value: "ADMIN" },
		]);

		const unnamed = ASSISTANT_ACTION_DEFINITIONS["admin.change_role"].describe(
			{ userId: "member-1", role: "ADMIN" },
			FULL_CONTEXT,
		);
		expect(unnamed.summary).toBe("Change the member's role to ADMIN.");
		expect(unnamed.fields[0]).toEqual({ label: "Member", value: "member-1" });
	});

	it("says Grant or Revoke according to the requested change", () => {
		const grant = ASSISTANT_ACTION_DEFINITIONS["admin.set_permission"].describe(
			{ userId: "member-1", permission: "manage_schedule", granted: true, memberName: "Ana" },
			FULL_CONTEXT,
		);
		expect(grant.summary).toBe("Grant manage_schedule for Ana.");
		expect(grant.fields.at(-1)).toEqual({ label: "Action", value: "Grant" });

		const revoke = ASSISTANT_ACTION_DEFINITIONS["admin.set_permission"].describe(
			{ userId: "member-1", permission: "manage_schedule", granted: false },
			FULL_CONTEXT,
		);
		expect(revoke.summary).toBe("Revoke manage_schedule for the member.");
		expect(revoke.fields.at(-1)).toEqual({ label: "Action", value: "Revoke" });
	});

	it("states the blast radius of suspending, restoring and viewing an organization", () => {
		const payload = { orgId: "org-1", reason: "Non-payment for three months" };

		const suspend = ASSISTANT_ACTION_DEFINITIONS["superadmin.suspend_org"].describe(
			payload,
			FULL_CONTEXT,
		);
		expect(suspend.summary).toBe(
			"Suspend organization org-1. Every member loses access until it is restored. Reason: Non-payment for three months",
		);

		const restore = ASSISTANT_ACTION_DEFINITIONS["superadmin.restore_org"].describe(
			payload,
			FULL_CONTEXT,
		);
		expect(restore.summary).toBe(
			"Restore organization org-1 so its members can sign in again. Reason: Non-payment for three months",
		);

		const viewAs = ASSISTANT_ACTION_DEFINITIONS["superadmin.start_view_as"].describe(
			payload,
			FULL_CONTEXT,
		);
		expect(viewAs.summary).toBe(
			"Open a read-only view-as session for organization org-1 for 30 minutes. Reason: Non-payment for three months",
		);
		expect(viewAs.fields).toEqual([
			{ label: "Organization", value: "org-1" },
			{ label: "Reason", value: "Non-payment for three months" },
		]);
	});
});

describe("the pond guard rejects every pond-scoped tool before it writes", () => {
	it.each(POND_SCOPED_PAYLOADS)(
		"%s fails with a clear message and touches no server action",
		async (toolId, payload) => {
			mocks.getActivePond.mockResolvedValue(null);

			const result = await ASSISTANT_ACTION_DEFINITIONS[toolId].execute(payload, ctx);

			expect(result).toEqual({
				success: false,
				message: "No active pond is assigned to this account.",
			});
			expect(ACTION_SPIES.filter((spy) => spy.mock.calls.length > 0)).toEqual([]);
		},
	);
});

describe("schedule changes keep the untouched half of the schedule", () => {
	it("writes pond settings directly when no feeder is paired", async () => {
		mocks.deviceFindFirst.mockResolvedValue(null);

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_meals"].execute(
			{ mealsPerDay: 4 },
			ctx,
		);

		expect(mocks.updatePondSettings).toHaveBeenCalledWith("pond-1", 3, 4);
		expect(mocks.updateScheduleCommand).not.toHaveBeenCalled();
		expect(result).toEqual({
			success: true,
			message: "Saved: 4 meals/day at 3% of body weight.",
		});
	});

	it("passes the pond-settings failure through when no feeder is paired", async () => {
		mocks.deviceFindFirst.mockResolvedValue(null);
		mocks.updatePondSettings.mockResolvedValue({ success: false, error: "Pond is fallow." });

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_rate"].execute(
			{ feedingRatePct: 2.5 },
			ctx,
		);

		expect(mocks.updatePondSettings).toHaveBeenCalledWith("pond-1", 2.5, 3);
		expect(result).toEqual({ success: false, message: "Pond is fallow." });
	});

	it("uses a generic pond-settings message when the action returns no error", async () => {
		mocks.deviceFindFirst.mockResolvedValue(null);
		mocks.updatePondSettings.mockResolvedValue({ success: false });

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_meals"].execute(
			{ mealsPerDay: 4 },
			ctx,
		);

		expect(result).toEqual({ success: false, message: "Could not save the feeding settings." });
	});

	it("refuses to guess the missing half when the current schedule cannot be read", async () => {
		mocks.resolveCurrentSchedule.mockResolvedValue(null);

		const meals = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_meals"].execute(
			{ mealsPerDay: 4 },
			ctx,
		);
		const rate = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_rate"].execute(
			{ feedingRatePct: 2.5 },
			ctx,
		);

		expect(meals).toEqual({
			success: false,
			message: "The current feeding schedule could not be read.",
		});
		expect(rate).toEqual(meals);
		expect(mocks.updateScheduleCommand).not.toHaveBeenCalled();
		expect(mocks.updatePondSettings).not.toHaveBeenCalled();
	});

	it("passes the device-command failure through", async () => {
		mocks.updateScheduleCommand.mockResolvedValue({
			success: false,
			error: "The device is offline.",
		});

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_meals"].execute(
			{ mealsPerDay: 4 },
			ctx,
		);

		expect(result).toEqual({ success: false, message: "The device is offline." });
	});

	it("uses a generic device-command message when the action returns no error", async () => {
		mocks.updateScheduleCommand.mockResolvedValue({ success: false });

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_rate"].execute(
			{ feedingRatePct: 2.5 },
			ctx,
		);

		expect(result).toEqual({ success: false, message: "Could not save the feeding schedule." });
	});
});

describe("feeding.set_grams reports the applied amount", () => {
	it("formats the new amount to one decimal place", async () => {
		mocks.applyGrowthPlan.mockResolvedValue({ success: true, newGrams: 92.25 });

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].execute(
			{ grams: 92.25 },
			ctx,
		);

		expect(result).toEqual({
			success: true,
			message:
				"Feeding amount updated to 92.3 g per meal. The next adjustment is available after 15 days.",
		});
	});

	it("shows a dash when the action confirms without a new amount", async () => {
		mocks.applyGrowthPlan.mockResolvedValue({ success: true });

		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].execute(
			{ grams: 90 },
			ctx,
		);

		expect(result.message).toContain("updated to — g per meal");
	});

	it("propagates the growth-plan rejection, with a generic fallback", async () => {
		mocks.applyGrowthPlan.mockResolvedValue({
			success: false,
			error: "The 15-day adjustment window is still open.",
		});
		const rejected = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].execute(
			{ grams: 90 },
			ctx,
		);
		expect(rejected).toEqual({
			success: false,
			message: "The 15-day adjustment window is still open.",
		});

		mocks.applyGrowthPlan.mockResolvedValue({ success: false });
		const noReason = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].execute(
			{ grams: 90 },
			ctx,
		);
		expect(noReason).toEqual({ success: false, message: "Could not apply the feed amount." });
	});
});

describe("pause and resume need a paired feeder", () => {
	it.each(["feeding.pause", "feeding.resume"] as const)(
		"%s refuses when the pond has no device",
		async (toolId) => {
			mocks.deviceFindFirst.mockResolvedValue(null);

			const result = await ASSISTANT_ACTION_DEFINITIONS[toolId].execute({}, ctx);

			expect(result).toEqual({
				success: false,
				message: "No feeder is linked to this pond yet.",
			});
			expect(mocks.toggleDevicePause).not.toHaveBeenCalled();
		},
	);

	it("names the feeder in the confirmation", async () => {
		const paused = await ASSISTANT_ACTION_DEFINITIONS["feeding.pause"].execute({}, ctx);
		expect(paused).toEqual({
			success: true,
			message: "Automatic feeding is paused on Feeder A.",
		});
	});
});

describe("feed.now forwards an optional dose", () => {
	it("omits the dose when the caller did not name one", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["feed.now"].execute({}, ctx);

		expect(mocks.requestFeed).toHaveBeenCalledWith("device-1", undefined);
	});

	it("refuses when the pond has no device", async () => {
		mocks.deviceFindFirst.mockResolvedValue(null);

		const result = await ASSISTANT_ACTION_DEFINITIONS["feed.now"].execute({ grams: 120 }, ctx);

		expect(result).toEqual({ success: false, message: "No feeder is linked to this pond yet." });
		expect(mocks.requestFeed).not.toHaveBeenCalled();
	});

	it("propagates the request-feed rejection, with a generic fallback", async () => {
		mocks.requestFeed.mockResolvedValue({ success: false, error: "The device is offline." });
		const offline = await ASSISTANT_ACTION_DEFINITIONS["feed.now"].execute({}, ctx);
		expect(offline).toEqual({ success: false, message: "The device is offline." });

		mocks.requestFeed.mockResolvedValue({ success: false });
		const noReason = await ASSISTANT_ACTION_DEFINITIONS["feed.now"].execute({}, ctx);
		expect(noReason).toEqual({
			success: false,
			message: "Could not queue the feed request.",
		});
	});
});

describe("records.log_biomass shapes the sample form", () => {
	it("converts the average weight and count into a total sample weight", async () => {
		mocks.saveBiomassLog.mockResolvedValue({ success: true, feed: { effectiveGrams: 250 } });

		const result = await ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].execute(
			{ avgWeightG: 250, sampleCount: 10 },
			ctx,
		);

		const formData = mocks.saveBiomassLog.mock.calls[0]?.[0] as FormData;
		expect(formData.get("pondId")).toBe("pond-1");
		expect(formData.get("sampleCount")).toBe("10");
		expect(formData.get("sampleWeightKg")).toBe("2.5");
		expect(formData.get("sampleLengthCm")).toBe("0");
		expect(formData.has("recordedAt")).toBe(false);
		expect(result).toEqual({
			success: true,
			message: "Sample saved: 250 g average across 10 fish. The feeder is set to 250 g per meal.",
		});
	});

	it("rounds a fractional count before calculating the total", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].execute(
			{ avgWeightG: 150, sampleCount: 10.4 },
			ctx,
		);

		const formData = mocks.saveBiomassLog.mock.calls[0]?.[0] as FormData;
		expect(formData.get("sampleCount")).toBe("10");
		expect(formData.get("sampleWeightKg")).toBe("1.5");
	});

	it("forwards an explicit sample date", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].execute(
			{ avgWeightG: 150, sampleCount: 10, recordedAt: "2026-10-01" },
			ctx,
		);

		const formData = mocks.saveBiomassLog.mock.calls[0]?.[0] as FormData;
		expect(formData.get("recordedAt")).toBe("2026-10-01");
	});

	it("drops the feeder clause when the sample produced no recommendation", async () => {
		mocks.saveBiomassLog.mockResolvedValue({ success: true, feed: { effectiveGrams: null } });

		const result = await ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].execute(
			{ avgWeightG: 150, sampleCount: 10 },
			ctx,
		);

		expect(result).toEqual({
			success: true,
			message: "Sample saved: 150 g average across 10 fish.",
		});
	});

	it("propagates the biomass rejection", async () => {
		mocks.saveBiomassLog.mockResolvedValue({
			success: false,
			error: "The sample date cannot be in the future.",
		});

		const result = await ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].execute(
			{ avgWeightG: 150, sampleCount: 10 },
			ctx,
		);

		expect(result).toEqual({
			success: false,
			message: "The sample date cannot be in the future.",
		});
	});
});

describe("records.add_calendar_item derives all-day from the timestamp", () => {
	it("treats a date-only start as all-day and a timestamp as timed", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30" },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{ kind: "EVENT", title: "Vet visit", startsAt: "2026-10-30T09:00" },
			ctx,
		);

		const [allDayItem, timedItem] = mocks.createPondEvent.mock.calls.map(
			(call) => call[0] as Record<string, unknown>,
		);
		expect(allDayItem?.allDay).toBe(true);
		expect(timedItem?.allDay).toBe(false);
	});

	it("honours an explicit all-day flag and forwards notes", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{
				kind: "EVENT",
				title: "Harvest",
				startsAt: "2026-10-30T06:00",
				allDay: true,
				notes: "Bring the truck",
			},
			ctx,
		);

		expect(mocks.createPondEvent).toHaveBeenCalledWith({
			pondId: "pond-1",
			kind: "EVENT",
			type: "MAINTENANCE",
			title: "Harvest",
			allDay: true,
			startsAt: "2026-10-30T06:00",
			notes: "Bring the truck",
			color: null,
		});
	});

	it("forwards an explicit calendar colour", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{
				kind: "EVENT",
				title: "Capstone papers",
				startsAt: "2026-11-02T13:00",
				color: "#2563EB",
			},
			ctx,
		);

		expect(mocks.createPondEvent).toHaveBeenCalledWith(
			expect.objectContaining({ color: "#2563EB" }),
		);
	});

	it("sends null notes when none were given", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30" },
			ctx,
		);

		expect(mocks.createPondEvent).toHaveBeenCalledWith(expect.objectContaining({ notes: null }));
	});

	it("propagates the calendar rejection and confirms success", async () => {
		const success = await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30" },
			ctx,
		);
		expect(success).toEqual({ success: true, message: "Calendar item added." });

		mocks.createPondEvent.mockResolvedValue({
			success: false,
			error: "The pond calendar is full for that day.",
		});
		const rejected = await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30" },
			ctx,
		);
		expect(rejected).toEqual({
			success: false,
			message: "The pond calendar is full for that day.",
		});
	});
});

describe("records.start_cycle applies the documented defaults", () => {
	it("sends 85% survival and null optional fields when they are omitted", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].execute(
			{ stockingDate: "2026-05-01", targetHarvestDate: "2026-08-29", stockingCount: 1000 },
			ctx,
		);

		expect(mocks.createCropCycle).toHaveBeenCalledWith({
			pondId: "pond-1",
			label: null,
			stockingDate: "2026-05-01",
			stockingCount: 1000,
			stockingAvgWeightG: null,
			growOutDays: 120,
			targetHarvestDate: "2026-08-29",
			targetHarvestWeightG: null,
			expectedSurvivalPct: 85,
			notes: null,
		});
	});

	it("forwards every supplied optional field", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].execute(
			{
				label: "Cycle 4",
				stockingDate: "2026-05-01",
				stockingCount: 1000,
				stockingAvgWeightG: 12,
				targetHarvestDate: "2026-08-29",
				targetHarvestWeightG: 330,
				expectedSurvivalPct: 92,
			},
			ctx,
		);

		expect(mocks.createCropCycle).toHaveBeenCalledWith(
			expect.objectContaining({
				label: "Cycle 4",
				stockingAvgWeightG: 12,
				targetHarvestWeightG: 330,
				expectedSurvivalPct: 92,
			}),
		);
	});

	it("propagates the crop-cycle rejection and confirms success", async () => {
		const success = await ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].execute(
			{ stockingDate: "2026-05-01", targetHarvestDate: "2026-08-29", stockingCount: 1000 },
			ctx,
		);
		expect(success).toEqual({
			success: true,
			message: "Grow-out cycle started. The calendar events were added.",
		});

		mocks.createCropCycle.mockResolvedValue({
			success: false,
			error: "A cycle is already active on this pond.",
		});
		const rejected = await ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].execute(
			{ stockingDate: "2026-05-01", targetHarvestDate: "2026-08-29", stockingCount: 1000 },
			ctx,
		);
		expect(rejected).toEqual({
			success: false,
			message: "A cycle is already active on this pond.",
		});
	});
});

describe("records.complete_task", () => {
	it("forwards a recurrence occurrence when one is given", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.complete_task"].execute(
			{ eventId: "event-1", occurrence: "2026-10-30T00:00:00.000Z" },
			ctx,
		);

		expect(mocks.completePondEvent).toHaveBeenCalledWith({
			id: "event-1",
			occurrence: "2026-10-30T00:00:00.000Z",
		});
	});

	it("propagates the completion rejection and confirms success", async () => {
		const success = await ASSISTANT_ACTION_DEFINITIONS["records.complete_task"].execute(
			{ eventId: "event-1" },
			ctx,
		);
		expect(success).toEqual({ success: true, message: "Task marked done." });

		mocks.completePondEvent.mockResolvedValue({
			success: false,
			error: "That task is already done.",
		});
		const rejected = await ASSISTANT_ACTION_DEFINITIONS["records.complete_task"].execute(
			{ eventId: "event-1" },
			ctx,
		);
		expect(rejected).toEqual({ success: false, message: "That task is already done." });
	});
});

describe("admin tools", () => {
	it("derives the display name from the email when none is given", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "maria@example.com", role: "OPERATOR" },
			ctx,
		);

		expect(mocks.inviteMember).toHaveBeenCalledWith({
			email: "maria@example.com",
			displayName: "maria",
			role: "OPERATOR",
		});
	});

	it("keeps an explicit display name and treats a blank one as missing", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "maria@example.com", displayName: "Maria Cruz", role: "ADMIN" },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "jose@example.com", displayName: "   ", role: "VIEWER" },
			ctx,
		);

		expect(mocks.inviteMember).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ displayName: "Maria Cruz" }),
		);
		expect(mocks.inviteMember).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ displayName: "jose" }),
		);
	});

	it("shares the one-time password when the invite created a login", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "maria@example.com", role: "OPERATOR" },
			ctx,
		);

		expect(result).toEqual({
			success: true,
			message:
				"Invited maria@example.com. Share the one-time password shown in the result: Temp-1234",
		});
	});

	it("omits the password clause for an existing login", async () => {
		mocks.inviteMember.mockResolvedValue({
			success: true,
			membershipId: "m1",
			userId: "u2",
			loginEmail: "maria@example.com",
			temporaryPassword: null,
			createdUser: false,
			inviteEmailSent: true,
		});

		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "maria@example.com", role: "OPERATOR" },
			ctx,
		);

		expect(result).toEqual({
			success: true,
			message: "Invited maria@example.com to the organization.",
		});
	});

	it("propagates the invite rejection", async () => {
		mocks.inviteMember.mockResolvedValue({ error: "That email is already a member." });

		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "maria@example.com", role: "OPERATOR" },
			ctx,
		);

		expect(result).toEqual({ success: false, message: "That email is already a member." });
	});

	it("propagates a role-change rejection", async () => {
		mocks.changeMemberRole.mockResolvedValue({ error: "You cannot demote the last owner." });

		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.change_role"].execute(
			{ userId: "member-1", role: "VIEWER" },
			ctx,
		);

		expect(result).toEqual({ success: false, message: "You cannot demote the last owner." });
	});

	it("confirms a role change", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.change_role"].execute(
			{ userId: "member-1", role: "ADMIN" },
			ctx,
		);

		expect(result).toEqual({ success: true, message: "Role updated." });
	});

	it("propagates a permission-change rejection", async () => {
		mocks.setUserPermission.mockResolvedValue({ error: "Only an owner can grant that." });

		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.set_permission"].execute(
			{ userId: "member-1", permission: "manage_members", granted: true },
			ctx,
		);

		expect(result).toEqual({ success: false, message: "Only an owner can grant that." });
	});
});

describe("superadmin tools", () => {
	it("suspends with a SUSPENDED status and the operator's reason", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["superadmin.suspend_org"].execute(
			{ orgId: "org-1", reason: "Non-payment for three months" },
			ctx,
		);

		expect(result).toEqual({ success: true, message: "Organization suspended." });
		expect(mocks.setOrganizationStatus).toHaveBeenCalledWith({
			orgId: "org-1",
			status: "SUSPENDED",
			reason: "Non-payment for three months",
		});
	});

	it("restores with an ACTIVE status and the operator's reason", async () => {
		mocks.setOrganizationStatus.mockResolvedValue({ success: true, status: "ACTIVE" });

		const result = await ASSISTANT_ACTION_DEFINITIONS["superadmin.restore_org"].execute(
			{ orgId: "org-1", reason: "Invoice settled" },
			ctx,
		);

		expect(result).toEqual({ success: true, message: "Organization restored." });
		expect(mocks.setOrganizationStatus).toHaveBeenCalledWith({
			orgId: "org-1",
			status: "ACTIVE",
			reason: "Invoice settled",
		});
	});

	it("propagates organization-status rejections", async () => {
		mocks.setOrganizationStatus.mockResolvedValue({ error: "Organization not found." });

		const suspend = await ASSISTANT_ACTION_DEFINITIONS["superadmin.suspend_org"].execute(
			{ orgId: "org-1", reason: "Non-payment for three months" },
			ctx,
		);
		const restore = await ASSISTANT_ACTION_DEFINITIONS["superadmin.restore_org"].execute(
			{ orgId: "org-1", reason: "Non-payment for three months" },
			ctx,
		);

		expect(suspend).toEqual({ success: false, message: "Organization not found." });
		expect(restore).toEqual(suspend);
	});

	it("names the organization and the local expiry time on a view-as card result", async () => {
		const expiresAt = "2026-10-27T12:30:00.000Z";

		const result = await ASSISTANT_ACTION_DEFINITIONS["superadmin.start_view_as"].execute(
			{ orgId: "org-1", reason: "Investigating a support ticket" },
			ctx,
		);

		expect(result).toEqual({
			success: true,
			message: `Viewing Org A read-only until ${new Date(expiresAt).toLocaleTimeString()}.`,
		});
	});

	it("propagates a view-as rejection", async () => {
		mocks.startViewAs.mockResolvedValue({ error: "That organization is already suspended." });

		const result = await ASSISTANT_ACTION_DEFINITIONS["superadmin.start_view_as"].execute(
			{ orgId: "org-1", reason: "Investigating a support ticket" },
			ctx,
		);

		expect(result).toEqual({
			success: false,
			message: "That organization is already suspended.",
		});
	});
});

describe("catalogue lookups", () => {
	it("returns the definition for a known tool id", () => {
		expect(getAssistantActionDefinition("feeding.pause")).toBe(
			ASSISTANT_ACTION_DEFINITIONS["feeding.pause"],
		);
	});

	it("returns null for an id outside the catalogue", () => {
		expect(getAssistantActionDefinition("feeding.explode")).toBeNull();
		expect(getAssistantActionDefinition("")).toBeNull();
	});

	it("returns null for inherited object members, not a prototype function", () => {
		// A plain record lookup resolves inherited members, so "toString" used to
		// return Object.prototype.toString (truthy) while the signature promises
		// AssistantActionDefinition | null.
		for (const id of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
			expect(getAssistantActionDefinition(id), id).toBeNull();
		}
	});

	it("reports today in farm time rather than UTC", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-29T17:30:00.000Z"));

		// 17:30 UTC is already the next calendar day in Asia/Manila (UTC+8).
		expect(assistantToday()).toBe("2026-10-30");
	});
});
