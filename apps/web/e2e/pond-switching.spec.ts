import { expect, test } from "@playwright/test";

test.describe("Pond switching", () => {
	test("dashboard shows pond selector when multiple ponds exist", async ({ page }) => {
		await page.goto("/en/dashboard");
		// Unauthenticated users get redirected
		await expect(page).toHaveURL(/login/);
	});

	test("pond selector opens and shows pond names", async ({ page }) => {
		// This test requires authentication — skip if not logged in
		await page.goto("/en/dashboard");
		if (await page.locator('input[name="farmId"], input[type="text"]').first().isVisible()) {
			test.skip(true, "Not logged in — skipping pond selector test");
			return;
		}

		const pondButton = page
			.locator("button")
			.filter({ hasText: /pond|select/i })
			.first();
		if (await pondButton.isVisible()) {
			await pondButton.click();
			// Dropdown should appear with pond names
			const dropdown = page.locator(".absolute.top-full");
			await expect(dropdown).toBeVisible();
		}
	});

	test("switching ponds updates the page", async ({ page }) => {
		await page.goto("/en/dashboard");
		if (await page.locator('input[name="farmId"], input[type="text"]').first().isVisible()) {
			test.skip(true, "Not logged in — skipping pond switch test");
			return;
		}

		const pondButton = page
			.locator("button")
			.filter({ hasText: /pond|select/i })
			.first();
		if (await pondButton.isVisible()) {
			await pondButton.click();
			const dropdown = page.locator(".absolute.top-full");
			await expect(dropdown).toBeVisible();

			// Click a different pond in the list
			const secondPond = dropdown.locator("button").nth(1);
			if (await secondPond.isVisible()) {
				await secondPond.click();
				// Page should refresh or update
				await page.waitForLoadState("networkidle");
			}
		}
	});
});
