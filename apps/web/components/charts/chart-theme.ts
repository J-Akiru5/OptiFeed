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

export function seriesColor(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length];
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
