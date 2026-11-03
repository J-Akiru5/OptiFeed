import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	updateDeviceDailyCap: vi.fn(),
	deviceTarget: vi.fn(),
}));

vi.mock("../assistant/catalog/shared", () => ({
	deviceTarget: mocks.deviceTarget,
}));
vi.mock("@/lib/actions/settings", () => ({
	updateDeviceDailyCap: mocks.updateDeviceDailyCap,
}));

import { toolRefusal } from "../assistant/authorize";
import type { AssistantCaller } from "../assistant/caller";
import { settingsActions } from "../assistant/catalog/settings";
import {
	SETTING_DEFINITIONS,
	assistantSettingSchema,
	getSettingDefinition,
} from "../assistant/settings/registry";
import type { AssistantProposalContext } from "../assistant/types";

const context: AssistantProposalContext = {
	pondName: "Pond A",
	orgName: "Org A",
	deviceLabel: "Feeder A",
	currentGrams: 100,
	currentFeedsPerDay: 2,
	currentRatePct: 2,
	currentDailyCapG: 4000,
	deviceOnline: true,
};

const tool = settingsActions["settings.propose"];
if (!tool) throw new Error("settings.propose is not registered");

beforeEach(() => {
	vi.clearAllMocks();
	mocks.deviceTarget.mockResolvedValue({ ok: true, id: "device-1", label: "Feeder A" });
	mocks.updateDeviceDailyCap.mockResolvedValue({ success: true, dailyCapG: 4500 });
});

describe("the closed setting registry", () => {
	it("registers only the daily feed cap in Phase 1", () => {
		expect(Object.keys(SETTING_DEFINITIONS)).toEqual(["daily_feed_cap"]);
		expect(getSettingDefinition("daily_feed_cap")).not.toBeNull();
		expect(getSettingDefinition("org_name")).toBeNull();
		expect(getSettingDefinition("toString")).toBeNull();
	});

	it("rejects an unknown setting key or an out-of-range value", () => {
		expect(
			assistantSettingSchema.safeParse({ setting: "daily_feed_cap", value: 4500 }).success,
		).toBe(true);
		expect(
			assistantSettingSchema.safeParse({ setting: "daily_feed_cap", value: "4500" }).success,
		).toBe(true);
		expect(assistantSettingSchema.safeParse({ setting: "org_name", value: "Farm" }).success).toBe(
			false,
		);
		expect(assistantSettingSchema.safeParse({ setting: "daily_feed_cap", value: 0 }).success).toBe(
			false,
		);
		expect(
			assistantSettingSchema.safeParse({ setting: "daily_feed_cap", value: 1_000_000 }).success,
		).toBe(false);
	});

	it("names the setting, permission, scope and live-device rule", () => {
		const definition = getSettingDefinition("daily_feed_cap");
		expect(definition).toMatchObject({
			label: "Daily feed ceiling",
			scope: "pond",
			permission: "control_feeder",
			ownerOnly: false,
			requiresLiveDevice: false,
		});
	});
});

describe("daily feed cap proposals", () => {
	it("describes the old and new ceiling", () => {
		const card = getSettingDefinition("daily_feed_cap")?.describe(4500, context);
		expect(card?.summary).toContain("4000 g/day");
		expect(card?.summary).toContain("4500 g/day");
		expect(card?.summary).not.toContain("offline");
		expect(card?.fields).toEqual([
			{ label: "Setting", value: "Daily feed ceiling" },
			{ label: "From", value: "4000 g/day" },
			{ label: "To", value: "4500 g/day" },
		]);
	});

	it("adds one heads-up while the feeder is offline but still proposes", () => {
		const card = getSettingDefinition("daily_feed_cap")?.describe(4500, {
			...context,
			deviceOnline: false,
		});
		expect(card?.summary).toContain("4500 g/day");
		expect(card?.summary).toContain("offline");
	});

	it("executes through the real server action and confirms its value", async () => {
		const result = await getSettingDefinition("daily_feed_cap")?.execute(4500);

		expect(mocks.deviceTarget).toHaveBeenCalledWith({});
		expect(mocks.updateDeviceDailyCap).toHaveBeenCalledWith("device-1", 4500);
		expect(result).toEqual({
			success: true,
			message: "Daily feed ceiling is now 4500 g/day.",
		});
	});

	it("returns the action failure without inventing success", async () => {
		mocks.updateDeviceDailyCap.mockResolvedValue({ success: false, error: "Device not found" });

		const result = await getSettingDefinition("daily_feed_cap")?.execute(4500);

		expect(result).toEqual({ success: false, message: "Device not found" });
	});

	it("stops before the action when no feeder is linked", async () => {
		mocks.deviceTarget.mockResolvedValue({
			ok: false,
			result: { success: false, message: "No feeder is linked to this pond yet." },
		});

		const result = await getSettingDefinition("daily_feed_cap")?.execute(4500);

		expect(result).toEqual({
			success: false,
			message: "No feeder is linked to this pond yet.",
		});
		expect(mocks.updateDeviceDailyCap).not.toHaveBeenCalled();
	});
});

describe("settings.propose tool", () => {
	it("is offered to an operator with control_feeder and refused without it", () => {
		const operator: AssistantCaller = {
			userId: "user-1",
			role: "farmer",
			membershipRole: "OPERATOR",
			isOwner: false,
			permissions: new Set(["control_feeder"]),
			canWrite: true,
			isPlatformAdmin: false,
			isTenantAdmin: false,
			orgName: "Org A",
		};
		const payload = { setting: "daily_feed_cap", value: 4500 };

		expect(toolRefusal(tool, operator, payload)).toBeNull();

		const refusal = toolRefusal(tool, { ...operator, permissions: new Set() }, payload);
		expect(refusal).toContain('"control_feeder"');
		expect(refusal).toContain("an operator or above");
	});

	it("resolves the permission and owner rule from the registry", () => {
		expect(tool?.permission).toBe("control_feeder");
		expect(tool?.resolvePermission?.({ setting: "daily_feed_cap" })).toBe("control_feeder");
		expect(tool?.resolveOwnerOnly?.({ setting: "daily_feed_cap" })).toBe(false);
		expect(tool?.resolvePermission?.({ setting: "unknown" })).toBeNull();
	});

	it("validates the payload before it is stored", () => {
		expect(tool?.schema.safeParse({ setting: "daily_feed_cap", value: 4500 }).success).toBe(true);
		expect(tool?.schema.safeParse({ setting: "daily_feed_cap", value: -1 }).success).toBe(false);
	});

	it("delegates describe and execute to the registry entry", async () => {
		const card = tool?.describe({ setting: "daily_feed_cap", value: 4500 }, context);
		expect(card?.summary).toContain("4500 g/day");

		const result = await tool?.execute(
			{ setting: "daily_feed_cap", value: 4500 },
			{ userId: "user-1" },
		);
		expect(result?.message).toBe("Daily feed ceiling is now 4500 g/day.");
	});
});
