import {
	EVENT_COLOR_PALETTE,
	EVENT_TYPE_COLORS,
	contrastRatio,
	eventTypeColor,
	resolveEventColor,
} from "@/lib/calendar/event-colors";
import { describe, expect, it } from "vitest";

describe("calendar event colours", () => {
	it("keeps every type default and palette swatch at WCAG AA on white text", () => {
		for (const [type, color] of Object.entries(EVENT_TYPE_COLORS)) {
			expect(contrastRatio(color, "#ffffff"), `${type} ${color}`).toBeGreaterThanOrEqual(4.5);
		}
		for (const color of EVENT_COLOR_PALETTE) {
			expect(contrastRatio(color, "#ffffff"), color).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("uses a distinct default per type", () => {
		const values = Object.values(EVENT_TYPE_COLORS);
		expect(new Set(values.map((value) => value.toLowerCase())).size).toBe(values.length);
	});

	it("falls back to the type default for missing or malformed colours", () => {
		expect(resolveEventColor(null, "SAMPLING")).toBe(EVENT_TYPE_COLORS.SAMPLING);
		expect(resolveEventColor("red", "STOCKING")).toBe(EVENT_TYPE_COLORS.STOCKING);
		expect(resolveEventColor("#123456", "STOCKING")).toBe("#123456");
		expect(eventTypeColor("UNKNOWN")).toBe(EVENT_TYPE_COLORS.OTHER);
	});
});
