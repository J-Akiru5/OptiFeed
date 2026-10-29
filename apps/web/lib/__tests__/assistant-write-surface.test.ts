import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #344: Pakoy's write surface is everything the signed-in user is
 * permitted to do, gated by the same server action the UI calls.
 *
 * These tests pin three things:
 * 1. every newly exposed kind calls the real server action with the payload
 *    the proposal card described (allow);
 * 2. a refusal from the action is surfaced as a readable message, never
 *    swallowed (deny);
 * 3. the guard metadata matches the UI's guard (permission, tenant admin,
 *    platform admin, step-up) so Accept re-checks the same boundary.
 */

const mocks = vi.hoisted(() => ({
	applyGrowthPlan: vi.fn(),
	toggleDevicePause: vi.fn(),
	updateScheduleCommand: vi.fn(),
	updatePondSettings: vi.fn(),
	requestFeed: vi.fn(),
	saveBiomassLog: vi.fn(),
	updateBiomassLog: vi.fn(),
	deleteBiomassLog: vi.fn(),
	createCropCycle: vi.fn(),
	createPondEvent: vi.fn(),
	updatePondEvent: vi.fn(),
	deletePondEvent: vi.fn(),
	completePondEvent: vi.fn(),
	uncompletePondEvent: vi.fn(),
	inviteMember: vi.fn(),
	changeMemberRole: vi.fn(),
	setUserPermission: vi.fn(),
	revokeMember: vi.fn(),
	revealDeviceToken: vi.fn(),
	setPondStatus: vi.fn(),
	setOrganizationStatus: vi.fn(),
	startViewAs: vi.fn(),
	stopViewAs: vi.fn(),
	rotateDeviceToken: vi.fn(),
	remoteFeedDevice: vi.fn(),
	remoteSetDevicePause: vi.fn(),
	deleteTenantPond: vi.fn(),
	moveDeviceToPond: vi.fn(),
	unassignDevice: vi.fn(),
	createOrg: vi.fn(),
	disablePlatformUser: vi.fn(),
	enablePlatformUser: vi.fn(),
	grantPlatformAdmin: vi.fn(),
	revokePlatformAdmin: vi.fn(),
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
vi.mock("@/lib/actions/biomass", () => ({
	saveBiomassLog: mocks.saveBiomassLog,
	updateBiomassLog: mocks.updateBiomassLog,
	deleteBiomassLog: mocks.deleteBiomassLog,
}));
vi.mock("@/lib/actions/crop-cycle", () => ({ createCropCycle: mocks.createCropCycle }));
vi.mock("@/lib/actions/pond-event", () => ({
	createPondEvent: mocks.createPondEvent,
	updatePondEvent: mocks.updatePondEvent,
	deletePondEvent: mocks.deletePondEvent,
	completePondEvent: mocks.completePondEvent,
	uncompletePondEvent: mocks.uncompletePondEvent,
}));
vi.mock("@/lib/actions/admin", () => ({
	inviteMember: mocks.inviteMember,
	changeMemberRole: mocks.changeMemberRole,
	setUserPermission: mocks.setUserPermission,
	revokeMember: mocks.revokeMember,
	revealDeviceToken: mocks.revealDeviceToken,
	setPondStatus: mocks.setPondStatus,
}));
vi.mock("@/lib/actions/ponds", () => ({
	deleteTenantPond: mocks.deleteTenantPond,
	moveDeviceToPond: mocks.moveDeviceToPond,
	unassignDevice: mocks.unassignDevice,
}));
vi.mock("@/lib/actions/platform/organizations", () => ({
	setOrganizationStatus: mocks.setOrganizationStatus,
}));
vi.mock("@/lib/actions/platform/impersonation", () => ({
	startViewAs: mocks.startViewAs,
	stopViewAs: mocks.stopViewAs,
}));
vi.mock("@/lib/actions/platform/devices", () => ({
	rotateDeviceToken: mocks.rotateDeviceToken,
	remoteFeedDevice: mocks.remoteFeedDevice,
	remoteSetDevicePause: mocks.remoteSetDevicePause,
}));
vi.mock("@/lib/actions/superadmin", () => ({
	createOrg: mocks.createOrg,
	disablePlatformUser: mocks.disablePlatformUser,
	enablePlatformUser: mocks.enablePlatformUser,
	grantPlatformAdmin: mocks.grantPlatformAdmin,
	revokePlatformAdmin: mocks.revokePlatformAdmin,
}));
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

import type { AssistantCaller } from "../assistant/caller";
import { ASSISTANT_ACTION_DEFINITIONS } from "../assistant/catalog";
import { availableToolIds } from "../assistant/tools";
import { ASSISTANT_TOOL_IDS, type AssistantToolId } from "../assistant/types";

const ctx = { userId: "user-1" };
const reason = "Investigating a support ticket";

function caller(overrides: Partial<AssistantCaller> = {}): AssistantCaller {
	return {
		userId: "user-1",
		role: "owner",
		permissions: new Set(),
		canWrite: true,
		isPlatformAdmin: false,
		isTenantAdmin: false,
		orgName: "Org A",
		...overrides,
	};
}

function allowWrite() {
	mocks.getActivePond.mockResolvedValue({ id: "pond-1", name: "Pond A" });
	mocks.deviceFindFirst.mockResolvedValue({ id: "device-1", label: "Feeder A" });
	mocks.resolveCurrentSchedule.mockResolvedValue(null);
	mocks.setPondStatus.mockResolvedValue({ success: true });
	mocks.deleteTenantPond.mockResolvedValue({ success: true });
	mocks.moveDeviceToPond.mockResolvedValue({ success: true });
	mocks.unassignDevice.mockResolvedValue({ success: true });
	mocks.updatePondEvent.mockResolvedValue({ success: true, eventId: "event-1" });
	mocks.deletePondEvent.mockResolvedValue({ success: true, eventId: "event-1" });
	mocks.uncompletePondEvent.mockResolvedValue({ success: true, eventId: "event-1" });
	mocks.updateBiomassLog.mockResolvedValue({ success: true });
	mocks.deleteBiomassLog.mockResolvedValue({ success: true });
	mocks.revokeMember.mockResolvedValue({ success: true });
	mocks.revealDeviceToken.mockResolvedValue({
		success: true,
		token: "tok-123",
		mac: "AA:BB:CC:DD:EE:FF",
		label: "Feeder A",
	});
	mocks.rotateDeviceToken.mockResolvedValue({ success: true, token: "new-token" });
	mocks.remoteFeedDevice.mockResolvedValue({ success: true });
	mocks.remoteSetDevicePause.mockResolvedValue({ success: true, isPaused: true });
	mocks.disablePlatformUser.mockResolvedValue({ success: true });
	mocks.enablePlatformUser.mockResolvedValue({ success: true });
	mocks.grantPlatformAdmin.mockResolvedValue({ success: true });
	mocks.revokePlatformAdmin.mockResolvedValue({ success: true });
	mocks.stopViewAs.mockResolvedValue({ success: true });
	mocks.createOrg.mockResolvedValue({ success: true, orgId: "org-2" });
}

beforeEach(() => {
	vi.clearAllMocks();
	allowWrite();
});

describe("calendar and sample deletes call the same actions as the UI", () => {
	it("records.update_calendar_item -> updatePondEvent, inferring all-day from a date-only start", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["records.update_calendar_item"].execute(
			{ eventId: "event-1", title: "Clean the net", startsAt: "2026-10-30" },
			ctx,
		);

		expect(mocks.updatePondEvent).toHaveBeenCalledWith({
			id: "event-1",
			title: "Clean the net",
			startsAt: "2026-10-30",
			allDay: true,
		});
		expect(result).toEqual({ success: true, message: "Calendar item updated." });
	});

	it("records.delete_calendar_item -> deletePondEvent and propagates a refusal", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["records.delete_calendar_item"].execute(
			{ eventId: "event-1" },
			ctx,
		);
		expect(mocks.deletePondEvent).toHaveBeenCalledWith({
			id: "event-1",
			occurrence: null,
		});
		expect(result).toEqual({ success: true, message: "Calendar item deleted." });

		mocks.deletePondEvent.mockResolvedValueOnce({
			success: false,
			error: "Cycle events cannot be deleted.",
		});
		await expect(
			ASSISTANT_ACTION_DEFINITIONS["records.delete_calendar_item"].execute(
				{ eventId: "event-1" },
				ctx,
			),
		).resolves.toEqual({ success: false, message: "Cycle events cannot be deleted." });
	});

	it("records.reopen_task -> uncompletePondEvent", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["records.reopen_task"].execute(
			{ eventId: "event-1" },
			ctx,
		);
		expect(mocks.uncompletePondEvent).toHaveBeenCalledWith({
			id: "event-1",
			occurrence: null,
		});
		expect(result).toEqual({ success: true, message: "Task reopened." });
	});

	it("records.update_biomass -> updateBiomassLog with a recomputed sample weight", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.update_biomass"].execute(
			{ logId: "log-1", avgWeightG: 150, sampleCount: 10, sampleLengthCm: 18 },
			ctx,
		);

		expect(mocks.updateBiomassLog).toHaveBeenCalledWith({
			id: "log-1",
			sampleCount: 10,
			sampleWeightKg: 1.5,
			sampleLengthCm: 18,
			batchLabel: null,
		});
	});

	it("records.delete_biomass -> deleteBiomassLog and surfaces its error", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["records.delete_biomass"].execute(
			{ logId: "log-1", sampleDate: "2026-10-01" },
			ctx,
		);
		expect(mocks.deleteBiomassLog).toHaveBeenCalledWith("log-1");

		mocks.deleteBiomassLog.mockResolvedValueOnce({
			success: false,
			error: "Sample not found.",
		});
		await expect(
			ASSISTANT_ACTION_DEFINITIONS["records.delete_biomass"].execute({ logId: "log-1" }, ctx),
		).resolves.toEqual({ success: false, message: "Sample not found." });
	});
});

