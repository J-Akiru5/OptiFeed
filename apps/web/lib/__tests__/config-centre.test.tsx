import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { ConfigCentre } from "@/components/superadmin/config-centre";

/**
 * The configuration centre is one page with eight sections. This renders the
 * shell only: it proves every declared section gets an anchor, a desktop
 * heading and a panel, and that the first section starts open on mobile.
 */
describe("ConfigCentre", () => {
	const sections = [
		{
			id: "lists",
			icon: "lists" as const,
			title: "Lists",
			description: "Page size",
			content: <p>lists content</p>,
		},
		{
			id: "flags",
			icon: "flags" as const,
			title: "Feature flags",
			description: "Switches",
			content: <p>flags content</p>,
		},
	];

	it("renders a nav entry and a panel for every section", () => {
		const html = renderToStaticMarkup(<ConfigCentre sections={sections} />);

		expect(html).toContain('href="#lists"');
		expect(html).toContain('href="#flags"');
		expect(html).toContain('id="lists-panel"');
		expect(html).toContain('id="flags-panel"');
		expect(html).toContain("lists content");
		expect(html).toContain("flags content");
	});

	it("opens the first section and collapses the rest on mobile", () => {
		const html = renderToStaticMarkup(<ConfigCentre sections={sections} />);

		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain('aria-expanded="false"');
	});

	it("labels the section list for assistive technology", () => {
		const html = renderToStaticMarkup(<ConfigCentre sections={sections} />);

		expect(html).toContain('aria-label="tocLabel"');
		expect(html).toContain("<nav");
	});
});
