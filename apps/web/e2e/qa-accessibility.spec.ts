import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

import { login } from "./helpers";

/**
 * Axe accessibility checks for the release QA pass.
 *
 * The public pages run without a session. The authenticated run logs in once as
 * the seeded e2e farmer and audits two console screens: the dashboard and the
 * Calendar & Harvest page (the dense screen `/dashboard/harvest` redirects to).
 * This is the only browser-level a11y gate that sees the real seeded data,
 * hydrated client components and production CSS; the static markup gate lives
 * in `lib/__tests__/a11y-pages.test.tsx`.
 *
 * Color contrast is disabled in the general scan so it does not mask the other
 * results; the dedicated login-CTA test keeps the QA-20 fix pinned at WCAG AA.
 *
 * The axe-core bundle is read from the installed package and evaluated in the
 * page, so this suite keeps the repository's existing axe-core dependency
 * instead of adding a second wrapper package.
 */

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
/**
 * Read once, then evaluate in the page instead of injecting a `<script>` tag.
 *
 * `page.addScriptTag` on the authenticated screens races the app's realtime
 * client: the local Supabase socket (`ws://127.0.0.1:54321`) is blocked by the
 * `connect-src` CSP and Playwright rejects the injection with that violation.
 * `page.evaluate` goes through CDP, which CSP does not gate, so the audit runs
 * the same axe build without changing the page's CSP or its behaviour.
 */
const axeSource = fs.readFileSync(axePath, "utf8");

type AxeViolation = {
	id: string;
	impact: string | null;
	help: string;
	nodes: unknown[];
};

type AxeResults = {
	violations: AxeViolation[];
};

type PageSummary = {
	page: string;
	path: string;
	/** Violation ids grouped by axe impact, for the CI step summary. */
	byImpact: Record<string, string[]>;
	totalNodes: number;
};

async function runAxe(page: Page): Promise<AxeResults> {
	await page.evaluate(axeSource);

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

/**
 * The console screens the browser gate audits, in the order it audits them.
 *
 * `/dashboard` is the control room; `/dashboard/calendar` is the dense screen
 * the old Harvest page redirects to (crop cycle, harvest projection, org-wide
 * calendar and feeder panels). Both need the seeded e2e fixture: a pond, a
 * feeder and an organisation.
 */
const AUTHENTICATED_PAGES = [
	{ label: "dashboard", path: "/en/dashboard", url: /\/en\/dashboard$/ },
	{
		label: "calendar-harvest",
		path: "/en/dashboard/calendar",
		url: /\/en\/dashboard\/calendar/,
	},
] as const;

/** Violation ids grouped by impact, so the summary reports minor/serious too. */
function groupByImpact(results: AxeResults): Record<string, string[]> {
	const groups: Record<string, string[]> = {};
	for (const violation of results.violations) {
		const impact = violation.impact ?? "unknown";
		groups[impact] = [...(groups[impact] ?? []), violation.id];
	}
	return groups;
}

/**
 * Write the machine-readable summary the CI step prints into the job summary.
 * Written even when a page fails, so a red run explains which rule fired.
 */
function writeSummary(summary: PageSummary[]): void {
	const directory = path.resolve("test-results");
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(
		path.join(directory, "a11y-summary.json"),
		`${JSON.stringify({ generatedAt: new Date().toISOString(), pages: summary }, null, 2)}\n`,
	);
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
	test("axe: the console has no critical violations", async ({ page }) => {
		// One login for both screens: the login endpoint is rate-limited to five
		// attempts per minute per IP and the whole suite is serial.
		await login(page);
		await expect(page).toHaveURL(/\/en\/dashboard/);

		const summary: PageSummary[] = [];
		const critical: string[] = [];

		for (const entry of AUTHENTICATED_PAGES) {
			await page.goto(entry.path);
			await expect(page).toHaveURL(entry.url);

			const result = await attachAxeResult(page, entry.label);
			summary.push({
				page: entry.label,
				path: entry.path,
				byImpact: groupByImpact(result),
				totalNodes: result.violations.reduce(
					(total, violation) => total + violation.nodes.length,
					0,
				),
			});

			for (const violation of criticalViolations(result)) {
				critical.push(`${entry.label}: ${violation.id}: ${violation.help}`);
			}
		}

		// The file is written before the assertion so the CI summary step still
		// has data on a red run.
		writeSummary(summary);
		await test.info().attach("a11y-summary.json", {
			body: JSON.stringify(summary, null, 2),
			contentType: "application/json",
		});

		expect(
			critical,
			`critical axe violations on the authenticated console:\n${critical.join("\n")}`,
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
