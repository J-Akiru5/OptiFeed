import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #757 — the Feed Now confirmation and the biomass edit overlay were plain
 * fixed divs (no dialog role, no focus trap, no Escape, no focus restore), the
 * notification toast/banner had no live region, their close buttons had no
 * accessible name, and a toast timeout captured in the realtime callback could
 * dismiss a newer message. These tests pin the semantics and the timer rule.
 */

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
	}: { href: string; children?: React.ReactNode } & Record<string, unknown>) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/actions/energy", () => ({ requestFeed: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/actions/biomass", () => ({
	updateBiomassLog: vi.fn(async () => ({ success: true })),
	deleteBiomassLog: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/pwa/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/assistant/mascot", () => ({
	Mascot: () => <span data-testid="mascot" />,
}));

// A Supabase channel that records the realtime handler so a test can deliver
// the payload a hosted INSERT would.
const realtime = vi.hoisted(() => ({
	handlers: [] as Array<(payload: { new: Record<string, unknown> }) => void>,
}));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => {
		const builder = {
			on: (
				_event: string,
				_filter: Record<string, unknown>,
				callback: (payload: { new: Record<string, unknown> }) => void,
			) => {
				realtime.handlers.push(callback);
				return builder;
			},
			subscribe: () => builder,
		};
		return { channel: () => builder, removeChannel: vi.fn() };
	},
}));

import { FeedNowButton } from "@/components/FeedNowButton";
import { BiomassLogActions } from "@/components/growth/BiomassLogActions";
import { NotificationProvider } from "@/components/notification-provider";
import { createTranslator } from "./helpers/messages";

const feedNow = createTranslator("dashboard.feedNowModal");
const logSample = createTranslator("dashboard.logSample");
const notifications = createTranslator("dashboard.notifications");

function emit(notification: Record<string, unknown>) {
	act(() => {
		for (const handler of realtime.handlers) handler({ new: notification });
	});
}

beforeEach(() => {
	realtime.handlers = [];
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("Feed Now confirmation dialog", () => {
	it("is a labelled modal, closes on Escape and restores focus", async () => {
		const user = userEvent.setup();
		render(<FeedNowButton deviceId="dev-1" nextFeedingVolume="29.63g" label="Feed Now" />);

		const trigger = screen.getByRole("button", { name: "Feed Now" });
		await user.click(trigger);

		const dialog = screen.getByRole("dialog", { name: feedNow("triggerTitle") });
		expect(dialog).toHaveAttribute("aria-modal", "true");

		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});
});

describe("Biomass edit dialog", () => {
	it("is a labelled modal, closes on Escape and restores focus", async () => {
		const user = userEvent.setup();
		render(
			<BiomassLogActions
				canWrite
				log={{
					id: "log-1",
					recordedAt: "2026-11-01",
					sampleCount: 30,
					sampleWeightKg: 1.25,
					sampleLengthCm: 12.4,
					batchLabel: "Batch A",
				}}
			/>,
		);

		const edit = screen.getByRole("button", { name: logSample("editLog") });
		await user.click(edit);

		const dialog = screen.getByRole("dialog", { name: logSample("editLogTitle") });
		expect(dialog).toHaveAttribute("aria-modal", "true");

		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(edit).toHaveFocus();
	});
});

describe("notification live regions", () => {
	it("announces a critical alert assertively and names its dismiss control", () => {
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		emit({ id: "n1", tier: "CRITICAL", message: "Pond is offline", category: "connectivity" });

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Pond is offline");

		fireEvent.click(screen.getByRole("button", { name: notifications("dismissNotification") }));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("announces a toast politely and lets a newer message outlive the older timer", () => {
		vi.useFakeTimers();
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		emit({ id: "n1", tier: "INFO", message: "First message" });
		expect(screen.getByRole("status")).toHaveTextContent("First message");

		// 4.9 s later a second toast replaces the first. The first timeout would
		// have fired at 5 s and wrongly dismissed the second message.
		act(() => vi.advanceTimersByTime(4900));
		emit({ id: "n2", tier: "INFO", message: "Second message" });
		act(() => vi.advanceTimersByTime(200));
		expect(screen.getByRole("status")).toHaveTextContent("Second message");

		act(() => vi.advanceTimersByTime(4800));
		expect(screen.getByRole("status")).toBeEmptyDOMElement();
	});

	it("pauses auto-dismiss while the toast is hovered", () => {
		vi.useFakeTimers();
		render(
			<NotificationProvider pondId="pond-1" initialUnreadCount={0}>
				<div />
			</NotificationProvider>,
		);

		emit({ id: "n1", tier: "SUCCESS", message: "Saved" });
		const toast = screen.getByTestId("notification-toast");
		fireEvent.mouseEnter(toast);

		act(() => vi.advanceTimersByTime(5000));
		expect(screen.getByTestId("notification-toast")).toBeInTheDocument();

		fireEvent.mouseLeave(toast);
		act(() => vi.advanceTimersByTime(5000));
		expect(screen.getByRole("status")).toBeEmptyDOMElement();
	});
});
