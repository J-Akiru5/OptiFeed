import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Treemap and radial gauge (#629): the state contract (empty/loading/error),
 * a single reading, the leaf-path table, and the gauge's centre value.
 *
 * Recharts measures its parent with a ResizeObserver. jsdom has none, so the
 * real container is pinned to a fixed size; every other Recharts component is
 * the real one, which keeps the SVG text and layout paths exercised.
 */
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	const React = await import("react");
	return {
		...actual,
		ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
			React.createElement(actual.ResponsiveContainer, { width: 480, height: 240, children }),
	};
});

import { SERIES_COLORS } from "@/components/charts/chart-theme";
import { RadialGauge } from "@/components/charts/radial-gauge";
import { Treemap } from "@/components/charts/treemap";

const LABELS = { period: "Period", value: "Value", name: "Name", empty: "Nothing to plot" };
const TREE_SUMMARY = "Organizations by pond";
const GAUGE_SUMMARY = "Fleet online share";

afterEach(cleanup);

function hiddenTable(summary: string): HTMLElement {
	return screen.getByRole("table", { name: summary });
}

describe("Treemap", () => {
	it("shows the empty state without nodes", () => {
		render(<Treemap title="Organizations" summary={TREE_SUMMARY} labels={LABELS} nodes={[]} />);

		expect(screen.getByText(LABELS.empty)).toBeVisible();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});

	it("shows the empty state when every value is zero", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[
					{
						name: "Org A",
						value: 0,
						children: [{ name: "Pond 1", value: 0 }],
					},
				]}
			/>,
		);

		expect(screen.getByText(LABELS.empty)).toBeVisible();
	});

	it("renders one node and one hidden-table row", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[{ name: "Pond A", value: 120 }]}
				unit="devices"
			/>,
		);

		const plot = screen.getByRole("img", { name: TREE_SUMMARY });
		expect(plot.querySelector("svg")).not.toBeNull();
		expect(within(plot).getByText("Pond A")).toBeInTheDocument();
		expect(within(plot).getByText("120 devices")).toBeInTheDocument();
		const table = hiddenTable(TREE_SUMMARY);
		expect(within(table).getAllByRole("row")).toHaveLength(2);
		expect(within(table).getByRole("rowheader", { name: "Pond A" })).toBeInTheDocument();
		expect(within(table).getByRole("cell", { name: "120" })).toBeInTheDocument();
	});

	it("renders one row per leaf with the full name path", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[
					{
						name: "Org A",
						value: 200,
						children: [
							{ name: "Pond 1", value: 120 },
							{ name: "Pond 2", value: 80 },
						],
					},
				]}
			/>,
		);

		const table = hiddenTable(TREE_SUMMARY);
		expect(within(table).getAllByRole("row")).toHaveLength(3);
		expect(within(table).getByRole("rowheader", { name: "Org A / Pond 1" })).toBeInTheDocument();
		expect(within(table).getByRole("rowheader", { name: "Org A / Pond 2" })).toBeInTheDocument();
		expect(within(table).getByRole("cell", { name: "120" })).toBeInTheDocument();
		expect(within(table).getByRole("cell", { name: "80" })).toBeInTheDocument();
	});

	it("gives each organization its own auto-assigned fill (#835)", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[
					{ name: "Org A", value: 1, children: [{ name: "Pond 1", value: 1 }] },
					{ name: "Org B", value: 1, children: [{ name: "Pond 2", value: 1 }] },
				]}
			/>,
		);

		const plot = screen.getByRole("img", { name: TREE_SUMMARY });
		const fills = [...plot.querySelectorAll("rect[fill]")].map((rect) => rect.getAttribute("fill"));

		expect(fills).toContain(SERIES_COLORS[0]);
		expect(fills).toContain(SERIES_COLORS[1]);
		// The parent tile and its leaf share the organization's colour, so the
		// proof is that both palette slots are present, not how many rects use them.
		expect(new Set(fills).size).toBeGreaterThanOrEqual(2);
	});

	it("honours an explicit colour and lets its children inherit it (#835)", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[
					{
						name: "Org A",
						value: 2,
						color: "#123456",
						children: [
							{ name: "Pond 1", value: 1 },
							{ name: "Pond 2", value: 1 },
						],
					},
				]}
			/>,
		);

		const plot = screen.getByRole("img", { name: TREE_SUMMARY });
		const fills = [...plot.querySelectorAll("rect[fill]")].map((rect) => rect.getAttribute("fill"));

		expect(fills.length).toBeGreaterThan(0);
		expect(fills.every((fill) => fill === "#123456")).toBe(true);
	});

	it("shows the loading skeleton", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[]}
				isLoading
				loadingLabel="Loading organizations"
			/>,
		);

		expect(screen.getByRole("status", { name: "Loading organizations" })).toBeInTheDocument();
		expect(screen.queryByText(LABELS.empty)).not.toBeInTheDocument();
	});

	it("shows the error state", () => {
		render(
			<Treemap
				title="Organizations"
				summary={TREE_SUMMARY}
				labels={LABELS}
				nodes={[]}
				error="Could not load organizations"
			/>,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("Could not load organizations");
	});
});

