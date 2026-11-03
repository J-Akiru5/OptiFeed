import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contrast, readConsolePalette, resolvePair } from "./helpers/console-palette";

/**
 * #321: the platform-console step-up dialog must follow the theme.
 * #628: it does so through the same `console-*` tokens as every other surface.
 *
 * The console was built light-only, and the app toggles `.dark` on `<html>` for
 * every shell (see `theme-provider.tsx`), so the modal used to be a bright white
 * island in an otherwise dark console. The first fix paired every light class
 * with a hand-written `dark:` variant; the token layer replaces that with one
 * name per colour and a light/dark value behind it.
 *
 * These checks lock the fix in three ways:
 *   1. no element the dialog renders carries a raw colour utility, so there is
 *      no light-only class left to forget a `dark:` on (the walker below);
 *   2. the surfaces the reader sees (panel, title, field, error, buttons) carry
 *      the documented token classes;
 *   3. every `DIALOG_CONTRAST` pair meets WCAG AA (4.5:1) in both themes, with
 *      the values read from `app/globals.css` rather than restated here.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/lib/actions/step-up", () => ({ startStepUp: vi.fn() }));

import { DIALOG_CONTRAST } from "@/components/superadmin/dialog-theme";
import { StepUpDialog } from "@/components/superadmin/step-up-dialog";

beforeEach(() => {
	vi.clearAllMocks();
});

/**
 * Raw colour utilities the dialog must no longer render. Brand fills that work
 * in both themes are not listed: since #628 they are tokens too, so the dialog
 * has no literal colour at all.
 */
const RAW_COLOURS = [
	/\bbg-white(?![/\w-])/,
	/\btext-white(?![/\w-])/,
	/\bborder-white(?![/\w-])/,
	/\bbg-black(?![/\w-])/,
	/\b(?:bg|text|border|ring|fill|stroke)-(?:gray|slate|red|emerald|amber|orange|blue)-\d/,
	/\[#[0-9a-fA-F]{3,8}\]/,
];

/** No element may name a colour outside the token layer. */
function expectTokenOnly(container: HTMLElement) {
	for (const element of container.querySelectorAll("*")) {
		const className = element.getAttribute("class") ?? "";
		for (const pattern of RAW_COLOURS) {
			expect(
				pattern.test(className),
				`${element.tagName.toLowerCase()} renders a raw colour (class="${className}")`,
			).toBe(false);
		}
	}
}

function openDialog() {
	const view = render(
		<StepUpDialog
			open
			actionLabel="rotate this device token"
			onClose={vi.fn()}
			onVerified={vi.fn()}
		/>,
	);
	return { container: view.container, dialog: screen.getByRole("dialog") };
}

describe("step-up dialog theme (#321, #628)", () => {
	it("paints the panel, header and explanation from the console tokens", () => {
		const { container, dialog } = openDialog();

		expectTokenOnly(container);

		expect(dialog).toHaveClass("bg-console-surface", "text-console-content");
		expect(dialog).toHaveClass("border-console-border");

		const backdrop = dialog.parentElement as HTMLElement;
		expect(backdrop).toHaveClass("bg-console-scrim/70");

		const title = screen.getByRole("heading", { name: "Confirm your password" });
		expect(title).toHaveClass("text-console-content");

		const description = screen.getByText(/re-enter your own password/i);
		expect(description).toHaveClass("text-console-content-muted");

		const close = screen.getByRole("button", { name: "Close step-up dialog" });
		expect(close).toHaveClass("text-console-content-muted", "hover:bg-console-surface-sunken");
	});

	it("keeps the password field and both actions on the same palette", () => {
		const { container } = openDialog();

		const field = screen.getByLabelText("Password *");
		expect(field).toHaveClass("bg-console-surface-sunken", "text-console-content");
		expect(field).toHaveClass("border-console-control-border");
		expect(field.className).toContain("placeholder:text-console-content-muted");

		const label = container.querySelector('label[for="stepup-password"]') as HTMLElement;
		expect(label).toHaveClass("text-console-content-muted");

		// The confirm control is the AA-safe accent in both themes, never the
		// decorative brand orange.
		const confirm = screen.getByRole("button", { name: "Continue" });
		expect(confirm).toHaveClass("bg-console-accent", "text-console-accent-foreground");

		const cancel = screen.getByRole("button", { name: "Cancel" });
		expect(cancel).toHaveClass("bg-console-surface-raised", "text-console-content");
		expect(cancel).toHaveClass("border-console-control-border");

		expectTokenOnly(container);
	});

	it("paints the validation message from the critical status tokens", () => {
		const { container } = openDialog();

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		const error = screen.getByRole("alert");
		expect(error).toHaveClass("bg-console-critical-surface", "text-console-critical-content");
		expect(error).toHaveClass("border-console-critical-content/40");

		// The field itself switches to the critical outline.
		expect(screen.getByLabelText("Password *")).toHaveClass("border-console-critical-content");

		expectTokenOnly(container);
	});
});

describe("step-up dialog contrast values (#321, #628)", () => {
	const palette = readConsolePalette();

	it("documents every surface the dialog depends on", () => {
		const labels = DIALOG_CONTRAST.map((pair) => pair.label);
		expect(labels).toEqual(
			expect.arrayContaining([
				"dialog title",
				"dialog explanation",
				"password field text",
				"confirm button",
				"cancel button",
				"validation message",
			]),
		);
	});

	it("meets WCAG AA (4.5:1) for every documented pair in both themes", () => {
		for (const pair of DIALOG_CONTRAST) {
			for (const theme of ["light", "dark"] as const) {
				const { background, foreground } = resolvePair(palette, theme, pair);
				expect(
					contrast(background, foreground),
					`${pair.label} (${theme}): ${foreground} on ${background}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});
});
