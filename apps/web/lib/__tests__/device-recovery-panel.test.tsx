import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "./helpers/messages";

import { DeviceRecoveryPanel } from "@/components/device-recovery-panel";
import type { DeviceHealthReport } from "@/lib/device-health-model";
import {
	type BuildRecoveryPlanInput,
	buildRecoveryPlan,
	unavailableRecoveryPlan,
} from "@/lib/device-recovery-model";

/**
 * The recovery panel is the operator's copy of the procedure. It must show the
 * real state and the cause, and it must never offer a button that pretends to
 * clear safe mode from the dashboard.
 */

const NOW = new Date("2026-11-07T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const t = createTranslator("dashboard.appSettings.recovery");

function report(over: Partial<DeviceHealthReport> = {}): DeviceHealthReport {
	return {
		safeMode: false,
		faultsPresent: 0,
		faultsLatched: 0,
		lastFault: null,
		abnormalResets: 0,
		resetReasons: null,
		resetReason: null,
		uptimeS: null,
		...over,
	};
}

const POLICY = { weakAfterMs: 4 * 60_000, offlineAfterMs: 5 * 60_000, graceMs: 0 };

const DEVICE = {
	lastSeenAt: minutesAgo(0.5),
	rtcOk: true,
	wifiRssiDbm: -60,
	wifiRssiUpdatedAt: NOW,
	diag: { uptime_s: 10_800, fw: "1.9.0" },
};

function render(over: Partial<BuildRecoveryPlanInput> = {}) {
	const plan = buildRecoveryPlan({
		now: NOW,
		device: DEVICE,
		healthRows: [],
		firmwareVersion: "1.9.0",
		policy: POLICY,
		...over,
	});
	return renderToStaticMarkup(<DeviceRecoveryPanel plan={plan} t={t} />);
}

describe("DeviceRecoveryPanel", () => {
	it("explains safe mode with the controller cause and no PSU instruction", () => {
		const html = render({
			healthRows: [
				{
					report: report({
						safeMode: true,
						faultsPresent: 16,
						faultsLatched: 16,
						abnormalResets: 3,
						resetReasons: "panic",
						resetReason: "panic",
					}),
					createdAt: minutesAgo(5),
				},
			],
		});

		expect(html).toContain("Safe mode");
		expect(html).toContain("ESP_RST_PANIC");
		expect(html).not.toMatch(/check the power/i);
		expect(html).toContain("Locked: safe mode is on");
	});

	it("shows the quiet window and the conditional reset hold", () => {
		const html = render({
			healthRows: [
				{ report: report({ abnormalResets: 1, resetReasons: "panic" }), createdAt: minutesAgo(5) },
				{
					report: report({ safeMode: true, abnormalResets: 1, resetReasons: "panic" }),
					createdAt: minutesAgo(6),
				},
			],
		});

		expect(html).toContain("min left of the 30 min window");
		expect(html).toContain("GPIO 17");
		expect(html).toContain("cannot detect whether the enclosure has the button wired");
		expect(html).toContain("Recovery is not safe yet");
	});

	it("warns that another reset since the trip is not a repair", () => {
		const html = render({
			healthRows: [
				{
					report: report({ abnormalResets: 4, resetReasons: "panic", resetReason: "panic" }),
					createdAt: minutesAgo(120),
				},
				{
					report: report({ safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
					createdAt: minutesAgo(150),
				},
			],
		});

		expect(html).toContain("Another reset since the trip");
		expect(html).toContain("Clearing safe mode is not the repair");
		expect(html).toContain("Locked: safe mode cleared");
	});

	it("shows every verification check with its own status", () => {
		const html = render({
			device: { ...DEVICE, diag: { uptime_s: 10_800 } },
			firmwareVersion: null,
			healthRows: [
				{
					report: report({ abnormalResets: 3, resetReasons: "panic" }),
					createdAt: minutesAgo(120),
				},
				{
					report: report({ safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
					createdAt: minutesAgo(150),
				},
			],
		});

		expect(html).toContain('data-check="heartbeat"');
		expect(html).toContain('data-check="connectivity"');
		expect(html).toContain('data-check="sensors"');
		expect(html).toContain('data-check="firmware"');
		expect(html).toContain("Not reported");
	});

	it("says the unit is healthy and dose testing is available", () => {
		const html = render({
			healthRows: [
				{
					report: report({ abnormalResets: 3, resetReasons: "panic" }),
					createdAt: minutesAgo(120),
				},
				{
					report: report({ safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
					createdAt: minutesAgo(150),
				},
			],
		});

		expect(html).toContain('data-recovery-state="HEALTHY"');
		expect(html).toContain("Available: the unit is healthy.");
	});

	it("renders cannot-verify instead of a healthy feeder when the read failed", () => {
		const html = renderToStaticMarkup(
			<DeviceRecoveryPanel plan={unavailableRecoveryPlan(NOW)} t={t} />,
		);

		expect(html).toContain("Cannot verify this unit");
		expect(html).not.toContain("Healthy");
	});

	it("never offers a dashboard button that claims to clear safe mode", () => {
		const html = render({
			healthRows: [
				{
					report: report({ safeMode: true, faultsPresent: 16, abnormalResets: 3 }),
					createdAt: minutesAgo(5),
				},
			],
		});

		expect(html).not.toContain("<button");
	});
});
