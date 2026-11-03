import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #747: an episode escalation is an UPDATE on the existing Notification row.
 * The provider must subscribe to both events, re-alert on an unread update, and
 * keep a newer toast alive when an older toast's timer fires.
 */

type RealtimePayload = {
	new: Record<string, unknown>;
	old?: Record<string, unknown>;
};

const { handlers, removeChannel } = vi.hoisted(() => ({
	handlers: [] as Array<{ event: string; callback: (payload: RealtimePayload) => void }>,
	removeChannel: vi.fn(),
}));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/lib/supabase/client", () => {
	const channel = {
		on: (
			_type: string,
			config: { event: string },
			callback: (payload: RealtimePayload) => void,
		) => {
			handlers.push({ event: config.event, callback });
			return channel;
		},
		subscribe: () => channel,
	};

	return {
		createClient: () => ({
			channel: () => channel,
			removeChannel,
		}),
	};
});

import { NotificationProvider, useNotifications } from "@/components/notification-provider";

function UnreadBadge() {
	const { unreadCount } = useNotifications();
	return <span data-testid="badge">{unreadCount}</span>;
}

function renderProvider() {
	render(
		<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
			<UnreadBadge />
		</NotificationProvider>,
	);
}

function emit(event: "INSERT" | "UPDATE", payload: RealtimePayload) {
	const handler = handlers.find((candidate) => candidate.event === event);
	act(() => handler?.callback(payload));
}

beforeEach(() => {
	handlers.length = 0;
	vi.clearAllMocks();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("NotificationProvider realtime", () => {
	it("subscribes to INSERT and UPDATE", () => {
		renderProvider();
		expect(handlers.map((handler) => handler.event)).toEqual(["INSERT", "UPDATE"]);
	});

	it("shows an inserted warning as an alert and increments the badge", () => {
		renderProvider();

		emit("INSERT", {
			new: { id: "n1", tier: "WARNING", message: "Hopper level is low" },
		});

		expect(screen.getByRole("alert")).toHaveTextContent("Hopper level is low");
		expect(screen.getByTestId("badge")).toHaveTextContent("1");
		expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
	});

	it("re-alerts on an unread escalation update", () => {
		renderProvider();

		emit("UPDATE", {
			new: {
				id: "n1",
				tier: "CRITICAL",
				message: "Hopper is nearly empty",
				read: false,
			},
			old: { id: "n1" },
		});

		expect(screen.getByRole("alert")).toHaveTextContent("Hopper is nearly empty");
		expect(screen.getByText("Critical Alert:")).toBeInTheDocument();
	});

	it("ignores an update that only acknowledged or resolved the row", () => {
		renderProvider();

		emit("UPDATE", {
			new: {
				id: "n1",
				tier: "WARNING",
				message: "Hopper level is low",
				read: true,
				acknowledgedAt: "2026-10-18T08:00:00.000Z",
			},
		});
		emit("UPDATE", {
			new: {
				id: "n2",
				tier: "WARNING",
				message: "Recovered",
				read: true,
				autoCleared: true,
				resolvedAt: "2026-10-18T08:05:00.000Z",
			},
		});

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.getByTestId("badge")).toHaveTextContent("0");
	});

	it("does not let an older toast timer dismiss a newer toast", () => {
		renderProvider();

		emit("INSERT", { new: { id: "n1", tier: "INFO", message: "First message" } });
		act(() => vi.advanceTimersByTime(4_000));

		emit("INSERT", { new: { id: "n2", tier: "INFO", message: "Second message" } });
		act(() => vi.advanceTimersByTime(1_000));

		expect(screen.getByText("Second message")).toBeInTheDocument();
		expect(screen.queryByText("First message")).not.toBeInTheDocument();

		act(() => vi.advanceTimersByTime(4_000));
		expect(screen.queryByText("Second message")).not.toBeInTheDocument();
	});

	it("pauses auto-dismiss while the toast is hovered", () => {
		renderProvider();

		emit("INSERT", { new: { id: "n1", tier: "INFO", message: "First message" } });
		const toast = screen.getByRole("status");
		fireEvent.mouseEnter(toast);

		act(() => vi.advanceTimersByTime(10_000));
		expect(screen.getByText("First message")).toBeInTheDocument();

		fireEvent.mouseLeave(toast);
		act(() => vi.advanceTimersByTime(5_000));
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
	});
});
