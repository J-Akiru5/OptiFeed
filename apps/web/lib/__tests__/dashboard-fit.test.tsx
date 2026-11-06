import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Issue #399: the farmer dashboard must fit one screen at 100 % zoom.
 * Issue #475: 100 % zoom on a 1366x768 laptop is a ~657 px *viewport*, not a
 * 768 px one, because the browser chrome takes ~111 px; a 1920x1080 laptop at
 * 125 % Windows scaling leaves ~700 px. The old tiers only knew about 768 px+
 * viewports, so the reported laptop had ~63 px less room than the budget needed.
 *
 * The reported screenshot showed the fixed rows running past the room: the
 * feed chart's legend wrapped a long localized label onto three lines (141 px
 * legend, more than half of the card), and the 800 px tier had been tuned for a
 * 768 px *viewport* even though the screen chrome leaves 657. Together they
 * pushed the chart row below the shell's `overflow-hidden`; the flexible pond
 * row collapsed to a clipped strip.
 *
 * These checks lock the fix in five ways:
 *   1. the chrome height is a pair of tokens that match `layout.tsx`, and the
 *      pane's vertical padding is the *same* token the room's height subtracts,
 *      so the header/padding math cannot drift apart;
 *   2. the shell takes its height from `ofd-control-room` and no panel is
 *      hidden or clipped to make it fit (the redundant legend label ellipsizes
 *      and its full text stays in the sr-only table);
 *   3. the density tiers get more compact as the viewport gets shorter, and the
 *      new <= 760 px tier covers the 100 %-zoom viewport, including the pane
 *      padding step-down;
 *   4. the legend is one single-line row per source, so a long translation
 *      cannot make a chart card's height depend on the language;
 *   5. a height budget driven by those CSS values leaves at least 96 px for the
 *      pond canvas at 1366x657, 1536x700 and the taller laptop sizes.
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
const pondSource = read("components/dashboard/control-room/pond-overview.tsx");
const pageSource = read("app/[locale]/(dashboard)/dashboard/page.tsx");

const xlBlockStart = globalsCss.indexOf("@media (min-width: 80rem) {");
const tier900Start = globalsCss.indexOf("@media (min-width: 80rem) and (max-height: 900px)");
const tier800Start = globalsCss.indexOf("@media (min-width: 80rem) and (max-height: 800px)");
const tier760Start = globalsCss.indexOf("@media (min-width: 80rem) and (max-height: 760px)");
const roomCssEnd = globalsCss.indexOf("/* The help centre's");

