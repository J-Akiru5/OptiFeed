import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Guards #275.
 *
 * The schedule card clips its overflow, so the card is the sticky save row's
 * scrollport and the safe-area offset is measured from the card's bottom. That
 * pulls the row up out of the flow, on top of the Sync Status card. A
 * mobile-only spacer between the card and the row gives the row empty space to
 * cover instead; without it, "Force Resync" is hidden and untappable on a
 * phone.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/lib/actions/schedule", () => ({
	updateScheduleCommand: vi.fn(),
}));

import { ScheduleEditor } from "@/components/ScheduleEditor";

function renderEditor() {
	return renderToStaticMarkup(
		<ScheduleEditor
			pondId="pond-1"
			deviceId="device-1"
			initialStart="06:00"
			initialEnd="18:00"
			initialFeedsPerDay={3}
			initialFeedingRatePct={4}
			pendingCommand={null}
			latestAppliedCommand={null}
		/>,
	);
}

function tagAt(html: string, index: number) {
	return html.slice(html.lastIndexOf("<div", index), html.indexOf(">", index) + 1);
}

describe("ScheduleEditor mobile save row (#275)", () => {
	it("reserves mobile space between the sync card and the sticky row", () => {
		const html = renderEditor();

		const spacer = html.indexOf('class="h-20 sm:hidden"');
		expect(spacer).toBeGreaterThan(-1);
		// Decorative only: it must not be announced or trap a tap.
		expect(tagAt(html, spacer)).toContain('aria-hidden="true"');

		// The sync card, its summary and Force Resync all sit above the spacer.
		const resync = html.indexOf("Force Resync");
		expect(resync).toBeGreaterThan(-1);
		expect(resync).toBeLessThan(spacer);

		// The sticky row starts below the spacer, so it covers empty space
		// rather than the card.
		const actions = html.indexOf("max-sm:sticky");
		expect(actions).toBeGreaterThan(spacer);
		expect(html.indexOf('data-help="schedule-save"')).toBeGreaterThan(spacer);
	});

	it("keeps the sticky offset and leaves desktop markup alone", () => {
		const html = renderEditor();

		// The spacer only exists below `sm`.
		const spacer = html.indexOf('class="h-20 sm:hidden"');
		expect(tagAt(html, spacer)).toContain('class="h-20 sm:hidden"');

		// Every sticky rule stays `max-sm`-scoped, so `sm` and above render the
		// plain action row exactly as before.
		expect(html).toContain("max-sm:sticky");
		expect(html).toContain(
			"max-sm:bottom-[calc(var(--ofd-bottom-nav-h)+env(safe-area-inset-bottom)+0.5rem)]",
		);
	});
});
