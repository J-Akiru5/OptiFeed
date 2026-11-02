import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the relay hardware variant (issue #582).
 *
 * A firmware image built for GPIO 25 boots, heartbeats and reports feeds on a
 * unit wired for GPIO 5 while never closing the relay. These assertions keep
 * the build environment, the compiled pin, the signed manifest and the device
 * refusal tied to one variant map. They complement the host tests in
 * firmware/test/test_firmware_variant and the route tests in
 * firmware-check.test.ts; they do not replace a real firmware compile.
 */

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
const platformio = readFileSync(join(repoRoot, "firmware", "platformio.ini"), "utf8");
const firmware = readFileSync(
	join(repoRoot, "firmware", "firmware-main", "firmware-main.ino"),
	"utf8",
);
const hardware = readFileSync(join(repoRoot, "firmware", "firmware-main", "hardware.h"), "utf8");
const signRelease = readFileSync(join(repoRoot, "scripts", "ota", "sign-release.mjs"), "utf8");

const VARIANTS = [
	{ env: "esp32dev-gpio5", variant: "gpio5", relayGpio: 5 },
	{ env: "esp32dev-gpio25", variant: "gpio25", relayGpio: 25 },
] as const;

function envBody(name: string): string {
	const match = new RegExp(`\\[env:${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(platformio);
	expect(match, `[env:${name}] must exist`).not.toBeNull();
	return match?.[1] ?? "";
}

function declaredVariantFlags(name: string): { relayGpio: number; variant: string } {
	const body = envBody(name);
	const pin = /-DRELAY_PIN=(\d+)/.exec(body);
	const variant = /-DFW_HW_VARIANT=\\?"([^"\\]+)\\?"/.exec(body);
	expect(pin, `[env:${name}] must set -DRELAY_PIN explicitly`).not.toBeNull();
	expect(variant, `[env:${name}] must set -DFW_HW_VARIANT explicitly`).not.toBeNull();
	return { relayGpio: Number(pin?.[1]), variant: variant?.[1] ?? "" };
}

describe("firmware hardware variants (#582)", () => {
	it("has no unqualified esp32dev environment", () => {
		expect(platformio).not.toMatch(/^\[env:esp32dev\]$/m);
		expect(platformio).toMatch(/^default_envs\s*=\s*esp32dev-gpio25$/m);
	});

	it.each(VARIANTS)("$env declares $variant and relay GPIO $relayGpio", (expected) => {
		expect(declaredVariantFlags(expected.env)).toEqual({
			relayGpio: expected.relayGpio,
			variant: expected.variant,
		});
	});

	it("refuses to compile without an explicit variant and pin", () => {
		expect(firmware).toContain('#error "RELAY_PIN is required');
		expect(firmware).toContain('#error "FW_HW_VARIANT is required');
		expect(firmware).toContain("static_assert(fw::relayPinForVariant(FW_HW_VARIANT) == RELAY_PIN");
	});

	it("maps every declared variant to exactly one relay pin", () => {
		expect(hardware).toContain('sameVariantName(variant, "gpio5") ? 5');
		expect(hardware).toContain('sameVariantName(variant, "gpio25") ? 25');
		expect(hardware).toContain("otaMatchesHardware");
	});

	it("refuses a signed manifest whose variant or relay pin differs", () => {
		expect(firmware).toContain('manifestDoc["variant"]');
		expect(firmware).toContain('manifestDoc["relay_gpio"]');
		expect(firmware).toContain("fw::otaMatchesHardware(");
		expect(firmware).toContain('otaRefusalReason = "variant_mismatch"');
		expect(firmware).toContain('otaSetState("refused_variant")');
		expect(firmware).toContain('diag["hw_variant"] = FW_HW_VARIANT');
		expect(firmware).toContain('diag["relay_gpio"] = RELAY_PIN');
		expect(firmware).toContain('diag["hw_variant_ok"] = hardwareVariantOk');
		expect(firmware).toContain("fw::Refusal::HARDWARE_VARIANT");
		expect(firmware).toContain("provisioned_variant_mismatch");
		expect(firmware).toContain("prefs.remove(NVS_HW_VARIANT_KEY)");
	});

	it("makes the release script prove the environment before signing", () => {
		expect(signRelease).toContain('"--variant": "variant"');
		expect(signRelease).toContain('for (const required of ["variant", "version", "key"])');
		expect(signRelease).toContain("assertBuildMatchesVariant(options)");
		expect(signRelease).toContain("variant: options.variant");
		expect(signRelease).toContain("relay_gpio: relayGpio");
	});
});
