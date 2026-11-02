import { PondList } from "@/components/settings/pond-list";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The settings pond list (#484).
 *
 * The component is presentational, so the tests hold the contract the settings
 * page relies on: the count heading, every assigned pond, the manage link, a
 * capped scroll box, and truncation that keeps the full name in the tooltip.
 * The routing Link is stubbed so the test needs no i18n provider.
 */

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: { href: string; children?: ReactNode } & Record<string, unknown>) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

const LABELS = {
	label: "Ponds",
	emptyTitle: "No ponds yet.",
	emptyHint: "Ponds appear here after your administrator assigns one to your farm.",
	manageLabel: "Manage ponds",
};

const MANAGE_HREF = "/dashboard/settings/pond";

const PONDS = [
	{ id: "pond-1", name: "Pond Alpha" },
	{ id: "pond-2", name: "Pond Beta" },
	{ id: "pond-3", name: "Pond Gamma" },
];

const LONG_NAME = "Pond with a name that is far too long to fit on one settings row";

describe("PondList", () => {
	it("renders the count heading, every pond and the manage link", () => {
		const html = renderToStaticMarkup(
			<PondList ponds={PONDS} countLabel="Ponds (3)" manageHref={MANAGE_HREF} {...LABELS} />,
		);

		expect(html).toContain("Ponds (3)");
		for (const pond of PONDS) {
			expect(html).toContain(pond.name);
		}
		expect(html).toContain("Manage ponds");
		expect(html).toContain(`href="${MANAGE_HREF}"`);
	});

	it("caps the list to a scrollable box", () => {
		render(<PondList ponds={PONDS} countLabel="Ponds (3)" manageHref={MANAGE_HREF} {...LABELS} />);

		const list = screen.getByRole("list");
		expect(list).toHaveClass("max-h-64");
		expect(list).toHaveClass("overflow-y-auto");
	});

	it("truncates a long pond name and keeps the full name in the title", () => {
		render(
			<PondList
				ponds={[{ id: "pond-long", name: LONG_NAME }]}
				countLabel="Ponds (1)"
				manageHref={MANAGE_HREF}
				{...LABELS}
			/>,
		);

		const name = screen.getByText(LONG_NAME);
		expect(name).toHaveClass("truncate");
		expect(name).toHaveAttribute("title", LONG_NAME);
	});

	it("shows the empty state and no manage link when the farm has no ponds", () => {
		const html = renderToStaticMarkup(
			<PondList ponds={[]} countLabel="Ponds (0)" manageHref={MANAGE_HREF} {...LABELS} />,
		);

		expect(html).toContain("No ponds yet.");
		expect(html).toContain("Ponds appear here after your administrator assigns one to your farm.");
		expect(html).not.toContain(`href="${MANAGE_HREF}"`);
		expect(html).not.toContain("Manage ponds");
	});
});
