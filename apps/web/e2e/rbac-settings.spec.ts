import { expect, test } from "@playwright/test";

import { E2E, login } from "./helpers";

/**
 * Tenant RBAC in Admin -> Settings -> Members (decision D2).
 *
 * The e2e admin is the only OWNER, so the last-owner lock and the self-role
 * lock must both be visible. The farmer starts as OPERATOR with no permission
 * overrides (the seed resets them), which makes the billing grant deterministic.
 */
test.describe("Tenant RBAC settings", () => {
	test("owner changes a role and grants a permission; ownership guards show", async ({ page }) => {
		await login(page, "admin");
		await page.goto("/en/admin/settings");

		const farmerRow = page.locator("tr").filter({ hasText: E2E.farmerLogin }).first();
		await expect(farmerRow).toBeVisible({ timeout: 20_000 });

		const roleSelect = farmerRow.getByRole("combobox");
		const currentRole = await roleSelect.inputValue();
		const nextRole = currentRole === "OPERATOR" ? "VIEWER" : "OPERATOR";
		await roleSelect.selectOption(nextRole);
		await expect(roleSelect).toHaveValue(nextRole);
		await expect(page.getByText("Role updated.")).toBeVisible();

		// Grant a permission the OPERATOR/VIEWER role does not have by default.
		// Permissions live on a dedicated page (#189), not in a dialog.
		await farmerRow.getByRole("link", { name: `Permissions — ${E2E.farmerLogin}` }).click();
		await expect(
			page.getByRole("heading", { name: `Permissions for ${E2E.farmerLogin}` }),
		).toBeVisible({ timeout: 20_000 });
		const billingRow = page.locator("li").filter({ hasText: "View billing" });
		await expect(billingRow.getByRole("checkbox")).not.toBeChecked();
		await billingRow.getByRole("checkbox").check();
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(page.getByText("Permissions updated.")).toBeVisible();

		// Reload and prove the override was stored, not just shown locally.
		await page.reload();
		const reloadedBilling = page.locator("li").filter({ hasText: "View billing" });
		await expect(reloadedBilling.getByRole("checkbox")).toBeChecked({ timeout: 20_000 });
		await expect(reloadedBilling.getByText("Granted", { exact: true })).toBeVisible();
		await page.getByRole("link", { name: "Back to Settings" }).click();
		await expect(farmerRow).toBeVisible({ timeout: 20_000 });

		// Ownership guards: the admin is the only OWNER and cannot edit themself.
		const adminRow = page.locator("tr").filter({ hasText: E2E.adminLogin }).first();
		await expect(adminRow).toBeVisible();
		await expect(
			adminRow.getByText("Promote another owner before changing this one."),
		).toBeVisible();
		await expect(adminRow.getByText("You cannot change your own role.")).toBeVisible();

		// Restore the deterministic seed state for the remaining specs.
		await roleSelect.selectOption("OPERATOR");
		await expect(roleSelect).toHaveValue("OPERATOR");
	});
});
