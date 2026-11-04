import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	CommandCenterLayout,
	type CommandCenterLayoutProps,
} from "@/components/superadmin/monitor/sections/command-center-layout";

/**
 * Shell composition at each width the console is designed for (#628).
 *
 * There is no browser in this harness (the console needs auth, a tenant and a
 * database, so a route cannot be screenshotted from a unit test), so this suite
 * proves the two things a screenshot would have shown, arithmetically and
 * structurally:
 *
 *   1. **The pane width.** The console pane is `viewport − sidebar − padding`.
 *      The padding steps and the sidebar width are read from the real stylesheet
 *      and the real sidebar source, and the resulting content width is asserted
 *      at 1920 / 1440 / 1280 / 1024 / 768 / 390.
 *   2. **The columns that pane produces.** The grids are rendered through
 *      `renderToStaticMarkup` and their `grid-cols-*` classes are resolved
 *      against the Tailwind breakpoints, so a row that would collapse to one
 *      narrow column (or overflow) at a listed width fails here.
 *
 * What this does **not** prove is pixel rendering; that is the QA lane's job on
 * a running console. The structural half of the suite (last describe block)
 * covers the other half of "no horizontal overflow": one scroll pane, no fixed
 * width outside a scroller, and the pane's padding token.
 */

const webRoot = join(__dirname, "../..");

/** Tailwind's default breakpoints, in px. */
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 } as const;

/** The widths #628 is designed for, in px. */
const VIEWPORTS = [390, 768, 1024, 1280, 1440, 1920] as const;

/** The sidebar's expanded width (`w-64`) and the width at which it appears (`lg`). */
const SIDEBAR_PX = 256;
const SIDEBAR_FROM_PX = BREAKPOINTS.lg;

function remToPx(value: number): number {
	return Math.round(value * 16);
}

/**
 * The three `--console-pane-pad` steps, read from `app/globals.css` instead of
 * restated here: the base rule, then each `@media (min-width: …)` override.
 */
function panePaddingSteps(): { minPx: number; padPx: number }[] {
	const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");

	const padOf = (body: string): number | null => {
		const match = /--console-pane-pad:\s*([\d.]+)rem/.exec(body);
		return match ? remToPx(Number(match[1])) : null;
	};

	const baseBody = /\.ofd-console-pane\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
	const base = padOf(baseBody);
	if (base === null) throw new Error(".ofd-console-pane declares no --console-pane-pad");

	const steps = [{ minPx: 0, padPx: base }];
	for (const match of css.matchAll(
		/@media \(min-width: ([\d.]+)rem\)\s*\{\s*\.ofd-console-pane\s*\{([\s\S]*?)\}/g,
	)) {
		const pad = padOf(match[2]);
		if (pad !== null) steps.push({ minPx: remToPx(Number(match[1])), padPx: pad });
	}

	return steps.sort((a, b) => a.minPx - b.minPx);
}

function panePadding(viewport: number): number {
	let pad = panePaddingSteps()[0].padPx;
	for (const step of panePaddingSteps()) if (viewport >= step.minPx) pad = step.padPx;
	return pad;
}

/** The content width a console page gets at a viewport, in px. */
function contentWidth(viewport: number): number {
	const sidebar = viewport >= SIDEBAR_FROM_PX ? SIDEBAR_PX : 0;
	return viewport - sidebar - 2 * panePadding(viewport);
}

/** Resolves `grid-cols-*` (plus its breakpoint variants) to a column count. */
function columnsAt(className: string, viewport: number): number {
	let columns = 1;
	let applied = 0;

	for (const token of className.split(/\s+/)) {
		const match = /^(?:([a-z0-9]+):)?grid-cols-(\d+)$/.exec(token);
		if (!match) continue;

		const min = match[1] ? BREAKPOINTS[match[1] as keyof typeof BREAKPOINTS] : 0;
		if (min === undefined || viewport < min) continue;

		// Later in the class list wins at the same breakpoint, matching how the
		// utilities cascade.
		if (min >= applied) {
			columns = Number(match[2]);
			applied = min;
		}
	}

	return columns;
}

const full = {
	title: "Platform Command Center",
	rangeSwitcher: <button type="button">Last 7 days</button>,
	bands: <div>status bands</div>,
	kpis: [
		{ label: "Organizations", value: "24" },
		{ label: "Users", value: "140" },
		{ label: "Devices online", value: "87%" },
		{ label: "Open incidents", value: "3" },
	],
	trend: {
		title: "New accounts",
		children: <p>chart</p>,
	},
	mix: {
		title: "Fleet status",
		items: [{ key: "online", label: "Online", value: 112, tone: "ok" }],
		totalLabel: "128 devices",
	},
	attention: {
		title: "Needs attention",
		items: [{ id: "a1", title: "Feeder offline", severity: "critical" }],
		empty: "Nothing is waiting in the queue.",
	},
	activity: {
		title: "Recent activity",
		items: [{ id: "e1", title: "Organization suspended", time: "5 minutes ago" }],
		empty: "No events in this window.",
	},
} satisfies CommandCenterLayoutProps;

/** The class list of every grid row in the rendered composition, by name. */
function grids(): Record<string, string> {
	const markup = renderToStaticMarkup(<CommandCenterLayout {...full} />);
	const found: Record<string, string> = {};

	for (const match of markup.matchAll(/<div\b([^>]*)>/g)) {
		const attributes = match[1];
		const name = /data-console-grid="([a-z]+)"/.exec(attributes)?.[1];
		if (!name) continue;
		found[name] = /class="([^"]*)"/.exec(attributes)?.[1] ?? "";
	}

	return found;
}

