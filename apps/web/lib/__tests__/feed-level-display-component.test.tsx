import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { FeedLevelDisplay } from "@/components/feed-level-display";

const readingAt = new Date("2026-08-28T09:32:00+08:00");

function render(props: {
	levelPercent: number | null;
	updatedAt: Date | null;
	isOffline: boolean;
}) {
	return renderToStaticMarkup(
		<FeedLevelDisplay
			levelPercent={props.levelPercent}
			updatedAt={props.updatedAt}
			isOffline={props.isOffline}
		/>,
	);
}

describe("FeedLevelDisplay", () => {
	it("shows the live percentage while the device is online", () => {
		const html = render({ levelPercent: 82, updatedAt: readingAt, isOffline: false });

		expect(html).toContain("82%");
		expect(html).not.toContain("Last known");
		expect(html).not.toContain("No reading yet");
	});

	it("shows the last known level, its reading time and an Offline tag when offline", () => {
		const html = render({ levelPercent: 82, updatedAt: readingAt, isOffline: true });

		expect(html).toContain("Last known 82%");
		expect(html).toContain("Offline");
		expect(html).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
	});

	it("shows a dash and no-reading copy when no reading ever arrived", () => {
		const html = render({ levelPercent: null, updatedAt: null, isOffline: true });

		expect(html).toContain("—");
		expect(html).toContain("No reading yet");
		expect(html).not.toContain("Last known");
	});

	it("shows a dash even when an online device has never reported", () => {
		const html = render({ levelPercent: null, updatedAt: null, isOffline: false });

		expect(html).toContain("—");
		expect(html).toContain("No reading yet");
	});
});
