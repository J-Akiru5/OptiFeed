import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/lib/pwa/use-feed-guard", () => ({
	useFeedCommandGuard: () => ({ online: true, reason: undefined, blockIfOffline: () => false }),
}));

const actionMocks = vi.hoisted(() => ({ requestFeed: vi.fn() }));

vi.mock("@/lib/actions/energy", () => ({
	requestFeed: actionMocks.requestFeed,
}));

import { EnergyControllerCard } from "@/components/EnergyControllerCard";
import { createTranslator } from "./helpers/messages";

const tLimit = createTranslator("dashboard.feedNowModal");

const baseProps = {
	deviceId: "device-1",
	label: "Feeder 1",
	mac: "AA:BB:CC:DD:EE:FF",
	rtcOk: true,
	feederActive: false,
	gramsPerFeeding: 1500,
	gramsPerSecond: 4,
	lastSeenAt: new Date(),
	isOffline: false,
	canWrite: true,
};

const limit = {
	effectiveG: 1300.5,
	dailyCapG: 2000,
	usedTodayG: 699.5,
	remainingDailyG: 1300.5,
};

describe("EnergyControllerCard Feed Now input", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("caps the input at the remaining daily grams, not 1,000 g", () => {
		render(<EnergyControllerCard {...baseProps} feedNowLimit={limit} />);

		const input = screen.getByLabelText("Feed Amount (grams)");
		expect(input).toHaveAttribute("max", "1300.5");
		expect(input).toHaveValue(1300.5);
		expect(screen.getByTestId("feed-now-limit-hint")).toHaveTextContent(
			"Enter at most 1300.5 g — today's remaining daily ceiling.",
		);
	});

	it("sends a dose above 1,000 g when the daily ceiling allows it", async () => {
		actionMocks.requestFeed.mockResolvedValue({ success: true });

		render(<EnergyControllerCard {...baseProps} feedNowLimit={limit} />);
		fireEvent.click(screen.getByRole("button", { name: /Feed Now/ }));

		// #749: the first click only opens the confirmation; nothing is sent yet.
		expect(actionMocks.requestFeed).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Send 1300.5g" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 1300.5);
		});
	});

	it("cancels the confirmation on Escape without sending", () => {
		render(<EnergyControllerCard {...baseProps} feedNowLimit={limit} />);

		fireEvent.click(screen.getByRole("button", { name: /Feed Now/ }));
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(actionMocks.requestFeed).not.toHaveBeenCalled();
	});

	it("disables Feed Now and explains why on a fallow pond", () => {
		render(<EnergyControllerCard {...baseProps} feedNowLimit={limit} isFallow />);

		expect(screen.getByRole("button", { name: /Feed Now/ })).toBeDisabled();
		expect(screen.getByText(tLimit("fallowWarning"))).toBeInTheDocument();
	});

	it("blocks a manually typed amount above the remaining daily grams", () => {
		render(<EnergyControllerCard {...baseProps} feedNowLimit={limit} />);

		fireEvent.change(screen.getByLabelText("Feed Amount (grams)"), {
			target: { value: "1400" },
		});

		expect(screen.getByRole("button", { name: /Feed Now/ })).toBeDisabled();
	});
});
