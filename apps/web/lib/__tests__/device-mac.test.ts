import { canonicalMac } from "@/lib/device-mac";
import { provisioningApSsid } from "@/lib/provisioning-ap";
import { describe, expect, it } from "vitest";

describe("canonicalMac", () => {
	it("returns six uppercase pairs joined by colons", () => {
		expect(canonicalMac("A4:CF:12:7E:3B:09")).toBe("A4:CF:12:7E:3B:09");
		expect(canonicalMac("a4:cf:12:7e:3b:09")).toBe("A4:CF:12:7E:3B:09");
	});

	it("accepts common separators and none", () => {
		expect(canonicalMac("a4-cf-12-7e-3b-09")).toBe("A4:CF:12:7E:3B:09");
		expect(canonicalMac("a4cf.127e.3b09")).toBe("A4:CF:12:7E:3B:09");
		expect(canonicalMac("A4CF127E3B09")).toBe("A4:CF:12:7E:3B:09");
		expect(canonicalMac("  A4 CF 12 7E 3B 09  ")).toBe("A4:CF:12:7E:3B:09");
	});

	it("rejects anything that is not exactly 12 hex digits", () => {
		expect(canonicalMac("")).toBeNull();
		expect(canonicalMac("A4:CF:12:7E:3B")).toBeNull();
		expect(canonicalMac("A4:CF:12:7E:3B:09:00")).toBeNull();
		expect(canonicalMac("G4:CF:12:7E:3B:09")).toBeNull();
		expect(canonicalMac("A4:CF:12:7E:3B:09; drop")).toBeNull();
		expect(canonicalMac("YOUR_DEVICE_ID")).toBeNull();
	});

	it("gives the same setup SSID as the raw input", () => {
		const raw = "a4-cf-12-7e-3b-09";
		expect(provisioningApSsid(canonicalMac(raw) ?? "")).toBe(provisioningApSsid(raw));
	});
});
