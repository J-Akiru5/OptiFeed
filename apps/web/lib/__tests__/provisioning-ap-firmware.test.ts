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

/**
 * Setup portal 1.5.2 (issue #252). The portal is firmware-only, so these are
 * static contracts: a scan that cannot start must not be reported as "no
 * networks", and a submitted network must be proven before it is saved.
 */
describe("setup portal scan and test-before-save", () => {
	function bodyOf(signature: string) {
		const start = firmware.indexOf(signature);
		expect(start, `${signature} must exist`).toBeGreaterThan(-1);
		return firmware.slice(start, firmware.indexOf("\n}\n", start));
	}

	it("serves the status and rescan endpoints", () => {
		for (const route of [
			'provisioningServer.on("/status", HTTP_GET, handleProvisioningStatus);',
			'provisioningServer.on("/scan", HTTP_GET, handleProvisioningScanGet);',
			'provisioningServer.on("/scan", HTTP_POST, handleProvisioningScanPost);',
		]) {
			expect(firmware).toContain(route);
		}
	});

	it("scans asynchronously and polls scanComplete from loop()", () => {
		const start = bodyOf("void startAsyncWiFiScan(bool userInitiated)");
		expect(start).toContain("WiFi.scanNetworks(true");
		expect(start).toContain("provisioningScanState = PROV_SCAN_RUNNING");

		const service = bodyOf("void serviceProvisioningScan()");
		expect(service).toContain("WiFi.scanComplete()");
		expect(service).toContain("PROV_SCAN_RETRY_WAIT");
	});

	it("settles the station and sets AP_STA before scanning", () => {
		const settle = bodyOf("void settleStationForScan()");
		expect(settle).toContain("WiFi.setAutoReconnect(false)");
		expect(settle).toContain("WiFi.disconnect(false, false)");
		expect(settle.indexOf("WiFi.disconnect") < settle.indexOf("WiFi.mode(WIFI_AP_STA)")).toBe(true);

		const portal = bodyOf("void startProvisioningPortal()");
		expect(portal.indexOf("WIFI_AP_STA") < portal.indexOf("startAsyncWiFiScan")).toBe(true);
	});

	it("logs the real scan result and retries an empty scan once", () => {
		expect(firmware).toContain('Serial.printf("[PROV] WiFi scan could not start (%d)\\n"');
		expect(firmware).toContain("retrying once in %lu ms");
		expect(firmware).toMatch(/#define PROVISIONING_SCAN_RETRY_MS\s+2000UL/);
		expect(firmware).toContain("No Wi-Fi networks found. Check that the antenna is ");
		expect(firmware).toContain("move closer to the router (2.4 GHz only), then tap ");
		expect(firmware).toContain("Rescan.");

		// Exactly one automatic retry: the second empty or failed attempt stops.
		const finish = bodyOf("void finishScanAttempt(int count, bool failed) {");
		expect(finish).toContain("if (!provisioningScanRetried)");
		expect(finish).toContain("provisioningScanRetried = true;");
	});

	it("tests a submitted network before saving it", () => {
		const save = bodyOf("void handleProvisioningSave()");
		expect(save).toContain("startProvisioningJoin(");
		expect(save).not.toContain("saveWiFiCredentials(");
		expect(save).not.toContain("ESP.restart()");

		const joined = bodyOf("void provisioningJoinSucceeded()");
		expect(joined).toContain("saveWiFiCredentials(");
		expect(joined).toContain("saveDeviceIdentity(");

		// A failure must clear the password and never write NVS.
		const failed = bodyOf("void failProvisioningJoin(const String &detail)");
		expect(failed).toContain('provisioningPendingPass = "";');
		expect(failed).not.toContain("saveWiFiCredentials(");
		expect(failed).not.toContain("saveDeviceIdentity(");
	});

	it("keeps passwords and tokens out of the JSON endpoints", () => {
		for (const signature of [
			"void handleProvisioningStatus()",
			"void handleProvisioningScanGet()",
		]) {
			const body = bodyOf(signature);
			expect(body).not.toContain("provisioningPendingPass");
			expect(body).not.toContain("provisioningPendingDeviceToken");
			expect(body).not.toContain("device_token");
		}
	});

	it("carries the PakaonAI brand and the reported firmware version", () => {
		expect(firmware).toContain('#define FW_VERSION "1.6.0"');
		expect(firmware).toContain("#0A3D62");
		expect(firmware).toContain("#E8722C");
		expect(firmware).toContain("Sakto nga pakaon, sakto nga oras.");
		expect(firmware).toContain('class=\\"word\\">Pakaon<span class=\\"ai\\">AI</span>');
	});
});
