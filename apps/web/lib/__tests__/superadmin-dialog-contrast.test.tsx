import { contrastRatio } from "@/lib/calendar/event-colors";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #321: the platform-console step-up dialog must follow the theme.
 *
 * The console was built light-only, and the app toggles `.dark` on `<html>` for
 * every shell (see `theme-provider.tsx`). The modal therefore stayed a bright
 * white island in an otherwise dark dashboard — readable, but the one surface
 * that ignored the reader's theme. The same dialog is also used by the chat for
 * superadmin actions, so the chat's dark palette could open a light modal.
 *
 * These checks lock the fix in three ways, following the pattern #309 set for
 * the chat surfaces:
 *   1. every light surface, text colour and border the dialog renders needs a
 *      `dark:` counterpart on the same element (the walker below);
 *   2. the specific surfaces the reader sees (panel, title, field, error,
 *      buttons) must carry the documented dark classes;
 *   3. every documented `DIALOG_CONTRAST` pair meets WCAG AA (4.5:1) for normal
 *      text in both themes.
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
 * Light-only utilities the dialog used to render without a dark variant. Brand
 * fills that work in both themes (the navy chrome, the orange confirm) are not
 * listed.
 */
const LIGHT_BACKGROUNDS = new Set(["bg-white", "bg-[#F4F7F6]", "bg-red-50", "bg-gray-200"]);
const LIGHT_TEXT = new Set(["text-[#0A3D62]", "text-[#3D5568]", "text-[#C42B3A]", "text-gray-800"]);
const LIGHT_BORDERS = new Set(["border-gray-200", "border-red-200"]);

function failure(element: Element, missing: string, light: string[]): string {
	const tag = element.tagName.toLowerCase();
	return `${tag} renders ${light.join(", ")} without ${missing} (class="${element.getAttribute("class")}")`;
}

/** Every light surface, text colour and border must have its dark counterpart. */
function expectThemeAware(container: HTMLElement) {
	for (const element of container.querySelectorAll("*")) {
		const classes = (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
		const backgrounds = classes.filter((name) => LIGHT_BACKGROUNDS.has(name));
		const text = classes.filter((name) => LIGHT_TEXT.has(name));
		const borders = classes.filter((name) => LIGHT_BORDERS.has(name));

		if (backgrounds.length > 0) {
			expect(
				classes.some((name) => name.startsWith("dark:bg-")),
				failure(element, "a dark: background", backgrounds),
			).toBe(true);
		}
		if (text.length > 0) {
			expect(
				classes.some((name) => name.startsWith("dark:text-")),
				failure(element, "a dark: text colour", text),
			).toBe(true);
		}
		if (borders.length > 0) {
			expect(
				classes.some((name) => name.startsWith("dark:border-")),
				failure(element, "a dark: border colour", borders),
			).toBe(true);
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

describe("step-up dialog dark palette (#321)", () => {
	it("paints the panel, header and explanation for both themes", () => {
		const { container, dialog } = openDialog();

		expectThemeAware(container);

		expect(dialog).toHaveClass("bg-white", "dark:bg-gray-900");
		expect(dialog).toHaveClass("text-[#0A3D62]", "dark:text-gray-100");
		expect(dialog).toHaveClass("border-gray-200", "dark:border-gray-700");

		const backdrop = dialog.parentElement as HTMLElement;
		expect(backdrop).toHaveClass("bg-[#0A3D62]/40", "dark:bg-black/70");

		const title = screen.getByRole("heading", { name: "Confirm your password" });
		expect(title).toHaveClass("text-[#0A3D62]", "dark:text-gray-100");

		const description = screen.getByText(/re-enter your own password/i);
		expect(description).toHaveClass("text-[#3D5568]", "dark:text-gray-400");

		const close = screen.getByRole("button", { name: "Close step-up dialog" });
		expect(close).toHaveClass("dark:text-gray-400", "dark:hover:bg-gray-800");
	});

	it("keeps the password field and both actions readable on the dark panel", () => {
		const { container } = openDialog();

		const field = screen.getByLabelText("Password *");
		expect(field).toHaveClass("bg-[#F4F7F6]", "dark:bg-gray-800");
		expect(field).toHaveClass("text-[#0A3D62]", "dark:text-white");
		expect(field).toHaveClass("border-gray-200", "dark:border-gray-600");

		const label = container.querySelector('label[for="stepup-password"]') as HTMLElement;
		expect(label).toHaveClass("text-[#3D5568]", "dark:text-gray-400");

		// White on #C2410C is 5.18:1; the brand orange would be 3.54:1.
		const confirm = screen.getByRole("button", { name: "Continue" });
		expect(confirm).toHaveClass("bg-[#C2410C]", "text-white");

		const cancel = screen.getByRole("button", { name: "Cancel" });
		expect(cancel).toHaveClass("dark:bg-gray-800", "dark:text-gray-100");

		expectThemeAware(container);
	});

	it("shows the validation message on the dark palette as well", () => {
		const { container } = openDialog();

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		const error = screen.getByRole("alert");
		expect(error).toHaveClass("bg-red-50", "dark:bg-red-950");
		expect(error).toHaveClass("text-[#C42B3A]", "dark:text-red-300");
		expect(error).toHaveClass("border-red-200", "dark:border-red-900");
		expectThemeAware(container);
	});
});

describe("step-up dialog contrast values (#321)", () => {
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
				const { background, foreground } = pair[theme];
				expect(
					contrastRatio(background, foreground),
					`${pair.label} (${theme}): ${foreground} on ${background}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});
});
