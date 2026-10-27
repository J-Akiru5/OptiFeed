import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import hil from "../../messages/hil.json";
import { FEED_EVENT_SOURCES, feedSourceKey } from "../feed-sources";

describe("feed sources", () => {
	it("keeps device and hand-fed sources, and never relabels others as a device source", () => {
		expect(feedSourceKey("scheduled")).toBe("scheduled");
		expect(feedSourceKey("hand_fed")).toBe("hand_fed");
		expect(feedSourceKey("import")).toBe("other");
		expect(feedSourceKey(null)).toBe("other");
	});

	it("has a History label for every source in both locales", () => {
		for (const key of [...FEED_EVENT_SOURCES, "other"]) {
			expect(en.dashboard.history, key).toHaveProperty(`source_${key}`);
			expect(hil.dashboard.history, key).toHaveProperty(`source_${key}`);
		}
	});
});
