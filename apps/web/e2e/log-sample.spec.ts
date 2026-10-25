import { expect, test } from "@playwright/test";

import { login } from "./helpers";

test("saving a sample shows the feed calculation result and a batch card", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await login(page);
	await page.goto("/en/dashboard/log-sample");

	// Average Mode is the default.
	await page.locator("#weightGrams").fill("220");
	await page.locator("#lengthCm").fill("24");
	await page.locator("#sampleCount").fill("20");
	await page.locator("#batchLabel").fill("E2E Batch 2026");

	await page.getByRole("button", { name: "Save Sample" }).click();

	// Result panel with the calculated feed amount.
	await expect(page.getByText("Feed to dispense per feeding")).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText(/\d+\.\d{2} g/)).toBeVisible();
	await expect(page.getByText("Saved to")).toBeVisible();
	// Schedule status: applied, kept by safety guard, or skipped — any is valid here.
	await expect(
		page.getByText(/Device schedule|Schedule kept|no device is linked/i).first(),
	).toBeVisible();

	// Batch card below the form.
	const section = page.locator("section[aria-labelledby='saved-batches-heading']");
	await expect(section.getByRole("heading", { name: "Saved Batches" })).toBeVisible();
	await expect(section.getByText("E2E Batch 2026", { exact: true })).toBeVisible();

	// "Log Another Sample" resets the form for a fresh entry.
	await page.getByRole("button", { name: "Log Another Sample" }).click();
	await expect(page.locator("#weightGrams")).toBeVisible();
	await expect(section.getByText("E2E Batch 2026", { exact: true })).toBeVisible();

	// The saved batch card opens its dedicated log page.
	await section.getByRole("link", { name: /E2E Batch 2026/ }).click();
	await expect(page.getByRole("heading", { name: "E2E Batch 2026" })).toBeVisible();
	await expect(page.getByText("Every saved log for this batch")).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Avg Weight" })).toBeVisible();
});
