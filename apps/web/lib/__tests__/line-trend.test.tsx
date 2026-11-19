import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The shared line chart must accept a gap-aware series (issue #947/hopper
 * history): a day without a sensor reading is a blank in the accessible table,
 * not a zero, and `markLatest` labels the newest real observation.
 */

vi.mock("recharts", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		React.createElement(React.Fragment, null, children);
	return {
		ResponsiveContainer: passthrough,
		LineChart: passthrough,
		CartesianGrid: () => null,
		Line: () => null,
		Tooltip: () => null,
		XAxis: () => null,
		YAxis: () => null,
		ReferenceDot: ({
			label,
		}: {
			label?: { value?: string };
		}) => React.createElement("span", { "data-testid": "latest-dot" }, label?.value),
	};
});

import { LineTrend } from "@/components/charts/line-trend";

const LABELS = { period: "Date", value: "Level", name: "Series", empty: "Nothing to plot" };

describe("LineTrend", () => {
	it("renders a gap as a blank table cell and marks the newest reading", () => {
		const html = renderToStaticMarkup(
			<LineTrend
				title="Hopper level"
				summary="Hopper level history"
				labels={LABELS}
				points={[
					{ label: "2026-11-11", value: 38.4 },
					{ label: "2026-11-12", value: null },
					{ label: "2026-11-19", value: 47.9 },
				]}
				unit="%"
				decimals={1}
				markLatest
			/>,
		);

		expect(html).toContain("<td>—</td>");
		expect(html).toContain("47.9 %");
	});

	it("shows the empty label when every bucket is a gap", () => {
		const html = renderToStaticMarkup(
			<LineTrend
				title="Hopper level"
				summary="Hopper level history"
				labels={LABELS}
				points={[
					{ label: "2026-11-18", value: null },
					{ label: "2026-11-19", value: null },
				]}
			/>,
		);

		expect(html).toContain(LABELS.empty);
	});
});
