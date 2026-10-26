import { Scale } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	DashboardCard,
	DashboardCardList,
	DashboardCardRow,
	DashboardTHead,
	DashboardTable,
	DashboardTd,
	DashboardTh,
	DashboardTr,
} from "@/components/dashboard/dashboard-table";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";

/**
 * The dashboard primitives carry the responsive and accessibility behaviour
 * every page relies on (T-09b): one `h1` per page, a scoped table that becomes
 * a card list on phones, and a read-only note that explains disabled controls.
 */

describe("dashboard primitives", () => {
	it("renders the page header with a single h1 and translated description", () => {
		const html = renderToStaticMarkup(
			<DashboardPageHeader
				title="Growth & FCR"
				description="Biomass tracking for Pond 1"
				icon={Scale}
				actions={<button type="button">Export</button>}
			/>,
		);

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Growth &amp; FCR");
		expect(html).toContain("Biomass tracking for Pond 1");
		expect(html).toContain("Export");
		// The icon is decorative; the title already names the page.
		expect(html).toMatch(/<span aria-hidden="true"/);
	});

	it("renders an empty state whose icon is hidden from screen readers", () => {
		const html = renderToStaticMarkup(
			<DashboardEmptyState
				icon={Scale}
				title="No biomass samples yet"
				description="Log a sample to start the chart."
			/>,
		);

		expect(html).toContain("No biomass samples yet");
		expect(html).toContain("Log a sample to start the chart.");
		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});

	it("explains read-only mode instead of letting a tap fail", () => {
		const html = renderToStaticMarkup(
			<ReadOnlyNotice title="View only" description="Controls are disabled." />,
		);

		expect(html).toContain('role="note"');
		expect(html).toContain("View only");
		expect(html).toContain("Controls are disabled.");
	});

	it("hides the desktop table below md and shows the card list instead", () => {
		const html = renderToStaticMarkup(
			<>
				<DashboardTable caption="Biomass samples, newest first" minWidth="min-w-[40rem]">
					<DashboardTHead>
						<DashboardTh>Date</DashboardTh>
						<DashboardTh align="right">ABW (g)</DashboardTh>
					</DashboardTHead>
					<tbody>
						<DashboardTr>
							<DashboardTd>Jul 8</DashboardTd>
							<DashboardTd className="text-right">120.0 g</DashboardTd>
						</DashboardTr>
					</tbody>
				</DashboardTable>
				<DashboardCardList label="Biomass samples, newest first">
					<DashboardCard>
						<DashboardCardRow label="Date">Jul 8</DashboardCardRow>
						<DashboardCardRow label="ABW (g)">120.0 g</DashboardCardRow>
					</DashboardCard>
				</DashboardCardList>
			</>,
		);

		// Table: hidden on phones, caption for screen readers, column scopes.
		expect(html).toContain("hidden overflow-hidden md:block");
		expect(html).toContain('<caption class="sr-only">Biomass samples, newest first</caption>');
		expect(html.match(/scope="col"/g)).toHaveLength(2);

		// Card list: visible on phones only, with an accessible name.
		expect(html).toContain('<ul aria-label="Biomass samples, newest first"');
		expect(html).toContain("md:hidden");
		expect(html).toContain("Jul 8");
		expect(html).toContain("120.0 g");
	});

	it("renders a section as a heading block with its action", () => {
		const html = renderToStaticMarkup(
			<DashboardSection
				title="Growth Summary"
				description="Weight and length gain"
				action={<a href="/dashboard/growth/history">View all</a>}
			>
				<p>Body</p>
			</DashboardSection>,
		);

		expect(html).toContain("<h2");
		expect(html).toContain("Growth Summary");
		expect(html).toContain("Weight and length gain");
		expect(html).toContain("View all");
		expect(html).toContain("Body");
	});
});
