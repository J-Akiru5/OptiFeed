import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	globalSetup: "./e2e/global-setup",
	timeout: 30_000,
	retries: 1,
	use: {
		baseURL: "http://localhost:3000",
		screenshot: "only-on-failure",
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
