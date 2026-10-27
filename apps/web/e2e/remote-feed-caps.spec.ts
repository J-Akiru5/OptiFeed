import { expect, test } from "@playwright/test";

import { E2E, completeStepUpIfPrompted, login } from "./helpers";

/**
 * Remote feeder caps (decision D1, plan §6).
 *
 * The e2e unit is fake and permanently offline, so this spec asserts refusals
 * only: a 2,000 g request is rejected by the per-request cap, and a 150 g
 * request reaches the server and is refused because the unit is offline. No
 * valid feed is ever sent to a real device.
 */
test.describe("Remote feeder caps", () => {
	test("refuses an over-cap request and the offline path", async ({ page }) => {
		await login(page, "platform");
		await page.goto(`/en/superadmin/devices?q=${encodeURIComponent(E2E.deviceMac)}`);

		const row = page.locator("tr").filter({ hasText: E2E.deviceMac }).first();
		await expect(row).toBeVisible({ timeout: 20_000 });
		await row.getByRole("button", { name: `Remote control for ${E2E.deviceLabel}` }).click();

		await row
			.getByLabel(`Reason for controlling ${E2E.deviceLabel}`)
			.fill("e2e: verify the remote feed caps on a fake offline unit");

		const grams = row.getByLabel("Grams");
		await grams.fill("2000");
		// Native max-length validation would block submit before the app's own
		// cap message; remove it so the refusal path is exercised.
		await grams.evaluate((element) => element.removeAttribute("max"));
		await row.getByRole("button", { name: "Feed", exact: true }).click();
		await expect(row.getByText("Feed amount must be between 1 and 1000 g.")).toBeVisible();

		await grams.fill("150");
		await row.getByRole("button", { name: "Feed", exact: true }).click();

		// The command is dangerous, so a fresh step-up is required first.
		expect(await completeStepUpIfPrompted(page)).toBe(true);

		await expect(row.getByText(/Refused — Device is offline/)).toBeVisible({ timeout: 30_000 });
		await expect(row.getByText("Feed request for 150 g queued.")).toHaveCount(0);
	});
});
