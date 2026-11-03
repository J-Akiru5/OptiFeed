import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #746 — every producer stores a `linkTo`, but the list only offered the generic
 * Audit link; harvest/sampling/event/security categories rendered as raw keys
 * and could not be filtered; and the `!` split printed messages twice.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string | { pathname?: string };
		children?: React.ReactNode;
	} & Record<string, unknown>) => (
		<a href={typeof href === "string" ? href : (href?.pathname ?? "#")} {...rest}>
			{children}
		</a>
	),
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/actions/notifications", () => ({
	acknowledgeNotification: vi.fn(),
	markAllNotificationsRead: vi.fn(),
}));
vi.mock("@/components/assistant/mascot", () => ({ Mascot: () => <span /> }));

import { NotificationList } from "@/components/NotificationList";

const NOTIFICATIONS = [
	{
		id: "n1",
		tier: "INFO",
		message: "Harvest is due in 3 days",
		category: "harvest",
		linkTo: "/dashboard/calendar",
		read: false,
		autoCleared: false,
		acknowledgedAt: null,
		createdAt: "2026-11-04T08:00:00.000Z",
	},
	{
		id: "n2",
		tier: "WARNING",
		message: "Suspicious sign-in blocked",
		category: "security",
		// Producers store data, not code: this must never become a link.
		linkTo: "javascript:alert(1)",
		read: false,
		autoCleared: false,
		acknowledgedAt: null,
		createdAt: "2026-11-04T07:00:00.000Z",
	},
	{
		id: "n3",
		tier: "INFO",
		message: "Sampling is due tomorrow",
		category: "sampling",
		linkTo: null,
		read: false,
		autoCleared: false,
		acknowledgedAt: null,
		createdAt: "2026-11-04T06:00:00.000Z",
	},
];

afterEach(cleanup);

function renderList() {
	return render(<NotificationList initialNotifications={NOTIFICATIONS} pondId="pond-1" />);
}

describe("notification inbox destinations and categories (#746)", () => {
	it("renders the producer's destination with the locale-aware link", () => {
		renderList();

		const openLinks = screen.getAllByRole("link", { name: "Open" });
		// One in the table view and one in the card view.
		expect(openLinks).toHaveLength(2);
		for (const link of openLinks) {
			expect(link).toHaveAttribute("href", "/dashboard/calendar");
		}
	});

	it("does not turn an unsafe stored destination into a link", () => {
		renderList();

		// Only n1 has a safe destination; n2's javascript: value is ignored and it
		// still has the Audit fallback.
		expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(2);
		expect(screen.getAllByRole("link", { name: "Audit" })).toHaveLength(6);
	});

	it("labels the harvest, sampling and security categories", () => {
		renderList();

		expect(screen.getAllByText("Harvest").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Sampling").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Security").length).toBeGreaterThan(0);
		expect(screen.queryByText("categoryHarvest")).not.toBeInTheDocument();
	});

	it("prints each message once per view instead of a split headline plus body", () => {
		renderList();

		// Table + card view: two occurrences total, not four.
		expect(screen.getAllByText("Harvest is due in 3 days")).toHaveLength(2);
		expect(screen.getAllByText("Sampling is due tomorrow")).toHaveLength(2);
	});
});
