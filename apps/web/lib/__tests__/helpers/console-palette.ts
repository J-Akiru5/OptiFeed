import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the platform console palette out of `app/globals.css` (#628).
 *
 * The console's colours live in exactly one place: the `--console-*` custom
 * properties in the `:root` block and their `.dark` counterparts. The theme
 * tests parse the real stylesheet instead of restating hex values in TypeScript,
 * so a token can never drift between the component, the test and the CSS.
 */

const webRoot = join(__dirname, "../../..");

/** Every `--console-*` declaration in `app/globals.css`, per theme. */
export interface ConsolePalette {
	light: Record<string, string>;
	dark: Record<string, string>;
}

/**
 * The bodies of every top-level `selector { ... }` rule in the sheet, matched
 * with balanced braces. A selector that is only a prefix of something else
 * (`.dark` inside `@custom-variant dark (&:is(.dark *))`) is skipped because the
 * text between the selector and the brace is not whitespace.
 */
function ruleBodies(css: string, selector: string): string[] {
	const bodies: string[] = [];
	let from = 0;

	for (;;) {
		const at = css.indexOf(selector, from);
		if (at === -1) break;

		const open = css.indexOf("{", at + selector.length);
		if (open === -1) break;

		if (css.slice(at + selector.length, open).trim() !== "") {
			from = at + selector.length;
			continue;
		}

		let depth = 0;
		let index = open;
		for (; index < css.length; index += 1) {
			if (css[index] === "{") depth += 1;
			else if (css[index] === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}

		bodies.push(css.slice(open + 1, index));
		from = index;
	}

	return bodies;
}

function declarations(bodies: string[]): Record<string, string> {
	const values: Record<string, string> = {};
	for (const body of bodies) {
		for (const match of body.matchAll(/(--console-[a-z-]+)\s*:\s*([^;]+);/g)) {
			values[match[1]] = match[2].trim();
		}
	}
	return values;
}

export function readConsolePalette(): ConsolePalette {
	const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");

	return {
		light: declarations(ruleBodies(css, ":root")),
		dark: declarations(ruleBodies(css, ".dark")),
	};
}

/** WCAG 2.1 relative luminance of a 6-digit sRGB hex colour. */
export function luminance(hex: string): number {
	const channels = hex
		.replace("#", "")
		.match(/../g)
		?.map((part) => Number.parseInt(part, 16) / 255);
	if (!channels || channels.length !== 3) throw new Error(`bad hex ${hex}`);

	const linear = channels.map((value) =>
		value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio between two sRGB hex colours. */
export function contrast(background: string, foreground: string): number {
	const a = luminance(background);
	const b = luminance(foreground);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Resolves a token pair for one theme, failing loudly on a missing key. */
export function resolvePair(
	palette: ConsolePalette,
	theme: "light" | "dark",
	pair: { label: string; background: string; foreground: string },
): { background: string; foreground: string } {
	const values = palette[theme];
	const background = values[`--${pair.background}`];
	const foreground = values[`--${pair.foreground}`];

	if (!background)
		throw new Error(`${pair.label}: --${pair.background} is not declared in ${theme}`);
	if (!foreground)
		throw new Error(`${pair.label}: --${pair.foreground} is not declared in ${theme}`);

	return { background, foreground };
}
