import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChartRangeProvider } from "@/components/charts/chart-range";
import { Heatmap, type HeatmapProps } from "@/components/charts/heatmap";
import { Timeline, type TimelineProps } from "@/components/charts/timeline";

/**
 * The two non-Recharts chart primitives (#629): a day × hour heatmap and a
 * vertical event timeline. Both share the frame's empty/loading/error states
 * and the page's date range, and both repeat their values in the hidden table.
 */

const labels = {
	period: "When",
	value: "Detail",
	name: "Event",
	empty: "Nothing to show",
};

function dayKey(daysAgo: number): string {
	const date = new Date();
	date.setDate(date.getDate() - daysAgo);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate(),
	).padStart(2, "0")}`;
}

function atDaysAgo(daysAgo: number, hoursAgo = 0): Date {
	const date = new Date();
	date.setDate(date.getDate() - daysAgo);
	date.setHours(date.getHours() - hoursAgo);
	return date;
}

function valuesWith(hour: number, value: number): number[] {
	const values = Array.from({ length: 24 }, () => 0);
	values[hour] = value;
	return values;
}

function heatmap(overrides: Partial<HeatmapProps> = {}) {
	return (
		<Heatmap
			title="Feed activity"
			summary="Feed events by day and hour"
			labels={labels}
			rows={[{ date: dayKey(1), values: valuesWith(9, 5) }]}
			unit="events"
			{...overrides}
		/>
	);
}

function timeline(overrides: Partial<TimelineProps> = {}) {
	return (
		<Timeline
			title="Recent events"
			summary="Incidents and device events, newest first"
			labels={labels}
			events={[
				{
					id: "e1",
					at: atDaysAgo(0, 1),
					title: "Feeder offline",
					detail: "No heartbeat for 12 minutes",
					tone: "warning",
				},
			]}
			{...overrides}
		/>
	);
}

afterEach(cleanup);

describe("Heatmap", () => {
	it("renders the empty state when there are no rows", () => {
		render(heatmap({ rows: [] }));

		expect(screen.getByText("Nothing to show")).toBeTruthy();
		expect(screen.queryByTestId("chart-heatmap-grid")).toBeNull();
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("is empty when every cell is zero, and draws a single non-zero cell", () => {
		const { unmount } = render(
			heatmap({ rows: [{ date: dayKey(1), values: Array.from({ length: 24 }, () => 0) }] }),
		);
		expect(screen.getByText("Nothing to show")).toBeTruthy();
		expect(screen.queryByTestId("chart-heatmap-grid")).toBeNull();
		unmount();

		const day = dayKey(1);
		render(heatmap({ rows: [{ date: day, values: valuesWith(9, 5) }] }));

		const grid = screen.getByTestId("chart-heatmap-grid");
		expect(grid.querySelectorAll("[title]")).toHaveLength(24);
		expect(screen.getByTitle(`${day} 9:00 — 5 events`)).toBeTruthy();
		expect(screen.getByRole("table", { name: "Feed events by day and hour" })).toBeTruthy();
	});

	it("shows the loading skeleton instead of the grid", () => {
		render(heatmap({ isLoading: true, loadingLabel: "Loading heatmap" }));

		expect(screen.getByRole("status", { name: "Loading heatmap" })).toBeTruthy();
		expect(screen.queryByTestId("chart-heatmap-grid")).toBeNull();
	});

	it("shows the error instead of the grid", () => {
		render(heatmap({ error: "Heatmap failed" }));

		expect(screen.getByRole("alert").textContent).toBe("Heatmap failed");
		expect(screen.queryByTestId("chart-heatmap-grid")).toBeNull();
	});

	it("filters rows by the shared range", () => {
		const oldDay = dayKey(30);
		const freshDay = dayKey(0);
		render(
			<ChartRangeProvider initial={{ key: "7d", from: null, to: null }}>
				{heatmap({
					rows: [
						{ date: oldDay, values: valuesWith(8, 3) },
						{ date: freshDay, values: valuesWith(9, 5) },
					],
				})}
			</ChartRangeProvider>,
		);

		expect(screen.queryByTitle(`${oldDay} 8:00 — 3 events`)).toBeNull();
		expect(screen.getByTitle(`${freshDay} 9:00 — 5 events`)).toBeTruthy();

		const table = screen.getByRole("table", { name: "Feed events by day and hour" });
		expect(within(table).queryByText(oldDay)).toBeNull();
		expect(within(table).getByText(freshDay)).toBeTruthy();
	});
});

describe("Timeline", () => {
	it("renders the empty state when there are no events", () => {
		render(timeline({ events: [] }));

		expect(screen.getByText("Nothing to show")).toBeTruthy();
		expect(screen.queryByTestId("chart-timeline")).toBeNull();
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("renders one event with its time, tone label, title and detail", () => {
		const at = atDaysAgo(0, 1);
		render(
			timeline({
				events: [
					{
						id: "e1",
						at,
						title: "Feeder offline",
						detail: "No heartbeat for 12 minutes",
						tone: "warning",
					},
				],
			}),
		);

		const list = screen.getByTestId("chart-timeline");
		const items = within(list).getAllByRole("listitem");
		expect(items).toHaveLength(1);

		expect(within(items[0]).getByText("Warning")).toBeTruthy();
		expect(within(items[0]).getByText("Feeder offline")).toBeTruthy();
		expect(within(items[0]).getByText("No heartbeat for 12 minutes")).toBeTruthy();

		const time = items[0].querySelector("time");
		expect(time?.getAttribute("dateTime")).toBe(at.toISOString());
		expect(
			screen.getByRole("table", { name: "Incidents and device events, newest first" }),
		).toBeTruthy();
	});

	it("shows the loading skeleton instead of the rail", () => {
		render(timeline({ isLoading: true, loadingLabel: "Loading timeline" }));

		expect(screen.getByRole("status", { name: "Loading timeline" })).toBeTruthy();
		expect(screen.queryByTestId("chart-timeline")).toBeNull();
	});

	it("shows the error instead of the rail", () => {
		render(timeline({ error: "Timeline failed" }));

		expect(screen.getByRole("alert").textContent).toBe("Timeline failed");
		expect(screen.queryByTestId("chart-timeline")).toBeNull();
	});

	it("filters by the shared range and orders the survivors newest first", () => {
		render(
			<ChartRangeProvider initial={{ key: "7d", from: null, to: null }}>
				{timeline({
					events: [
						{ id: "old", at: atDaysAgo(30), title: "Old incident", tone: "danger" },
						{ id: "middle", at: atDaysAgo(2), title: "Middle incident", tone: "info" },
						{ id: "new", at: atDaysAgo(0, 1), title: "Newest incident", tone: "success" },
					],
				})}
			</ChartRangeProvider>,
		);

		const list = screen.getByTestId("chart-timeline");
		const items = within(list).getAllByRole("listitem");
		expect(items).toHaveLength(2);
		expect(items[0].textContent).toContain("Newest incident");
		expect(items[1].textContent).toContain("Middle incident");
		expect(screen.queryByText("Old incident")).toBeNull();

		const table = screen.getByRole("table", { name: "Incidents and device events, newest first" });
		expect(within(table).queryByText("Old incident")).toBeNull();
		expect(within(table).getByText("Newest incident")).toBeTruthy();
	});
});
