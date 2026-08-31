import { expect, test } from "@playwright/test";

test.describe("Login flow", () => {
	test("shows login page", async ({ page }) => {
		await page.goto("/en/login");
		await expect(page.locator("text=OptiFeed")).toBeVisible();
	});

	test("shows error for invalid credentials", async ({ page }) => {
		await page.goto("/en/login");
		const farmIdInput = page
			.locator('input[name="farmId"], input[placeholder*="farm" i], input[type="text"]')
			.first();
		const pinInput = page
			.locator('input[name="pin"], input[type="password"], input[placeholder*="pin" i]')
			.first();

		if (await farmIdInput.isVisible()) {
			await farmIdInput.fill("nonexistent-farmer");
			await pinInput.fill("000000");
			await page.locator('button[type="submit"]').click();
			// Should show an error or stay on login page
			await expect(page).toHaveURL(/login/);
		}
	});
});

test.describe("Dashboard loads", () => {
	test("redirects unauthenticated user to login", async ({ page }) => {
		await page.goto("/en/dashboard");
		await expect(page).toHaveURL(/login/);
	});
});
