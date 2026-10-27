import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sheet is the part readers actually touch: does the current page open
 * first, are the sections collapsible, and does "Show me" point at a real
 * control (here or on the next page) instead of closing silently?
 */

let currentPath = "/dashboard";
const push = vi.fn();
const startTour = vi.fn();
let hasTour = false;

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	usePathname: () => currentPath,
	useRouter: () => ({ push }),
}));

vi.mock("@/components/onboarding-provider", () => ({
	useOnboarding: () => ({ startTour, hasTour }),
}));

import { HelpSheet } from "@/components/help/help-sheet";
import { HELP_RING_CLASS, clearHelpHighlight } from "@/lib/help/highlight";
import { clearHelpTarget, peekHelpTarget } from "@/lib/help/reveal";

beforeEach(() => {
	currentPath = "/dashboard";
	hasTour = false;
	push.mockClear();
	startTour.mockClear();
});

afterEach(() => {
	// Unmount first: the sheet is a portal on `body`, and clearing `body` while
	// React still owns the portal node makes the unmount fail.
	cleanup();
	clearHelpHighlight();
	clearHelpTarget();
	document.body.innerHTML = "";
	vi.useRealTimers();
});

describe("HelpSheet", () => {
	it("opens the current page's section first and marks it", () => {
		render(<HelpSheet open onOpenChange={() => undefined} audience="farmer" />);

		const dialog = screen.getByRole("dialog");
		const sections = within(dialog).getAllByRole("heading", { level: 3 });
		expect(sections[0]).toHaveTextContent("Dashboard");

		// The first section is expanded: its items are in the panel.
		expect(
			within(dialog).getByText(/Feed Now dispenses the next scheduled dose immediately/),
		).toBeVisible();
		expect(within(dialog).getAllByText("This page").length).toBeGreaterThan(0);
	});

	it("does not show the farmer's dashboard to a superadmin", () => {
		currentPath = "/superadmin/devices";
		render(<HelpSheet open onOpenChange={() => undefined} audience="superadmin" />);

		const dialog = screen.getByRole("dialog");
		expect(within(dialog).queryByText("Feeding schedule")).toBeNull();
		expect(within(dialog).getByText("Device fleet")).toBeVisible();
	});

	it("rings a control on this page, then closes", () => {
		vi.useFakeTimers();
		document.body.innerHTML = '<button data-help="feed-now">Feed Now</button>';
		const onOpenChange = vi.fn();

		render(<HelpSheet open onOpenChange={onOpenChange} audience="farmer" />);
		fireEvent.click(screen.getAllByRole("button", { name: "Show me" })[0] as HTMLElement);

		expect(onOpenChange).toHaveBeenCalledWith(false);
		vi.advanceTimersByTime(500);
		expect(document.querySelector(`.${HELP_RING_CLASS}`)).not.toBeNull();
	});

	it("remembers a control on another page, then navigates", () => {
		render(<HelpSheet open onOpenChange={() => undefined} audience="farmer" />);

		const dialog = screen.getByRole("dialog");
		// Open the settings section and point at the calibration form, which lives
		// on the hardware settings page.
		fireEvent.click(within(dialog).getByRole("button", { name: /Settings/ }));
		const calibration = within(dialog).getByText(/Rate calibration dispenses a measured dose/);
		const item = calibration.closest("li");
		if (!item) throw new Error("no item");
		fireEvent.click(within(item as HTMLElement).getByRole("button", { name: "Show me" }));

		expect(push).toHaveBeenCalledWith("/dashboard/settings/hardware");
		expect(peekHelpTarget("/dashboard/settings/hardware")?.target).toBe("calibration-form");
	});

	it("says so when a control is not on this page", () => {
		render(<HelpSheet open onOpenChange={() => undefined} audience="farmer" />);

		// The dashboard is rendered without any controls in this test DOM.
		fireEvent.click(screen.getAllByRole("button", { name: "Show me" })[0] as HTMLElement);
		expect(screen.getByText(/That control is not on this screen right now/)).toBeVisible();
	});

	it("offers the tour only where a tour exists", () => {
		const { rerender } = render(
			<HelpSheet open onOpenChange={() => undefined} audience="farmer" />,
		);
		expect(screen.queryByRole("button", { name: "Take the tour" })).toBeNull();

		hasTour = true;
		rerender(<HelpSheet open onOpenChange={() => undefined} audience="farmer" />);
		fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
		expect(startTour).toHaveBeenCalledOnce();
	});

	it("keeps a fixed-height panel with a scrollable body (#214)", () => {
		render(<HelpSheet open onOpenChange={() => undefined} audience="farmer" />);

		const dialog = screen.getByRole("dialog");
		// A `dialog` is content-high by default. Without an explicit height and
		// clipped overflow the sheet grows past the viewport, so its body never
		// scrolls and the footer is out of reach.
		expect(dialog.className).toContain("flex-col");
		expect(dialog.className).toContain("overflow-hidden");
		expect(dialog.className).toContain("md:h-dvh");

		const body = document.querySelector("[data-help-sheet-body]");
		expect(body).not.toBeNull();
		expect(body?.className).toContain("flex-1");
		expect(body?.className).toContain("min-h-0");
		expect(body?.className).toContain("overflow-y-auto");
		// A wheel or swipe inside the panel must not scroll the page behind it.
		expect(body?.className).toContain("overscroll-contain");
	});

	it("closes on Escape, the close button and the backdrop", () => {
		const onOpenChange = vi.fn();
		render(<HelpSheet open onOpenChange={onOpenChange} audience="farmer" />);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);

		onOpenChange.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "Close help" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);

		onOpenChange.mockClear();
		const backdrop = document.querySelector('button[aria-hidden="true"]');
		if (!backdrop) throw new Error("no backdrop");
		fireEvent.click(backdrop);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
