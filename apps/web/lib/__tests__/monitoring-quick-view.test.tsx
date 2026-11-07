import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #575: the quick-view monitoring status must live in one place on
 * desktop (the sidebar card) and one floating place on mobile (above the
 * bottom bar), with the issue's colour language:
 *
 *  - online / weak signal → high-contrast orange (active);
 *  - safe mode / fault → yellow;
 *  - offline → red.
 *
 * The component checks render the real server output, so they also prove that
 * every state has text and an icon instead of relying on colour alone.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string;
		children?: ReactNode;
	} & Record<string, unknown>) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
	usePathname: () => "/dashboard",
}));

import { MobileMonitoringHud } from "@/components/mobile/monitoring-hud";
import { Sidebar } from "@/components/sidebar";
import { MonitoringCard } from "@/components/status/monitoring-card";
import {
	type MonitoringHealth,
	monitoringHealthMessage,
	monitoringHealthState,
	summarizeMonitoring,
} from "@/components/status/monitoring-status";
import { expectNoSeriousOrCriticalViolations } from "./helpers/axe";

const readingAt = new Date("2026-11-02T09:00:00+08:00");
afterEach(cleanup);
const clearHealth: MonitoringHealth = { safeMode: false, faults: [] };
const safeMode: MonitoringHealth = { safeMode: true, faults: [] };
const rtcFault: MonitoringHealth = { safeMode: false, faults: ["rtc"] };

function sidebarHtml(
	connection: "online" | "weak" | "offline" | "missing",
	health: MonitoringHealth | null,
	levelPercent: number | null = 82,
	sensorOffline = false,
) {
	return renderToStaticMarkup(
		<Sidebar
			hopperLevelPct={levelPercent}
			hopperLevelUpdatedAt={readingAt}
			hopperCapacityG={22_190}
			gramsPerFeeding={350}
			feedsPerDay={3}
			isOffline={connection === "offline"}
			isSensorOffline={sensorOffline}
			connection={connection}
			health={health}
		/>,
	);
}

function hudHtml(
	connection: "online" | "weak" | "offline" | "missing",
	health: MonitoringHealth | null,
	levelPercent: number | null = 82,
	sensorOffline = false,
) {
	return renderToStaticMarkup(
		<MobileMonitoringHud
			levelPercent={levelPercent}
			levelUpdatedAt={readingAt}
			sensorOffline={sensorOffline}
			connection={connection}
			health={health}
		/>,
	);
}

describe("quick-view state (#575)", () => {
	it("maps online and weak signal to the high-contrast active tone", () => {
		expect(summarizeMonitoring({ connection: "online", health: clearHealth })).toMatchObject({
			kind: "online",
			tone: "active",
		});
		expect(summarizeMonitoring({ connection: "weak", health: clearHealth })).toMatchObject({
			kind: "weak",
			tone: "active",
		});
	});

	it("puts safe mode and faults in the yellow attention tone", () => {
		expect(summarizeMonitoring({ connection: "online", health: safeMode })).toMatchObject({
			kind: "safe_mode",
			tone: "attention",
			secondaryHealth: null,
		});
		expect(summarizeMonitoring({ connection: "online", health: rtcFault })).toMatchObject({
			kind: "fault",
			tone: "attention",
			faultCount: 1,
		});
	});

	it("keeps offline red and still counts a health warning underneath", () => {
		expect(summarizeMonitoring({ connection: "offline", health: safeMode })).toEqual({
			kind: "offline",
			tone: "offline",
			faultCount: 0,
			secondaryHealth: "safe_mode",
		});
	});

	it("does not turn an unpaired feeder into a fault or an offline device", () => {
		expect(summarizeMonitoring({ connection: "missing", health: null })).toEqual({
			kind: "missing",
			tone: "neutral",
			faultCount: 0,
			secondaryHealth: null,
		});
	});

	it("distinguishes a missing health read from an all-clear one", () => {
		expect(monitoringHealthState(null)).toBe("unknown");
		expect(monitoringHealthState(clearHealth)).toBe("clear");
		expect(monitoringHealthMessage(null)).toBeNull();
		expect(monitoringHealthMessage(clearHealth)).toEqual({ key: "healthClear" });
		expect(monitoringHealthMessage(safeMode)).toEqual({ key: "healthSafeMode" });
		expect(monitoringHealthMessage(rtcFault)).toEqual({ key: "healthFaults", count: 1 });
	});
});

