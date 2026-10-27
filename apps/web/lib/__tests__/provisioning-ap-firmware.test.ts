import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AP_PREFIX, provisioningApSsid } from "@/lib/provisioning-ap";
import { describe, expect, it } from "vitest";

/**
 * The firmware cannot import a TypeScript constant, so the setup AP prefix is
 * declared twice. This keeps the two honest: a sticker QR or settings page
 * that names a network the unit does not broadcast is a silent field failure.
 */

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
const firmware = readFileSync(join(repoRoot, "firmware/firmware-main/firmware-main.ino"), "utf8");

describe("setup AP naming matches the firmware", () => {
	it("declares the same prefix as AP_PREFIX", () => {
		const match = firmware.match(/^#define\s+PROVISIONING_AP_PREFIX\s+"([^"]*)"/m);
		expect(match, "PROVISIONING_AP_PREFIX must be #define'd in firmware-main.ino").not.toBeNull();
		expect(match?.[1]).toBe(AP_PREFIX);
	});

	it("builds the SSID from that constant, not a string literal", () => {
		const fn = firmware.slice(firmware.indexOf("String provisioningApSsid()"));
		const body = fn.slice(0, fn.indexOf("\n}\n"));
		expect(body).toContain("PROVISIONING_AP_PREFIX");
		expect(body).not.toMatch(/"(PakaonAI|OptiFeed)-"/);
	});

	it("uses the same pad-and-truncate rule as the web derivation", () => {
		const fn = firmware.slice(firmware.indexOf("String provisioningApSsid()"));
		const body = fn.slice(0, fn.indexOf("\n}\n"));
		expect(body).toContain("isxdigit");
		expect(body).toContain("toupper");
		expect(body).toMatch(/while \(hex\.length\(\) < 4\) hex = String\("0"\) \+ hex;/);
		expect(body).toContain("hex.substring(hex.length() - 4)");
		expect(provisioningApSsid("A4:CF:12:7E:3B:09")).toBe("PakaonAI-3B09");
	});

	it("names the AP from a MAC Device ID, otherwise the chip eFuse MAC", () => {
		// Provisioned units broadcast the name of their registered Device ID, so
		// the AP matches the sticker. Until provisioning (or for a non-MAC
		// Device ID) the chip MAC keeps every unit's name distinct.
		const fn = firmware.slice(firmware.indexOf("String provisioningApSsid()"));
		const body = fn.slice(0, fn.indexOf("\n}\n"));
		expect(body).toContain("chipMacString()");
		expect(body).toContain("provisionedDeviceId");
		expect(body).toContain("macDeviceIdLastFour");

		const parser = firmware.slice(firmware.indexOf("bool macDeviceIdLastFour("));
		const parserBody = parser.slice(0, parser.indexOf("\n}\n"));
		expect(parserBody).toContain("hex.length() != 12");
		expect(parserBody).toContain("lastFour = hex.substring(8)");

		const mac = firmware.slice(firmware.indexOf("String chipMacString()"));
		const macBody = mac.slice(0, mac.indexOf("\n}\n"));
		expect(macBody).toContain("esp_read_mac(mac, ESP_MAC_WIFI_STA)");
		expect(macBody).toContain('"%02X:%02X:%02X:%02X:%02X:%02X"');
	});

	it("has no compile-time device identity fallback", () => {
		// A public repository must never bake a MAC or token into the image: an
		// unprovisioned unit would share public credentials and call the API.
		expect(firmware).not.toMatch(/^#define\s+DEVICE_MAC\b/m);
		expect(firmware).not.toMatch(/^#define\s+DEVICE_TOKEN\b/m);
		expect(firmware).toContain("[IDENTITY] not provisioned - API disabled");
	});

	it("gates every API caller on a provisioned identity", () => {
		// Ingest, feed-command, schedule-sync and the OTA check must all be
		// unreachable until the portal has stored both NVS keys.
		for (const signature of [
			"void sendTelemetry()",
			"void pollDashboardFeedCommand()",
			"void pollScheduleCommand()",
			"void flushQueuedEvents()",
			"void maybeCheckForUpdate()",
		]) {
			const start = firmware.indexOf(signature);
			expect(start, `${signature} must exist`).toBeGreaterThan(-1);
			const body = firmware.slice(start, firmware.indexOf("\n}\n", start));
			expect(body, `${signature} must check apiIdentityAvailable()`).toContain(
				"apiIdentityAvailable()",
			);
		}
	});

	it("prints the chip MAC at boot so it can be registered", () => {
		expect(firmware).toMatch(
			/Serial\.print\("\[DEVICE MAC\] "\);\s*Serial\.println\(chipMacString\(\)\);/,
		);
	});

	it("keeps the NVS namespace so stored credentials survive the rename", () => {
		expect(firmware).toContain('prefs.begin("optifeed", false);');
	});
});
