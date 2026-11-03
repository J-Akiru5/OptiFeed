import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/biomass", () => ({
	deleteBiomassLog: vi.fn(),
	updateBiomassLog: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { BiomassLogActions, farmDateInputValue } from "@/components/growth/BiomassLogActions";

const LOG = {
	id: "log-1",
	// 00:30 on 4 November in Manila is still 3 November in UTC.
	recordedAt: "2026-11-03T16:30:00.000Z",
	sampleCount: 25,
	sampleWeightKg: 4.2,
	sampleLengthCm: 18.5,
	batchLabel: "Batch A",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("farmDateInputValue", () => {
	it("uses the Manila calendar day instead of the UTC slice", () => {
		expect(farmDateInputValue("2026-11-03T16:30:00.000Z")).toBe("2026-11-04");
		expect(farmDateInputValue("2026-11-03T15:59:00.000Z")).toBe("2026-11-03");
	});

	it("falls back to the raw prefix for an unparseable value", () => {
		expect(farmDateInputValue("not-a-date")).toBe("not-a-date");
	});
});

describe("BiomassLogActions dialog", () => {
	it("prefills the farm-local date", () => {
		render(<BiomassLogActions log={LOG} canWrite />);

		fireEvent.click(screen.getByRole("button", { name: "Edit sample" }));

		expect(screen.getByLabelText("Saved")).toHaveValue("2026-11-04");
	});

	it("is a labelled modal, closes on Escape and restores focus", async () => {
		render(<BiomassLogActions log={LOG} canWrite />);

		const edit = screen.getByRole("button", { name: "Edit sample" });
		edit.focus();
		fireEvent.click(edit);

		const dialog = screen.getByRole("dialog", { name: "Edit biomass sample" });
		expect(dialog).toHaveAttribute("aria-modal", "true");
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(edit).toHaveFocus();
	});
});