describe("desktop sidebar card (#575)", () => {
	it("combines the hopper, connection and health in the existing sidebar link", () => {
		const html = sidebarHtml("online", clearHealth);

		expect(html).toContain('aria-label="View hopper level history"');
		expect(html).toContain('href="/dashboard/history#hopper-level"');
		expect(html).toContain("Monitoring");
		expect(html).toContain("Pond Feed Pellet");
		expect(html).toContain("82%");
		expect(html).toContain("No faults reported");
		// Active/online is the high-contrast orange from the issue.
		expect(html).toContain('data-monitoring-tone="active"');
		expect(html).toContain("bg-[#C2410C]");
		expect(html).toContain("Online");
	});

	it("turns the badge yellow for safe mode and keeps the explanation visible", () => {
		const html = sidebarHtml("online", safeMode);

		expect(html).toContain('data-monitoring-tone="attention"');
		expect(html).toContain("bg-[#FACC15]");
		expect(html).toContain("Safe mode");
		expect(html).toContain("Safe mode: doses are refused");
	});

	it("shows a fault count in text, not only as a colour", () => {
		const html = sidebarHtml("online", rtcFault);

		expect(html).toContain('data-monitoring-tone="attention"');
		expect(html).toContain("1 fault");
		expect(html).toContain("1 active fault");
	});

	it("stays red when offline and keeps a yellow safe-mode line underneath", () => {
		const html = sidebarHtml("offline", safeMode);

		expect(html).toContain('data-monitoring-tone="offline"');
		expect(html).toContain("bg-[#C42B3A]");
		expect(html).toContain("Offline");
		expect(html).toContain("Last known 82%");
		expect(html).toContain("bg-[#FACC15]");
		expect(html).toContain("Safe mode: doses are refused");
	});

	it("labels a weak signal and an unpaired feeder instead of hiding them behind a colour", () => {
		expect(sidebarHtml("weak", clearHealth)).toContain("Weak signal");
		const missing = sidebarHtml("missing", null);
		expect(missing).toContain("No feeder paired");
		expect(missing).toContain('data-monitoring-tone="neutral"');
	});

	it("keeps the collapsed card informative to assistive tech", () => {
		const html = renderToStaticMarkup(
			<MonitoringCard
				hopperLevelPct={82}
				hopperLevelUpdatedAt={readingAt}
				hopperCapacityG={22_190}
				gramsPerFeeding={350}
				feedsPerDay={3}
				isOffline={false}
				connection="online"
				health={clearHealth}
				collapsed
			/>,
		);

		expect(html).toContain('aria-label="Online. Hopper level 82%."');
		expect(html).toContain("82%");
		expect(html).toContain("No faults reported");
	});

	it("opens the device's 3D view when a feeder is paired (#892)", () => {
		const html = renderToStaticMarkup(
			<MonitoringCard
				hopperLevelPct={82}
				hopperLevelUpdatedAt={readingAt}
				hopperCapacityG={22_190}
				gramsPerFeeding={350}
				feedsPerDay={3}
				isOffline={false}
				connection="online"
				health={clearHealth}
				deviceHref="/dashboard/devices/dev-1"
				collapsed={false}
			/>,
		);

		expect(html).toContain('href="/dashboard/devices/dev-1"');
		expect(html).toContain('aria-label="Open device view"');
	});

	it("falls back to the hopper history when no device is paired (#892)", () => {
		const html = sidebarHtml("missing", null);

		expect(html).toContain('href="/dashboard/history#hopper-level"');
		expect(html).toContain('aria-label="View hopper level history"');
	});
});

