import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/admin", () => ({
	getUserPermissionState: vi.fn(),
	setUserPermission: vi.fn(),
}));

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => {
		const strings: Record<string, string> = {
			permissionsButton: "Permissions",
			permissionsTitle: "Permissions for {name}",
			permissionsDesc: "Role defaults apply unless a permission is changed here.",
			roleLabel: "Membership role",
			close: "Close",
			cancel: "Cancel",
			save: "Save changes",
			saving: "Saving…",
			loading: "Loading permissions…",
			roleDefault: "Role default",
			notGranted: "Not granted",
			granted: "Granted",
			revoked: "Revoked",
			manageMembersLocked: "You cannot revoke your own ability to manage members.",
			"permission.view_dashboard": "View dashboard",
			"permission.manage_members": "Manage members",
		};
		const value = strings[key];
		return typeof value === "string" ? value : key;
	},
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UserPermissionsDialog } from "@/components/admin/user-permissions-dialog";
import { getUserPermissionState } from "@/lib/actions/admin";

const mockState = vi.mocked(getUserPermissionState);

beforeEach(() => {
	mockState.mockReset();
	mockState.mockResolvedValue({
		success: true,
		role: "ADMIN",
		defaults: ["view_dashboard"],
		overrides: [],
	});
});

describe("UserPermissionsDialog focus handling", () => {
	it("moves focus into the dialog and restores it to the trigger on Escape", async () => {
		render(
			<UserPermissionsDialog
				userId="user-1"
				userName="Juan Miguel"
				permissions={["view_dashboard", "manage_members"]}
				isSelf={false}
			/>,
		);

		const trigger = screen.getByRole("button", { name: /Permissions/ });
		trigger.focus();
		fireEvent.click(trigger);

		const close = await screen.findByRole("button", { name: "Close" });
		await waitFor(() => expect(document.activeElement).toBe(close));

		fireEvent.keyDown(window, { key: "Escape" });

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument(),
		);
		expect(document.activeElement).toBe(trigger);
	});

	it("labels the dialog with its title and description", async () => {
		render(
			<UserPermissionsDialog
				userId="user-1"
				userName="Juan Miguel"
				permissions={["view_dashboard"]}
				isSelf={false}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Permissions/ }));

		const dialog = await screen.findByRole("dialog");
		const titleId = dialog.getAttribute("aria-labelledby");
		const descriptionId = dialog.getAttribute("aria-describedby");

		expect(titleId).toBeTruthy();
		expect(descriptionId).toBeTruthy();
		expect(document.getElementById(titleId ?? "")?.textContent).toContain("Permissions for");
		expect(document.getElementById(descriptionId ?? "")?.textContent).toContain("Role defaults");
	});
});
