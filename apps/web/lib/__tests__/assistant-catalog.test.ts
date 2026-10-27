import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { ASSISTANT_ACTION_DEFINITIONS } from "../assistant/catalog";

const ctx = { userId: "user-1" };

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
	mocks.saveBiomassLog.mockResolvedValue({
		success: true,
		feed: { effectiveGrams: 95 },
	});
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

describe("assistant action definitions call the same actions the UI calls", () => {
	it("feeding.set_grams -> applyGrowthPlan", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["feeding.set_grams"].execute(
			{ grams: 95 },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(mocks.applyGrowthPlan).toHaveBeenCalledWith("pond-1", { grams: 95 });
	});

	it("feeding.set_meals -> updateScheduleCommand, preserving the rest of the schedule", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["feeding.set_meals"].execute({ mealsPerDay: 4 }, ctx);
		expect(mocks.updateScheduleCommand).toHaveBeenCalledWith("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 4,
			feedingRatePct: 3,
		});
	});

	it("feeding.set_rate -> updateScheduleCommand, preserving meals", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["feeding.set_rate"].execute({ feedingRatePct: 2.5 }, ctx);
		expect(mocks.updateScheduleCommand).toHaveBeenCalledWith("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 3,
			feedingRatePct: 2.5,
		});
	});

	it("feeding.pause and feeding.resume -> toggleDevicePause", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["feeding.pause"].execute({}, ctx);
		await ASSISTANT_ACTION_DEFINITIONS["feeding.resume"].execute({}, ctx);
		expect(mocks.toggleDevicePause).toHaveBeenNthCalledWith(1, "device-1", true);
		expect(mocks.toggleDevicePause).toHaveBeenNthCalledWith(2, "device-1", false);
	});

	it("feed.now -> requestFeed with the requested dose", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["feed.now"].execute({ grams: 120 }, ctx);
		expect(mocks.requestFeed).toHaveBeenCalledWith("device-1", 120);
	});

	it("records.log_biomass -> saveBiomassLog with the total sample weight", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.log_biomass"].execute(
			{ avgWeightG: 150, sampleCount: 10 },
			ctx,
		);
		const formData = mocks.saveBiomassLog.mock.calls[0]?.[0] as FormData;
		expect(formData.get("pondId")).toBe("pond-1");
		expect(formData.get("sampleCount")).toBe("10");
		expect(formData.get("sampleWeightKg")).toBe("1.5");
	});

	it("records.add_calendar_item -> createPondEvent", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.add_calendar_item"].execute(
			{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30", allDay: true },
			ctx,
		);
		expect(mocks.createPondEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				pondId: "pond-1",
				kind: "TASK",
				title: "Clean the net",
				startsAt: "2026-10-30",
				allDay: true,
			}),
		);
	});

	it("records.start_cycle -> createCropCycle with a computed grow-out length", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.start_cycle"].execute(
			{
				stockingDate: "2026-05-01",
				targetHarvestDate: "2026-08-29",
				stockingCount: 1000,
				targetHarvestWeightG: 330,
			},
			ctx,
		);
		expect(mocks.createCropCycle).toHaveBeenCalledWith(
			expect.objectContaining({
				pondId: "pond-1",
				stockingDate: "2026-05-01",
				targetHarvestDate: "2026-08-29",
				growOutDays: 120,
			}),
		);
	});

	it("records.complete_task -> completePondEvent", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.complete_task"].execute(
			{ eventId: "event-1" },
			ctx,
		);
		expect(mocks.completePondEvent).toHaveBeenCalledWith({ id: "event-1", occurrence: null });
	});

	it("admin.invite_member -> inviteMember", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["admin.invite_member"].execute(
			{ email: "new@example.com", role: "OPERATOR" },
			ctx,
		);
		expect(mocks.inviteMember).toHaveBeenCalledWith({
			email: "new@example.com",
			displayName: "new",
			role: "OPERATOR",
		});
	});

	it("admin.change_role -> changeMemberRole", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["admin.change_role"].execute(
			{ userId: "member-1", role: "ADMIN" },
			ctx,
		);
		expect(mocks.changeMemberRole).toHaveBeenCalledWith("member-1", "ADMIN");
	});

	it("admin.set_permission -> setUserPermission", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["admin.set_permission"].execute(
			{ userId: "member-1", permission: "manage_schedule", granted: false },
			ctx,
		);
		expect(mocks.setUserPermission).toHaveBeenCalledWith("member-1", "manage_schedule", false);
	});

	it("superadmin suspend/restore -> setOrganizationStatus", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.suspend_org"].execute(
			{ orgId: "org-1", reason: "Non-payment for three months" },
			ctx,
		);
		expect(mocks.setOrganizationStatus).toHaveBeenCalledWith({
			orgId: "org-1",
			status: "SUSPENDED",
			reason: "Non-payment for three months",
		});
	});

	it("superadmin.start_view_as -> startViewAs", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["superadmin.start_view_as"].execute(
			{ orgId: "org-1", reason: "Investigating a support ticket" },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(mocks.startViewAs).toHaveBeenCalledWith({
			orgId: "org-1",
			reason: "Investigating a support ticket",
		});
	});
});
