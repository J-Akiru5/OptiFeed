import {
	MONITORING_HUD_BORDER_CLASSES,
	MONITORING_TONE_CLASSES,
} from "@/components/status/monitoring-status-badge";
import { contrastRatio } from "@/lib/calendar/event-colors";
import { describe, expect, it } from "vitest";

/**
 * #884: the mobile status monitoring chip was nearly invisible in dark mode.
 *
 * The chip is opaque navy with a tone-coloured border; on the dark dashboard
 * (`#0f1419`) the navy fill alone is 1.2:1, so the border is what identifies
 * the control. These are the measured WCAG 2.1 ratios for the labels and that
 * boundary — text at 4.5:1 (AA), component boundary at 3:1 (1.4.11). The view
 * layer is verified separately by axe in `monitoring-quick-view.test.tsx`.
 */

/** `rgba(255,255,255,0.7)` over an opaque navy, pre-composited for the ratio. */
const WHITE_70_ON_LIGHT_NAVY = "#B4BAC4"; // over #06263f
const WHITE_70_ON_DARK_NAVY = "#B6C2CC"; // over #0b3554

const LIGHT_HUD = "#06263f";
const DARK_HUD = "#0b3554";
const LIGHT_PAGE = "#f4f7f6";
const DARK_PAGE = "#0f1419";

interface TextPair {
	label: string;
	background: string;
	foreground: string;
}

const TEXT_PAIRS: TextPair[] = [
	// Status badge, light theme.
	{ label: "badge active, light", background: "#C2410C", foreground: "#FFFFFF" },
	{ label: "badge attention, light", background: "#FACC15", foreground: "#3B2F00" },
	{ label: "badge offline, light", background: "#C42B3A", foreground: "#FFFFFF" },
	{ label: "badge neutral, light", background: "#E5E7EB", foreground: "#0A3D62" },
	// Status badge, dark theme.
	{ label: "badge active, dark", background: "#FF5A1F", foreground: "#1A0A02" },
	{ label: "badge attention, dark", background: "#FACC15", foreground: "#3B2F00" },
	{ label: "badge offline, dark", background: "#C42B3A", foreground: "#FFFFFF" },
	{ label: "badge neutral, dark", background: "#374151", foreground: "#F3F4F6" },
	// The chip's own labels.
	{ label: "chip labels, light", background: LIGHT_HUD, foreground: WHITE_70_ON_LIGHT_NAVY },
	{ label: "chip labels, dark", background: DARK_HUD, foreground: WHITE_70_ON_DARK_NAVY },
	{ label: "chip level value, light", background: LIGHT_HUD, foreground: "#FFFFFF" },
	{ label: "chip level value, dark", background: DARK_HUD, foreground: "#FFFFFF" },
];

describe("mobile monitoring chip contrast (#884)", () => {
	it("documents the classes those pairs come from", () => {
		expect(MONITORING_TONE_CLASSES.active).toContain("dark:bg-[#FF5A1F]");
		expect(MONITORING_TONE_CLASSES.active).toContain("dark:text-[#1A0A02]");
		expect(MONITORING_TONE_CLASSES.offline).toContain("bg-[#C42B3A]");
		expect(MONITORING_TONE_CLASSES.attention).toContain("text-[#3B2F00]");

		expect(MONITORING_HUD_BORDER_CLASSES.active).toContain("border-[#FF8A5C]");
		expect(MONITORING_HUD_BORDER_CLASSES.attention).toContain("border-[#FACC15]");
		expect(MONITORING_HUD_BORDER_CLASSES.offline).toContain("border-[#F87171]");
	});

	it("meets WCAG AA (4.5:1) for every label it affects", () => {
		for (const pair of TEXT_PAIRS) {
			expect(
				contrastRatio(pair.background, pair.foreground),
				`${pair.label}: ${pair.foreground} on ${pair.background}`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("gives the chip a boundary of at least 3:1 in both themes", () => {
		// Light theme: the opaque navy chip against the page.
		expect(contrastRatio(LIGHT_PAGE, LIGHT_HUD)).toBeGreaterThanOrEqual(3);

		// Dark theme: the fill is a decorative lift; the tone border is the
		// boundary WCAG 1.4.11 measures.
		const darkBorders: Array<[string, string]> = [
			["active", "#FF8A5C"],
			["attention", "#FACC15"],
			["offline", "#F87171"],
			["neutral", "#6D8698"], // white/40 over #0b3554
		];
		for (const [tone, border] of darkBorders) {
			expect(
				contrastRatio(DARK_PAGE, border),
				`${tone} border on the dark page`,
			).toBeGreaterThanOrEqual(3);
		}
	});
});
