import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform account menu (issue #560).
 *
 * The console used to render a bare avatar that was not interactive for a
 * platform admin without a tenant membership. These tests pin the replacement:
 * the avatar opens the identity panel, every account action is reachable,
 * Escape restores focus, and signing out clears the cached state before the
 * session ends.
 */

const mocks = vi.hoisted(() => ({
	signOut: vi.fn(async () => undefined),
	replace: vi.fn(),
	clearMessages: vi.fn(),
	clearChatHistory: vi.fn(),
	clearSnapshot: vi.fn(),
	clearOffline: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({ auth: { signOut: mocks.signOut } }),
}));
vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ clearMessages: mocks.clearMessages }),
}));
vi.mock("@/components/chat/chat-storage", () => ({
	clearChatHistory: mocks.clearChatHistory,
}));
vi.mock("@/lib/pwa/snapshot", () => ({
	clearDashboardSnapshot: mocks.clearSnapshot,
}));
vi.mock("@/lib/offline/db", () => ({
	clearOfflineData: mocks.clearOffline,
}));
vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({ href, children, ...rest }: { href: unknown; children?: React.ReactNode }) =>
			react.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
		useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
	};
});
vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});
vi.mock("@/components/user-avatar", async () => {
	const react = await import("react");
	return {
		UserAvatar: ({ name }: { name: string }) =>
			react.createElement("span", { "data-avatar": name }),
	};
});

import { SuperadminAccountMenu } from "@/components/superadmin/account-menu";
import { createTranslator } from "./helpers/messages";

const t = createTranslator("superadmin.account");
const tShell = createTranslator("superadmin.shell");

const USER = {
	displayName: "Karl Calimotan",
	email: "karl@example.com",
	farmId: "platform-karl",
	role: "ADMIN",
	avatarUrl: null,
};

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("SuperadminAccountMenu", () => {
	it("opens from the avatar and shows the identity and account actions", () => {
		render(<SuperadminAccountMenu user={USER} hasFarmDashboard={false} />);

		const trigger = screen.getByRole("button", { name: t("menuLabel") });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(trigger);

		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Karl Calimotan")).toBeVisible();
		expect(screen.getByText("karl@example.com")).toBeVisible();
		expect(screen.getByRole("link", { name: t("menuProfile") })).toHaveAttribute(
			"href",
			"/superadmin/account",
		);
		expect(screen.getByRole("link", { name: t("menuSettings") })).toHaveAttribute(
			"href",
			"/superadmin/settings",
		);
		expect(screen.getByRole("button", { name: tShell("signOut") })).toBeVisible();
	});

	it("only offers the farm dashboard when the admin has a tenant", () => {
		render(<SuperadminAccountMenu user={USER} hasFarmDashboard={false} />);
		fireEvent.click(screen.getByRole("button", { name: t("menuLabel") }));
		expect(screen.queryByRole("link", { name: t("menuFarm") })).toBeNull();
	});

	it("shows the farm dashboard link for a platform admin with a membership", () => {
		render(<SuperadminAccountMenu user={USER} hasFarmDashboard />);
		fireEvent.click(screen.getByRole("button", { name: t("menuLabel") }));
		expect(screen.getByRole("link", { name: t("menuFarm") })).toHaveAttribute("href", "/dashboard");
	});

	it("closes on Escape and returns focus to the avatar", () => {
		render(<SuperadminAccountMenu user={USER} hasFarmDashboard={false} />);
		const trigger = screen.getByRole("button", { name: t("menuLabel") });
		fireEvent.click(trigger);
		expect(screen.getByText("Karl Calimotan")).toBeVisible();

		fireEvent.keyDown(document, { key: "Escape" });

		expect(screen.queryByText("Karl Calimotan")).toBeNull();
		expect(trigger).toHaveFocus();
	});

	it("clears cached state and ends the session before redirecting", async () => {
		render(<SuperadminAccountMenu user={USER} hasFarmDashboard={false} />);
		fireEvent.click(screen.getByRole("button", { name: t("menuLabel") }));
		fireEvent.click(screen.getByRole("button", { name: tShell("signOut") }));

		await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));

		expect(mocks.clearMessages).toHaveBeenCalledTimes(1);
		expect(mocks.clearChatHistory).toHaveBeenCalledTimes(1);
		expect(mocks.clearSnapshot).toHaveBeenCalledTimes(1);
		expect(mocks.clearOffline).toHaveBeenCalledTimes(1);
		expect(mocks.replace).toHaveBeenCalledWith("/");
	});
});
