import { defineConfig } from "@playwright/test";

/**
 * The suite is deliberately serial. It runs against one of two targets (see
 * docs/e2e.md): the disposable local Supabase stack used locally and in CI, or
 * the production Supabase project on an isolated e2e- fixture (decision D5,
 * amended) for the integrator's pre-release run.
 *
 * - one worker keeps concurrent logins inside the 5-attempts/60s limiter;
 * - role/permission and device-token changes from one spec cannot race another;
 * - every spec still creates only e2e- rows and global setup refuses to start
 *   unless the target is acknowledged (local opt-in + loopback host, or the
 *   host allow-list + production acknowledgement).
 */
export default defineConfig({
	testDir: "./e2e",
	// `e2e/smoke/` needs no database or fixture and runs on Chromium, Firefox
	// and WebKit through playwright.smoke.config.ts. It is excluded here so the
	// authenticated suite stays single-browser and does not run it a second time.
	testIgnore: /smoke[\\/]/,
	globalSetup: "./e2e/global-setup",
	timeout: 60_000,
	// Stateful specs (device registration, RBAC) must not replay a half-finished
	// attempt against the production fixture. On failure: cleanup, seed, rerun.
	retries: 0,
	workers: 1,
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
		screenshot: "only-on-failure",
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
	// Firefox and WebKit are covered by the public smoke suite only
	// (playwright.smoke.config.ts); see docs/compatibility.md for the split.
});
