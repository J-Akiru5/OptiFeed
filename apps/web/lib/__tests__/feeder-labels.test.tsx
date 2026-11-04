import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { FeederComponentStatusList, FeederLabels } from "@/components/feeder/feeder-labels";

const RTC_LIVE = { value: "Healthy", status: "Live", tone: "live" } as const;
const WATER_LIVE = { value: "26.9 °C", status: "Healthy", tone: "live" } as const;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("FeederLabels ISO overlay", () => {
	function mockStage(width = 720, height = 440) {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			width,
			height,
			top: 0,
			left: 0,
			right: width,
			bottom: height,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect);
	}

	it("renders the two new cards when the overlay is active", () => {
		mockStage();

		render(<FeederLabels status="idle" level={30} active rtc={RTC_LIVE} waterTemp={WATER_LIVE} />);

		expect(screen.getByTestId("feeder-labels")).toBeInTheDocument();
		expect(screen.getByText("Real time clock")).toBeInTheDocument();
		expect(screen.getByText("Water temperature")).toBeInTheDocument();

		const rtcCard = screen.getByText("Real time clock").closest("div");
		const waterCard = screen.getByText("Water temperature").closest("div");
		if (!rtcCard || !waterCard) throw new Error("label cards not found");

		expect(within(rtcCard).getByText("Healthy")).toBeInTheDocument();
		expect(within(rtcCard).getByText("Live")).toBeInTheDocument();
		expect(within(waterCard).getByText("26.9 °C")).toBeInTheDocument();
		expect(within(waterCard).getByText("Healthy")).toBeInTheDocument();
	});

	it("omits both new cards when the overlay is inactive", () => {
		expect(
			renderToStaticMarkup(
				<FeederLabels
					status="idle"
					level={30}
					active={false}
					rtc={RTC_LIVE}
					waterTemp={WATER_LIVE}
				/>,
			),
		).toBe("");
	});
});

describe("FeederComponentStatusList", () => {
	it("keeps the parts' readings order and inserts the hotspots beside their parts", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList
				status="idle"
				level={30}
				active
				rtc={RTC_LIVE}
				waterTemp={WATER_LIVE}
			/>,
		);

		expect(html).toContain('data-testid="feeder-component-status"');
		expect(html).toContain('id="feeder-component-status"');
		for (const name of [
			"Hopper",
			"Ultrasonic sensor",
			"Controller",
			"Real time clock",
			"Motor",
			"Auger",
			"Outlet",
			"Water temperature",
		]) {
			expect(html, name).toContain(name);
		}

		const order = [
			"Hopper",
			"Ultrasonic sensor",
			"Controller",
			"Real time clock",
			"Motor",
			"Auger",
			"Outlet",
			"Water temperature",
		].map((name) => html.indexOf(name));
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it("shows live values for an idle feeder", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList
				status="idle"
				level={30}
				active
				rtc={RTC_LIVE}
				waterTemp={WATER_LIVE}
			/>,
		);

		expect(html).toContain("30%");
		expect(html).toContain("Reading");
		expect(html).toContain("Online");
		expect(html).toContain("Idle");
		expect(html).toContain("Ready");
		expect(html).toContain("Live");
		expect(html).toContain("26.9 °C");
		expect(html).toMatch(/Real time clock<\/dt>.*?Healthy.*?Live/);
		expect(html.match(/Healthy/g)).toHaveLength(2);
	});

	it("mirrors a stale RTC and water reading with their age", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList
				status="idle"
				level={30}
				active
				rtc={{ value: "Stale · 2h ago", status: "Last known", tone: "paused" }}
				waterTemp={{ value: "26.9 °C", status: "Stale · 2h ago", tone: "paused" }}
			/>,
		);

		expect(html.match(/Stale · 2h ago/g)).toHaveLength(2);
		expect(html).toMatch(/Real time clock<\/dt>.*?Stale · 2h ago.*?Last known/);
		expect(html).toMatch(/Water temperature<\/dt>.*?26.9 °C.*?Stale · 2h ago/);
	});

	it("prints the RTC health once and marks a fault as offline", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList
				status="idle"
				level={30}
				active
				rtc={{ value: "Fault", status: "Offline", tone: "paused" }}
				waterTemp={{ value: "—", status: "Not reported", tone: "muted" }}
			/>,
		);

		// The value is the strip's health string; the status is the state, so
		// "Fault" is announced once instead of twice.
		expect(html.match(/Fault/g)).toHaveLength(1);
		expect(html).toMatch(/Real time clock<\/dt>.*?Fault.*?Offline/);
		expect(html).toMatch(/Water temperature<\/dt>.*?—.*?Not reported/);
	});

	it("marks a never-reported RTC as no reading", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList
				status="idle"
				level={30}
				active
				rtc={{ value: "Not reported", status: "No reading", tone: "muted" }}
				waterTemp={WATER_LIVE}
			/>,
		);

		expect(html).toMatch(/Real time clock<\/dt>.*?Not reported.*?No reading/);
	});

	it("falls back to no reading when the telemetry extras are absent", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="idle" level={30} active />,
		);

		expect(html).toMatch(/Real time clock<\/dt>.*?—.*?No reading/);
		expect(html).toMatch(/Water temperature<\/dt>.*?—.*?No reading/);
	});

	it("keeps the last known hopper level but shows the sensor offline", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="offline" level={30} active />,
		);

		expect(html).toContain("30%");
		expect(html).toContain("Last known");
		expect(html).toContain("Offline");
		// #810: the sensor is not "Reading" while its unit is offline.
		expect(html).not.toContain("Reading");
		expect(html).toContain("—");
	});

	it("marks the hopper last known when an online unit's sensor is faulted (#810)", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="idle" level={30} sensorOffline active />,
		);

		expect(html).toContain("30%");
		expect(html).toContain("Offline");
		expect(html).not.toContain("Reading");
		expect(html).toContain("—");
		// The hopper is the only component whose reading is last known here;
		// motor/auger still use the live tone while online and idle.
		expect(html.match(/Last known/g)).toHaveLength(1);
		expect(html).toMatch(/Hopper<\/dt>.*?30%.*?Last known/);
	});

	it("keeps the hopper at no reading when an online sensor is faulted without a level (#810)", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="idle" level={null} sensorOffline active />,
		);

		// Hopper plus the two telemetry fallbacks.
		expect(html.match(/No reading/g)).toHaveLength(3);
		expect(html).toContain("Offline");
		expect(html).toContain("—");
	});

	it("shows no reading when the level is missing", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="offline" level={null} active />,
		);

		// The hopper, RTC and water temperature have no reading; the sensor is
		// offline instead (#810).
		expect(html.match(/No reading/g)).toHaveLength(3);
		expect(html).toContain("Offline");
		expect(html).toContain("—");
	});

	it("renders nothing outside ISO mode", () => {
		expect(
			renderToStaticMarkup(<FeederComponentStatusList status="idle" level={30} active={false} />),
		).toBe("");
	});
});
