import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "./helpers/console-palette";

/**
 * #756 — primary CTAs used `#E85A2A` with white text: 3.54:1 at rest and
 * 4.33:1 on the `#D24E22` hover, both below the 4.5:1 WCAG AA threshold for the
 * 12.5-14.5 px labels these buttons carry. The fill now comes from
 * `--ofd-cta`/`--ofd-cta-hover`, declared once in `app/globals.css`.
 *
 * The second test keeps the literal out of any surface that paints white text
 * on it, so a new button cannot silently reintroduce the failure.
 */

const webRoot = join(__dirname, "../..");
const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");

function token(name: string): string {
	const match = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6});`));
	if (!match) throw new Error(`--${name} is not declared in app/globals.css`);
	return match[1];
}

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(tsx|ts)$/.test(entry) && !entry.includes(".test.")) out.push(full);
	}
	return out;
}

describe("brand CTA contrast (#756)", () => {
	it("keeps the resting and hover fills at 4.5:1 or better against white", () => {
		expect(contrast(token("ofd-cta"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
		expect(contrast(token("ofd-cta-hover"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
	});

	it("uses the token, not the brand literal, behind white text", () => {
		const offenders: string[] = [];
		const files = [...walk(join(webRoot, "app")), ...walk(join(webRoot, "components"))];

		for (const file of files) {
			const lines = readFileSync(file, "utf8").split(/\r?\n/);
			lines.forEach((line, index) => {
				// A solid brand background (opacity variants such as `/10` are
				// decorative washes, not text surfaces).
				if (!/bg-\[#e85a2a\](?!\/)/i.test(line)) return;
				// Tailwind class strings and their JSX siblings sit within a few
				// lines of each other; this is the window the audit used too.
				if (!/text-white/.test(lines.slice(index, index + 3).join(" "))) return;
				offenders.push(`${relative(webRoot, file)}:${index + 1}`);
			});
		}

		expect(offenders).toEqual([]);
	});
});
