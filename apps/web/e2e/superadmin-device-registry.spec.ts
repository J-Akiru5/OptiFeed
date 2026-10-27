import { expect, test } from "@playwright/test";

import { E2E, completeStepUpIfPrompted, login, provisioningSsid } from "./helpers";

/**
 * Superadmin device registry: register a fake unit, rotate its token and print
 * its sticker.
 *
 * The registration MAC and label are reserved e2e- data. The unit is never a
 * real feeder, so nothing is dispatched by this spec.
 */
test.describe("Superadmin device registry", () => {
	test("registers, rotates and prints the e2e device", async ({ page }) => {
		await login(page, "platform");
		await page.goto("/en/superadmin/devices");

		// A failed earlier run must not silently turn this into a "duplicate MAC"
		// failure; say what to do instead.
		await page.getByPlaceholder("Search MAC or label").fill(E2E.registerMac);
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(
			page.getByText(/No device matches/),
			`stale ${E2E.registerMac} found: run scripts/e2e/cleanup-e2e.ts, then seed again`,
		).toBeVisible();

		await page.locator("#device-mac").fill(E2E.registerMac);
		await page.locator("#device-label").fill(E2E.registerLabel);
		await page.locator("#device-org").selectOption(E2E.orgId);
		await expect(page.locator("#device-pond")).toBeEnabled();
		await page.locator("#device-pond").selectOption(E2E.pondId);
		await page.locator("#device-reason").fill("e2e: register a fake unit for the Playwright suite");

		await page.getByRole("button", { name: "Register device" }).click();

		// Registration issues a live credential, so step-up is required.
		await expect(page.locator("#stepup-password")).toBeVisible({ timeout: 30_000 });
		expect(await completeStepUpIfPrompted(page)).toBe(true);

		const tokenPattern = /^esp32-tok-[0-9a-f]{32}$/;
		const tokenCode = page.getByText(tokenPattern);
		await expect(tokenCode).toBeVisible({ timeout: 30_000 });
		const registrationToken = (await tokenCode.textContent())?.trim() ?? "";
		expect(registrationToken).toMatch(tokenPattern);

		// The sticker comes from the register result and never carries the token.
		const printLink = page.getByRole("link", {
			name: `Print sticker for ${E2E.registerMac}`,
		});
		await expect(printLink).toBeVisible();
		await printLink.click();
		await expect(page).toHaveURL(/\/superadmin\/devices\/labels\?id=/);

		const sticker = page.locator(".pk-sticker").first();
		await expect(sticker).toBeVisible();
		const ssid = provisioningSsid(E2E.registerMac);
		await expect(sticker).toHaveAttribute("data-ssid", ssid);
		await expect(sticker).toContainText(E2E.registerMac);
		const html = await page.content();
		expect(html).not.toContain("esp32-tok-");
		expect(html).not.toContain("tokenHash");

		// Rotation revokes the old credential. A fresh step-up cookie means the
		// dialog may not reappear within five minutes; handle both paths.
		await page.goto(`/en/superadmin/devices?q=${encodeURIComponent(E2E.registerMac)}`);
		const row = page.locator("tr").filter({ hasText: E2E.registerMac }).first();
		await expect(row).toBeVisible({ timeout: 20_000 });
		await row.getByRole("button", { name: `Rotate token — ${E2E.registerMac}` }).click();
		await row.getByLabel("Reason for rotating the token").fill("e2e: rotate the fake unit token");
		await row.getByRole("button", { name: "Rotate", exact: true }).click();
		await completeStepUpIfPrompted(page);

		const rotatedCode = page.getByText(tokenPattern);
		await expect(rotatedCode).toBeVisible({ timeout: 30_000 });
		const rotatedToken = (await rotatedCode.textContent())?.trim() ?? "";
		expect(rotatedToken).toMatch(tokenPattern);
		expect(rotatedToken).not.toBe(registrationToken);
	});
});
