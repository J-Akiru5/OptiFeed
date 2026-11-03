import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DARK_SERIES_COLORS, SERIES_COLORS } from "@/components/charts/chart-theme";
import { CONSOLE_CONTRAST, CONSOLE_NON_TEXT_CONTRAST } from "@/components/superadmin/ui";
import { describe, expect, it } from "vitest";
import { contrast, readConsolePalette, resolvePair } from "./helpers/console-palette";

/**
 * Issue #477 built the console's light/dark pair; #628 made it a token layer.
 *
 * The palette now lives once, in `--console-*` custom properties in
 * `app/globals.css`, with a light value in `:root` and a dark value in `.dark`.
 * These tests keep it honest:
 *
 *   1. every pair the console renders meets WCAG AA in both themes — read from
 *      the stylesheet itself, not from a second copy of the hex values;
 *   2. the focus ring and the field outline meet the 3:1 non-text threshold;
 *   3. every token has a dark counterpart, so no surface can be light-only;
 *   4. no shell component names a colour literal, so no surface can bypass the
 *      tokens and be half-themed;
 *   5. the shell mounts the theme toggle on desktop and mobile.
 */

const webRoot = join(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(tsx|ts)$/.test(entry) && !entry.includes(".test.")) out.push(full);
	}
	return out;
}

const consoleFiles = [
	...walk(join(webRoot, "components/superadmin")),
	...walk(join(webRoot, "app/[locale]/(superadmin)")),
];

/**
 * The files #628 redesigned: the shell chrome, the console primitives, the
 * dialogs and the command-center composition. These must carry no colour of
 * their own at all — every colour is a `console-*` token.
 *
 * Page bodies inside the console are deliberately not in this list yet: they
 * still pair a brand literal with its `dark:` counterpart, which the
 * "light-only utility" walk below keeps honest. Converting them is the follow-up
 * recorded on the epic, not something this shell change can do without
 * rewriting the dashboards it is not allowed to touch.
 */
const tokenOnlyFiles = [
	"app/[locale]/(superadmin)/superadmin/layout.tsx",
	"components/superadmin-bottom-nav.tsx",
	"components/superadmin-sidebar.tsx",
	"components/superadmin/dialog-shell.tsx",
	"components/superadmin/dialog-theme.ts",
	"components/superadmin/scope-banner.tsx",
	"components/superadmin/step-up-dialog.tsx",
	"components/superadmin/ui.tsx",
	"components/superadmin/monitor/sections/command-center-layout.tsx",
].map((path) => join(webRoot, path));

tokenOnlyFiles.push(...walk(join(webRoot, "components/superadmin/monitor/primitives")));