describe("mobile floating HUD (#575)", () => {
	it("floats on the top edge of the bottom navigation", () => {
		const html = hudHtml("online", clearHealth);

		expect(html).toContain(
			"bottom-[calc(var(--ofd-bottom-nav-h)+env(safe-area-inset-bottom)+0.5rem)]",
		);
		expect(html).toContain("lg:hidden");
		expect(html).toContain('href="/dashboard/history#hopper-level"');
		expect(html).toContain('data-monitoring-tone="active"');
		expect(html).toContain("bg-[#C2410C]");
		expect(html).toContain("Online");
		expect(html).toContain("82%");
	});

	it("outlines the floating chip in the live tone so it cannot vanish (#884)", () => {
		expect(hudHtml("online", clearHealth)).toContain("border-[#FF8A5C]");
		expect(hudHtml("online", safeMode)).toContain("border-[#FACC15]");
		expect(hudHtml("offline", clearHealth)).toContain("border-[#F87171]");
		// The opaque surface replaced the translucent one, so page content can
		// no longer show through the chip.
		expect(hudHtml("online", clearHealth)).not.toContain("bg-[#06263f]/95");
	});

	it("uses dark ink on the bright dark-mode orange badge (#884)", () => {
		const html = hudHtml("online", clearHealth);
		expect(html).toContain("dark:bg-[#FF5A1F]");
		expect(html).toContain("dark:text-[#1A0A02]");
	});

	it("uses the same red/yellow semantics when the unit is offline in safe mode", () => {
		const html = hudHtml("offline", safeMode);

		expect(html).toContain('data-monitoring-tone="offline"');
		expect(html).toContain("bg-[#C42B3A]");
		expect(html).toContain("Last known");
		// The secondary yellow tag keeps the fault visible while red owns the
		// primary connection badge.
		expect(html).toContain("bg-[#FACC15]");
		expect(html).toContain("Safe mode: doses are refused");
	});

	it("renders nothing when there is no feeder or no farm chrome", () => {
		expect(hudHtml("missing", null)).toBe("");
		expect(
			renderToStaticMarkup(
				<MobileMonitoringHud
					levelPercent={82}
					levelUpdatedAt={readingAt}
					connection="online"
					health={clearHealth}
					show={false}
				/>,
			),
		).toBe("");
	});

	it("has no serious or critical axe violations in dark mode (#884)", async () => {
		const { container } = render(
			<div className="dark">
				<MobileMonitoringHud
					levelPercent={82}
					levelUpdatedAt={readingAt}
					connection="offline"
					health={safeMode}
				/>
			</div>,
		);

		await expectNoSeriousOrCriticalViolations(container);
	});
});

describe("sensor offline in the quick view (#574 + #575)", () => {
	it("keeps the last hopper level and names the sensor in the sidebar", () => {
		const html = sidebarHtml("online", clearHealth, 82, true);

		expect(html).toContain("Last known 82%");
		expect(html).toContain("Ultrasonic offline");
		// The unit is still online, so the primary badge is not red.
		expect(html).toContain('data-monitoring-tone="active"');
	});

	it("names the sensor in the mobile HUD without hiding the level", () => {
		const html = hudHtml("online", clearHealth, 82, true);

		expect(html).toContain("Ultrasonic offline");
		expect(html).toContain("82%");
		expect(html).toContain('data-monitoring-tone="active"');
	});
});

describe("monitoring catalogue parity (#575)", () => {
	const messagesDir = join(__dirname, "../../messages");

	type Tree = { [key: string]: string | Tree };

	function load(locale: string): Tree {
		return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
	}

	function flatten(tree: Tree, prefix = ""): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(tree)) {
			const path = prefix ? `${prefix}.${key}` : key;
			if (typeof value === "string") out[path] = value;
			else Object.assign(out, flatten(value, path));
		}
		return out;
	}

	function placeholders(message: string): string[] {
		return [...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]).sort();
	}

	it("ships every new key in en, hil and tl with the same placeholders", () => {
		const en = flatten(load("en"));
		const keys = Object.keys(en).filter((key) => key.startsWith("dashboard.monitoring."));
		expect(keys.length).toBeGreaterThanOrEqual(10);

		for (const locale of ["hil", "tl"]) {
			const messages = flatten(load(locale));
			for (const key of keys) {
				expect(messages[key], `${locale} is missing ${key}`).toBeTruthy();
				expect(placeholders(messages[key]), `${locale} placeholders differ for ${key}`).toEqual(
					placeholders(en[key]),
				);
			}
		}
	});

	it("keeps both ICU plural branches in every locale", () => {
		const en = flatten(load("en"));
		const keys = Object.keys(en).filter(
			(key) => key.startsWith("dashboard.monitoring.") && en[key].includes("plural"),
		);
		expect(keys.length).toBeGreaterThan(0);

		for (const locale of ["hil", "tl"]) {
			const messages = flatten(load(locale));
			for (const key of keys) {
				expect(messages[key], `${locale} is missing ${key}`).toContain("one {");
				expect(messages[key], `${locale} is missing the other branch for ${key}`).toContain(
					"other {",
				);
			}
		}
	});
});