describe("pond lifecycle and feeder placement", () => {
	it("archives and restores the active pond through setPondStatus", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["ponds.archive"].execute({}, ctx);
		await ASSISTANT_ACTION_DEFINITIONS["ponds.restore"].execute({}, ctx);

		expect(mocks.setPondStatus).toHaveBeenNthCalledWith(1, "pond-1", "ARCHIVED");
		expect(mocks.setPondStatus).toHaveBeenNthCalledWith(2, "pond-1", "ACTIVE");
	});

	it("deletes only with the typed confirmation the action requires", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["ponds.delete"].execute(
			{ pondId: "pond-1", pondName: "Pond A", confirmName: "Pond A" },
			ctx,
		);
		expect(mocks.deleteTenantPond).toHaveBeenCalledWith({
			pondId: "pond-1",
			confirmName: "Pond A",
		});
		expect(result).toEqual({ success: true, message: "Pond A deleted." });

		mocks.deleteTenantPond.mockResolvedValueOnce({
			error: "This pond has data or devices. Archive it instead.",
		});
		await expect(
			ASSISTANT_ACTION_DEFINITIONS["ponds.delete"].execute(
				{ pondId: "pond-1", confirmName: "Pond A" },
				ctx,
			),
		).resolves.toEqual({
			success: false,
			message: "This pond has data or devices. Archive it instead.",
		});
	});

	it("moves and unassigns a named feeder", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["ponds.move_device"].execute(
			{ deviceId: "device-1", targetPondId: "pond-2" },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["ponds.unassign_device"].execute(
			{ deviceId: "device-1" },
			ctx,
		);

		expect(mocks.moveDeviceToPond).toHaveBeenCalledWith({
			deviceId: "device-1",
			targetPondId: "pond-2",
		});
		expect(mocks.unassignDevice).toHaveBeenCalledWith("device-1");
	});

	it("refuses a pond or feeder action when the caller has no active pond", async () => {
		mocks.getActivePond.mockResolvedValue(null);

		const archived = await ASSISTANT_ACTION_DEFINITIONS["ponds.archive"].execute({}, ctx);
		const unassigned = await ASSISTANT_ACTION_DEFINITIONS["ponds.unassign_device"].execute({}, ctx);

		expect(archived).toEqual({
			success: false,
			message: "No active pond is assigned to this account.",
		});
		expect(unassigned).toEqual(archived);
		expect(mocks.setPondStatus).not.toHaveBeenCalled();
		expect(mocks.unassignDevice).not.toHaveBeenCalled();
	});
});

