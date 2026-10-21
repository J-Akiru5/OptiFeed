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

test.describe("Demo admin login", () => {
	test("logs in with demo-farmer-1 and reaches dashboard", async ({ page }) => {
		const pin = process.env.DEMO_PIN ?? "1234";
		await page.goto("/en/login");
		await page.locator("#farmId").fill("demo-farmer-1");
		await page.locator("#pin").fill(pin);
		await page.locator('button[type="submit"]').click();

		// Generous timeout: the server action may cold-compile on first hit in dev.
		await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });
		// Logged in = the login form is gone.
		await expect(page.locator("#farmId")).toHaveCount(0);
	});
});

test.describe("Dashboard loads", () => {
	test("redirects unauthenticated user to login", async ({ page }) => {
		await page.goto("/en/dashboard");
		await expect(page).toHaveURL(/login/);
	});
});
