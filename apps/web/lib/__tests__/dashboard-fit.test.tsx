import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Issue #399: the farmer dashboard must fit one screen at 100 % zoom.
 *
 * The report was a 100 %-zoom laptop screenshot where the control room ran past
 * the viewport, so the page scrolled and the last chart (and the hero below the
 * fold) could only be reached by scrolling. #188 already made the dashboard a
 * one-viewport grid, but the height was the literal `calc(100dvh - 8rem)` and
 * every block kept its desktop size, so a 768 px-tall laptop had no room left
 * once the three chart cards were laid out.
 *
 * These checks lock the fix in four ways:
 *   1. the chrome height is a pair of tokens that match `layout.tsx`, so the
 *      header (`h-16`) and the pane padding (`md:p-8`) cannot drift apart;
 *   2. the shell takes its height from `ofd-control-room` and nothing in the
 *      room is hidden or clipped to make it fit;
 *   3. the density tiers get *more* compact as the viewport gets shorter, and
 *      the plot area is CSS-sized so the chart cannot overflow its card;
 *   4. a height budget driven by those CSS values leaves at least 96 px for the
 *      pond canvas at 1366x768, 1440x900, 1536x864 and 1920x1080.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { ChartFrame } from "@/components/charts/chart-frame";
import {
	ControlRoomLayout,
	ControlRoomRail,
} from "@/components/dashboard/control-room/control-room-shell";
import { NextFeedingStrip } from "@/components/dashboard/control-room/next-feeding-strip";

const webRoot = join(__dirname, "../..");
const read = (relative: string) => readFileSync(join(webRoot, relative), "utf8");

const globalsCss = read("app/globals.css");
const layoutSource = read("app/[locale]/(dashboard)/layout.tsx");
const shellSource = read("components/dashboard/control-room/control-room-shell.tsx");
const pageSource = read("app/[locale]/(dashboard)/dashboard/page.tsx");

const xlBlockStart = globalsCss.indexOf("@media (min-width: 80rem) {");
const tier900Start = globalsCss.indexOf("@media (min-width: 80rem) and (max-height: 900px)");
const tier800Start = globalsCss.indexOf("@media (min-width: 80rem) and (max-height: 800px)");

/** The tiles/short/very-short blocks, in file order. */
const TIER_BLOCKS = {
	base: globalsCss.slice(xlBlockStart, tier900Start),
	short: globalsCss.slice(tier900Start, tier800Start),
	veryShort: globalsCss.slice(tier800Start),
} as const;

const remToPx = (value: number) => value * 16;

/** A `--ofd-*` length declared in a block, in px, with a fallback to `base`. */
function token(block: string, name: string, fallback?: number): number {
	const match = block.match(new RegExp(`${name}:\\s*([\\d.]+)rem`));
	if (match) return remToPx(Number.parseFloat(match[1]));
	if (fallback !== undefined) return fallback;
	throw new Error(`missing ${name}`);
}

/** A token declared once for the whole app (`:root`), not per density tier. */
function chromeToken(name: string): number {
	const match = globalsCss.match(new RegExp(`${name}:\\s*([\\d.]+)rem`));
	if (!match) throw new Error(`missing ${name}`);
	return remToPx(Number.parseFloat(match[1]));
}

interface Density {
	plot: number;
	gap: number;
	heroPad: number;
	heroTime: number;
	chartPad: number;
	legendSize: number;
}

function density(block: string, base?: Density): Density {
	return {
		plot: token(block, "--ofd-plot-h", base?.plot),
		gap: token(block, "--ofd-room-gap", base?.gap),
		heroPad: token(block, "--ofd-hero-pad", base?.heroPad),
		heroTime: token(block, "--ofd-hero-time", base?.heroTime),
		chartPad: token(block, "--ofd-chart-pad", base?.chartPad),
		legendSize: token(block, "--ofd-legend-size", base?.legendSize),
	};
}

const BASE: Density = {
	// The default plot area is declared once in `:root`; the tiers override it.
	plot: chromeToken("--ofd-plot-h"),
	gap: token(TIER_BLOCKS.base, "--ofd-room-gap"),
	heroPad: token(TIER_BLOCKS.base, "--ofd-hero-pad"),
	heroTime: token(TIER_BLOCKS.base, "--ofd-hero-time"),
	chartPad: token(TIER_BLOCKS.base, "--ofd-chart-pad"),
	legendSize: token(TIER_BLOCKS.base, "--ofd-legend-size"),
};
const SHORT = density(TIER_BLOCKS.short, BASE);
const VERY_SHORT = density(TIER_BLOCKS.veryShort, SHORT);

