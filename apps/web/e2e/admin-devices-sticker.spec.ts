import { expect, test } from "@playwright/test";

import { E2E, login, provisioningSsid } from "./helpers";

/**
 * Tenant Admin -> Devices sticker print page.
 *
 * The sticker is built from the MAC alone. Its QR payload carries the setup
 * SSID and nothing else, so the device token can never be printed by accident.
 */
test.describe("Tenant admin sticker print", () => {
	test("prints the e2e feeder sticker with an SSID-only QR payload", async ({ page }) => {
		await login(page, "admin");
		await page.goto("/en/admin/devices");

		const row = page
			.locator("tr")
			.filter({ has: page.getByText(E2E.deviceLabel, { exact: true }) })
			.first();
		await expect(row).toBeVisible({ timeout: 20_000 });
		await expect(row).toContainText(E2E.deviceMac);

		await row.getByRole("link", { name: "Print label" }).click();
		await expect(page).toHaveURL(/\/admin\/devices\/labels\?id=/);

		const sticker = page.locator(".pk-sticker").first();
		await expect(sticker).toBeVisible();

		const ssid = provisioningSsid(E2E.deviceMac);
		await expect(sticker).toHaveAttribute("data-ssid", ssid);
		await expect(sticker).toContainText(E2E.deviceMac);

		// The visible payload line is the SSID-only open-network join string.
		const payload = `WIFI:T:nopass;S:${ssid};;`;
		await expect(page.locator("code").filter({ hasText: payload })).toBeVisible();

		// A token is a credential: it must not appear anywhere in the page.
		const html = await page.content();
		expect(html).not.toContain("esp32-tok-");
		expect(html).not.toContain("tokenHash");
	});
});