/** A raw colour: a Tailwind palette keyword, an arbitrary colour value, a hex. */
const COLOUR_LITERALS: { pattern: RegExp; what: string }[] = [
	{
		pattern: /\b(?:bg|text|border|divide|ring|from|to|via)-white(?![/\w-])/,
		what: "white keyword",
	},
	{
		pattern: /\b(?:bg|text|border|divide|ring|from|to|via)-black(?![/\w-])/,
		what: "black keyword",
	},
	{
		pattern:
			/\b(?:bg|text|border|divide|ring|stroke|fill|from|to|via)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
		what: "Tailwind palette colour",
	},
	{ pattern: /\[#[0-9a-fA-F]{3,8}\]/, what: "arbitrary hex colour" },
	// Issue references are three digits (#628); a six-digit run is a colour.
	{ pattern: /#[0-9a-fA-F]{6}\b/, what: "hex colour" },
];

describe("console theme palette", () => {
	const palette = readConsolePalette();

	it("meets WCAG AA for every console text pair in both themes", () => {
		for (const pair of CONSOLE_CONTRAST) {
			for (const theme of ["light", "dark"] as const) {
				const { background, foreground } = resolvePair(palette, theme, pair);
				expect(
					contrast(background, foreground),
					`${pair.label} (${theme}): ${foreground} on ${background}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("meets the 3:1 non-text threshold for rings and control outlines", () => {
		for (const pair of CONSOLE_NON_TEXT_CONTRAST) {
			for (const theme of ["light", "dark"] as const) {
				const { background, foreground } = resolvePair(palette, theme, pair);
				expect(
					contrast(background, foreground),
					`${pair.label} (${theme}): ${foreground} on ${background}`,
				).toBeGreaterThanOrEqual(pair.minimum);
			}
		}
	});

	it("declares a dark counterpart for every console token", () => {
		const light = Object.keys(palette.light).sort();
		const dark = Object.keys(palette.dark).sort();

		expect(light.length).toBeGreaterThanOrEqual(CONSOLE_CONTRAST.length);
		expect(dark, "a console token exists in light mode but not in dark mode").toEqual(light);
	});

	it("mounts the theme toggle in the console header on desktop and mobile", () => {
		const layout = readFileSync(
			join(webRoot, "app/[locale]/(superadmin)/superadmin/layout.tsx"),
			"utf8",
		);
		expect(layout).toContain('from "@/components/dark-mode-toggle"');
		// One in MobileHeader's children, one in the desktop action bar.
		expect(layout.split("<DarkModeToggle />").length - 1).toBe(2);
	});

	it("keeps a dark variant for every light-only surface utility", () => {
		const lightOnly = [
			/\bbg-white(?![/\w-])/,
			/\bbg-\[#F4F7F6\](?![/\w-])/,
			/\btext-\[#0A3D62\](?![/\w-])/,
			/\btext-\[#3D5568\](?![/\w-])/,
			/\bborder-gray-200(?![/\w-])/,
		];
		const offenders: string[] = [];

		for (const file of consoleFiles) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (!lightOnly.some((pattern) => pattern.test(line))) return;
				if (line.includes("dark:")) return;
				offenders.push(`${file.replace(webRoot, "")}:${index + 1}`);
			});
		}

		expect(
			offenders,
			`light-only utilities without a dark variant: ${offenders.join(", ")}`,
		).toEqual([]);
	});
});

describe("console page bodies (#631)", () => {
	const palette = readConsolePalette();

	/**
	 * The series palette is painted as bars and slices, so it is "visual
	 * information required to understand the content" and held to 3:1
	 * (WCAG 1.4.11). The light navy was 1.54:1 on the dark card, which is how
	 * the second stacked-bar/donut series disappeared; the dark palette is a
	 * second, lifted array rather than a single set that cannot satisfy both.
	 */
	it("keeps every chart series at 3:1 on each theme's card", () => {
		for (const [theme, colors] of [
			["light", SERIES_COLORS],
			["dark", DARK_SERIES_COLORS],
		] as const) {
			const surface = palette[theme]["--console-surface"];
			expect(surface, `${theme} has no --console-surface`).toBeTruthy();

			for (const color of colors) {
				expect(
					contrast(surface, color),
					`series ${color} on ${surface} (${theme})`,
				).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it("never turns a console control navy on hover", () => {
		const offenders = consoleFiles.filter((file) =>
			readFileSync(file, "utf8").includes("hover:text-[#0A3D62]"),
		);

		expect(
			offenders.map((file) => file.replace(webRoot, "")),
			"a hover colour with no dark variant disappears on the dark console",
		).toEqual([]);
	});

	it("never paints white text on the brand orange", () => {
		const offenders: string[] = [];

		for (const file of consoleFiles) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (!/\bbg-\[#E85A2A\](?![/\w-])/.test(line)) return;
				if (!/\btext-white(?![/\w-])/.test(line)) return;
				offenders.push(`${file.replace(webRoot, "")}:${index + 1}`);
			});
		}

		expect(offenders, `white on #E85A2A is 3.54:1: ${offenders.join(", ")}`).toEqual([]);
	});

	it("keeps the fixed status surfaces on the status tokens", () => {
		const pages = [
			"app/[locale]/(superadmin)/superadmin/fleet/page.tsx",
			"app/[locale]/(superadmin)/superadmin/incidents/page.tsx",
			"app/[locale]/(superadmin)/superadmin/incidents/[incidentId]/page.tsx",
			"app/[locale]/(superadmin)/superadmin/tenants/page.tsx",
			"app/[locale]/(superadmin)/superadmin/tenants/compare/page.tsx",
			"app/[locale]/(superadmin)/loading.tsx",
		];
		const lightOnly = ["#FDE8EA", "#E8F5EC", "bg-gray-200"];
		const offenders: string[] = [];

		for (const page of pages) {
			const source = readFileSync(join(webRoot, page), "utf8");
			for (const literal of lightOnly) {
				if (source.includes(literal)) offenders.push(`${page}: ${literal}`);
			}
		}

		expect(offenders, `a light status surface with no dark value: ${offenders.join(", ")}`).toEqual(
			[],
		);
	});
});

describe("console shell tokens (#628)", () => {
	it("names no colour literal in the redesigned shell components", () => {
		const offenders: string[] = [];

		for (const path of tokenOnlyFiles) {
			const lines = readFileSync(path, "utf8").split("\n");
			const shown = path.replace(webRoot, "");
			lines.forEach((line, index) => {
				for (const { pattern, what } of COLOUR_LITERALS) {
					if (pattern.test(line)) {
						offenders.push(`${shown}:${index + 1} ${what}: ${line.trim()}`);
					}
				}
			});
		}

		expect(offenders, `hardcoded colours in the console shell:\n${offenders.join("\n")}`).toEqual(
			[],
		);
	});

	it("derives every console utility from the token layer", () => {
		// A `console-*` utility is only real if `@theme inline` maps it to the
		// custom property, so a typo in a component would otherwise just render
		// the inherited colour and pass every other check.
		const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");
		const mapped = new Set(
			[...css.matchAll(/--color-(console-[a-z-]+):\s*var\(--console-[a-z-]+\);/g)].map(
				(match) => match[1],
			),
		);

		const declared = new Set(Object.keys(readConsolePalette().light).map((name) => name.slice(2)));

		expect([...declared].sort()).toEqual([...mapped].sort());
	});
});