describe("RadialGauge", () => {
	it("shows the empty state when max is zero", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={50}
				max={0}
				label="Fleet online"
			/>,
		);

		expect(screen.getByText(LABELS.empty)).toBeVisible();
	});

	it("shows the empty state for a non-finite value", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={Number.NaN}
				max={100}
				label="Fleet online"
			/>,
		);

		expect(screen.getByText(LABELS.empty)).toBeVisible();
	});

	it("renders a single percentage reading in the centre and the table", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={82}
				max={100}
				unit="%"
				label="Fleet online"
				tone="success"
			/>,
		);

		const plot = screen.getByRole("img", { name: GAUGE_SUMMARY });
		expect(plot.querySelector("svg")).not.toBeNull();
		expect(plot.querySelectorAll("path").length).toBeGreaterThan(0);
		expect(within(plot).getByText("82%")).toBeInTheDocument();

		const table = hiddenTable(GAUGE_SUMMARY);
		expect(within(table).getAllByRole("row")).toHaveLength(2);
		expect(within(table).getByRole("rowheader", { name: "Fleet online" })).toBeInTheDocument();
		expect(within(table).getByRole("cell", { name: "82%" })).toBeInTheDocument();
	});

	it("renders the value with a unit when one is supplied", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={37}
				max={50}
				unit="devices"
				label="Devices online"
			/>,
		);

		const plot = screen.getByRole("img", { name: GAUGE_SUMMARY });
		expect(within(plot).getByText("37 devices")).toBeInTheDocument();
		expect(
			within(hiddenTable(GAUGE_SUMMARY)).getByRole("cell", { name: "37 devices" }),
		).toBeInTheDocument();
	});

	it("clamps a value above max", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={140}
				max={100}
				label="Fleet online"
			/>,
		);

		const plot = screen.getByRole("img", { name: GAUGE_SUMMARY });
		expect(within(plot).getByText("100%")).toBeInTheDocument();
		expect(
			within(hiddenTable(GAUGE_SUMMARY)).getByRole("cell", { name: "100%" }),
		).toBeInTheDocument();
	});

	it("shows the loading skeleton", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={82}
				max={100}
				label="Fleet online"
				isLoading
				loadingLabel="Loading fleet health"
			/>,
		);

		expect(screen.getByRole("status", { name: "Loading fleet health" })).toBeInTheDocument();
	});

	it("shows the error state", () => {
		render(
			<RadialGauge
				title="Fleet health"
				summary={GAUGE_SUMMARY}
				labels={LABELS}
				value={82}
				max={100}
				label="Fleet online"
				error="Could not load fleet health"
			/>,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("Could not load fleet health");
	});
});
