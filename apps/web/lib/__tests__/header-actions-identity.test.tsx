import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});
vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children?: unknown }) => children,
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
	email: "juan@pond.optifeed.local",
	role: "ADMIN",
	displayName: "Juan Miguel",
	isTenantAdmin: true,
	isPlatformAdmin: false,
};

const PLATFORM_ADMIN: HeaderActionsUser = {
	email: "superadmin@pond.optifeed.local",
	role: "ADMIN",
	displayName: "superadmin",
	isTenantAdmin: false,
	isPlatformAdmin: true,
};

function renderHeader(initialUser: HeaderActionsUser, options: { isViewingAs?: boolean } = {}) {
	return render(
		<HeaderActions
			ponds={[{ id: "pond-1", name: "ILO-POND-01" }]}
			activePondId="pond-1"
			pondName="ILO-POND-01"
			lastSeenAt={new Date().toISOString()}
			esp32Status="online"
			isViewingAs={options.isViewingAs}
			initialUser={initialUser}
		/>,
	);
}

function openProfileMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Open profile and settings menu" }));
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("HeaderActions identity (E18, #199)", () => {
	it("shows a farmer their pond name, last synced time and operator label", () => {
		const { container } = renderHeader(FARMER);
		const html = container.innerHTML;

		expect(html).toContain("ILO-POND-01");
		expect(html).toContain("Last synced");

		openProfileMenu();
		expect(screen.getByText("Pond Operator")).toBeInTheDocument();
		expect(screen.queryByText("Platform admin")).not.toBeInTheDocument();
	});

	it("labels a platform admin 'Platform admin' and hides the farmer pond chrome", () => {
		const { container } = renderHeader(PLATFORM_ADMIN);
		const html = container.innerHTML;

		expect(html).not.toContain("Last synced");
		expect(html).not.toContain("ILO-POND-01");

		openProfileMenu();
		expect(screen.getByText("Platform admin")).toBeInTheDocument();
		expect(screen.queryByText("Pond Operator")).not.toBeInTheDocument();
		expect(screen.queryByText("ILO-POND-01")).not.toBeInTheDocument();
	});

	it("leaves the tenant header untouched during a read-only view-as session", () => {
		const { container } = renderHeader(PLATFORM_ADMIN, { isViewingAs: true });
		const html = container.innerHTML;

		expect(html).toContain("ILO-POND-01");
		expect(html).toContain("Last synced");

		openProfileMenu();
		expect(screen.getByText("Pond Operator")).toBeInTheDocument();
	});

	it("shows the no-pond empty state instead of a hard-coded pond name", () => {
		const { container } = render(
			<HeaderActions
				ponds={[]}
				activePondId=""
				pondName=""
				lastSeenAt={null}
				esp32Status="missing"
				initialUser={FARMER}
			/>,
		);

		expect(screen.getByText("No pond assigned yet")).toBeInTheDocument();
		expect(container.innerHTML).not.toContain("ILO-POND-01");

		openProfileMenu();
		expect(screen.getAllByText("No pond assigned yet").length).toBeGreaterThan(0);
	});
});