/**
 * Worst-case content heights taken from the markup, not measured in a browser:
 *
 * - the hero's time group may wrap to two lines (`leading-none`, so 2 x font),
 *   plus the `gap-y-2` row gap and the 22 px status pill;
 * - a chart card is `2 x padding + title + mt-4 + plot + legend`;
 * - the feed chart's legend has four sources, and in the narrowest 3-column
 *   grid each entry wraps to two lines at 1.5 x its font size, with
 *   `gap-y-1.5` between rows;
 * - the water-range control is 36 px plus `mb-2`.
 */
const MARKUP = {
	heroRowGapAndPill: 8 + 22,
	chartTitleAndPlotOffset: 20 + 16,
	legendOffset: 12 + 18,
	legendLines: 4 * 2,
	rangeControl: 44,
	/** The pond canvas must keep a usable height; it is the flexible row. */
	pondFloor: 96,
} as const;

function usedHeight(d: Density): number {
	const legendHeight = MARKUP.legendOffset + MARKUP.legendLines * Math.round(d.legendSize * 1.5);
	const chartCard = 2 * d.chartPad + MARKUP.chartTitleAndPlotOffset + d.plot + legendHeight;
	const charts = MARKUP.rangeControl + chartCard;
	const hero = 2 * d.heroPad + 2 * d.heroTime + MARKUP.heroRowGapAndPill;
	return hero + charts + 2 * d.gap;
}

/** Laptop viewports at 100 % zoom. */
const VIEWPORTS = [
	{ name: "1366x768", width: 1366, height: 768 },
	{ name: "1440x900", width: 1440, height: 900 },
	{ name: "1536x864", width: 1536, height: 864 },
	{ name: "1920x1080", width: 1920, height: 1080 },
] as const;

function densityFor(viewportHeight: number): Density {
	if (viewportHeight <= 800) return VERY_SHORT;
	if (viewportHeight <= 900) return SHORT;
	return BASE;
}

describe("control-room height tokens (#399)", () => {
	it("derives the room height from the real header and pane padding", () => {
		// The two tokens describe what layout.tsx actually renders.
		expect(layoutSource).toContain("h-16 w-full items-center justify-between");
		expect(layoutSource).toContain("p-4 focus:outline-none md:p-8");

		expect(chromeToken("--ofd-topbar-h")).toBe(64);
		expect(chromeToken("--ofd-main-pad-y")).toBe(32);

		// 64 px header + 2 x 32 px padding is the old literal 8rem, now derived.
		expect(TIER_BLOCKS.base).toContain(
			"height: calc(100dvh - var(--ofd-topbar-h) - (2 * var(--ofd-main-pad-y)))",
		);
	});

	it("sizes the plot area in CSS so the chart fills the card it reports", () => {
		expect(globalsCss).toContain(".ofd-plot {");
		expect(globalsCss).toContain("flex: none;");
		expect(globalsCss).toContain("height: var(--ofd-plot-h);");
	});

	it("never hides or clips to make the room fit", () => {
		const room = globalsCss.slice(
			globalsCss.indexOf("Farmer control room (issue #399)"),
			globalsCss.indexOf("The help centre's"),
		);
		for (const forbidden of [
			"display: none",
			"visibility: hidden",
			"overflow: hidden",
			"text-overflow",
		]) {
			expect(room, `control room must not use ${forbidden}`).not.toContain(forbidden);
		}
	});
});