/** The base/short/very-short/100 %-zoom blocks, in file order. */
const TIER_BLOCKS = {
	base: globalsCss.slice(xlBlockStart, tier900Start),
	short: globalsCss.slice(tier900Start, tier800Start),
	veryShort: globalsCss.slice(tier800Start, tier760Start),
	tight: globalsCss.slice(tier760Start, roomCssEnd),
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
const TIGHT = density(TIER_BLOCKS.tight, VERY_SHORT);

/**
 * Worst-case content heights taken from the markup and the #475 report:
 *
 * - the hero strip is a single flex row that squeezes its groups. At 1366 px
 *   the Hiligaynon labels cannot all fit side by side, so the lead label, the
 *   status pill and the update caption wrap inside their columns; the report
 *   measured the strip at 182 px. Text measurement needs a browser, so the
 *   budget carries that measured height; the 1366x768 e2e covers the rendered
 *   strip, while the 657 px case is budget-checked only (no authenticated
 *   browser run covers it). The row itself does not gain rows, so its height is
 *   bounded; what used to grow without limit was the legend, which is now a
 *   fixed one-line-per-source grid;
 * - a chart card is `2 x padding + title (up to two lines on the narrow 1366 px
 *   cards) + mt-4 + plot + legend`;
 * - the water-range control is 36 px plus `mb-2`;
 * - the pond canvas must keep a usable height; it is the flexible row.
 */
const MARKUP = {
	hero: 182,
	chartTitleLines: 2,
	chartTitleLine: 21,
	chartPlotOffset: 16,
	legendOffset: 12,
	/** scheduled / dashboard / button / hand_fed. */
	legendRows: 4,
	legendRowGap: 4,
	rangeControl: 44,
	pondFloor: 96,
} as const;

/**
 * The control-room legend is a one-line grid with `line-height: 1.25` and one
 * line per source (`auto-fit` can only make it shorter), so its height is
 * deterministic. A stray source key adds a row; the budget's margin at
 * 1366x657 covers the few the schema can produce.
 */
function legendHeight(d: Density): number {
	const line = Math.ceil(d.legendSize * 1.25);
	return (
		MARKUP.legendOffset + MARKUP.legendRows * line + (MARKUP.legendRows - 1) * MARKUP.legendRowGap
	);
}

function usedHeight(d: Density): number {
	const chartCard =
		2 * d.chartPad +
		MARKUP.chartTitleLines * MARKUP.chartTitleLine +
		MARKUP.chartPlotOffset +
		d.plot +
		legendHeight(d);
	const charts = MARKUP.rangeControl + chartCard;
	return MARKUP.hero + charts + 2 * d.gap;
}

/**
 * The pane's vertical padding. The <= 760 px tier overrides the token on
 * `.ofd-main` (#475); read it from the CSS so the room's calc and the test
 * cannot disagree about which padding is in force.
 */
function mainPadFor(viewportHeight: number): number {
	return viewportHeight <= 760
		? token(TIER_BLOCKS.tight, "--ofd-main-pad-y")
		: chromeToken("--ofd-main-pad-y");
}

/** Laptop viewports at 100 % zoom: screen height minus browser chrome. */
const VIEWPORTS = [
	// 1366x768 screen at 100 %: the case in the #475 report.
	{ name: "1366x657 (1366x768 at 100 %)", width: 1366, height: 657 },
	// 1920x1080 screen at 125 % Windows scaling.
	{ name: "1536x700 (1920x1080 at 125 %)", width: 1536, height: 700 },
	{ name: "1366x768", width: 1366, height: 768 },
	{ name: "1440x900", width: 1440, height: 900 },
	{ name: "1536x864", width: 1536, height: 864 },
	{ name: "1920x1080", width: 1920, height: 1080 },
] as const;

function densityFor(viewportHeight: number): Density {
	if (viewportHeight <= 760) return TIGHT;
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

		// The pane pays the *same* token the room subtracts, so a tier that
		// steps the padding down moves both together (#475).
		expect(globalsCss).toContain("padding-top: var(--ofd-main-pad-y);");
		expect(globalsCss).toContain("padding-bottom: var(--ofd-main-pad-y);");
		expect(layoutSource).toContain("ofd-main ofd-main-room");
	});

	it("sizes the plot area in CSS so the chart fills the card it reports", () => {
		expect(globalsCss).toContain(".ofd-plot {");
		expect(globalsCss).toContain("flex: none;");
		expect(globalsCss).toContain("height: var(--ofd-plot-h);");
	});

	it("never hides a panel to make the room fit", () => {
		const room = globalsCss.slice(
			globalsCss.indexOf("Farmer control room (issue #399)"),
			globalsCss.indexOf("The help centre's"),
		);
		for (const forbidden of ["display: none", "visibility: hidden"]) {
			expect(room, `control room must not use ${forbidden}`).not.toContain(forbidden);
		}

		// The one deliberate clip is the legend's redundant visual label: its
		// value stays visible and the full label is in the sr-only data table.
		// Nothing else in the room may clip, so this count is the drift alarm.
		expect(room.split("overflow: hidden").length - 1).toBe(1);
		expect(room).toContain(".ofd-chart-legend > li > span:nth-of-type(2)");
	});
});

