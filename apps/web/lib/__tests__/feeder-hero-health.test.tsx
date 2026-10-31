import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The feeder hero's health notice: what the unit itself reports (safe mode,
 * faults, the last refused dose). Silent while the feeder is healthy, and the
 * state is written in words, not colour alone.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", async () => {
	const React = await import("react");
	return {
		Link: ({ href, children }: { href: unknown; children?: React.ReactNode }) =>
			React.createElement("a", { href: typeof href === "string" ? href : "#" }, children),
	};
});

import { FeederHero } from "@/components/feeder/feeder-hero";
import { HEALTHY_VIEW } from "@/lib/device-health-model";
import type { DeviceHealthView } from "@/lib/device-health-model";
import type { FeederHeroData } from "@/lib/feeder-hero-types";

function heroData(health: DeviceHealthView): FeederHeroData {
	return {
		deviceLabel: "Feeder A",
		connectionState: "online",
		isOffline: false,
		isPaused: false,
		lastSeenAt: new Date(2026, 10, 1, 9, 12),
		rssiDbm: null,
		hopperLevelPercent: 82,
		hopperUpdatedAt: new Date(2026, 10, 1, 9, 10),
		gramsToday: 0,
		nextFeedSlot: { hours: 14, minutes: 0, dayOffset: 0 },
		waterTempC: 28.4,
		waterTempOk: true,
		waterTempUpdatedAt: new Date(2026, 10, 1, 9, 5),
		firmwareVersion: "1.8.1",
		health,
		advisor: null,
	};
}

function renderHero(health: DeviceHealthView) {
	return render(<FeederHero pondName="Demo Pond" {...heroData(health)} />);
}

afterEach(cleanup);

describe("FeederHero health notice", () => {
	it("shows nothing while the feeder is healthy", () => {
		renderHero(HEALTHY_VIEW);
		expect(screen.queryByTestId("feeder-hero-health")).toBeNull();
	});

	it("announces safe mode in words, with the resets that caused it and how it clears", () => {
		renderHero({
			...HEALTHY_VIEW,
			safeMode: true,
			resetReasons: "brownout",
			abnormalResets: 3,
			since: new Date(2026, 10, 1, 9, 0),
		});

		const alert = screen.getByRole("alert");
		expect(within(alert).getByText("Safe mode: doses are refused")).toBeTruthy();
		expect(within(alert).getByText(/30 quiet minutes/)).toBeTruthy();
		expect(within(alert).getByText("Recent resets: brownout")).toBeTruthy();
	});

	it("lists each active fault with what to check", () => {
		renderHero({ ...HEALTHY_VIEW, faults: ["hopper_sensor", "rtc"] });

		expect(screen.getByText("Needs a check")).toBeTruthy();
		expect(screen.getByText(/TRIG and ECHO/)).toBeTruthy();
		expect(screen.getByText(/SDA and SCL/)).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("names the last refused dose, its source and the reason", () => {
		renderHero({
			...HEALTHY_VIEW,
			lastRefusal: {
				reason: "safe_mode",
				source: "dashboard",
				grams: 150,
				at: new Date(2026, 10, 1, 8, 30),
			},
		});

		const note = screen.getByTestId("feeder-hero-health");
		expect(note.textContent).toContain("Last dose refused");
		expect(note.textContent).toContain("150 g (dashboard)");
		expect(note.textContent).toContain("safe mode");
	});

	it("falls back to the raw reason code for a reason it does not know", () => {
		renderHero({
			...HEALTHY_VIEW,
			lastRefusal: { reason: "future_reason", source: "button", grams: 80, at: new Date() },
		});

		expect(screen.getByTestId("feeder-hero-health").textContent).toContain("future_reason");
	});
});
