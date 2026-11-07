import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #893: the legal pages' "on this page" pane must stay in view while the
 * document scrolls.
 *
 * The old markup put `sticky` on the nav inside an `aside` that was only as
 * tall as the list, so the sticky box had no travel and scrolled away with the
 * document. The regression guard therefore checks where `sticky` lives, not
 * just that the class is somewhere in the tree.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next/image", () => ({
	default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("@/components/legal/hiligaynon-summary", () => ({ HiligaynonSummary: () => null }));

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string;
		children?: ReactNode;
	} & Record<string, unknown>) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { PRIVACY_SECTIONS } from "@/lib/legal/sections";

async function renderShell() {
	const ui = await LegalPageShell({ kind: "privacy", children: <p>Policy body</p> });
	return renderToStaticMarkup(ui);
}

describe("legal page sticky contents pane (#893)", () => {
	it("makes the pane itself sticky, with the nav as a plain child", async () => {
		const html = await renderShell();

		const aside = html.match(/<aside[^>]*class="([^"]*)"/);
		expect(aside, "the contents pane must render an aside").not.toBeNull();
		expect(aside?.[1]).toContain("lg:sticky");
		expect(aside?.[1]).toContain("lg:top-24");
		// `self-start` keeps the pane its content height inside the grid row, so
		// the sticky box can travel the full length of the article.
		expect(aside?.[1]).toContain("lg:self-start");

		const nav = html.match(/<nav[^>]*aria-label="On this page"[^>]*class="([^"]*)"/);
		expect(nav, "the pane must keep its navigation").not.toBeNull();
		expect(nav?.[1]).not.toContain("sticky");
	});

	it("keeps the pane scrollable on a short viewport without changing the page scroll", async () => {
		const html = await renderShell();

		const aside = html.match(/<aside[^>]*class="([^"]*)"/);
		expect(aside?.[1]).toContain("lg:max-h-[calc(100dvh-7rem)]");
		expect(aside?.[1]).toContain("lg:overflow-y-auto");
		// The document column stays in normal page flow: no viewport-height
		// shell and no `overflow-hidden` on the page wrapper.
		expect(html).not.toMatch(/(?:^|["\s])h-(?:screen|\[100dvh\])(?:["\s])/);
	});

	it("keeps every section anchor in the pane", async () => {
		const html = await renderShell();

		for (const section of PRIVACY_SECTIONS) {
			expect(html).toContain(`href="#${section.id}"`);
		}
	});
});
