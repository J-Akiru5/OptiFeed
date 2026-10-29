import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { FeederFallback } from "@/components/feeder/feeder-fallback";

describe("FeederFallback", () => {
	it("carries the live status and hopper level without WebGL", () => {
		const html = renderToStaticMarkup(
			<FeederFallback
				label="CICT Building A Feeder"
				status="dispensing"
				feedLevelPercent={30}
				lastFedLabel="Oct 29, 10:00 AM"
			/>,
		);

		expect(html).toContain("CICT Building A Feeder");
		expect(html).toContain("Dispensing");
		expect(html).toContain("30%");
		expect(html).toContain("Oct 29, 10:00 AM");
		expect(html).toContain("feeder-viewer-fallback");
	});

	it("says no reading when the level is null", () => {
		const html = renderToStaticMarkup(
			<FeederFallback
				label="Feeder"
				status="offline"
				feedLevelPercent={null}
				lastFedLabel={null}
			/>,
		);

		expect(html).toContain("Offline");
		expect(html).toContain("—");
		expect(html).toContain("No reading yet");
	});
});
