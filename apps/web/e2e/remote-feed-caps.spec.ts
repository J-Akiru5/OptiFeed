import { expect, test } from "@playwright/test";

import { E2E, completeStepUpIfPrompted, login } from "./helpers";

/**
 * Remote feeder caps (decision D1, plan A6).
 *
 * The e2e unit is fake and permanently offline, so this spec asserts refusals
 * only: a 5,001 g request is rejected by the 5,000 g payload sanity bound, and
 * a 150 g request reaches the server and is refused because the unit is
 * offline. The daily ceiling is the only gram cap. No valid feed is ever sent
 * to a real device.
 *
 * The control panel is NOT inside the device row: in the table view it renders
 * in its own full-width row underneath (`RemoteFeedRow`), and in the card view
 * it renders inside the card. Scoping the panel locators to the device row
 * therefore only ever worked by accident on the card layout, so the panel is
 * addressed at page level — exactly one panel is open at a time.
 */
test.describe("Remote feeder caps", () => {
	test("refuses an over-cap request and the offline path", async ({ page }) => {
		await login(page, "platform");
		await page.goto(`/en/superadmin/devices?q=${encodeURIComponent(E2E.deviceMac)}`);

		const row = page.locator("tr").filter({ hasText: E2E.deviceMac }).first();
		await expect(row).toBeVisible({ timeout: 20_000 });
		await row.getByRole("button", { name: `Remote control for ${E2E.deviceLabel}` }).click();

		const reason = page.getByLabel(`Reason for controlling ${E2E.deviceLabel}`);
		await expect(reason).toBeVisible({ timeout: 10_000 });
		await reason.fill("e2e: verify the remote feed caps on a fake offline unit");

		const grams = page.getByLabel("Grams", { exact: true });
		await grams.fill("5001");
		// Native max validation would block submit before the app's own sanity
		// message; remove it so the refusal path is exercised.
		await grams.evaluate((element) => element.removeAttribute("max"));
		await page.getByRole("button", { name: "Feed", exact: true }).click();
		await expect(page.getByText("Feed amount must be between 1 and 5000 g.")).toBeVisible();

		await grams.fill("150");
		await page.getByRole("button", { name: "Feed", exact: true }).click();

		// The command is dangerous, so a fresh step-up is required first.
		expect(await completeStepUpIfPrompted(page)).toBe(true);

		await expect(page.getByText(/Refused .* Device is offline/)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText("Feed request for 150 g queued.")).toHaveCount(0);
	});
});
