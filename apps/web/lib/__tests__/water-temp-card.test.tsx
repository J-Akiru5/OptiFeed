import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { getTranslations: async (namespace: string) => createTranslator(namespace) };
});

import { WaterTempCard } from "@/components/WaterTempCard";

/**
 * Water temperature card with a warn-only feeding minimum (issue #486).
 *
 * The card must stay quiet when no limit is set, and it must never present a
 * cold reading as fine. It also must not warn on a stale reading: an old value
 * cannot say what the water is doing now.
 */

const RECENT = new Date("2026-11-02T08:00:00.000Z");

async function html(props: Parameters<typeof WaterTempCard>[0]) {
	return renderToStaticMarkup(await WaterTempCard(props));
}

describe("WaterTempCard", () => {
	it("shows no minimum at all when the pond has not set one", async () => {
		const output = await html({ tempC: 21.5, tempOk: true, updatedAt: RECENT });

		expect(output).toContain("21.5°C");
		expect(output).toContain("OK");
		expect(output).not.toContain("Feeding minimum");
		expect(output).not.toContain("Colder than");
	});

	it("warns, without claiming a feed was blocked, when the water is below the minimum", async () => {
		const output = await html({ tempC: 21.5, tempOk: true, updatedAt: RECENT, minFeedTempC: 24 });

		expect(output).toContain("Below minimum");
		expect(output).toContain("Colder than this pond&#x27;s feeding minimum of 24.0°C");
		expect(output).toContain("Feeding is not blocked");
		expect(output).not.toContain(">OK<");
	});

	it("shows the minimum as context once the water is warm enough", async () => {
		const output = await html({ tempC: 27.2, tempOk: true, updatedAt: RECENT, minFeedTempC: 24 });

		expect(output).toContain(">OK<");
		expect(output).toContain("Feeding minimum: 24.0°C");
		expect(output).not.toContain("Below minimum");
	});

	it("treats exactly the minimum as warm enough", async () => {
		const output = await html({ tempC: 24, tempOk: true, updatedAt: RECENT, minFeedTempC: 24 });

		expect(output).toContain(">OK<");
		expect(output).not.toContain("Below minimum");
	});

	it("keeps a stale reading stale instead of re-labeling it as too cold", async () => {
		const output = await html({
			tempC: 18,
			tempOk: true,
			updatedAt: RECENT,
			isDeviceOffline: true,
			minFeedTempC: 24,
		});

		expect(output).toContain("Stale");
		expect(output).not.toContain("Below minimum");
	});

	it("stays offline, not cold, when the probe reports nothing", async () => {
		const output = await html({ tempC: null, tempOk: false, updatedAt: null, minFeedTempC: 24 });

		expect(output).toContain("Sensor Offline");
		expect(output).toContain("Sensor offline");
		expect(output).not.toContain("Below minimum");
	});
});
