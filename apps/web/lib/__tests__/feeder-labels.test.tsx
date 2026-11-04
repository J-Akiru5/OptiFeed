import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { FeederComponentStatusList } from "@/components/feeder/feeder-labels";

describe("FeederComponentStatusList", () => {
	it("renders the six components in physical top-to-bottom order", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="idle" level={30} active />,
		);

		expect(html).toContain('data-testid="feeder-component-status"');
		expect(html).toContain('id="feeder-component-status"');
		expect(html).toContain("Hopper");
		expect(html).toContain("Ultrasonic sensor");
		expect(html).toContain("Controller");
		expect(html).toContain("Motor");
		expect(html).toContain("Auger");
		expect(html).toContain("Outlet");
		expect(html.indexOf("Hopper")).toBeLessThan(html.indexOf("Ultrasonic sensor"));
		expect(html.indexOf("Motor")).toBeLessThan(html.indexOf("Auger"));
	});

	it("shows live values for an idle feeder", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="idle" level={30} active />,
		);

		expect(html).toContain("30%");
		expect(html).toContain("Reading");
		expect(html).toContain("Online");
		expect(html).toContain("Idle");
		expect(html).toContain("Ready");
		expect(html).toContain("Live");
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

		expect(html.match(/No reading/g)).toHaveLength(1);
		expect(html).toContain("Offline");
		expect(html).toContain("—");
	});

	it("shows no reading when the level is missing", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="offline" level={null} active />,
		);

		// Only the hopper has no reading; the sensor itself is offline (#810).
		expect(html.match(/No reading/g)).toHaveLength(1);
		expect(html).toContain("Offline");
		expect(html).toContain("—");
	});

	it("renders nothing outside ISO mode", () => {
		expect(
			renderToStaticMarkup(<FeederComponentStatusList status="idle" level={30} active={false} />),
		).toBe("");
	});
});