describe("member and device credential actions", () => {
	it("admin.revoke_member -> revokeMember and surfaces the hierarchy refusal", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.revoke_member"].execute(
			{ userId: "member-1", memberName: "Ana" },
			ctx,
		);
		expect(mocks.revokeMember).toHaveBeenCalledWith("member-1");
		expect(result).toEqual({
			success: true,
			message: "Member removed from the organization.",
		});

		mocks.revokeMember.mockResolvedValueOnce({
			error: "The last owner cannot be demoted or removed. Promote another owner first.",
		});
		await expect(
			ASSISTANT_ACTION_DEFINITIONS["admin.revoke_member"].execute({ userId: "member-1" }, ctx),
		).resolves.toEqual({
			success: false,
			message: "The last owner cannot be demoted or removed. Promote another owner first.",
		});
	});

	it("admin.reveal_device_token -> revealDeviceToken and returns the credential", async () => {
		const result = await ASSISTANT_ACTION_DEFINITIONS["admin.reveal_device_token"].execute(
			{ deviceId: "device-1" },
			ctx,
		);
		expect(mocks.revealDeviceToken).toHaveBeenCalledWith("device-1");
		expect(result.success).toBe(true);
		expect(result.message).toContain("tok-123");
		expect(result.message).toContain("AA:BB:CC:DD:EE:FF");
	});

	it("rotate/remote feed/pause call the platform device actions", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.rotate_device_token"].execute(
			{ deviceId: "device-1", reason },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.remote_feed"].execute(
			{ deviceId: "device-1", grams: 120, reason },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.pause_device"].execute(
			{ deviceId: "device-1", isPaused: true, reason },
			ctx,
		);

		expect(mocks.rotateDeviceToken).toHaveBeenCalledWith({
			deviceId: "device-1",
			reason,
		});
		expect(mocks.remoteFeedDevice).toHaveBeenCalledWith({
			deviceId: "device-1",
			grams: 120,
			reason,
		});
		expect(mocks.remoteSetDevicePause).toHaveBeenCalledWith({
			deviceId: "device-1",
			isPaused: true,
			reason,
		});
	});

	it("surfaces feed_refused and pause_refused instead of hiding them", async () => {
		mocks.remoteFeedDevice.mockResolvedValueOnce({
			success: false,
			code: "feed_refused",
			error: "The device is offline.",
		});
		mocks.remoteSetDevicePause.mockResolvedValueOnce({
			success: false,
			code: "pause_refused",
			error: "The pond is fallow.",
		});

		await expect(
			ASSISTANT_ACTION_DEFINITIONS["superadmin.remote_feed"].execute(
				{ deviceId: "device-1", grams: 120, reason },
				ctx,
			),
		).resolves.toEqual({ success: false, message: "The device is offline." });
		await expect(
			ASSISTANT_ACTION_DEFINITIONS["superadmin.pause_device"].execute(
				{ deviceId: "device-1", isPaused: false, reason },
				ctx,
			),
		).resolves.toEqual({ success: false, message: "The pond is fallow." });
	});
});

