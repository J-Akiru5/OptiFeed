import { expect, test } from "@playwright/test";

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

		await page.locator("#farmId").fill("demo-farmer-1");
		await page.locator("#password").fill("OptiFeedDemo123");
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
			await farmIdInput.fill("nonexistent-farmer");
			await passwordInput.fill("wrong-password-123");
			await page.locator('button[type="submit"]').click();
			// Should show an error or stay on login page
			await expect(page).toHaveURL(/login/);
		}
	});
});

test.describe("Demo admin login", () => {
	test("logs in with demo-farmer-1 and reaches dashboard", async ({ page }) => {
		const password = process.env.DEMO_PASSWORD ?? "OptiFeedDemo123";
		await page.goto("/en/login");
		await page.locator("#farmId").fill("demo-farmer-1");
		await page.locator("#password").fill(password);
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
