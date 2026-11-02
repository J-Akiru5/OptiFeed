import { Scale } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-ui";

/**
 * Tagalog greetings are longer than their English counterparts, so the shared
 * dashboard header must stack safely on a phone: the title wraps inside its
 * column and the action row sits full-width underneath instead of overlapping
 * the greeting (#474).
 *
 * The fixture omits `mascot` on purpose: the mascot pulls in image assets that
 * this layout test does not need.
 */

const TAGALOG_TITLE = "Maligayang pagbabalik, Juan Miguel!";

function renderHeader() {
	return renderToStaticMarkup(
		<DashboardPageHeader
			title={TAGALOG_TITLE}
			description="Narito ang lagay ng iyong mga palaisdaan ngayon."
			summary="Susunod na pagpapakain sa 6:00 PM"
			icon={Scale}
			actions={<button type="button">Export PDF</button>}
		/>,
	);
}

describe("DashboardPageHeader mobile layout (#474)", () => {
	it("wraps a long Tagalog greeting instead of clipping it", () => {
		const html = renderHeader();

		// A page keeps exactly one h1.
		expect(html.match(/<h1/g)).toHaveLength(1);

		const h1 = /<h1 class="([^"]*)"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
		expect(h1).not.toBeNull();
		expect(h1?.[1]).toContain("break-words");
		expect(h1?.[1]).toContain("text-balance");
		expect(h1?.[2]).toBe(TAGALOG_TITLE);

		// Supporting copy wraps too, so no long Tagalog sentence overflows.
		const description = /<p class="([^"]*)"[^>]*>Narito ang lagay/.exec(html);
		expect(description?.[1]).toContain("break-words");
		const summary = /<p class="([^"]*)"[^>]*>Susunod na pagpapakain/.exec(html);
		expect(summary?.[1]).toContain("break-words");
	});

	it("puts the action in a full-width row below the text on phones", () => {
		const html = renderHeader();

		const actionWrapper =
			/<div class="([^"]*)"[^>]*><button type="button">Export PDF<\/button>/.exec(html);
		expect(actionWrapper).not.toBeNull();
		expect(actionWrapper?.[1]).toContain("w-full");
		expect(actionWrapper?.[1]).toContain("sm:w-auto");
		expect(actionWrapper?.[1]).toContain("justify-start");
		expect(actionWrapper?.[1]).toContain("sm:justify-end");

		// The action comes after the h1 in document order.
		const h1Index = html.indexOf("<h1");
		const actionIndex = html.indexOf("Export PDF");
		expect(h1Index).toBeGreaterThanOrEqual(0);
		expect(actionIndex).toBeGreaterThan(h1Index);

		// The header stacks below `sm` and only becomes a row from `sm` up.
		const header = /<header class="([^"]*)"/.exec(html);
		expect(header?.[1]).toContain("flex-col");
		expect(header?.[1]).toContain("sm:flex-row");

		// No absolute positioning may reintroduce an overlap.
		expect(html).not.toContain("absolute");
	});
});
