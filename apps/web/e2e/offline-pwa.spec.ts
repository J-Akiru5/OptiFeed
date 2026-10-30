import { expect, test } from "@playwright/test";

import { login } from "./helpers";

/**
 * Offline PWA UX (decision D9, mission T-11): the banner appears, feeder
 * controls are disabled, and feed commands are never queued while offline.
 */
test.describe("Offline PWA", () => {
	test("shows the offline banner and disables feeder controls", async ({ page }) => {
		await login(page, "farmer");
		await page.goto("/en/dashboard");

		const feedButton = page.getByRole("button", { name: "Feed Now", exact: true });
		await expect(feedButton).toBeVisible({ timeout: 20_000 });

		await page.context().setOffline(true);

		try {
			const banner = page.getByTestId("offline-banner");
			await expect(banner).toBeVisible();
			await expect(banner).toContainText("Offline mode");
			await expect(banner).toContainText("Feed commands are disabled until you reconnect.");
			await expect(feedButton).toBeDisabled();
		} finally {
			await page.context().setOffline(false);
		}
	});
});
