import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #316: the header's "Last synced" line used to be English literals
 * ("LAST SYNCED", "5 MINUTES AGO"). It now composes a catalogue sentence with a
 * catalogue relative time, so both follow the active locale.
 */

const i18n = vi.hoisted(() => ({ locale: "en" as "en" | "hil" }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace, i18n.locale),
		useLocale: () => i18n.locale,
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

import { HeaderActions } from "@/components/header-actions";

function minutesAgo(minutes: number): string {
	return new Date(Date.now() - minutes * 60_000).toISOString();
}

function renderHeader(lastSeenAt: string | null) {
	return render(
		<HeaderActions
			ponds={[{ id: "pond-1", name: "ILO-POND-01" }]}
			activePondId="pond-1"
			pondName="ILO-POND-01"
			lastSeenAt={lastSeenAt}
			esp32Status="online"
			initialUser={{
				email: "juan@pond.optifeed.local",
				role: "ADMIN",
				displayName: "Juan Miguel",
				isTenantAdmin: true,
				isPlatformAdmin: false,
			}}
		/>,
	);
}

beforeEach(() => {
	i18n.locale = "en";
});

describe("HeaderActions last synced label (#316)", () => {
	it("renders the English label with an ICU-pluralised relative time", () => {
		renderHeader(minutesAgo(5));

		expect(screen.getByText("Last synced: 5 minutes ago")).toBeInTheDocument();
	});

	it("uses the singular form for a single unit", () => {
		renderHeader(minutesAgo(61));

		expect(screen.getByText("Last synced: 1 hour ago")).toBeInTheDocument();
	});

	it("formats days and the never-synced state through the catalogue", () => {
		const { unmount } = renderHeader(minutesAgo(3 * 24 * 60));
		expect(screen.getByText("Last synced: 3 days ago")).toBeInTheDocument();
		unmount();

		renderHeader(null);
		expect(screen.getByText("Last synced: never")).toBeInTheDocument();
	});

	it("follows the locale instead of English word order", () => {
		i18n.locale = "hil";
		renderHeader(minutesAgo(5));

		expect(screen.getByText("Huli nga na-sync: 5 ka minuto ang nakaligad")).toBeInTheDocument();
		expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument();
	});

	it("translates the device status instead of printing the raw enum", () => {
		renderHeader(minutesAgo(5));
		fireEvent.click(screen.getByRole("button", { name: "Open profile and settings menu" }));

		expect(screen.getByText("ESP32 online")).toBeInTheDocument();
		expect(screen.queryByText("online", { exact: true })).not.toBeInTheDocument();
	});
});
