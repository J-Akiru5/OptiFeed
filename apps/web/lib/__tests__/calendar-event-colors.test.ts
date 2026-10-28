import {
	CALENDAR_MORE_COLORS,
	CALENDAR_THEME_SURFACE,
	type CalendarTheme,
	EVENT_COLOR_PALETTE,
	EVENT_TYPE_COLORS,
	contrastRatio,
	eventChipColors,
	eventTypeColor,
	meetsChipContrast,
	resolveEventColor,
} from "@/lib/calendar/event-colors";
import { describe, expect, it } from "vitest";

/**
 * Colours the calendar renders outside the manual palette: the harvest
 * states, sampling, device and the status fallback from `calendar-view.tsx`.
 */
const VIEW_EVENT_COLORS = [
	"#FF6B35", // harvest planned
	"#9CA3AF", // harvest cancelled
	"#1E7B34", // harvest done
	"#0F766E", // sampling
	"#7C3AED", // manual (type fallback)
	"#C42B3A", // device
	"#64748B", // unknown type
] as const;

const ALL_EVENT_COLORS = [
	...Object.values(EVENT_TYPE_COLORS),
	...EVENT_COLOR_PALETTE,
	...VIEW_EVENT_COLORS,
] as const;

const THEMES: CalendarTheme[] = ["light", "dark"];

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

describe("theme-aware event chip colours (#272)", () => {
	it("returns a WCAG AA pair for every event colour in both themes", () => {
		for (const theme of THEMES) {
			for (const color of ALL_EVENT_COLORS) {
				const chip = eventChipColors(color, theme);
				expect(
					meetsChipContrast(chip),
					`${theme} ${color} -> ${chip.foreground} on ${chip.background}`,
				).toBe(true);
				expect(
					contrastRatio(chip.background, chip.foreground),
					`${theme} ${color} -> ${chip.background}/${chip.foreground}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("repairs the colours that cannot carry white text in light mode", () => {
		// The two light-mode failures that motivated the helper.
		expect(contrastRatio("#FF6B35", "#ffffff")).toBeLessThan(4.5);
		expect(contrastRatio("#9CA3AF", "#ffffff")).toBeLessThan(4.5);
		expect(eventChipColors("#FF6B35", "light").background).not.toBe("#FF6B35");
		expect(eventChipColors("#9CA3AF", "light").background).not.toBe("#9CA3AF");
	});

	it("keeps each event's hue instead of flattening the palette", () => {
		const darkBackgrounds = new Set(
			ALL_EVENT_COLORS.map((color) => eventChipColors(color, "dark").background.toLowerCase()),
		);
		const uniqueColors = new Set(ALL_EVENT_COLORS.map((color) => color.toLowerCase()));

		expect(darkBackgrounds.size).toBe(uniqueColors.size);
		// The red chip is still red, the green chip still green: the dark pair
		// is a tint of the stored colour, not a grey.
		const red = eventChipColors("#B91C1C", "dark");
		const green = eventChipColors("#1E7B34", "dark");
		expect(red.background).not.toBe(green.background);
		expect(red.foreground).not.toBe(green.foreground);
	});

	it("keeps the dark chip surface distinct from the calendar background", () => {
		for (const color of ALL_EVENT_COLORS) {
			const chip = eventChipColors(color, "dark");
			expect(
				contrastRatio(chip.background, CALENDAR_THEME_SURFACE.dark),
				`${color} chip on the dark calendar surface`,
			).toBeGreaterThan(1.2);
		}
	});

	it("falls back to the OTHER default for a malformed stored colour", () => {
		expect(eventChipColors("not-a-colour", "light")).toEqual(
			eventChipColors(EVENT_TYPE_COLORS.OTHER, "light"),
		);
		expect(eventChipColors("not-a-colour", "dark")).toEqual(
			eventChipColors(EVENT_TYPE_COLORS.OTHER, "dark"),
		);
	});

	it('keeps the "+N more" link readable in both themes', () => {
		for (const theme of THEMES) {
			const more = CALENDAR_MORE_COLORS[theme];
			expect(contrastRatio(more.background, more.foreground), theme).toBeGreaterThanOrEqual(4.5);
		}
		// The links sit on the theme's tinted pill, not only on the cell.
		expect(contrastRatio(CALENDAR_MORE_COLORS.light.foreground, "#DBDBDB")).toBeGreaterThanOrEqual(
			4.5,
		);
		expect(contrastRatio(CALENDAR_MORE_COLORS.dark.foreground, "#323946")).toBeGreaterThanOrEqual(
			4.5,
		);
	});
});
