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

	it("keeps the last known level and marks every module offline", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="offline" level={30} active />,
		);

		expect(html).toContain("30%");
		expect(html).toContain("Reading");
		expect(html).toContain("Last known");
		expect(html).toContain("Offline");
	});

	it("shows no reading when the level is missing", () => {
		const html = renderToStaticMarkup(
			<FeederComponentStatusList status="offline" level={null} active />,
		);

		expect(html).toContain("No reading");
		expect(html).toContain("—");
	});

	it("renders nothing outside ISO mode", () => {
		expect(
			renderToStaticMarkup(<FeederComponentStatusList status="idle" level={30} active={false} />),
		).toBe("");
	});
});
