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

	it("keeps the NVS namespace so stored credentials survive the rename", () => {
		expect(firmware).toContain('prefs.begin("optifeed", false);');
	});
});
