import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineBanner } from "@/components/pwa/offline-banner";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

function setOnline(value: boolean) {
	Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

function goOffline() {
	setOnline(false);
	fireEvent(window, new Event("offline"));
}

function goOnline() {
	setOnline(true);
	fireEvent(window, new Event("online"));
}

afterEach(() => cleanup());

beforeEach(() => {
	vi.clearAllMocks();
	setOnline(true);
});

describe("offline indicator (#381)", () => {
	it("stays out of the way while online", () => {
		render(<OfflineBanner />);
		expect(screen.queryByTestId("offline-banner")).toBeNull();
	});

	it("shows a dismissible indicator when the connection drops", () => {
		render(<OfflineBanner />);
		goOffline();

		const banner = screen.getByTestId("offline-banner");
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveTextContent("Offline mode");
		expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
	});

	it("hides when dismissed", () => {
		render(<OfflineBanner />);
		goOffline();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

		expect(screen.queryByTestId("offline-banner")).toBeNull();
	});

	it("comes back after reconnecting and dropping again", () => {
		render(<OfflineBanner />);
		goOffline();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByTestId("offline-banner")).toBeNull();

		goOnline();
		goOffline();

		expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
	});

	it("announces the state politely rather than as an alert", () => {
		render(<OfflineBanner />);
		goOffline();
		expect(screen.getByTestId("offline-banner")).toHaveAttribute("aria-live", "polite");
	});
});
