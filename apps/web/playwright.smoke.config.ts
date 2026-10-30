import { defineConfig } from "@playwright/test";

/**
 * Cross-browser smoke configuration.
 *
 * Separate from `playwright.config.ts` on purpose: this suite must run with no
 * session, no Supabase project and no database, so it has no global setup and
 * no fixture guard. The authenticated suite is Chromium-only (it is serial and
 * bound to the `e2e-` fixture); only the small public smoke is multiplied
 * across the three engines. See docs/compatibility.md.
 */
const port = Number(process.env.SMOKE_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
	testDir: "./e2e/smoke",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	forbidOnly: Boolean(process.env.CI),
	// A smoke that only passes on the second attempt hides the engine-specific
	// defect it exists to find.
	retries: 0,
	// One worker per project: the three engines run in parallel, the tests
	// inside each project stay serial so the app never sees a burst.
	workers: 3,
	reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
	use: {
		baseURL,
		// No pixel snapshots: the asserts are layout invariants, so failures
		// need a trace and a screenshot, not a baseline diff.
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	// When no target is supplied, serve the local production build. CI builds
	// first and lets Playwright start `next start`; a supplied base URL (a
	// deployed preview) is used as-is and no local server is started.
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
				command: `pnpm exec next start -p ${port}`,
				url: baseURL,
				reuseExistingServer: !process.env.CI,
				timeout: 180_000,
			},
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "firefox", use: { browserName: "firefox" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
});