describe("platform user and organization actions", () => {
	it("disable requires the typed login id and calls disablePlatformUser", async () => {
		const denied = await ASSISTANT_ACTION_DEFINITIONS["superadmin.disable_user"].schema.safeParse({
			userId: "user-2",
			confirmFarmId: "",
			reason,
		});
		expect(denied.success).toBe(false);

		const result = await ASSISTANT_ACTION_DEFINITIONS["superadmin.disable_user"].execute(
			{ userId: "user-2", confirmFarmId: "farm-2", reason },
			ctx,
		);
		expect(mocks.disablePlatformUser).toHaveBeenCalledWith("user-2", reason, "farm-2");
		expect(result).toEqual({ success: true, message: "User disabled." });
	});

	it("enable, grant, revoke and stop-view-as call their actions", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.enable_user"].execute(
			{ userId: "user-2", reason },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.grant_platform_admin"].execute(
			{ userId: "user-2", reason, expiresAt: "2026-12-31T00:00:00Z" },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.revoke_platform_admin"].execute(
			{ userId: "user-2", reason },
			ctx,
		);
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.stop_view_as"].execute({}, ctx);

		expect(mocks.enablePlatformUser).toHaveBeenCalledWith("user-2", reason);
		expect(mocks.grantPlatformAdmin).toHaveBeenCalledWith("user-2", reason, "2026-12-31T00:00:00Z");
		expect(mocks.revokePlatformAdmin).toHaveBeenCalledWith("user-2", reason);
		expect(mocks.stopViewAs).toHaveBeenCalled();
	});

	it("create org calls createOrg and propagates its refusal", async () => {
		await ASSISTANT_ACTION_DEFINITIONS["superadmin.create_org"].execute(
			{ name: "Org B", type: "COOPERATIVE", reason },
			ctx,
		);
		expect(mocks.createOrg).toHaveBeenCalledWith({
			name: "Org B",
			type: "COOPERATIVE",
			reason,
		});

		mocks.createOrg.mockResolvedValueOnce({ error: "Organization name is required." });
		await expect(
			ASSISTANT_ACTION_DEFINITIONS["superadmin.create_org"].execute({ name: "Org B", reason }, ctx),
		).resolves.toEqual({ success: false, message: "Organization name is required." });
	});
});

