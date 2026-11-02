import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fleet monitor page, per-device telemetry (issue #479, M3C.4b).
 *
 * The rules and the loader cover the values; these cover what the operator sees:
 * a unit that never reported says so instead of showing a zero, a timed-out
 * reading is not printed as the current signal, safe mode and faults carry
 * words next to their icon, and a failed read never renders as a healthy fleet.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({ href, children, ...rest }: { href: unknown; children?: React.ReactNode }) =>
			react.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
		getPathname: ({ href }: { href: string }) => href,
		usePathname: () => "/superadmin/fleet",
		useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	};
});

const mocks = vi.hoisted(() => ({ getFleetMonitor: vi.fn(), gateMock: vi.fn() }));

vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: mocks.gateMock }));
vi.mock("@/lib/platform/fleet-health", () => ({ getFleetMonitor: mocks.getFleetMonitor }));

import SuperadminFleetPage from "@/app/[locale]/(superadmin)/superadmin/fleet/page";
import { deviceStatusPolicyFromValue } from "@/lib/device-status";
import type { FleetMonitor } from "@/lib/platform/fleet-health";
import {
	type FleetDeviceInput,
	buildTenantFleetRows,
	summarizeFleet,
} from "@/lib/platform/fleet-health-rules";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function unit(overrides: Partial<FleetDeviceInput> = {}): FleetDeviceInput {
	return {
		id: `dev-${Math.random().toString(36).slice(2, 8)}`,
		label: "Feeder",
		mac: "AA:BB:CC:DD:EE:FF",
		lastSeenAt: ago(1),
		tenantId: "org-1",
		tenantName: "Alpha",
		pondName: "Pond 1",
		...overrides,
	};
}

function monitor(devices: FleetDeviceInput[]): FleetMonitor {
	const rows = buildTenantFleetRows(devices, NOW, POLICY);
	return {
		checkedAt: NOW,
		policy: POLICY,
		rows,
		summary: summarizeFleet(rows),
		totalDevices: devices.length,
		truncated: false,
		sourceError: false,
	};
}

function failed(): FleetMonitor {
	return {
		checkedAt: NOW,
		policy: null,
		rows: [],
		summary: { state: "unknown", counts: { ok: 0, degraded: 0, critical: 0, unknown: 0 } },
		totalDevices: 0,
		truncated: false,
		sourceError: true,
	};
}

async function html(): Promise<string> {
	return renderToStaticMarkup((await SuperadminFleetPage()) as React.ReactElement);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gateMock.mockResolvedValue(undefined);
	mocks.getFleetMonitor.mockResolvedValue(monitor([]));
});

describe("fleet page per-device telemetry", () => {
	it("says Not reported, Unknown and Never for a unit that never reported anything", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([unit({ label: "Silent unit", lastSeenAt: null })]),
		);

		const output = await html();

		expect(output).toContain("Silent unit");
		expect(output).toContain("Not reported");
		expect(output).toContain("Unknown");
		expect(output).toContain("No version reported");
		expect(output).toContain("Never");
		// The hopper surface says "no reading yet" and draws an empty bar, never a
		// rendered 0 %; the style width of the grey bar is not a displayed value.
		expect(output).toContain("No reading yet");
		expect(output).not.toContain(">0%<");
	});

	it("prints the fresh signal, the firmware and the readings the unit sent", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([
				unit({
					label: "Reporting unit",
					diag: { fw: "1.6.2" },
					rssiDbm: -61,
					rssiUpdatedAt: ago(1),
					feedLevelPercent: 55,
					feedLevelUpdatedAt: ago(2),
					waterTempC: 26.5,
					waterTempOk: true,
					waterTempUpdatedAt: ago(2),
					lastFeedAt: ago(45),
				}),
			]),
		);

		const output = await html();

		expect(output).toContain("Reporting unit");
		expect(output).toContain("-61 dBm");
		expect(output).toContain("1.6.2");
		expect(output).toContain("55%");
		expect(output).toContain("26.5 °C");
		expect(output).toContain("Fresh, read");
	});

	it("does not print a signal reading that has timed out", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([
				unit({
					label: "Quiet unit",
					lastSeenAt: ago(3),
					rssiDbm: -61,
					rssiUpdatedAt: ago(40),
				}),
			]),
		);

		const output = await html();

		expect(output).toContain("Quiet unit");
		expect(output).not.toContain("-61 dBm");
		// The stale reading is still not a current value, so the cell says so and
		// dates the reading instead of printing it.
		expect(output).toContain("Not reported");
		expect(output).toContain("Stale, last read");
	});

	it("shows safe mode and faults with words next to the icon", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([
				unit({
					label: "Locked unit",
					health: {
						metadata: { safeMode: true, faultsPresent: 2, faultsLatched: 2 },
						createdAt: ago(5),
					},
				}),
			]),
		);

		const output = await html();

		expect(output).toContain("Safe mode");
		expect(output).toContain("Faults: hopper sensor");
		expect(output).toContain("State since");
		expect(output).not.toContain("No faults reported");
	});

	it("dates a stale water reading and names a probe that did not answer", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([
				unit({
					label: "Tepid unit",
					waterTempC: 26,
					waterTempOk: false,
					waterTempUpdatedAt: ago(40),
				}),
			]),
		);

		const output = await html();

		expect(output).toContain("Probe not detected");
		expect(output).toContain("Stale, last read");
		// An old temperature is not printed as the current one.
		expect(output).not.toContain("26 °C");
	});

	it("says a unit reported no faults instead of hiding the health column", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([
				unit({
					label: "Healthy unit",
					health: {
						metadata: { safeMode: false, faultsPresent: 0, faultsLatched: 0 },
						createdAt: ago(500),
					},
				}),
			]),
		);

		const output = await html();

		expect(output).toContain("Not in safe mode");
		expect(output).toContain("No faults reported");
	});

	it("ranks the units worst first, whatever their label", async () => {
		mocks.getFleetMonitor.mockResolvedValue(
			monitor([
				unit({ label: "Alpha healthy", lastSeenAt: ago(1) }),
				unit({ label: "Zulu silent", lastSeenAt: null }),
			]),
		);

		const output = await html();

		expect(output).toContain("Units, worst first");
		expect(output.indexOf("Zulu silent")).toBeLessThan(output.indexOf("Alpha healthy"));
	});

	it("keeps a failed read an explicit error, with no unit list pretending to be fine", async () => {
		mocks.getFleetMonitor.mockResolvedValue(failed());

		const output = await html();

		expect(output).toContain("The fleet source did not report.");
		expect(output).toContain("No tenant can be called healthy in this state.");
		expect(output).toContain("Not reported: the device policy could not be read");
		expect(output).not.toContain("Units, worst first");
	});
});