describe("console shell breakpoints (#628)", () => {
	const rows = grids();

	it("renders the three composed rows", () => {
		expect(Object.keys(rows).sort()).toEqual(["kpis", "queues", "trend"]);
	});

	it("reads the pane padding from the stylesheet, not from the test", () => {
		expect(panePaddingSteps()).toEqual([
			{ minPx: 0, padPx: 16 },
			{ minPx: 768, padPx: 24 },
			{ minPx: 1024, padPx: 32 },
		]);
	});

	it("gives the pane the documented content width at every designed viewport", () => {
		const expected: Record<number, number> = {
			390: 358,
			768: 720,
			1024: 704,
			1280: 960,
			1440: 1120,
			1920: 1600,
		};

		for (const viewport of VIEWPORTS) {
			expect(contentWidth(viewport), `content width at ${viewport}px`).toBe(expected[viewport]);
		}
	});

	it("collapses each row only where the content width stops supporting it", () => {
		const expected: Record<number, { kpis: number; trend: number; queues: number }> = {
			// phone: one column, drawer-style navigation, KPI values still legible
			390: { kpis: 1, trend: 1, queues: 1 },
			// tablet: KPI pair, panels stacked
			768: { kpis: 2, trend: 1, queues: 1 },
			// laptop: sidebar appears and takes 256 px; two columns everywhere
			1024: { kpis: 2, trend: 2, queues: 2 },
			// desktop: four KPIs, 2:1 analytics row
			1280: { kpis: 4, trend: 3, queues: 2 },
			1440: { kpis: 4, trend: 3, queues: 2 },
			1920: { kpis: 4, trend: 3, queues: 2 },
		};

		for (const viewport of VIEWPORTS) {
			for (const row of ["kpis", "trend", "queues"] as const) {
				expect(columnsAt(rows[row], viewport), `${row} at ${viewport}px`).toBe(
					expected[viewport][row],
				);
			}
		}
	});

	it("keeps every KPI legible and every panel wide enough for a chart", () => {
		for (const viewport of VIEWPORTS) {
			const width = contentWidth(viewport);
			const kpi = width / columnsAt(rows.kpis, viewport);
			const panel = width / columnsAt(rows.trend, viewport);

			expect(kpi, `KPI tile width at ${viewport}px`).toBeGreaterThanOrEqual(220);
			expect(panel, `panel width at ${viewport}px`).toBeGreaterThanOrEqual(300);
		}
	});
});

describe("console shell structure (#628)", () => {
	const layout = readFileSync(
		join(webRoot, "app/[locale]/(superadmin)/superadmin/layout.tsx"),
		"utf8",
	);
	const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");
	const sidebar = readFileSync(join(webRoot, "components/superadmin-sidebar.tsx"), "utf8");
	const bottomNav = readFileSync(join(webRoot, "components/superadmin-bottom-nav.tsx"), "utf8");

	it("keeps one scrolling pane inside a full-height, non-scrolling frame", () => {
		expect(layout).toContain("flex h-dvh flex-col overflow-hidden");
		expect(layout).toContain(
			'className="ofd-console-pane relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto"',
		);
	});

	it("swaps the sidebar for the bottom bar at `lg`, never both", () => {
		expect(sidebar).toContain("hidden h-full shrink-0 flex-col overflow-y-auto");
		expect(sidebar).toContain("lg:flex");
		expect(bottomNav).toContain("lg:hidden");
	});

	it("derives the content pane from the padding token", () => {
		expect(css).toContain("--console-pane-pad: 1rem");
		expect(layout).toContain("ofd-console-pane");
	});

	it("keeps wide tables inside their own scroller instead of the page", () => {
		const ui = readFileSync(join(webRoot, "components/superadmin/ui.tsx"), "utf8");
		const table = ui.slice(ui.indexOf("export function TableFrame"));

		// The only fixed min-width in the console primitives is the table, and the
		// table frame scrolls it horizontally inside its card.
		expect(table).toContain("overflow-x-auto");
		expect(table).toContain('minWidth = "min-w-[44rem]"');
	});
});
