import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TermInfo } from "@/components/dashboard/term-info";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * The growth and dashboard cards keep ABW/FCR visible, so their explanation
 * must be reachable without replacing the abbreviation: a focusable info
 * trigger whose accessible description screen readers announce, plus a visual
 * tooltip for pointer and keyboard users (issue #347).
 */

const ABW = {
	label: "Latest ABW",
	hint: "What does ABW mean?",
	description:
		"Average Body Weight: the mean weight of the fish in your latest biomass sample, in grams.",
};

const FCR = {
	label: "Current FCR",
	hint: "What does FCR mean?",
	description:
		"Feed Conversion Ratio: the kilograms of feed used for every kilogram of fish weight gained.",
};

function tooltip() {
	return document.querySelector("[data-term-tooltip]");
}

describe("TermInfo", () => {
	it("keeps the abbreviation and attaches the expansion as the accessible description", () => {
		render(<TermInfo {...ABW} />);

		expect(screen.getByText("Latest ABW")).toBeInTheDocument();

		// `description` is the computed accessible description, i.e. what a
		// screen reader announces for the trigger, not just a hidden string.
		const trigger = screen.getByRole("button", {
			name: ABW.hint,
			description: ABW.description,
		});
		const describedBy = trigger.getAttribute("aria-describedby");
		expect(describedBy).toBeTruthy();
		expect(document.getElementById(describedBy ?? "")).toHaveTextContent(ABW.description);
	});

	it("shows the explanation on hover and hides it again on leave", () => {
		render(<TermInfo {...FCR} />);

		expect(tooltip()).toBeNull();

		fireEvent.pointerOver(screen.getByText("Current FCR"));
		expect(tooltip()).toHaveTextContent(FCR.description);

		fireEvent.pointerOut(screen.getByText("Current FCR"));
		expect(tooltip()).toBeNull();
	});

	it("shows the explanation on keyboard focus and closes it with Escape", () => {
		render(<TermInfo {...FCR} />);

		const trigger = screen.getByRole("button", { name: FCR.hint });
		act(() => trigger.focus());
		expect(trigger).toHaveFocus();
		expect(tooltip()).toHaveTextContent(FCR.description);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(tooltip()).toBeNull();
		expect(trigger).toHaveFocus();
	});

	it("closes the explanation when focus moves to the next control", () => {
		render(
			<>
				<TermInfo {...ABW} />
				<button type="button">Next</button>
			</>,
		);

		const trigger = screen.getByRole("button", { name: ABW.hint });
		act(() => trigger.focus());
		expect(tooltip()).toHaveTextContent(ABW.description);

		act(() => screen.getByRole("button", { name: "Next" }).focus());
		expect(tooltip()).toBeNull();
	});
});

describe("terminology copy", () => {
	it.each(["en", "hil", "tl"] as const)("%s expands both abbreviations", (locale) => {
		const messages = JSON.parse(
			readFileSync(join(__dirname, "../../messages", `${locale}.json`), "utf8"),
		) as {
			dashboard: {
				common: {
					terminology: { aboutAbw: string; abw: string; aboutFcr: string; fcr: string };
				};
			};
		};
		const terms = messages.dashboard.common.terminology;

		expect(terms.abw).toContain("Average Body Weight");
		expect(terms.fcr).toContain("Feed Conversion Ratio");
		expect(terms.aboutAbw).toContain("ABW");
		expect(terms.aboutFcr).toContain("FCR");
	});
});
