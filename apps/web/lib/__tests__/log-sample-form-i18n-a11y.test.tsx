import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The biomass sample form in Hiligaynon, with its accessible names (#591, #592).
 *
 * Two regressions are pinned here, and they fail independently:
 *
 * - **copy**: every visible string and every placeholder comes from
 *   `dashboard.logSample`, so switching the locale switches the form. A
 *   hardcoded English sentence would render in `hil` exactly as before, which
 *   is what this form did for ~40 strings.
 * - **names**: the individual-fish inputs were placeholder-only and the remove
 *   button was an icon with no name, so a screen reader announced "edit text,
 *   blank" and "button". Both now carry a translated name, and the mode switch
 *   reports which mode is on through `aria-pressed` instead of colour alone.
 *
 * The whole rendered form is also run through axe, because missing names are
 * exactly what the `label`/`button-name` rules catch.
 */

const { locale } = vi.hoisted(() => ({ locale: { current: "hil" as "en" | "hil" } }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace, locale.current),
		useLocale: () => locale.current,
	};
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/biomass", () => ({ saveBiomassLog: vi.fn() }));
vi.mock("@/lib/offline/outbox", () => ({
	enqueueBiomassSample: vi.fn(),
	newClientEventId: () => "test-event-id",
}));
vi.mock("@/lib/pwa/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/components/mobile/form-actions", () => ({ mobileStickyActions: "" }));

import { LogSampleForm } from "@/components/LogSampleForm";
import { expectNoSeriousOrCriticalViolations } from "./helpers/axe";

function renderForm() {
	return render(
		<LogSampleForm
			pondId="pond-1"
			feedingRatePct={3}
			feedsPerDay={3}
			population={5000}
			batchLabels={["Batch A"]}
		/>,
	);
}

describe("biomass sample form in Hiligaynon (#591)", () => {
	it("renders its labels, placeholders and modes from the hil catalogue", () => {
		renderForm();

		expect(screen.getByLabelText("Average nga Timbang sang Isda (gramos)")).toBeInTheDocument();
		expect(screen.getByLabelText("Kasagaran nga Kalabaon (cm)")).toBeInTheDocument();
		expect(screen.getByLabelText("Kadamuon sang Sample nga Isda")).toBeInTheDocument();
		expect(screen.getByLabelText("Sampling batch (opsyonal)")).toBeInTheDocument();

		expect(screen.getByPlaceholderText("hal. 220")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("hal. 24")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("hal. Sampling batch 2026-10 A")).toBeInTheDocument();

		// Preview headings are translated too, not just the inputs.
		expect(screen.getByText("Kabilugan nga Biomass")).toBeInTheDocument();
		expect(screen.getByText("Pagkaon kada Pagpakaon")).toBeInTheDocument();
	});

	it("leaves no English label standing in the Hiligaynon form", () => {
		renderForm();

		for (const english of [
			"Avg. Fish Weight (grams)",
			"Avg. Fish Length (cm)",
			"Sample Fish Count",
			"Sampling batch (optional)",
			"Average Mode",
			"Individual Mode",
			"Total Biomass",
			"Feed per Meal",
		]) {
			expect(screen.queryByText(english), `${english} is still hardcoded`).toBeNull();
		}
	});

	it("marks the active input mode for assistive tech, not just with colour", () => {
		renderForm();

		const average = screen.getByRole("button", { name: "Average nga Mode" });
		const individual = screen.getByRole("button", { name: "Indibidwal nga Mode" });
		expect(average).toHaveAttribute("aria-pressed", "true");
		expect(individual).toHaveAttribute("aria-pressed", "false");

		fireEvent.click(individual);
		expect(average).toHaveAttribute("aria-pressed", "false");
		expect(individual).toHaveAttribute("aria-pressed", "true");
	});

	it("gives every individual-fish input and remove button a translated name", () => {
		renderForm();
		fireEvent.click(screen.getByRole("button", { name: "Indibidwal nga Mode" }));

		expect(screen.getByLabelText("Timbang sang isda 1 sa gramos")).toHaveAttribute(
			"placeholder",
			"Timbang (g)",
		);
		expect(screen.getByLabelText("Kalabaon sang isda 1 sa sentimetro")).toHaveAttribute(
			"placeholder",
			"Kalabaon (cm)",
		);
		expect(screen.getByLabelText("Timbang sang isda 2 sa gramos")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Kuhaon ang isda 1" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "Magdugang Isda" })).toBeInTheDocument();

		// No field in the form is reachable only through its placeholder.
		for (const field of screen.getAllByRole("spinbutton")) {
			expect(field).toHaveAccessibleName();
		}
	});

	it("has no serious or critical axe violations in Hiligaynon", async () => {
		const { container } = renderForm();

		await expectNoSeriousOrCriticalViolations(container);
	});
});
