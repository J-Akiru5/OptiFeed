import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The command center really imports the #629 chart layer (#707).
 *
 * The defect this guards was invisible to the component suites: every primitive
 * was tested in isolation and passed, while no page imported any of them. A
 * render test alone would not catch it either — the page would simply not have
 * those sections. So this file reads the two files that carry the wiring and
 * asserts the module boundary itself:
 *
 *  - the Recharts-backed charts come from `charts/lazy`, never the barrel, so a
 *    future edit cannot quietly pull the library into the route's first load;
 *  - the heatmap and the timeline (plain DOM) come from their own modules;
 *  - the sections are fed by the read models added in #629, not by fixtures.
 */

const webRoot = join(__dirname, "..", "..");
const pagePath = join(webRoot, "app/[locale]/(superadmin)/superadmin/page.tsx");
const sectionsPath = join(
	webRoot,
	"components/superadmin/monitor/sections/command-center-charts.tsx",
);
const rangePath = join(webRoot, "components/superadmin/monitor/sections/command-center-range.tsx");

function source(path: string): string {
	return readFileSync(path, "utf8");
}

/** Every module specifier the file imports, from `import … from "x"` and `import "x"`. */
function importsOf(text: string): string[] {
	return [...text.matchAll(/^\s*import\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/gm)].map(
		(match) => match[1],
	);
}

/** The named imports the file takes from one module. */
function namedImports(text: string, module: string): string[] {
	const escaped = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`, "s").exec(text);
	if (!match) return [];
	return match[1]
		.split(",")
		.map((entry) => entry.replace(/^\s*type\s+/, "").trim())
		.filter(Boolean);
}

describe("the command center imports the chart layer (#707)", () => {
	const page = source(pagePath);
	const sections = source(sectionsPath);
	const range = source(rangePath);

	it("loads the Recharts charts through the lazy entry points", () => {
		expect(namedImports(page, "@/components/charts/lazy")).toEqual(
			expect.arrayContaining(["LazyDonut", "LazyLineTrend", "LazyStackedBars"]),
		);
		expect(namedImports(sections, "@/components/charts/lazy")).toEqual(
			expect.arrayContaining(["LazyDonut", "LazyRadialGauge", "LazyStackedArea", "LazyTreemap"]),
		);
	});

	it("imports the plain-DOM primitives from their own modules", () => {
		expect(namedImports(sections, "@/components/charts/heatmap")).toContain("Heatmap");
		expect(namedImports(sections, "@/components/charts/timeline")).toContain("Timeline");
	});

	it("wraps the page in the shared range provider and control", () => {
		expect(namedImports(range, "@/components/charts/chart-range")).toContain("ChartRangeProvider");
		expect(namedImports(page, "@/components/charts/chart-range")).toContain("ChartRangeControl");
		expect(importsOf(page)).toContain(
			"@/components/superadmin/monitor/sections/command-center-range",
		);
		// The control is rendered inside the provider's subtree.
		expect(page).toContain("<ChartRangeControl");
		expect(page).toContain("<CommandCenterRangeFrame");
	});

	it("feeds the sections from the read models, not from literals", () => {
		const pageImports = importsOf(page);
		expect(pageImports).toContain("@/lib/platform/growth");
		expect(pageImports).toContain("@/lib/platform/feed-analytics");
		expect(pageImports).toContain("@/lib/platform/fleet-health");
		expect(namedImports(page, "@/lib/platform/growth")).toContain("getGrowthSeries");
		expect(namedImports(page, "@/lib/platform/feed-analytics")).toEqual(
			expect.arrayContaining(["getFeedBreakdown", "getFeedHeatmap"]),
		);
		expect(namedImports(page, "@/lib/platform/fleet-health")).toContain("getFleetMonitor");
		expect(namedImports(page, "@/lib/platform/fleet-health-rules")).toEqual(
			expect.arrayContaining(["summarizeTelemetryFreshness", "worstDevices"]),
		);
	});

	it("never imports Recharts or the barrel from the route", () => {
		for (const [name, text] of [
			["page.tsx", page],
			["command-center-charts.tsx", sections],
			["command-center-range.tsx", range],
		] as const) {
			const imports = importsOf(text);
			expect(imports, `${name} imports recharts directly`).not.toContain("recharts");
			expect(imports, `${name} imports a recharts submodule`).not.toEqual(
				expect.arrayContaining([expect.stringMatching(/^recharts\//)]),
			);
			// The barrel re-exports every chart module; importing it would put the
			// whole layer (Recharts included) back in the route's client manifest.
			expect(imports, `${name} imports the chart barrel`).not.toContain("@/components/charts");
		}
	});
});
