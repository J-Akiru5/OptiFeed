import { ACCOUNT_MENU_CONTRAST } from "@/components/account-menu-theme";
import { contrastRatio } from "@/lib/calendar/event-colors";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #345 the account menu must stay readable in both themes, and its account
 * name must lead somewhere. The dropdown used to keep the dark-mode device
 * status on the light-only red/green inks (2.62:1 and 2.75:1), leave the
 * "missing" state at 3.03:1, and paint the Admin Panel label with the brand
 * orange on a 5% tint (3.34:1); it also had no settings destination at all.
 *
 * These checks lock the fix in:
 *   1. "Account settings" opens the real profile settings route;
 *   2. every documented `ACCOUNT_MENU_CONTRAST` pair meets WCAG AA (4.5:1) for
 *      normal text in light and dark mode;
 *   3. the rendered items carry the documented dark-mode classes, so the
 *      component cannot drift from the measured pairs;
 *   4. Escape and the close control return focus to the avatar trigger.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

const routerMocks = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children?: unknown }) => children,
	useRouter: () => routerMocks,
	usePathname: () => "/dashboard",
}));
vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ clearMessages: vi.fn() }),
}));
vi.mock("@/components/notification-provider", () => ({
	useNotifications: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/theme-provider", () => ({
	useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({ auth: { signOut: vi.fn() } }),
}));
vi.mock("@/lib/offline/db", () => ({ clearOfflineData: vi.fn() }));
vi.mock("@/lib/pwa/snapshot", () => ({ clearDashboardSnapshot: vi.fn() }));
vi.mock("@/components/chat/chat-storage", () => ({ clearChatHistory: vi.fn() }));
vi.mock("@/lib/actions/pond-selection", () => ({ switchPond: vi.fn() }));

import { HeaderActions, type HeaderActionsUser } from "@/components/header-actions";

const FARMER: HeaderActionsUser = {
	email: "demo-farmer-1@pond.optifeed.local",
	role: "ADMIN",
	displayName: "Demo Farmer 1",
	isTenantAdmin: true,
	isPlatformAdmin: false,
};

function renderHeader(esp32Status: "online" | "offline" | "missing" = "online") {
	return render(
		<HeaderActions
			ponds={[{ id: "pond-1", name: "ILO-POND-01" }]}
			activePondId="pond-1"
			pondName="ILO-POND-01"
			lastSeenAt={new Date().toISOString()}
			esp32Status={esp32Status}
			initialUser={FARMER}
		/>,
	);
}

function openProfileMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Open profile and settings menu" }));
}

beforeEach(() => {
	routerMocks.push.mockClear();
	routerMocks.replace.mockClear();
});

describe("account menu navigation (#345)", () => {
	it("opens the profile settings route from the account menu", () => {
		renderHeader();
		openProfileMenu();

		fireEvent.click(screen.getByRole("button", { name: "Account settings" }));

		expect(routerMocks.push).toHaveBeenCalledWith("/dashboard/settings/profile");
		expect(screen.queryByRole("button", { name: "Account settings" })).not.toBeInTheDocument();
	});

	it("closes on Escape and returns focus to the avatar trigger", () => {
		renderHeader();
		const trigger = screen.getByRole("button", { name: "Open profile and settings menu" });
		trigger.focus();
		fireEvent.click(trigger);

		expect(screen.getByRole("button", { name: "Account settings" })).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });

		expect(screen.queryByRole("button", { name: "Account settings" })).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it("returns focus when the close control is used", () => {
		renderHeader();
		const trigger = screen.getByRole("button", { name: "Open profile and settings menu" });
		fireEvent.click(trigger);

		fireEvent.click(screen.getByRole("button", { name: "Close profile menu" }));

		expect(screen.queryByRole("button", { name: "Account settings" })).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});
});

describe("account menu contrast (#345)", () => {
	it("documents every menu item in both themes", () => {
		const labels = ACCOUNT_MENU_CONTRAST.map((pair) => pair.label);

		expect(labels).toEqual(
			expect.arrayContaining([
				"account name",
				"language value",
				"device online status",
				"device offline status",
				"device missing status",
				"admin panel action",
				"account settings action",
				"sign out action",
			]),
		);
	});

	it("meets WCAG AA (4.5:1) for every documented pair in both themes", () => {
		for (const pair of ACCOUNT_MENU_CONTRAST) {
			for (const theme of ["light", "dark"] as const) {
				const { background, foreground } = pair[theme];
				expect(
					contrastRatio(background, foreground),
					`${pair.label} (${theme}): ${foreground} on ${background}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("paints the status and actions with the documented theme classes", () => {
		renderHeader("offline");
		openProfileMenu();

		expect(screen.getByText("ESP32 offline")).toHaveClass("text-[#C42B3A]", "dark:text-red-400");

		const admin = screen.getByRole("button", { name: "Admin Panel" });
		expect(admin).toHaveClass("text-[#C2410C]", "dark:text-[#ff8a5c]");
		expect(admin).not.toHaveClass("text-[#E85A2A]");

		expect(screen.getByRole("button", { name: "Close profile menu" })).toHaveClass(
			"dark:bg-gray-800",
			"dark:text-gray-300",
			"focus-visible:ring-2",
			"dark:focus-visible:ring-[#ff8a5c]",
		);
	});

	it("uses a readable missing-device state", () => {
		renderHeader("missing");
		openProfileMenu();

		expect(screen.getByText("ESP32 not paired")).toHaveClass("text-gray-600", "dark:text-gray-300");
	});
});
