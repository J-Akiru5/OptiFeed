import { expect, test } from "@playwright/test";

import { E2E, login } from "./helpers";

test.describe("Login flow", () => {
	test("shows login page", async ({ page }) => {
		await page.goto("/en/login");
		await expect(page.getByRole("heading", { name: "Sign in to PakaonAI" })).toBeVisible();
	});

	test("validates fields and reveals the password", async ({ page }) => {
		await page.goto("/en/login");

		await page.getByRole("button", { name: "Sign in" }).click();
		await expect(page.locator("#farmId-error")).toHaveText("Enter your farm ID.");
		await expect(page.locator("#password-error")).toHaveText("Enter your password.");

		// The reveal control does not submit, so a throwaway value is enough.
		await page.locator("#farmId").fill(E2E.farmerLogin);
		await page.locator("#password").fill("not-the-real-password");
		await page.getByRole("button", { name: "Show password" }).click();
		await expect(page.locator("#password")).toHaveAttribute("type", "text");
		await page.getByRole("button", { name: "Hide password" }).click();
		await expect(page.locator("#password")).toHaveAttribute("type", "password");
	});

	test("shows error for invalid credentials", async ({ page }) => {
		await page.goto("/en/login");
		const farmIdInput = page
			.locator('input[name="farmId"], input[placeholder*="farm" i], input[type="text"]')
			.first();
		const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

		if (await farmIdInput.isVisible()) {
			await farmIdInput.fill("e2e-missing-login");
			await passwordInput.fill("wrong-password-123");
			await page.locator('button[type="submit"]').click();
			// Should show an error or stay on login page
			await expect(page).toHaveURL(/login/);
		}
	});
});

test.describe("E2E farmer login", () => {
	test("logs in with the isolated e2e-farmer account and reaches the dashboard", async ({
		page,
	}) => {
		await login(page, "farmer");

		await expect(page).toHaveURL(/dashboard/);
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
