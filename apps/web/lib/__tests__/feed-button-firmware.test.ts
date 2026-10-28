import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Firmware 1.5.3 button guard (CICT phantom feeds). The ISR used to queue a
 * dispense on a single falling edge; switching noise on the long, internally
 * pulled-up button line then dispensed 80 g at a time, in pairs and triples ~20 s
 * apart. These are static contracts: the interrupt may only record a candidate,
 * and the real decision must stay in loop().
 */

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
const firmware = readFileSync(join(repoRoot, "firmware/firmware-main/firmware-main.ino"), "utf8");

function bodyOf(signature: string) {
	const start = firmware.indexOf(signature);
	expect(start, `${signature} must exist`).toBeGreaterThan(-1);
	return firmware.slice(start, firmware.indexOf("\n}\n", start));
}

function defineOf(name: string) {
	const match = firmware.match(new RegExp(`^#define\\s+${name}\\s+(\\S+)`, "m"));
	expect(match, `#define ${name} must exist`).not.toBeNull();
	return match?.[1];
}

describe("feed-button press guard constants", () => {
	it("confirms a press over at least 50 ms at a 90 % threshold", () => {
		expect(defineOf("BUTTON_CONFIRM_SAMPLES")).toBe("10");
		expect(defineOf("BUTTON_CONFIRM_SAMPLE_MS")).toBe("5");
		expect(defineOf("BUTTON_CONFIRM_MIN_LOW_SAMPLES")).toBe("9");

		// 10 samples x 5 ms = the 50 ms window the brief requires.
		const samples = Number(defineOf("BUTTON_CONFIRM_SAMPLES"));
		const sampleMs = Number(defineOf("BUTTON_CONFIRM_SAMPLE_MS"));
		expect(samples * sampleMs).toBeGreaterThanOrEqual(50);
		expect(Number(defineOf("BUTTON_CONFIRM_MIN_LOW_SAMPLES")) / samples).toBeGreaterThanOrEqual(
			0.9,
		);
	});

	it("keeps the 250 ms debounce, the 5 s boot grace and the 2 s quiet window", () => {
		expect(defineOf("BUTTON_DEBOUNCE_MS")).toBe("250");
		expect(defineOf("BUTTON_STARTUP_GRACE_MS")).toBe("5000");
		expect(defineOf("BUTTON_QUIET_AFTER_DISPENSE_MS")).toBe("2000UL");
	});

	it("allows one button dispense per 30 s", () => {
		expect(defineOf("BUTTON_COOLDOWN_MS")).toBe("30000UL");
	});
});

describe("the interrupt only records a candidate", () => {
	it("does not dispense from the ISR", () => {
		const isr = bodyOf("void IRAM_ATTR onFeedButtonPress() {");

		expect(isr).not.toContain("dispenseFeed(");
		expect(isr).not.toContain("requestButtonDispense(");
		expect(isr).toContain("feedButtonPressQueued = true;");
		// The existing guards stay in place inside the interrupt.
		expect(isr).toContain("BUTTON_STARTUP_GRACE_MS");
		expect(isr).toContain("BUTTON_DEBOUNCE_MS");
	});
});

describe("loop() decides whether a falling edge is a real press", () => {
	it("samples the pin before anything reaches the relay", () => {
		const confirm = bodyOf("bool confirmFeedButtonPress(unsigned long &lowMs) {");
		expect(confirm).toContain("digitalRead(BUTTON_PIN)");
		expect(confirm).toContain("BUTTON_CONFIRM_SAMPLES");
		expect(confirm).toContain("BUTTON_CONFIRM_SAMPLE_MS");
		expect(confirm).toContain("BUTTON_CONFIRM_MIN_LOW_SAMPLES");

		const handle = bodyOf("void handleButton() {");
		const confirmAt = handle.indexOf("confirmFeedButtonPress(");
		expect(confirmAt).toBeGreaterThan(-1);
		expect(handle.indexOf("requestButtonDispense(")).toBeGreaterThan(confirmAt);

		// A rejected candidate must never reach the dispense path, and it is
		// counted for the heartbeat.
		expect(handle).toContain("buttonGlitchCount++");
		expect(handle).toContain("[BUTTON] rejected glitch");
	});

	it("drops and clears edges during and 2 s after a dispense", () => {
		const quiet = bodyOf("bool buttonQuietWindowActive() {");
		expect(quiet).toContain("feederActive");
		expect(quiet).toContain("dispenseQuietUntilMs");

		const handle = bodyOf("void handleButton() {");
		expect(handle.indexOf("buttonQuietWindowActive()")).toBeLessThan(
			handle.indexOf("confirmFeedButtonPress("),
		);
		expect(handle).toContain("takeQueuedFeedButtonPress()");
		expect(handle).toContain("[BUTTON] ignored during/after dispense");

		// The window starts when the relay actually turns OFF, whatever started
		// the dispense.
		const stop = bodyOf("void stopFeedCycle() {");
		expect(stop).toContain("digitalWrite(RELAY_PIN, RELAY_OFF);");
		expect(stop).toContain("dispenseQuietUntilMs = millis() + BUTTON_QUIET_AFTER_DISPENSE_MS;");
	});

	it("refuses a second confirmed press inside the cooldown", () => {
		const request = bodyOf("bool requestButtonDispense() {");
		expect(request).toContain("BUTTON_COOLDOWN_MS");
		expect(request).toContain("lastButtonDispenseMs");
		expect(request).toContain("[BUTTON] cooldown");
		expect(request).toContain('dispenseFeed(cachedButtonFeedGrams, "button")');

		// Only a dispense that actually started arms the cooldown.
		expect(request).toContain("wasActive");
		expect(request).toContain("started");
	});
});

describe("telemetry and the existing paths keep working", () => {
	it("reports the rejected-glitch counter in the heartbeat", () => {
		const telemetry = bodyOf("void sendTelemetry() {");
		expect(telemetry).toContain('doc["button_glitches"]');
		expect(telemetry).toContain("buttonGlitchCount");
	});

	it("keeps the boot-hold Wi-Fi reset before the interrupt is attached", () => {
		const setup = firmware.slice(firmware.indexOf("void setup()"));
		expect(setup.indexOf("bootButtonResetHeld()")).toBeGreaterThan(-1);
		expect(setup.indexOf("bootButtonResetHeld()")).toBeLessThan(
			setup.indexOf("attachInterrupt(digitalPinToInterrupt(BUTTON_PIN)"),
		);
	});

	it("confirms a press before aborting an OTA download, and dispenses once", () => {
		const download = bodyOf("bool performFirmwareUpdate(const String &url");
		expect(download).toContain("confirmFeedButtonPress(");
		expect(download).toContain("discardQueuedFeedButtonPress();");
		expect(download).toContain("requestButtonDispense();");
		expect(download).not.toContain('dispenseFeed(cachedButtonFeedGrams, "button", String())');
	});

	it("is firmware 1.6.0", () => {
		expect(firmware).toContain('#define FW_VERSION "1.6.0"');
	});
});
