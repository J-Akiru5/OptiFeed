import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/en/superadmin",
}));

import { ChartRangeControl } from "@/components/charts/chart-range";
import { CommandCenterRangeFrame } from "@/components/superadmin/monitor/sections/command-center-range";

/**
 * The command center's range control drives the *query*, not only the plot
 * (#707). A preset is written to `?range=`, so the server re-runs the read
 * models; a custom window has no server spelling and is narrowed locally inside
 * the widest window.
 */

const LABELS = {
	label: "Reporting period",
	sevenDays: "7 days",
	thirtyDays: "30 days",
	ninetyDays: "90 days",
	custom: "Custom",
	from: "From",
	to: "To",
};

function frame(initialKey: "7d" | "30d" | "90d") {
	return render(
		<CommandCenterRangeFrame initialKey={initialKey}>
			<ChartRangeControl labels={LABELS} />
		</CommandCenterRangeFrame>,
	);
}

beforeEach(() => {
	replaceMock.mockClear();
});

afterEach(cleanup);

describe("command center range frame", () => {
	it("re-queries the page when a preset is chosen", async () => {
		const user = userEvent.setup();
		frame("30d");

		expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");

		await user.click(screen.getByRole("button", { name: "7 days" }));

		expect(replaceMock).toHaveBeenCalledWith("/en/superadmin?range=7", { scroll: false });
		expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("does not navigate when the current preset is chosen again", async () => {
		const user = userEvent.setup();
		frame("90d");

		await user.click(screen.getByRole("button", { name: "90 days" }));

		expect(replaceMock).not.toHaveBeenCalled();
	});

	it("keeps a custom window local, loading the widest window once", async () => {
		const user = userEvent.setup();
		frame("7d");

		await user.click(screen.getByRole("button", { name: "Custom" }));

		// Custom has no `?range=` spelling: the page loads 90 days and the charts
		// narrow that window in the browser.
		expect(replaceMock).toHaveBeenCalledWith("/en/superadmin?range=90", { scroll: false });
		expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByLabelText("From")).toBeInTheDocument();
		expect(screen.getByLabelText("To")).toBeInTheDocument();
	});

	it("leaves custom mode when a preset is chosen again", async () => {
		const user = userEvent.setup();
		frame("7d");

		await user.click(screen.getByRole("button", { name: "Custom" }));
		expect(screen.getByLabelText("From")).toBeInTheDocument();
		replaceMock.mockClear();

		await user.click(screen.getByRole("button", { name: "30 days" }));

		expect(replaceMock).toHaveBeenCalledWith("/en/superadmin?range=30", { scroll: false });
		expect(screen.queryByLabelText("From")).toBeNull();
	});
});
