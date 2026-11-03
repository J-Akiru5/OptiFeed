import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "./helpers/console-palette";

/**
 * Brand CTA contrast (#756).
 *
 * White text on the brand orange `#E85A2A` is 3.54:1 and its old hover
 * `#D24E22` is 4.33:1: both below the 4.5:1 WCAG AA floor for the 12.5-14.5 px
 * CTA text used on login, landing and header actions. The fix uses the
 * existing AA-safe action orange (`#C2410C`, 5.18:1) and its hover
 * (`#9A3412`, 7.31:1), the same pair the dashboard console already uses.
 *
 * The scan is deliberately limited to class strings that put plain white text
 * on a solid background, so dark-mode pairings (`dark:text-white` on
 * `dark:bg-*`) and overlay/selection backgrounds are not confused with a CTA.
 */

const webRoot = join(__dirname, "../..");
const WHITE = "#FFFFFF";
const SAFE_ACTION = "#C2410C";
const SAFE_ACTION_HOVER = "#9A3412";

const CTA_FILES = [
	"app/[locale]/login/page.tsx",
	"components/landing/LandingHeader.tsx",
	"components/header-actions.tsx",
] as const;

const SOLID_BG = /^(?:(?:hover|focus|active):)?bg-\[(#[0-9a-fA-F]{6})\]$/;
const DARK_SOLID_BG = /^dark:(?:(?:hover|focus|active):)?bg-\[(#[0-9a-fA-F]{6})\]$/;

/** Double-quoted and template-literal class strings in a source file. */
function classStrings(source: string): string[] {
	return [
		...source.matchAll(/"(?:[^"\\]|\\.)*"/g),
		...source.matchAll(/`(?:[^`\\]|\\.)*`/g),
	].map((match) => match[0]);
}

describe("brand CTA contrast (#756)", () => {
	it("uses an AA-safe orange for normal-size white CTA text", () => {
		expect(contrast(SAFE_ACTION, WHITE)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(SAFE_ACTION_HOVER, WHITE)).toBeGreaterThanOrEqual(4.5);
	});

	it("has no white-on-solid-background class in the CTA surfaces below AA", () => {
		const failures: string[] = [];

		for (const file of CTA_FILES) {
			for (const value of classStrings(readFileSync(join(webRoot, file), "utf8"))) {
				const tokens = value.slice(1, -1).split(/\s+/);
				const plainWhite = tokens.includes("text-white");
				const darkWhite = tokens.includes("dark:text-white");
				if (!plainWhite && !darkWhite) continue;

				for (const token of tokens) {
					const solid = plainWhite ? token.match(SOLID_BG) : null;
					const dark = darkWhite ? token.match(DARK_SOLID_BG) : null;
					const background = solid?.[1] ?? dark?.[1];
					if (!background) continue;

					const ratio = contrast(background, WHITE);
					if (ratio < 4.5) {
						failures.push(`${file}: ${token} is ${ratio.toFixed(2)}:1 with white text`);
					}
				}
			}
		}

		expect(failures).toEqual([]);
	});
});
