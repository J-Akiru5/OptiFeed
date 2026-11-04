import { createRequire } from "node:module";
import { type Page, expect, test } from "@playwright/test";

import { login } from "./helpers";

/**
 * Axe accessibility checks for the release QA pass.
 *
 * The public pages run without a session; the dashboard check uses the normal
 * e2e- login. Color contrast is disabled in the general scan so it does not
 * mask the other results; the dedicated login-CTA test keeps the QA-20 fix
 * pinned at WCAG AA.
 *
 * The axe-core script is injected from the installed package, so this suite
 * keeps the repository's existing axe-core dependency instead of adding a
 * second wrapper package.
 */

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

type AxeViolation = {
	id: string;
	impact: string | null;
	help: string;
	nodes: unknown[];
};

type AxeResults = {
	violations: AxeViolation[];
};

async function runAxe(page: Page): Promise<AxeResults> {
	await page.addScriptTag({ path: axePath });

	return page.evaluate(async () => {
		const axe = (
			window as unknown as {
				axe: {
					run: (context: Document, options: unknown) => Promise<AxeResults>;
				};
			}
		).axe;

		return axe.run(document, {
			runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
			rules: {
				// Tracked separately as QA-20; see the contrast test at the end.
				"color-contrast": { enabled: false },
			},
		});
	});
}

async function attachAxeResult(page: Page, label: string): Promise<AxeResults> {
	const result = await runAxe(page);
	await test.info().attach(`axe-${label}.json`, {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	return result;
}

function criticalViolations(results: AxeResults): AxeViolation[] {
	return results.violations.filter((violation) => violation.impact === "critical");
}

const PUBLIC_PAGES = [
	{ label: "landing", path: "/en" },
	{ label: "login", path: "/en/login" },
	{ label: "privacy", path: "/en/privacy" },
	{ label: "terms", path: "/en/terms" },
] as const;

test.describe("QA accessibility — public", () => {
	for (const entry of PUBLIC_PAGES) {
		test(`axe: ${entry.label} has no critical violations`, async ({ page }) => {
			await page.goto(entry.path);
			const result = await attachAxeResult(page, entry.label);
			const critical = criticalViolations(result);

			expect(
				critical,
				critical.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
			).toEqual([]);
		});
	}
});

test.describe("QA accessibility — authenticated", () => {
	test("axe: dashboard has no critical violations", async ({ page }) => {
		await login(page);
		await expect(page).toHaveURL(/\/en\/dashboard/);

		const result = await attachAxeResult(page, "dashboard");
		const critical = criticalViolations(result);

		expect(
			critical,
			critical.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
		).toEqual([]);
	});
});

test.describe("QA contrast regression", () => {
	test("white on the brand CTA meets WCAG AA", async ({ page }) => {
		await page.goto("/en/login");

		const colors = await page
			.locator('button[type="submit"]')
			.first()
			.evaluate((element) => {
				const style = getComputedStyle(element);
				return { foreground: style.color, background: style.backgroundColor };
			});

		const ratio = contrastRatio(colors.foreground, colors.background);
		expect(
			ratio,
			`white on ${colors.background} is ${ratio.toFixed(2)}:1; expected at least 4.5:1`,
		).toBeGreaterThanOrEqual(4.5);
	});
});

function parseRgb(value: string): [number, number, number] {
	const channels = value
		.match(/[\d.]+/g)
		?.slice(0, 3)
		.map(Number);
	if (!channels || channels.length !== 3) {
		throw new Error(`Unsupported CSS color: ${value}`);
	}
	return [channels[0], channels[1], channels[2]];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
	const linear = [red, green, blue].map((channel) => {
		const normalized = channel / 255;
		return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
	const foregroundLuminance = relativeLuminance(parseRgb(foreground));
	const backgroundLuminance = relativeLuminance(parseRgb(background));
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}
