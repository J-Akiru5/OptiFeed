import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the CSS custom properties used across the app.
 *
 * An undefined `var(--ofd-*)` does not fail the build: the declaration becomes
 * invalid and the element inherits its parent colour, which is how `82%` and
 * the dashboard readings became invisible on white cards in dark mode
 * (issue #48). This test fails if any referenced token has no definition.
 */

const cwd = process.cwd();
const webRoot = existsSync(join(cwd, "app", "globals.css")) ? cwd : join(cwd, "apps", "web");
const globalsCss = readFileSync(join(webRoot, "app", "globals.css"), "utf8");

const SKIP_DIRS = new Set([
	"node_modules",
	".next",
	"test-results",
	"playwright-report",
	"coverage",
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

const sourceFiles = walk(webRoot).filter(
	(file) => /\.(tsx?|css)$/.test(file) && !file.includes("__tests__") && !file.endsWith(".test.ts"),
);

const referenced = new Set<string>();
for (const file of sourceFiles) {
	const content = readFileSync(file, "utf8");
	for (const match of content.matchAll(/var\((--ofd-[a-z0-9-]+)/g)) {
		referenced.add(match[1]);
	}
}

const defined = new Set(
	[...globalsCss.matchAll(/^\s*(--ofd-[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
);

describe("OptiFeed design tokens", () => {
	it("defines every --ofd-* custom property the app references", () => {
		const missing = [...referenced].filter((token) => !defined.has(token)).sort();
		expect(missing).toEqual([]);
	});

	it("defines --ofd-base-deep in both themes", () => {
		expect(globalsCss).toMatch(/:root\s*\{[^}]*--ofd-base-deep:/);
		expect(globalsCss).toMatch(/\.dark\s*\{[^}]*--ofd-base-deep:/);
	});
});