describe("the guard matrix matches the UI", () => {
	it("registers exactly one definition for every declared tool id", () => {
		expect(Object.keys(ASSISTANT_ACTION_DEFINITIONS).sort()).toEqual(
			[...ASSISTANT_TOOL_IDS].sort(),
		);
	});

	const GUARDS: Array<
		[AssistantToolId, Partial<(typeof ASSISTANT_ACTION_DEFINITIONS)[AssistantToolId]>]
	> = [
		["superadmin.rotate_device_token", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.remote_feed", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.pause_device", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.disable_user", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.enable_user", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.grant_platform_admin", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.revoke_platform_admin", { platformAdminOnly: true, requiresStepUp: true }],
		["superadmin.stop_view_as", { platformAdminOnly: true, requiresStepUp: false }],
		["superadmin.create_org", { platformAdminOnly: true, requiresStepUp: false }],
		[
			"admin.revoke_member",
			{
				tenantAdminOnly: true,
				permission: "manage_members",
				requiresStepUp: false,
			},
		],
		["admin.reveal_device_token", { tenantAdminOnly: true, requiresStepUp: false }],
		[
			"ponds.delete",
			{
				tenantAdminOnly: true,
				permission: "manage_farms_ponds",
				requiresStepUp: true,
			},
		],
		[
			"ponds.archive",
			{
				tenantAdminOnly: true,
				permission: "manage_farms_ponds",
				requiresStepUp: false,
			},
		],
		["records.update_calendar_item", { permission: "manage_crop_cycle", requiresStepUp: false }],
		["records.delete_calendar_item", { permission: "manage_crop_cycle", requiresStepUp: false }],
		["records.update_biomass", { requiresStepUp: false }],
		["records.delete_biomass", { requiresStepUp: false }],
	];

	it.each(GUARDS)("%s declares the same guards as the UI", (toolId, expected) => {
		expect(ASSISTANT_ACTION_DEFINITIONS[toolId]).toMatchObject(expected);
	});

	it("offers the new tenant writes only to a permitted tenant admin", () => {
		const admin = caller({
			isTenantAdmin: true,
			permissions: new Set(["manage_members", "manage_farms_ponds", "manage_crop_cycle"]),
		});
		const ids = availableToolIds(admin);

		expect(ids).toContain("admin.revoke_member");
		expect(ids).toContain("ponds.delete");
		expect(ids).toContain("records.delete_calendar_item");
		expect(ids).not.toContain("superadmin.rotate_device_token");

		const operator = availableToolIds(
			caller({
				role: "farmer",
				isTenantAdmin: false,
				permissions: new Set(["manage_schedule", "manage_crop_cycle"]),
			}),
		);
		expect(operator).not.toContain("admin.revoke_member");
		expect(operator).not.toContain("ponds.delete");
		expect(operator).toContain("records.delete_calendar_item");
	});

	it("offers platform-only writes only to a platform admin", () => {
		const platform = availableToolIds(
			caller({
				role: "superadmin",
				isPlatformAdmin: true,
				isTenantAdmin: false,
				permissions: new Set(),
			}),
		);
		expect(platform).toContain("superadmin.rotate_device_token");
		expect(platform).toContain("superadmin.disable_user");

		const owner = availableToolIds(
			caller({
				isTenantAdmin: true,
				permissions: new Set(["manage_members", "manage_farms_ponds"]),
			}),
		);
		expect(owner).not.toContain("superadmin.rotate_device_token");
		expect(owner).not.toContain("superadmin.disable_user");
	});
});

