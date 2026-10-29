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
import type { AssistantToolId } from "../assistant/types";

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
