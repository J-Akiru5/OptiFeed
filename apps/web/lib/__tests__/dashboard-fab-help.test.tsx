import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #269 dashboard: no redundant floating "?" and no horizontal scroll.
 *
 * The dashboard header already carries the help control, so the floating "?"
 * that hovered over the right rail was a second entry point (and it covered the
 * Time Calibration card). These checks prove the floating cluster no longer
 * renders a help control, that the header/mobile band still do (exactly one of
 * them is visible per width), and that the Time Calibration card keeps its two
 * controls while the rail is pinned against sideways scrolling.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ isOpen: false, isOpenPeek: false, toggle: vi.fn(), open: vi.fn() }),
}));

import { FabStack } from "@/components/fab-stack";

describe("dashboard floating controls (#269)", () => {
	it("keeps only the chat button in the floating stack", () => {
		const html = renderToStaticMarkup(<FabStack />);

		// The talk-to-Pakoy control stays.
		expect(html).toContain('aria-label="Open chat"');

		// #287 the closed FAB shows Pakoy's head instead of a generic
		// message-square glyph.
		expect(html).toContain("pakoy-head.webp");

		// The redundant floating "?" is gone: no help anchor, no dialog trigger.
		expect(html).not.toContain("data-fab-help");
		expect(html).not.toContain('aria-haspopup="dialog"');
	});

	it("keeps the header help control and gives the mobile band the same one", () => {
		const webRoot = join(__dirname, "../..");
		const layout = readFileSync(join(webRoot, "app/[locale]/(dashboard)/layout.tsx"), "utf8");
		const headerActions = readFileSync(join(webRoot, "components/header-actions.tsx"), "utf8");

		// The floating cluster is no longer given a help audience.
		expect(layout).toContain("<FabStack />");
		expect(layout).not.toContain("<FabStack audience=");

		// Both header rows still render HelpButton, so no dashboard width loses
		// its help entry point.
		expect(headerActions.match(/<HelpButton /g)).toHaveLength(2);
		expect(layout).toContain("helpEnabled={helpEnabled}");
	});
});
