import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The inline contact-email editor on the tenant Members table (#449).
 *
 * The synthetic pond login address is never shown (it cannot receive mail and
 * never changes); the row shows the address an administrator recorded, or says
 * there is none, and offers an edit control only where the server would accept
 * the change.
 */

const refresh = vi.fn();

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string | { pathname?: string };
		children?: ReactNode;
	} & Record<string, unknown>) => (
		<a href={typeof href === "string" ? href : (href?.pathname ?? "#")} {...rest}>
			{children}
		</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/admin", () => ({
	changeMemberRole: vi.fn(),
	inviteMember: vi.fn(),
	revokeMember: vi.fn(),
	updateMemberContactEmail: vi.fn(),
}));

import { MembersSettings } from "@/components/admin/members-settings";
import { type TenantMemberRow, updateMemberContactEmail } from "@/lib/actions/admin";
import { toast } from "sonner";

const ORG_OPTIONS = [{ id: "org-1", name: "Miguel Farm", callerRole: "OWNER" as const }];

function member(overrides: Partial<TenantMemberRow> = {}): TenantMemberRow {
	return {
		membershipId: "m-1",
		userId: "user-1",
		orgId: "org-1",
		orgName: "Miguel Farm",
		displayName: "Juan Miguel",
		farmId: "juan-miguel",
		email: "juan-miguel@pond.optifeed.local",
		contactEmail: "juan@example.com",
		avatarUrl: null,
		role: "OPERATOR",
		callerRole: "OWNER",
		permissions: [],
		joinedAt: new Date("2026-07-08T16:19:00"),
		isSelf: false,
		isPlatformAdmin: false,
		isLastOwner: false,
		...overrides,
	};
}

function renderMembers(rows: TenantMemberRow[], canManage = true) {
	return render(<MembersSettings members={rows} canManage={canManage} orgOptions={ORG_OPTIONS} />);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("members table contact email (#449)", () => {
	it("shows the recorded address and never the synthetic login address", () => {
		renderMembers([member()]);

		expect(screen.getAllByText("juan@example.com").length).toBeGreaterThan(0);
		expect(screen.queryByText("juan-miguel@pond.optifeed.local")).not.toBeInTheDocument();
	});

	it("says there is no email on file when none is recorded", () => {
		renderMembers([member({ contactEmail: null })]);

		expect(screen.getAllByText("No email on file").length).toBeGreaterThan(0);
	});

	it("offers the edit control to a manager", () => {
		renderMembers([member()]);

		expect(
			screen.getAllByRole("button", { name: "Edit email for Juan Miguel" }).length,
		).toBeGreaterThan(0);
	});

	it("hides the edit control from someone who cannot manage members", () => {
		renderMembers([member()], false);

		expect(screen.queryByRole("button", { name: /Edit email for/ })).not.toBeInTheDocument();
	});

	it("hides the edit control for a platform administrator", () => {
		renderMembers([member({ isPlatformAdmin: true })]);

		expect(screen.queryByRole("button", { name: /Edit email for/ })).not.toBeInTheDocument();
	});

	it("hides the edit control from an ADMIN looking at an OWNER", () => {
		renderMembers([member({ role: "OWNER", callerRole: "ADMIN" })]);

		expect(screen.queryByRole("button", { name: /Edit email for/ })).not.toBeInTheDocument();
	});

	it("saves the typed address, closes the editor and refreshes", async () => {
		vi.mocked(updateMemberContactEmail).mockResolvedValue({ success: true });
		renderMembers([member({ contactEmail: null })]);

		fireEvent.click(screen.getAllByRole("button", { name: "Edit email for Juan Miguel" })[0]);
		const [field] = screen.getAllByLabelText("Email for Juan Miguel");
		expect(field).toHaveValue("");
		fireEvent.change(field, { target: { value: "juan.real@example.com" } });
		fireEvent.click(screen.getAllByRole("button", { name: "Save email" })[0]);

		await waitFor(() =>
			expect(updateMemberContactEmail).toHaveBeenCalledWith("user-1", "juan.real@example.com"),
		);
		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(toast.success).toHaveBeenCalledWith("Email saved.");
		expect(screen.queryByLabelText("Email for Juan Miguel")).not.toBeInTheDocument();
	});

	it("prefills the current address and reports a removal when it is cleared", async () => {
		vi.mocked(updateMemberContactEmail).mockResolvedValue({ success: true });
		renderMembers([member()]);

		fireEvent.click(screen.getAllByRole("button", { name: "Edit email for Juan Miguel" })[0]);
		const [field] = screen.getAllByLabelText("Email for Juan Miguel");
		expect(field).toHaveValue("juan@example.com");
		fireEvent.change(field, { target: { value: "" } });
		fireEvent.click(screen.getAllByRole("button", { name: "Save email" })[0]);

		await waitFor(() => expect(updateMemberContactEmail).toHaveBeenCalledWith("user-1", ""));
		await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Email removed."));
	});

	it("shows the server refusal and keeps the editor open", async () => {
		vi.mocked(updateMemberContactEmail).mockResolvedValue({
			error: "That email is already registered to another account.",
		});
		renderMembers([member()]);

		fireEvent.click(screen.getAllByRole("button", { name: "Edit email for Juan Miguel" })[0]);
		fireEvent.click(screen.getAllByRole("button", { name: "Save email" })[0]);

		expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
			"That email is already registered to another account.",
		);
		expect(screen.getAllByLabelText("Email for Juan Miguel").length).toBeGreaterThan(0);
		expect(refresh).not.toHaveBeenCalled();
	});

	it("falls back to a generic message when the request throws", async () => {
		vi.mocked(updateMemberContactEmail).mockRejectedValue(new Error("network"));
		renderMembers([member()]);

		fireEvent.click(screen.getAllByRole("button", { name: "Edit email for Juan Miguel" })[0]);
		fireEvent.click(screen.getAllByRole("button", { name: "Save email" })[0]);

		expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
			"Could not save the email. Try again.",
		);
	});

	it("closes the editor on Cancel without saving", () => {
		renderMembers([member()]);

		fireEvent.click(screen.getAllByRole("button", { name: "Edit email for Juan Miguel" })[0]);
		fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);

		expect(screen.queryByLabelText("Email for Juan Miguel")).not.toBeInTheDocument();
		expect(updateMemberContactEmail).not.toHaveBeenCalled();
	});
});
