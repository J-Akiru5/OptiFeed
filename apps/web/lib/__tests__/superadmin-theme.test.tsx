import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONSOLE_CONTRAST } from "@/components/superadmin/ui";
import { describe, expect, it } from "vitest";

/**
 * Issue #477: the platform console has a light and a dark variant.
 *
 * The toggle lives in the console header; these tests keep the palette honest:
 * every pair the console renders meets WCAG AA in both themes, the shell mounts
 * the toggle on desktop and mobile, and no console surface drifts back to a
 * light-only utility without its `dark:` counterpart.
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

/** WCAG 2.1 relative luminance and contrast ratio. */
function luminance(hex: string): number {
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

function contrast(background: string, foreground: string): number {
	const a = luminance(background);
	const b = luminance(foreground);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const consoleFiles = [
	...walk(join(webRoot, "components/superadmin")),
	...walk(join(webRoot, "app/[locale]/(superadmin)")),
];

describe("console theme palette", () => {
	it("meets WCAG AA for every console text pair in both themes", () => {
		for (const pair of CONSOLE_CONTRAST) {
			expect(
				contrast(pair.light.background, pair.light.foreground),
				pair.label,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(pair.dark.background, pair.dark.foreground),
				pair.label,
			).toBeGreaterThanOrEqual(4.5);
		}
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
		const exempt = new Set(["ui.tsx", "dialog-theme.ts"]);
		const offenders: string[] = [];

		for (const file of consoleFiles) {
			const name = file.split(/[\\/]/).pop() ?? "";
			if (exempt.has(name)) continue;
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
