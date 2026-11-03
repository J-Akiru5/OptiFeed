"use client";

import { useEffect, useState } from "react";

/**
 * Brand palette for every chart (E15).
 *
 * The app's theme provider toggles `.dark` on `<html>` (it does not use a
 * third-party theme library), so the charts read the class directly instead of
 * depending on a React context. That keeps a chart usable in a test render and
 * in any surface that is not wrapped by the provider.
 */
export const CHART_COLORS = {
	navy: "#0A3D62",
	orange: "#C2410C",
	green: "#1E7B34",
	teal: "#0F766E",
	amber: "#B45309",
	red: "#C42B3A",
	slate: "#64748B",
} as const;

/** Colour for the Nth series/segment; stable order, brand first. */
export const SERIES_COLORS = [
	CHART_COLORS.orange,
	CHART_COLORS.navy,
	CHART_COLORS.green,
	CHART_COLORS.teal,
	CHART_COLORS.amber,
	CHART_COLORS.red,
] as const;

/**
 * The same six hues lifted for a dark surface (#631).
 *
 * The light palette is tuned against a white card, where navy `#0A3D62` is
 * 11.3:1. On the console's dark surface `#111A2C` that navy falls to **1.54:1**,
 * so the second series of a stacked bar or donut disappeared into the card
 * (WCAG 1.4.11 asks 3:1 for graphical objects). These replacements keep the
 * series order and stay above 6:1 on `#111A2C`; `superadmin-theme.test.tsx`
 * reads the surface out of `globals.css` and checks every entry in both themes.
 */
export const DARK_SERIES_COLORS = [
	"#F97316", // orange
	"#7FB0D0", // sky
	"#4ADE80", // green
	"#5EEAD4", // teal
	"#FBBF24", // amber
	"#F87171", // red
] as const;

export function seriesColor(index: number, dark = false): string {
	const palette = dark ? DARK_SERIES_COLORS : SERIES_COLORS;
	return palette[index % palette.length];
}

export interface ChartTheme {
	dark: boolean;
	axis: string;
	grid: string;
	tooltipBg: string;
	tooltipBorder: string;
	tooltipText: string;
	muted: string;
	/** Base stroke for a primary single-series chart. */
	primary: string;
	secondary: string;
	tertiary: string;
}

const LIGHT: ChartTheme = {
	dark: false,
	axis: "#64748B",
	grid: "rgba(10, 61, 98, 0.10)",
	tooltipBg: "#FFFFFF",
	tooltipBorder: "#E2E8F0",
	tooltipText: "#0A3D62",
	muted: "#3D5568",
	primary: CHART_COLORS.navy,
	secondary: CHART_COLORS.orange,
	tertiary: CHART_COLORS.green,
};

const DARK: ChartTheme = {
	dark: true,
	axis: "#94A3B8",
	grid: "rgba(255, 255, 255, 0.08)",
	tooltipBg: "#0F172A",
	tooltipBorder: "rgba(255, 255, 255, 0.14)",
	tooltipText: "#F8FAFC",
	muted: "#CBD5E1",
	primary: "#7FB0D0",
	secondary: "#F97316",
	tertiary: "#4ADE80",
};

/** Read the current theme and re-render when `.dark` is toggled. */
export function useChartTheme(): ChartTheme {
	const [dark, setDark] = useState(false);

	useEffect(() => {
		const root = document.documentElement;
		const update = () => setDark(root.classList.contains("dark"));
		update();
		const observer = new MutationObserver(update);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return dark ? DARK : LIGHT;
}

/** Tooltip styling shared by all charts. */
export function tooltipStyle(theme: ChartTheme) {
	return {
		backgroundColor: theme.tooltipBg,
		border: `1px solid ${theme.tooltipBorder}`,
		borderRadius: "0.75rem",
		color: theme.tooltipText,
		fontSize: "12px",
		padding: "8px 10px",
	} as const;
}
