import {
	DEVICE_SETTINGS_ANCHOR_TABS,
	DEVICE_SETTINGS_TABS,
	deviceSettingsHref,
	deviceSettingsQuery,
	parseDeviceSettingsTab,
	resolveSelectedDevice,
	tabForAnchor,
} from "@/lib/settings/device-settings-tabs";
import { describe, expect, it } from "vitest";

describe("device settings tabs (#403)", () => {
	it("parses a known tab and falls back to overview otherwise", () => {
		expect(parseDeviceSettingsTab("network")).toBe("network");
		expect(parseDeviceSettingsTab(undefined)).toBe("overview");
		expect(parseDeviceSettingsTab("danger")).toBe("overview");
	});

	it("maps every pre-tab anchor to a real tab", () => {
		for (const tab of Object.values(DEVICE_SETTINGS_ANCHOR_TABS)) {
			expect(DEVICE_SETTINGS_TABS).toContain(tab);
		}
		expect(tabForAnchor("#daily-ceiling")).toBe("feeding");
		expect(tabForAnchor("hopper-calibration")).toBe("calibration");
		expect(tabForAnchor("#nope")).toBeNull();
		expect(tabForAnchor("")).toBeNull();
	});

	it("leaves the default tab and a missing device out of the link", () => {
		expect(deviceSettingsHref({})).toBe("/dashboard/settings/hardware");
		expect(deviceSettingsHref({ tab: "overview" })).toBe("/dashboard/settings/hardware");
		expect(deviceSettingsHref({ deviceId: "d2", tab: "network" })).toBe(
			"/dashboard/settings/hardware?device=d2&tab=network",
		);
		expect(deviceSettingsHref({ tab: "feeding", anchor: "daily-ceiling" })).toBe(
			"/dashboard/settings/hardware?tab=feeding#daily-ceiling",
		);
		expect(deviceSettingsQuery({ deviceId: null, tab: "calibration" })).toEqual({
			tab: "calibration",
		});
	});
});

describe("resolveSelectedDevice", () => {
	const devices = [
		{ id: "a1", pondId: "pond-a" },
		{ id: "b1", pondId: "pond-b" },
		{ id: "b2", pondId: "pond-b" },
	];

	it("honours a requested device from the caller's own list", () => {
		expect(resolveSelectedDevice(devices, "b2", "pond-a")?.id).toBe("b2");
	});

	it("never selects a device outside the list", () => {
		expect(resolveSelectedDevice(devices, "foreign", "pond-b")?.id).toBe("b1");
	});

	it("falls back to the active pond's first feeder, then any feeder", () => {
		expect(resolveSelectedDevice(devices, undefined, "pond-b")?.id).toBe("b1");
		expect(resolveSelectedDevice(devices, undefined, "pond-empty")?.id).toBe("a1");
		expect(resolveSelectedDevice(devices, undefined, null)?.id).toBe("a1");
	});

	it("returns null when there are no feeders", () => {
		expect(resolveSelectedDevice([], "a1", "pond-a")).toBeNull();
	});
});