describe("density tiers (#399, #475)", () => {
	it("steps the plot area down as the viewport gets shorter", () => {
		expect(BASE.plot).toBe(130); // unchanged on a 1080 px-tall screen
		expect(SHORT.plot).toBe(104);
		expect(VERY_SHORT.plot).toBe(88);
		expect(TIGHT.plot).toBe(64); // the 100 %-zoom laptop
		expect(TIGHT.plot).toBeLessThan(VERY_SHORT.plot);
		expect(VERY_SHORT.plot).toBeLessThan(SHORT.plot);
		expect(SHORT.plot).toBeLessThan(BASE.plot);
	});

	it("tightens padding and the hero time, but keeps the legend readable", () => {
		expect(VERY_SHORT.gap).toBeLessThan(BASE.gap);
		expect(VERY_SHORT.heroPad).toBeLessThan(BASE.heroPad);
		expect(VERY_SHORT.heroTime).toBeLessThan(BASE.heroTime);
		expect(VERY_SHORT.chartPad).toBeLessThan(BASE.chartPad);
		expect(TIGHT.gap).toBeLessThan(VERY_SHORT.gap);
		expect(TIGHT.heroPad).toBeLessThan(VERY_SHORT.heroPad);
		expect(TIGHT.chartPad).toBeLessThan(VERY_SHORT.chartPad);
		// 10 px bold legend text is still above the 9 px the console uses for
		// micro-labels, and it is the only text that shrinks.
		expect(VERY_SHORT.legendSize).toBeGreaterThanOrEqual(10);
		expect(TIGHT.legendSize).toBeGreaterThanOrEqual(10);
	});

	it("covers the 100 %-zoom viewport with a <= 760 px tier", () => {
		// 1366x768 at 100 % is a 657 px viewport, not a 768 px one.
		expect(tier760Start).toBeGreaterThan(tier800Start);
		expect(TIER_BLOCKS.tight).toContain("--ofd-plot-h: 4rem;");
		expect(TIER_BLOCKS.tight).toContain("--ofd-room-gap: 0.5rem;");
		expect(TIER_BLOCKS.tight).toContain("--ofd-hero-pad: 0.75rem;");
		expect(TIER_BLOCKS.tight).toContain("--ofd-chart-pad: 0.5rem;");
		// The pane hands 16 px of its padding back to the room at this size,
		// and only the farmer dashboard pane does it (admin consoles keep 32).
		expect(TIER_BLOCKS.tight).toContain("--ofd-main-pad-y: 1rem;");
		expect(TIER_BLOCKS.tight).toContain(".ofd-main-room {");
		expect(TIER_BLOCKS.tight).not.toContain(".ofd-main {");
		expect(mainPadFor(657)).toBe(16);
		expect(mainPadFor(700)).toBe(16);
		expect(mainPadFor(768)).toBe(32);
		expect(densityFor(657)).toBe(TIGHT);
		expect(densityFor(700)).toBe(TIGHT);
		expect(densityFor(768)).toBe(VERY_SHORT);
	});

	it("leaves at least 96 px for the pond canvas at every laptop size", () => {
		const chrome = (dvh: number) => dvh - chromeToken("--ofd-topbar-h") - 2 * mainPadFor(dvh);

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

	it("keeps the dashboard's alert banners out of the desktop flow (#819)", () => {
		// The page owns the alert data but the desktop surface is the sidebar.
		expect(pageSource).toContain('<div className="lg:hidden">');
		expect(pageSource).toContain('"rounded-2xl bg-[#C42B3A]');
		expect(pageSource).toContain('CONTROL_ROOM_ORDER.alert, "lg:hidden"');
		expect(layoutSource).toContain("<DashboardAlertsProvider>");
		expect(read("components/sidebar.tsx")).toContain("<SidebarAlerts");
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

	it("lets the pane and the chart grid shrink instead of spilling", () => {
		// The pane is the scroll box; the room and rail already carry min-h-0.
		// The chart column now does too, so a taller hero can never push the
		// chart row out of the fixed-height grid (the #475 clipping).
		expect(layoutSource).toContain(
			"ofd-main ofd-main-room relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip",
		);
		expect(shellSource).toContain("xl:min-h-0");
		expect(shellSource).toContain("xl:grid-rows-[auto_minmax(0,1fr)_auto]");
		expect(pageSource).toContain('"min-h-0 min-w-0"');
		expect(pageSource).toContain("grid min-h-0 min-w-0 grid-cols-1");
		expect(pondSource).toContain("min-w-0");
	});

	it("caps the legend instead of letting the translation grow the card", () => {
		const legendStart = globalsCss.indexOf(".ofd-control-room .ofd-chart-legend {");
		const legendRule = globalsCss.slice(legendStart, globalsCss.indexOf("}", legendStart));
		// One line per source: the long localized label ellipsizes instead of
		// adding two or three lines to the card at 1366 px. `auto-fit` may use
		// more than one column on a wide card, which can only make it shorter.
		expect(legendRule).toContain("grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));");
		expect(legendRule).toContain("row-gap: 0.25rem;");

		const labelStart = globalsCss.indexOf(
			".ofd-control-room .ofd-chart-legend > li > span:nth-of-type(2) {",
		);
		const labelRule = globalsCss.slice(labelStart, globalsCss.indexOf("}", labelStart));
		expect(labelRule).toContain("text-overflow: ellipsis;");
		expect(labelRule).toContain("overflow: hidden;");
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
