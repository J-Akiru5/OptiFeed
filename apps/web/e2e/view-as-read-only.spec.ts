import { expect, test } from "@playwright/test";

import { E2E, completeStepUpIfPrompted, login } from "./helpers";

/**
 * Superadmin view-as is read-only (decision D1, plan M5.1).
 *
 * Starting a session needs a reason and a fresh step-up, then the tenant
 * dashboard renders with the red banner. A write control must be visibly
 * disabled, and exiting returns to the platform console.
 */
test.describe("Superadmin view-as", () => {
	test("shows the read-only banner, blocks writes and exits", async ({ page }) => {
		await login(page, "platform");
		await page.goto("/en/superadmin/orgs");

		const orgRow = page.locator("tr").filter({ hasText: E2E.orgName }).first();
		await expect(orgRow).toBeVisible({ timeout: 20_000 });
		await orgRow.getByRole("button", { name: `View ${E2E.orgName} read-only` }).click();

		await page
			.getByLabel(`Reason for viewing ${E2E.orgName} read-only`)
			.fill("e2e: verify the read-only view-as banner and write guards");
		await page.getByRole("button", { name: "Open read-only" }).click();

		await expect(page.locator("#stepup-password")).toBeVisible({ timeout: 30_000 });
		expect(await completeStepUpIfPrompted(page)).toBe(true);

		await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

		// Red banner + explicit read-only notice.
		await expect(page.getByText(`Read-only view as ${E2E.orgName}`, { exact: true })).toBeVisible();
		await expect(
			page.getByText("Every write is disabled. Exit to return to the platform console."),
		).toBeVisible();
		await expect(page.getByText("View only", { exact: true }).first()).toBeVisible();

		// A real write control is disabled instead of failing after a tap.
		const feedButton = page.getByRole("button", { name: "Feed Now", exact: true });
		await expect(feedButton).toBeVisible();
		await expect(feedButton).toBeDisabled();

		await page.getByRole("button", { name: "Exit view-as" }).click();
		await expect(page).toHaveURL(/\/superadmin\/orgs/, { timeout: 30_000 });
		await expect(page.getByText(`Read-only view as ${E2E.orgName}`, { exact: true })).toHaveCount(
			0,
		);
	});
});
