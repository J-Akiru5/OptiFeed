import { ConnectivityPanel } from "@/components/superadmin/connectivity-panel";
import type { PlatformConnectivity } from "@/lib/platform/connectivity-rules";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "./helpers/messages";

/**
 * Connectivity panel (#479, M3C.10).
 *
 * The page test covers the placement; this covers the three states the O24 rule
 * creates: nothing stored, stored days without a measured span, and stored days
 * with bars. A missing day must never appear as a zero.
 */

const t = createTranslator("superadmin.connectivity");

const WINDOW_DAYS = Array.from({ length: 90 }, (_, index) =>
	new Date(Date.UTC(2026, 7, 4 + index)).toISOString().slice(0, 10),
);

function snapshot(overrides: Partial<PlatformConnectivity> = {}): PlatformConnectivity {
	return {
		registered: 12,
		active30d: 9,
		activePct: 75,
		activeWindowDays: 30,
		activeCutoff: new Date("2026-09-27T12:00:00.000Z"),
		windowDays: WINDOW_DAYS,
		trend: [],
		daysWithoutData: 90,
		...overrides,
	};
}

function render(data: PlatformConnectivity): string {
	return renderToStaticMarkup(<ConnectivityPanel data={data} t={t} locale="en" />);
}

describe("ConnectivityPanel", () => {
	it("renders no bars and an explicit empty state when nothing is stored", () => {
		const html = render(snapshot());

		expect(html).toContain("Registered versus active devices");
		expect(html).toContain("Registered devices");
		expect(html).toContain("Active (30 days)");
		expect(html).toContain("9 of 12 registered devices");
		expect(html).toContain("No stored connectivity history yet.");
		expect(html).not.toContain("<rect");
	});

	it("says a stored day has no measured span instead of showing 0 %", () => {
		const html = render(
			snapshot({
				trend: [
					{
						day: "2026-11-01",
						devicesReporting: 2,
						onlineMinutes: 0,
						observedMinutes: 0,
						gapCount: 0,
						heartbeatCount: 2,
						onlineSharePct: null,
					},
				],
				daysWithoutData: 89,
			}),
		);

		expect(html).toContain("Stored days exist but none has a measured span yet.");
		expect(html).not.toContain("<rect");
		expect(html).toContain("Not measured");
	});

	it("draws one bar per stored day and repeats the values in a hidden table", () => {
		const html = render(
			snapshot({
				trend: [
					{
						day: "2026-10-30",
						devicesReporting: 5,
						onlineMinutes: 600,
						observedMinutes: 1000,
						gapCount: 2,
						heartbeatCount: 1200,
						onlineSharePct: 60,
					},
					{
						day: "2026-11-01",
						devicesReporting: 4,
						onlineMinutes: 900,
						observedMinutes: 1000,
						gapCount: 0,
						heartbeatCount: 900,
						onlineSharePct: 90,
					},
				],
				daysWithoutData: 88,
			}),
		);

		// Two stored days → two bars; the 88 missing days draw nothing.
		expect(html.split("<rect").length - 1).toBe(2);
		expect(html).toContain('role="img"');
		expect(html).toContain("2 of 90 days have stored history");
		expect(html).toContain("average online share 75%");
		expect(html).toContain('<th scope="row">2026-10-30</th>');
		expect(html).toContain("<td>60%</td>");
		expect(html).toContain("<td>90%</td>");
	});

	it("keeps the axis labels as HTML so they cannot scale to ~4 px at 390 px", () => {
		const html = render(
			snapshot({
				trend: [
					{
						day: "2026-11-01",
						devicesReporting: 4,
						onlineMinutes: 900,
						observedMinutes: 1000,
						gapCount: 0,
						heartbeatCount: 900,
						onlineSharePct: 90,
					},
				],
				daysWithoutData: 89,
			}),
		);

		// The plot still draws in a fixed coordinate space, but every label is now
		// text outside it at a fixed 10 px: an SVG text node would be scaled by the
		// viewBox (9 px → ~4 px in a 318 px pane).
		expect(html).not.toContain("<text");
		expect(html).toContain(">100%<");
		expect(html).toContain(">50%<");
		expect(html).toContain(">0%<");
		expect(html).toContain("text-[10px]");
	});
});
