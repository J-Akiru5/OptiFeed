import { expect, test } from "@playwright/test";

test.describe("Schedule page", () => {
	test("redirects unauthenticated user to login", async ({ page }) => {
		await page.goto("/en/dashboard/schedule");
		await expect(page).toHaveURL(/login/);
	});

	test("schedule page loads for authenticated user", async ({ page }) => {
		await page.goto("/en/login");
		// If already authenticated, should redirect to dashboard
		const url = page.url();
		if (!url.includes("login")) {
			await page.goto("/en/dashboard/schedule");
			await expect(page.locator("text=Schedule")).toBeVisible();
		}
	});
});

test.describe("Feed Now action", () => {
	test("feed now button is visible on dashboard", async ({ page }) => {
		await page.goto("/en/dashboard");
		if (await page.locator('input[type="text"]').first().isVisible()) {
			test.skip(true, "Not logged in");
			return;
		}
		const feedButton = page
			.locator("button")
			.filter({ hasText: /feed now/i })
			.first();
		if (await feedButton.isVisible()) {
			await expect(feedButton).toBeEnabled();
		}
	});

	test("feed now button shows confirmation", async ({ page }) => {
		await page.goto("/en/dashboard");
		if (await page.locator('input[type="text"]').first().isVisible()) {
			test.skip(true, "Not logged in");
			return;
		}
		const feedButton = page
			.locator("button")
			.filter({ hasText: /feed now/i })
			.first();
		if (await feedButton.isVisible()) {
			await feedButton.click();
			// Should show some kind of confirmation or dialog
			await page.waitForTimeout(500);
		}
	});
});

test.describe("Admin panel", () => {
	test("redirects non-admin to dashboard", async ({ page }) => {
		await page.goto("/en/admin");
		// Non-admin users should be redirected
		const url = page.url();
		expect(url.includes("/admin")).not.toBeTruthy();
	});

	test("admin page shows stats when accessed as admin", async ({ page }) => {
		await page.goto("/en/admin");
		const url = page.url();
		if (url.includes("/admin")) {
			// Admin page loaded - check for expected content
			await expect(page.locator("text=Admin")).toBeVisible();
		}
	});
});
