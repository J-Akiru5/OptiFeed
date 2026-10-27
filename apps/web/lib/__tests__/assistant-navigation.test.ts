import { describe, expect, it } from "vitest";
import { matchNavigation, navigationEntries, resolveNavigation } from "../assistant/navigation";

describe("assistant navigation", () => {
	it("only offers destinations the role can open", () => {
		const farmer = navigationEntries("farmer", "en");
		expect(farmer.some((entry) => entry.route === "/dashboard/settings/hardware")).toBe(true);
		expect(farmer.some((entry) => entry.route.startsWith("/superadmin"))).toBe(false);

		const superadmin = navigationEntries("superadmin", "en");
		expect(superadmin.some((entry) => entry.route === "/superadmin/devices")).toBe(true);
		expect(superadmin.some((entry) => entry.route === "/dashboard/schedule")).toBe(false);
	});

	it("resolves a control on another page to both the route and the anchor", () => {
		const entry = resolveNavigation("item:settings:2", "owner", "en");
		expect(entry).toMatchObject({
			route: "/dashboard/settings/pond",
			target: "pond-settings-form",
		});
	});

	it("refuses an id that belongs to another role", () => {
		expect(resolveNavigation("section:superadmin.devices", "farmer", "en")).toBeNull();
	});

	it("matches a natural 'take me to' phrase to the calibration control", () => {
		const entry = matchNavigation("Take me to calibration", "owner", "en");
		expect(entry).toMatchObject({
			route: "/dashboard/settings/hardware",
			target: "calibration-form",
		});
	});
});
