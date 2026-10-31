import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #221: Pakoy fronts feeding, low-hopper and offline alerts, and his low-hopper
 * reminder is dismissible per pond and day.
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
import { PakoyLowHopper } from "@/components/assistant/pakoy-low-hopper";
import { NotificationProvider } from "@/components/notification-provider";
import { hopperIsLow } from "@/lib/settings/org-alerts";

afterEach(cleanup);

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

function notification(id: string, tier: string, category: string | null, message: string) {
	return {
		id,
		tier,
		message,
		category,
		read: false,
		autoCleared: false,
		acknowledgedAt: null,
		createdAt: "2026-10-28T02:00:00.000Z",
	};
}

function renderList(items: ReturnType<typeof notification>[]) {
	return render(
		<NotificationProvider pondId="pond-1" initialUnreadCount={items.length}>
			<NotificationList initialNotifications={items} pondId="pond-1" />
		</NotificationProvider>,
	);
}

describe("Pakoy on alerts", () => {
	it("marks feeding, hopper and offline alerts with his head", () => {
		const { container } = renderList([
			notification("n1", "WARNING", "hopper_low", "Feed hopper is running low"),
			notification("n2", "CRITICAL", "connectivity", "Feeder offline"),
			notification("n3", "SUCCESS", "feeding", "Feeding dispensed"),
			notification("n4", "INFO", "system", "Firmware updated"),
		]);

		// Three alert rows across the list and card views, the system row keeps
		// its severity glyph.
		expect(container.querySelectorAll('[data-pose="head"]')).toHaveLength(6);
	});

	it("labels the hopper category instead of showing its raw key", () => {
		renderList([notification("n1", "WARNING", "hopper_low", "Feed hopper is running low")]);
		expect(screen.getAllByText("Low hopper").length).toBeGreaterThan(0);
		expect(screen.queryByText("hopper_low")).toBeNull();
	});
});

describe("Pakoy's low-hopper reminder", () => {
	it("shows once per pond and day, and remembers the dismissal", () => {
		const { unmount } = render(<PakoyLowHopper pondId="pond-1" levelPercent={12} low />);

		expect(screen.getByTestId("pakoy-low-hopper")).toBeVisible();
		expect(screen.getByText("Feed level is low (12%).")).toBeVisible();

		fireEvent.click(screen.getByRole("button", { name: "Got it" }));
		expect(screen.queryByTestId("pakoy-low-hopper")).toBeNull();

		unmount();
		render(<PakoyLowHopper pondId="pond-1" levelPercent={11} low />);
		expect(screen.queryByTestId("pakoy-low-hopper")).toBeNull();
	});

	it("stays out of the way when the hopper is fine", () => {
		render(<PakoyLowHopper pondId="pond-1" levelPercent={80} low={false} />);
		expect(screen.queryByTestId("pakoy-low-hopper")).toBeNull();
	});

	it("follows the shared inclusive threshold at the boundary (#412)", () => {
		// The page decides `low` with `hopperIsLow`, the same helper the rail
		// uses, so Pakoy appears at exactly the threshold and not one point above.
		for (const level of [19, 20]) {
			const { unmount } = render(
				<PakoyLowHopper
					pondId={`pond-${level}`}
					levelPercent={level}
					low={hopperIsLow(level, 20)}
				/>,
			);
			expect(screen.getByTestId("pakoy-low-hopper")).toBeVisible();
			unmount();
		}

		const { unmount } = render(
			<PakoyLowHopper pondId="pond-21" levelPercent={21} low={hopperIsLow(21, 20)} />,
		);
		expect(screen.queryByTestId("pakoy-low-hopper")).toBeNull();
		unmount();
	});
});