describe("density tiers (#399)", () => {
	it("steps the plot area down as the viewport gets shorter", () => {
		expect(BASE.plot).toBe(130); // unchanged on a 1080 px-tall screen
		expect(SHORT.plot).toBe(104);
		expect(VERY_SHORT.plot).toBe(88);
		expect(VERY_SHORT.plot).toBeLessThan(SHORT.plot);
		expect(SHORT.plot).toBeLessThan(BASE.plot);
	});

	it("tightens padding and the hero time, but keeps the legend readable", () => {
		expect(VERY_SHORT.gap).toBeLessThan(BASE.gap);
		expect(VERY_SHORT.heroPad).toBeLessThan(BASE.heroPad);
		expect(VERY_SHORT.heroTime).toBeLessThan(BASE.heroTime);
		expect(VERY_SHORT.chartPad).toBeLessThan(BASE.chartPad);
		// 10 px bold legend text is still above the 9 px the console uses for
		// micro-labels, and it is the only text that shrinks.
		expect(VERY_SHORT.legendSize).toBeGreaterThanOrEqual(10);
	});

	it("leaves at least 96 px for the pond canvas at every laptop size", () => {
		const chrome = (dvh: number) =>
			dvh - chromeToken("--ofd-topbar-h") - 2 * chromeToken("--ofd-main-pad-y");

		for (const viewport of VIEWPORTS) {
			const available = chrome(viewport.height);
			const remaining = available - usedHeight(densityFor(viewport.height));
			expect(
				remaining,
				`${viewport.name}: the pond canvas would be ${remaining} px`,
			).toBeGreaterThanOrEqual(MARKUP.pondFloor);
		}
	});
});

describe("control-room markup (#399)", () => {
	it("takes its height from the shell class and keeps the rail the only scroller", () => {
		expect(shellSource).toContain("ofd-control-room");
		expect(shellSource).not.toContain("100dvh-8rem");
		expect(shellSource).toContain("xl:overflow-hidden");

		const html = renderToStaticMarkup(
			<ControlRoomLayout>
				<div>block</div>
			</ControlRoomLayout>,
		);
		expect(html).toContain("ofd-control-room");
		expect(html).toContain("xl:overflow-hidden");
		expect(html).not.toContain("100dvh");

		const rail = renderToStaticMarkup(
			<ControlRoomRail label="Pond controls">
				<div>rail</div>
			</ControlRoomRail>,
		);
		expect(rail).toContain("xl:overflow-y-auto");
		expect(rail).toContain("xl:overflow-x-hidden");
		expect(rail).toContain("xl:min-h-0");
	});

	it("positions both scrollers so 1 px sr-only helpers cannot add a phantom scroll", () => {
		// The blocks carry absolutely positioned `.sr-only` text alternatives and
		// the charts' hidden tables. With no positioned ancestor inside the room
		// they are positioned against `main`, escape `overflow-hidden`, and the
		// page scrolls even though every block fits — the reported symptom (#399).
		const room = renderToStaticMarkup(
			<ControlRoomLayout>
				<div>block</div>
			</ControlRoomLayout>,
		);
		expect(room).toContain("relative");
		expect(room).not.toContain("absolute");

		const rail = renderToStaticMarkup(
			<ControlRoomRail label="Pond controls">
				<div>rail</div>
			</ControlRoomRail>,
		);
		expect(rail).toContain("xl:relative");
		expect(rail).toContain("xl:overflow-y-auto");
	});

	it("marks the hero strip and the CSS-sized chart cards on the dashboard", () => {
		const hero = renderToStaticMarkup(
			<NextFeedingStrip
				pondName="Demo Pond"
				label="NEXT SCHEDULED FEEDING"
				time="12:00"
				timeSrLabel="Next feeding time"
				isPaused={false}
				statusLabel="ESP32 Auto-Timer On"
				volumeLabel="FEED VOLUME"
				volumeValue="330 g"
				rateLabel="Feeding Rate"
				rateValue="3% BW/Day"
				basedOn={null}
				updateLabel="Update Biomass Weight"
				updateHref="/dashboard/log-sample"
			/>,
		);
		expect(hero).toContain("ofd-hero-strip");
		expect(hero).toContain("ofd-hero-time");

		// Data logic untouched: the page passes a percentage height, which only
		// works because the plot area is sized by CSS (`ofd-plot`).
		expect(pageSource.match(/plotClassName="ofd-plot"/g)).toHaveLength(3);
		expect(pageSource.match(/height="100%"/g)).toHaveLength(3);
		expect(pageSource.match(/ofd-chart-card/g)).toHaveLength(3);
	});

	it("renders the plot area with the caller's sizing class", () => {
		const html = renderToStaticMarkup(
			<ChartFrame
				title="Feed per day"
				summary="Feed per day"
				emptyLabel="No data"
				isEmpty={false}
				plotClassName="ofd-plot"
				table={<table />}
			>
				<svg aria-hidden="true" />
			</ChartFrame>,
		);
		expect(html).toContain('role="img"');
		expect(html).toContain("ofd-plot");
	});
});