describe("the proposal card names the change for the newly exposed writes", () => {
	const POND = {
		pondName: "Pond A",
		orgName: "Org A",
		deviceLabel: "Feeder A",
		currentGrams: 120,
		currentFeedsPerDay: 3,
		currentRatePct: 2.5,
	};
	const NO_POND = {
		pondName: null,
		orgName: null,
		deviceLabel: null,
		currentGrams: null,
		currentFeedsPerDay: null,
		currentRatePct: null,
	};

	it("records.update_biomass states the corrected average and sample size", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.update_biomass"].describe(
			{ logId: "log-1", avgWeightG: 150, sampleCount: 12 },
			POND,
		);

		expect(card.summary).toBe("Correct the biomass sample to 150 g average across 12 fish.");
		expect(card.fields).toEqual([
			{ label: "Sample", value: "log-1" },
			{ label: "Average weight", value: "150 g/fish" },
			{ label: "Sample size", value: "12 fish" },
		]);
	});

	it("records.delete_biomass names the date when it has one", () => {
		const dated = ASSISTANT_ACTION_DEFINITIONS["records.delete_biomass"].describe(
			{ logId: "log-1", sampleDate: "2026-10-01" },
			POND,
		);
		expect(dated.summary).toBe(
			"Delete the biomass sample from 2026-10-01. This removes it from the feeding plan history.",
		);
		expect(dated.fields).toEqual([
			{ label: "Sample", value: "log-1" },
			{ label: "Date", value: "2026-10-01" },
		]);

		const undated = ASSISTANT_ACTION_DEFINITIONS["records.delete_biomass"].describe(
			{ logId: "log-1" },
			POND,
		);
		expect(undated.summary).toBe(
			"Delete the biomass sample. This removes it from the feeding plan history.",
		);
		expect(undated.fields).toEqual([
			{ label: "Sample", value: "log-1" },
			{ label: "Date", value: "as logged" },
		]);
	});

	it("records.update_calendar_item quotes the new title and time, or says unchanged", () => {
		const changed = ASSISTANT_ACTION_DEFINITIONS["records.update_calendar_item"].describe(
			{ eventId: "event-1", title: "Clean the net", startsAt: "2026-10-30" },
			POND,
		);
		expect(changed.summary).toBe(
			'Change the calendar item on Pond A to "Clean the net" at 2026-10-30.',
		);
		expect(changed.fields).toEqual([
			{ label: "Item", value: "event-1" },
			{ label: "Title", value: "Clean the net" },
			{ label: "When", value: "2026-10-30" },
		]);

		const untouched = ASSISTANT_ACTION_DEFINITIONS["records.update_calendar_item"].describe(
			{ eventId: "event-1" },
			NO_POND,
		);
		expect(untouched.summary).toBe("Change the calendar item on the active pond.");
		expect(untouched.fields).toEqual([
			{ label: "Item", value: "event-1" },
			{ label: "Title", value: "unchanged" },
			{ label: "When", value: "unchanged" },
		]);
	});

	it("records.delete_calendar_item distinguishes one occurrence from the whole item", () => {
		const occurrence = "2026-10-30T08:00:00+08:00";
		const single = ASSISTANT_ACTION_DEFINITIONS["records.delete_calendar_item"].describe(
			{ eventId: "event-1", occurrence },
			POND,
		);
		expect(single.summary).toBe(`Delete the calendar item on Pond A for ${occurrence}.`);
		expect(single.fields).toEqual([
			{ label: "Item", value: "event-1" },
			{ label: "Occurrence", value: occurrence },
		]);

		const whole = ASSISTANT_ACTION_DEFINITIONS["records.delete_calendar_item"].describe(
			{ eventId: "event-1" },
			POND,
		);
		expect(whole.summary).toBe("Delete the calendar item on Pond A.");
		expect(whole.fields).toEqual([
			{ label: "Item", value: "event-1" },
			{ label: "Occurrence", value: "the whole item" },
		]);
	});

	it("records.reopen_task names the pond and the task", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["records.reopen_task"].describe(
			{ eventId: "event-1" },
			POND,
		);
		expect(card.summary).toBe("Reopen the task on Pond A.");
		expect(card.fields).toEqual([{ label: "Task", value: "event-1" }]);
	});

	it("ponds.archive uses the name the caller gave, the id, or the active pond", () => {
		const named = ASSISTANT_ACTION_DEFINITIONS["ponds.archive"].describe(
			{ pondId: "pond-2", pondName: "Pond B" },
			POND,
		);
		expect(named.summary).toBe(
			"Archive Pond B. It disappears from the farmer's pond selector; nothing is deleted.",
		);
		expect(named.fields).toEqual([{ label: "Pond", value: "Pond B" }]);

		const byId = ASSISTANT_ACTION_DEFINITIONS["ponds.archive"].describe({ pondId: "pond-2" }, POND);
		expect(byId.fields).toEqual([{ label: "Pond", value: "the selected pond" }]);

		const active = ASSISTANT_ACTION_DEFINITIONS["ponds.archive"].describe({}, POND);
		expect(active.fields).toEqual([{ label: "Pond", value: "Pond A" }]);
		expect(active.summary).toContain("Archive Pond A.");

		const unknown = ASSISTANT_ACTION_DEFINITIONS["ponds.archive"].describe({}, NO_POND);
		expect(unknown.fields).toEqual([{ label: "Pond", value: "Active pond" }]);
		expect(unknown.summary).toContain("Archive Active pond.");
	});

	it("ponds.restore describes the pond that comes back", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["ponds.restore"].describe(
			{ pondId: "pond-2", pondName: "Pond B" },
			POND,
		);
		expect(card.summary).toBe("Restore Pond B so the farmer can use it again.");
		expect(card.fields).toEqual([{ label: "Pond", value: "Pond B" }]);
	});

	it("ponds.delete repeats the typed confirmation on the card", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["ponds.delete"].describe(
			{ pondId: "pond-2", confirmName: "Pond B" },
			POND,
		);
		expect(card.summary).toBe(
			"Permanently delete the empty pond the selected pond. This cannot be undone.",
		);
		expect(card.fields).toEqual([
			{ label: "Pond", value: "the selected pond" },
			{ label: "Confirm", value: "Pond B" },
		]);
	});

	it("ponds.move_device names both ends of the move, falling back to the named id", () => {
		const labelled = ASSISTANT_ACTION_DEFINITIONS["ponds.move_device"].describe(
			{ deviceLabel: "Feeder A", targetPondId: "pond-2", targetPondName: "Pond B" },
			POND,
		);
		expect(labelled.summary).toBe("Move Feeder A to Pond B.");
		expect(labelled.fields).toEqual([
			{ label: "Feeder", value: "Feeder A" },
			{ label: "Target", value: "Pond B" },
		]);

		const unnamed = ASSISTANT_ACTION_DEFINITIONS["ponds.move_device"].describe(
			{ targetPondId: "pond-2" },
			POND,
		);
		expect(unnamed.summary).toBe("Move the active feeder to the selected pond.");
		expect(unnamed.fields).toEqual([
			{ label: "Feeder", value: "Active feeder" },
			{ label: "Target", value: "pond-2" },
		]);
	});

	it("ponds.unassign_device names the feeder or says the active one", () => {
		const named = ASSISTANT_ACTION_DEFINITIONS["ponds.unassign_device"].describe(
			{ deviceId: "device-1", deviceLabel: "Feeder A" },
			POND,
		);
		expect(named.summary).toBe("Detach Feeder A from its pond. It will stop receiving a schedule.");
		expect(named.fields).toEqual([{ label: "Feeder", value: "Feeder A" }]);

		const unnamed = ASSISTANT_ACTION_DEFINITIONS["ponds.unassign_device"].describe(
			{ deviceId: "device-1" },
			POND,
		);
		expect(unnamed.summary).toBe(
			"Detach the active feeder from its pond. It will stop receiving a schedule.",
		);
		expect(unnamed.fields).toEqual([{ label: "Feeder", value: "Active feeder" }]);
	});

	it("admin.revoke_member names the member, or falls back to the id", () => {
		const named = ASSISTANT_ACTION_DEFINITIONS["admin.revoke_member"].describe(
			{ userId: "member-1", memberName: "Ana" },
			POND,
		);
		expect(named.summary).toBe(
			"Remove Ana from the organization. Their account stays, but they lose access.",
		);
		expect(named.fields).toEqual([{ label: "Member", value: "Ana" }]);

		const unnamed = ASSISTANT_ACTION_DEFINITIONS["admin.revoke_member"].describe(
			{ userId: "member-1" },
			POND,
		);
		expect(unnamed.summary).toBe(
			"Remove the member from the organization. Their account stays, but they lose access.",
		);
		expect(unnamed.fields).toEqual([{ label: "Member", value: "member-1" }]);
	});

	it("admin.reveal_device_token warns that the token is a credential", () => {
		const named = ASSISTANT_ACTION_DEFINITIONS["admin.reveal_device_token"].describe(
			{ deviceId: "device-1", deviceLabel: "Feeder A" },
			POND,
		);
		expect(named.summary).toContain("Show the provisioning token for Feeder A.");
		expect(named.summary).toContain("counted against the hourly limit");
		expect(named.fields).toEqual([{ label: "Feeder", value: "Feeder A" }]);

		const unnamed = ASSISTANT_ACTION_DEFINITIONS["admin.reveal_device_token"].describe(
			{ deviceId: "device-1" },
			POND,
		);
		expect(unnamed.summary).toContain("Show the provisioning token for the active feeder.");
		expect(unnamed.fields).toEqual([{ label: "Feeder", value: "Active feeder" }]);
	});

	it("superadmin.stop_view_as explains that it ends the session", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["superadmin.stop_view_as"].describe({}, POND);
		expect(card.summary).toBe(
			"End the current read-only view-as session and return to the platform console.",
		);
		expect(card.fields).toEqual([]);
	});

	it("superadmin.rotate_device_token names the feeder and the reason", () => {
		const named = ASSISTANT_ACTION_DEFINITIONS["superadmin.rotate_device_token"].describe(
			{ deviceId: "device-1", deviceLabel: "Feeder A", reason },
			POND,
		);
		expect(named.summary).toBe(
			`Rotate the token for Feeder A. The old credential stops working at once. Reason: ${reason}`,
		);
		expect(named.fields).toEqual([
			{ label: "Feeder", value: "Feeder A" },
			{ label: "Reason", value: reason },
		]);

		const unnamed = ASSISTANT_ACTION_DEFINITIONS["superadmin.rotate_device_token"].describe(
			{ deviceId: "device-1", reason },
			POND,
		);
		expect(unnamed.summary).toContain("Rotate the token for the selected feeder.");
		expect(unnamed.fields).toEqual([
			{ label: "Feeder", value: "device-1" },
			{ label: "Reason", value: reason },
		]);
	});

	it("superadmin.remote_feed states the dose and the offline limits still apply", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["superadmin.remote_feed"].describe(
			{ deviceId: "device-1", deviceLabel: "Feeder A", grams: 120, reason },
			POND,
		);
		expect(card.summary).toBe(
			`Dispense 120 g now on Feeder A. The device caps and offline rules still apply. Reason: ${reason}`,
		);
		expect(card.fields).toEqual([
			{ label: "Feeder", value: "Feeder A" },
			{ label: "Dose", value: "120 g" },
			{ label: "Reason", value: reason },
		]);
	});

	it("superadmin.pause_device changes its verb with the requested state", () => {
		const pause = ASSISTANT_ACTION_DEFINITIONS["superadmin.pause_device"].describe(
			{ deviceId: "device-1", deviceLabel: "Feeder A", isPaused: true, reason },
			POND,
		);
		expect(pause.summary).toBe(`Pause automatic feeding on Feeder A. Reason: ${reason}`);
		expect(pause.fields).toContainEqual({ label: "Action", value: "Pause" });

		const resume = ASSISTANT_ACTION_DEFINITIONS["superadmin.pause_device"].describe(
			{ deviceId: "device-1", isPaused: false, reason },
			POND,
		);
		expect(resume.summary).toBe(
			`Resume automatic feeding on the selected feeder. Reason: ${reason}`,
		);
		expect(resume.fields).toContainEqual({ label: "Action", value: "Resume" });
	});

	it("superadmin.disable_user names the account the admin must confirm", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["superadmin.disable_user"].describe(
			{ userId: "user-2", confirmFarmId: "farm-2", reason },
			POND,
		);
		expect(card.summary).toBe(
			`Disable farm-2. The login is banned and every membership and platform grant is revoked; nothing is deleted. Reason: ${reason}`,
		);
		expect(card.fields).toEqual([
			{ label: "Account", value: "farm-2" },
			{ label: "Reason", value: reason },
		]);
	});

	it("superadmin.enable_user states what is restored", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["superadmin.enable_user"].describe(
			{ userId: "user-2", reason },
			POND,
		);
		expect(card.summary).toBe(
			`Enable user user-2 again and restore the memberships and grant recorded at disable time. Reason: ${reason}`,
		);
		expect(card.fields).toEqual([
			{ label: "User", value: "user-2" },
			{ label: "Reason", value: reason },
		]);
	});

	it("superadmin.grant_platform_admin shows the expiry, or that there is none", () => {
		const expiring = ASSISTANT_ACTION_DEFINITIONS["superadmin.grant_platform_admin"].describe(
			{ userId: "user-2", reason, expiresAt: "2026-12-31T00:00:00Z" },
			POND,
		);
		expect(expiring.summary).toBe(
			`Grant platform admin to user-2 until 2026-12-31T00:00:00Z. Reason: ${reason}`,
		);
		expect(expiring.fields).toContainEqual({
			label: "Expires",
			value: "2026-12-31T00:00:00Z",
		});

		const permanent = ASSISTANT_ACTION_DEFINITIONS["superadmin.grant_platform_admin"].describe(
			{ userId: "user-2", reason },
			POND,
		);
		expect(permanent.summary).toBe(`Grant platform admin to user-2. Reason: ${reason}`);
		expect(permanent.fields).toContainEqual({ label: "Expires", value: "no expiry" });
	});

	it("superadmin.revoke_platform_admin names the user and the reason", () => {
		const card = ASSISTANT_ACTION_DEFINITIONS["superadmin.revoke_platform_admin"].describe(
			{ userId: "user-2", reason },
			POND,
		);
		expect(card.summary).toBe(`Revoke platform admin from user-2. Reason: ${reason}`);
		expect(card.fields).toEqual([
			{ label: "User", value: "user-2" },
			{ label: "Reason", value: reason },
		]);
	});

	it("superadmin.create_org shows the type, defaulting to INDIVIDUAL", () => {
		const typed = ASSISTANT_ACTION_DEFINITIONS["superadmin.create_org"].describe(
			{ name: "Org B", type: "COOPERATIVE", reason },
			POND,
		);
		expect(typed.summary).toBe(`Create the organization "Org B" (COOPERATIVE). Reason: ${reason}`);
		expect(typed.fields).toEqual([
			{ label: "Name", value: "Org B" },
			{ label: "Type", value: "COOPERATIVE" },
			{ label: "Reason", value: reason },
		]);

		const untyped = ASSISTANT_ACTION_DEFINITIONS["superadmin.create_org"].describe(
			{ name: "Org B", reason },
			POND,
		);
		expect(untyped.summary).toBe(`Create the organization "Org B" (INDIVIDUAL). Reason: ${reason}`);
		expect(untyped.fields).toContainEqual({ label: "Type", value: "INDIVIDUAL" });
	});
});
