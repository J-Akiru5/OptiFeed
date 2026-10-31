import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #219: the bell and the list must react to "Mark as Read" and to a single
 * "Acknowledge" without a manual reload, and must roll back when the server
 * refuses. These tests render the real provider + bell-count consumer + list and
 * stub only the server actions.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

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
	useRouter: () => ({ refresh }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({
		channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
		removeChannel: () => undefined,
	}),
}));

vi.mock("@/lib/actions/notifications", () => ({
	acknowledgeNotification: vi.fn(),
	markAllNotificationsRead: vi.fn(),
}));

import { NotificationList } from "@/components/NotificationList";
import { NotificationProvider, useNotifications } from "@/components/notification-provider";
import { acknowledgeNotification, markAllNotificationsRead } from "@/lib/actions/notifications";
import { toast } from "sonner";

const mockAcknowledge = vi.mocked(acknowledgeNotification);
const mockMarkAll = vi.mocked(markAllNotificationsRead);
const mockToastError = vi.mocked(toast.error);

const NOTIFICATIONS = [
	{
		id: "n1",
		tier: "SUCCESS",
		message: "Dashboard feed completed — 316.51g dispensed by CICT Building A Feeder",
		category: "feeding",
		read: false,
		autoCleared: false,
		acknowledgedAt: null,
		createdAt: "2026-10-27T07:58:00.000Z",
	},
	{
		id: "n2",
		tier: "WARNING",
		message: "Hopper level is low",
		category: "feeding",
		read: false,
		autoCleared: false,
		acknowledgedAt: null,
		createdAt: "2026-10-27T07:50:00.000Z",
	},
	{
		id: "n3",
		tier: "INFO",
		message: "Old alert",
		category: "system",
		read: true,
		autoCleared: false,
		acknowledgedAt: "2026-10-27T06:00:00.000Z",
		createdAt: "2026-10-27T05:00:00.000Z",
	},
];

function UnreadBadge() {
	const { unreadCount } = useNotifications();
	return <span data-testid="badge">{unreadCount}</span>;
}

function renderNotifications() {
	return render(
		<NotificationProvider pondId="pond-1" initialUnreadCount={8}>
			<UnreadBadge />
			<NotificationList initialNotifications={NOTIFICATIONS} pondId="pond-1" />
		</NotificationProvider>,
	);
}

function tableAcknowledgeButtons() {
	return within(screen.getByRole("table")).queryAllByRole("button", { name: /Acknowledge/ });
}

function markAllButton() {
	return screen.getByRole("button", { name: "Mark as Read" });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAcknowledge.mockResolvedValue({ success: true, count: 1 });
	mockMarkAll.mockResolvedValue({ success: true, count: 2 });
});

describe("NotificationList read state", () => {
	it("clears the badge and every pending row after Mark as Read", async () => {
		renderNotifications();

		expect(screen.getByTestId("badge")).toHaveTextContent("8");
		// Two unread rows, each rendered in the table and the card view.
		expect(screen.getAllByRole("button", { name: /Acknowledge/ })).toHaveLength(4);

		fireEvent.click(markAllButton());

		await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("0"));
		expect(screen.queryAllByRole("button", { name: /Acknowledge/ })).toHaveLength(0);
		expect(mockMarkAll).toHaveBeenCalledTimes(1);
		// The server's acknowledged stamps are pulled back in.
		expect(refresh).toHaveBeenCalled();
	});

	it("rolls the badge and the rows back when Mark as Read fails", async () => {
		mockMarkAll.mockResolvedValue({ success: false, error: "Database unavailable" });
		renderNotifications();

		fireEvent.click(markAllButton());

		await waitFor(() => expect(mockToastError).toHaveBeenCalled());
		expect(screen.getByTestId("badge")).toHaveTextContent("8");
		expect(screen.getAllByRole("button", { name: /Acknowledge/ })).toHaveLength(4);
		expect(refresh).not.toHaveBeenCalled();
	});

	// #416: the action belongs above the feed so the reader does not scroll past
	// every notification to reach it, and it must still mark everything read.
	it("renders Mark as Read once, above the feed, and still marks everything read", async () => {
		renderNotifications();

		const markAll = markAllButton();
		expect(screen.getAllByRole("button", { name: "Mark as Read" })).toHaveLength(1);

		const feeds = [screen.getByRole("table"), screen.getByRole("list", { name: "Notifications" })];
		for (const feed of feeds) {
			// The button precedes the feed in document order and lives outside it.
			const position = markAll.compareDocumentPosition(feed);
			expect(position & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
			expect(feed.contains(markAll)).toBe(false);
		}

		fireEvent.click(markAll);

		await waitFor(() => expect(mockMarkAll).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("0"));
	});

	it("marks one row and drops the badge by one on Acknowledge", async () => {
		renderNotifications();

		fireEvent.click(tableAcknowledgeButtons()[0] as HTMLElement);

		await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("7"));
		expect(tableAcknowledgeButtons()).toHaveLength(1);
		expect(mockAcknowledge).toHaveBeenCalledWith("n1");
		// The other unread row keeps its actions in both views.
		expect(screen.getAllByRole("button", { name: /Acknowledge/ })).toHaveLength(2);
	});

	it("restores the row and the badge when Acknowledge fails", async () => {
		mockAcknowledge.mockResolvedValue({ success: false, error: "Read-only session" });
		renderNotifications();

		fireEvent.click(tableAcknowledgeButtons()[0] as HTMLElement);

		await waitFor(() => expect(mockToastError).toHaveBeenCalled());
		expect(screen.getByTestId("badge")).toHaveTextContent("8");
		expect(tableAcknowledgeButtons()).toHaveLength(2);
	});

	it("does not drop the badge for a row that was already read", async () => {
		// Only n1 is pending and read; n2 arrives read but unacknowledged.
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={1}>
				<UnreadBadge />
				<NotificationList
					initialNotifications={[{ ...NOTIFICATIONS[0], read: true }, NOTIFICATIONS[1]]}
					pondId="pond-1"
				/>
			</NotificationProvider>,
		);

		fireEvent.click(tableAcknowledgeButtons()[0] as HTMLElement);

		await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith("n1"));
		// n1 was read already, so the badge stays at 1 (n2 is still unread).
		expect(screen.getByTestId("badge")).toHaveTextContent("1");
	});
});
