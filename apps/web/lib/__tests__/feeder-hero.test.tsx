import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The feeder hero (task I-29, E29): the readings a farmer reads off it, the
 * offline "last known" treatment (E4), the illustration that stands in for the
 * photo, and the mobile 2×3 fallback for the callouts.
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
import { FEEDER_HERO_PHOTO_SESSION_KEY, type FeederHeroData } from "@/lib/feeder-hero-types";

function heroData(overrides: Partial<FeederHeroData> = {}): FeederHeroData {
	return {
		deviceLabel: "Feeder A",
		connectionState: "online",
		isOffline: false,
		isPaused: false,
		lastSeenAt: new Date(2026, 9, 27, 9, 12),
		hopperLevelPercent: 82,
		hopperUpdatedAt: new Date(2026, 9, 27, 9, 10),
		gramsToday: 1240,
		nextFeedSlot: { hours: 14, minutes: 0, dayOffset: 0 },
		waterTempC: 28.4,
		waterTempOk: true,
		waterTempUpdatedAt: new Date(2026, 9, 27, 9, 5),
		firmwareVersion: "1.5.0",
		advisor: { grams: 330, confidence: "medium", reasoning: "Fresh sample, stable FCR." },
		...overrides,
	};
}

function renderHero(overrides: Partial<FeederHeroData> = {}) {
	return render(<FeederHero pondName="Demo Pond" {...heroData(overrides)} />);
}

function callouts() {
	return screen.getByRole("list", { name: "Feeder readings" });
}

beforeEach(() => {
	window.sessionStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("FeederHero readings", () => {
	it("shows every callout value and the advisor summary", () => {
		renderHero();

		expect(within(callouts()).getByText("82%")).toBeInTheDocument();
		expect(within(callouts()).getByText("1.24 kg")).toBeInTheDocument();
		expect(within(callouts()).getByText("2:00 PM")).toBeInTheDocument();
		expect(within(callouts()).getByText("28.4 °C")).toBeInTheDocument();
		expect(within(callouts()).getByText("v1.5.0")).toBeInTheDocument();
		expect(within(callouts()).getAllByText("Online").length).toBeGreaterThan(0);

		expect(screen.getByText("Demo Pond")).toBeInTheDocument();
		expect(screen.getByText("330 g per meal")).toBeInTheDocument();
		expect(screen.getByText(/Medium confidence/)).toBeInTheDocument();
		expect(screen.getByText("Fresh sample, stable FCR.")).toBeInTheDocument();
	});

	it("shows a weak-signal state without treating the feeder as offline", () => {
		renderHero({ connectionState: "weak" });

		expect(within(callouts()).getByText("Weak signal")).toBeInTheDocument();
		// The hopper reading is still current, not the greyed "last known" value.
		expect(within(callouts()).getByText("82%")).toBeInTheDocument();
		expect(within(callouts()).queryByText("Last known 82%")).not.toBeInTheDocument();
	});

	it("keeps the last known hopper reading for an offline feeder", () => {
		renderHero({ connectionState: "offline", isOffline: true, isPaused: false });

		expect(within(callouts()).getByText("Last known 82%")).toBeInTheDocument();
		const items = within(callouts()).getAllByRole("listitem");
		// The hopper chip carries the Offline tag; the connection chip says it too.
		expect(within(items[0] as HTMLElement).getByText("Offline")).toBeInTheDocument();
		expect(within(items[4] as HTMLElement).getByText("Offline")).toBeInTheDocument();
		// The reading time proves when the greyed value was measured.
		expect(within(callouts()).getByText("Oct 27, 9:10 AM")).toBeInTheDocument();
		expect(within(callouts()).queryByText("82%")).not.toBeInTheDocument();
	});

	it("says there is no reading when the feeder never reported one", () => {
		renderHero({
			connectionState: "offline",
			isOffline: true,
			hopperLevelPercent: null,
			hopperUpdatedAt: null,
		});

		expect(within(callouts()).getByText("—")).toBeInTheDocument();
		expect(within(callouts()).getByText("No reading yet")).toBeInTheDocument();
	});

	it("says which day the next feed falls on, not just the hour", () => {
		renderHero({ nextFeedSlot: { hours: 8, minutes: 0, dayOffset: 1 } });

		expect(within(callouts()).getByText("8:00 AM")).toBeInTheDocument();
		expect(within(callouts()).getByText("Tomorrow")).toBeInTheDocument();
	});

	it("reports a paused schedule instead of a feed time", () => {
		renderHero({ isPaused: true });

		expect(within(callouts()).getByText("Schedule paused")).toBeInTheDocument();
		expect(within(callouts()).queryByText("2:00 PM")).not.toBeInTheDocument();
	});

	it("says so when the probe or the firmware has no reading", () => {
		renderHero({
			waterTempC: null,
			waterTempOk: false,
			firmwareVersion: null,
			advisor: null,
		});

		expect(within(callouts()).getByText("Probe not detected")).toBeInTheDocument();
		expect(within(callouts()).getByText("Not reported yet")).toBeInTheDocument();
		expect(screen.getByText("Not enough data for a recommendation yet.")).toBeInTheDocument();
	});
});

describe("FeederHero photo fallback", () => {
	it("always renders the illustration, even before the photo loads", () => {
		renderHero();

		expect(screen.getByTestId("feeder-illustration")).toBeInTheDocument();
		expect(screen.getByTestId("feeder-hero-photo")).toBeInTheDocument();
	});

	it("keeps the illustration and stops asking when the photo is missing", () => {
		const first = renderHero();
		const photo = screen.getByTestId("feeder-hero-photo");

		fireEvent.error(photo);

		expect(screen.queryByTestId("feeder-hero-photo")).not.toBeInTheDocument();
		expect(screen.getByTestId("feeder-illustration")).toBeInTheDocument();
		expect(window.sessionStorage.getItem(FEEDER_HERO_PHOTO_SESSION_KEY)).toBe("1");

		// A later page view in the same session does not probe again.
		first.unmount();
		renderHero();
		expect(screen.queryByTestId("feeder-hero-photo")).not.toBeInTheDocument();
		expect(screen.getByTestId("feeder-illustration")).toBeInTheDocument();
	});

	it("never throws when sessionStorage is blocked", () => {
		const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});

		renderHero();
		expect(() => fireEvent.error(screen.getByTestId("feeder-hero-photo"))).not.toThrow();
		expect(screen.getByTestId("feeder-illustration")).toBeInTheDocument();

		getItem.mockRestore();
		setItem.mockRestore();
	});
});

describe("FeederHero responsive layout", () => {
	it("falls back to a 2×3 callout grid below md and hides the leader lines", () => {
		renderHero();

		const list = callouts();
		expect(list).toHaveClass("grid", "grid-cols-2");
		expect(within(list).getAllByRole("listitem")).toHaveLength(6);

		const leaders = screen.getByTestId("feeder-hero-leaders");
		expect(leaders).toHaveClass("hidden", "md:block");
		expect(leaders).toHaveAttribute("aria-hidden", "true");
	});

	it("reserves the desktop placement for the callouts", () => {
		renderHero();

		// Every chip is positioned around the image from md up, and the two
		// columns sit on opposite edges of the hero body.
		const items = within(callouts()).getAllByRole("listitem");
		expect(items[0]).toHaveClass("md:left-0");
		expect(items[1]).toHaveClass("md:right-0");
		expect(items.every((item) => item.className.includes("md:absolute"))).toBe(true);
	});
});
