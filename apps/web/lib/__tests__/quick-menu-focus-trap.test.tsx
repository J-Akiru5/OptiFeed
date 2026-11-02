import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Keyboard contract of the mobile quick menu (#592).
 *
 * The sheet declares `aria-modal="true"`, which tells a screen reader that the
 * rest of the page is inert. Tab has to honour that: focus must cycle inside
 * the sheet instead of walking into the header and bottom bar behind it. Escape
 * and focus-return already worked and are pinned here so the trap cannot break
 * them.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string | { pathname?: string };
			children?: React.ReactNode;
		} & Record<string, unknown>) =>
			react.createElement(
				"a",
				{ href: typeof href === "string" ? href : (href?.pathname ?? "#"), ...rest },
				children,
			),
		usePathname: () => pathname.current,
	};
});

import { QuickMenu } from "@/components/mobile/quick-menu";

/** Every control the trap considers, in document order. */
function focusablesIn(panel: HTMLElement): HTMLElement[] {
	return Array.from(
		panel.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
		),
	);
}

function openMenu() {
	render(<QuickMenu shell="farmer" isTenantAdmin={false} trigger="more" label="More" />);
	const trigger = screen.getByRole("button", { name: "More sections" });
	fireEvent.click(trigger);
	const panel = screen.getByRole("dialog");
	return { trigger, panel };
}

describe("quick menu focus trap (#592)", () => {
	it("opens with focus inside the sheet", () => {
		const { panel } = openMenu();

		expect(panel.contains(document.activeElement)).toBe(true);
	});

	it("wraps Tab from the last control back to the first", () => {
		const { panel } = openMenu();
		const controls = focusablesIn(panel);
		expect(controls.length).toBeGreaterThan(2);

		const last = controls[controls.length - 1];
		last.focus();
		expect(last).toHaveFocus();

		fireEvent.keyDown(document, { key: "Tab" });
		expect(controls[0]).toHaveFocus();
	});

	it("wraps Shift+Tab from the first control to the last", () => {
		const { panel } = openMenu();
		const controls = focusablesIn(panel);
		const first = controls[0];
		const last = controls[controls.length - 1];

		first.focus();
		fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
		expect(last).toHaveFocus();
	});

	it("still closes on Escape and returns focus to the trigger", () => {
		const { trigger } = openMenu();
		screen.getByRole("dialog");

		fireEvent.keyDown(document, { key: "Escape" });

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(trigger).toHaveFocus();
	});
});
