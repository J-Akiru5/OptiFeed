import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #747 — the provider subscribed only to INSERT. Episode escalation updates the
 * existing row, so an acknowledged WARNING that became CRITICAL produced no
 * banner or toast. These tests deliver the UPDATE payloads Supabase would send
 * and pin both the escalation and the acknowledgement/resolution silence.
 */

vi.mock("@/components/assistant/mascot", () => ({
	Mascot: () => <span data-testid="mascot" />,
}));

const realtime = vi.hoisted(() => ({
	handlers: [] as Array<{
		event: string;
		callback: (payload: { new: Record<string, unknown> }) => void;
	}>,
}));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => {
		const builder = {
			on: (
				_event: string,
				filter: { event: string },
				callback: (payload: { new: Record<string, unknown> }) => void,
			) => {
				realtime.handlers.push({ event: filter.event, callback });
				return builder;
			},
			subscribe: () => builder,
		};
		return { channel: () => builder, removeChannel: vi.fn() };
	},
}));

import { NotificationProvider } from "@/components/notification-provider";

function emit(event: "INSERT" | "UPDATE", notification: Record<string, unknown>) {
	act(() => {
		for (const handler of realtime.handlers) {
			if (handler.event === event) handler.callback({ new: notification });
		}
	});
}

const warning = {
	id: "n1",
	tier: "WARNING",
	message: "Feed hopper is running low",
	category: "pellet",
	acknowledgedAt: null,
	resolvedAt: null,
	autoCleared: false,
};

beforeEach(() => {
	realtime.handlers = [];
});

afterEach(() => {
	cleanup();
	vi.clearAllTimers();
});

describe("notification realtime escalation (#747)", () => {
	it("subscribes to both INSERT and UPDATE", () => {
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		expect(realtime.handlers.map((handler) => handler.event).sort()).toEqual(["INSERT", "UPDATE"]);
	});

	it("shows a toast for a new warning", () => {
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		emit("INSERT", warning);
		expect(screen.getByText("Feed hopper is running low")).toBeInTheDocument();
	});

	it("shows a critical banner when the open episode escalates", () => {
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		emit("INSERT", warning);
		emit("UPDATE", {
			...warning,
			tier: "CRITICAL",
			message: "Feed hopper is nearly empty",
		});

		expect(screen.getByText("Feed hopper is nearly empty")).toBeInTheDocument();
	});

	it("stays silent when a row is only acknowledged or resolved", () => {
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		emit("INSERT", warning);
		// The banner/toast is dismissed by the reader, then the row is written.
		act(() => {
			for (const button of screen.queryAllByRole("button")) button.click();
		});

		emit("UPDATE", { ...warning, acknowledgedAt: "2026-11-04T10:00:00.000Z" });
		emit("UPDATE", { ...warning, autoCleared: true, resolvedAt: "2026-11-04T10:01:00.000Z" });

		expect(screen.queryByText("Feed hopper is running low")).not.toBeInTheDocument();
	});
});
