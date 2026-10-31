import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pond settings form (#371).
 *
 * The two promises of the issue, tested directly:
 *  - a failed save keeps every value the reader typed (and the draft survives
 *    leaving the page),
 *  - every problem is shown under its field and in a summary whose link moves
 *    focus to that field; a device conflict names both values and can apply the
 *    pond value to the device setting.
 */

const actions = vi.hoisted(() => ({
	updatePondSettings: vi.fn(),
	updateDeviceDailyCap: vi.fn(),
}));
const draftActions = vi.hoisted(() => ({
	loadPondSettingsDraft: vi.fn(),
	savePondSettingsDraft: vi.fn(),
	discardPondSettingsDraft: vi.fn(),
}));
const help = vi.hoisted(() => ({
	requestHelpTarget: vi.fn(),
	revealHelpTarget: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/actions/settings", () => actions);
vi.mock("@/lib/actions/pond-draft", () => draftActions);
vi.mock("@/lib/help/reveal", () => help);
vi.mock("sonner", () => ({ toast }));
vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		useRouter: () => router,
		usePathname: () => "/dashboard/settings/pond",
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string;
			children?: React.ReactNode;
		} & Record<string, unknown>) => react.createElement("a", { href, ...rest }, children),
	};
});
vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace?: string) => createTranslator(namespace ?? ""),
		useLocale: () => "en",
	};
});

import { PondSettingsForm } from "@/components/PondSettingsForm";
import { buildPondDeviceConstraints } from "@/lib/settings/pond-conflicts";
import { pondDraftKey } from "@/lib/settings/pond-draft";

const POND = {
	id: "pond-1",
	feedingRatePct: 2,
	feedsPerDay: 2,
	sampleIntervalDays: 15,
	population: 100,
	areaM2: 500,
	averageDepthM: 1.5,
	feedPricePerKg: 30,
};

const DEVICE = buildPondDeviceConstraints({
	deviceId: "device-1",
	configuredDailyCapG: 2000,
	hopperCapacityG: null,
	gramsPerSecond: 4,
	maxDispenseMs: 300_000,
	dailyCapFactor: 1,
});

function renderForm() {
	return render(<PondSettingsForm pond={POND} avgWeightKg={1} device={DEVICE} />);
}

function submit() {
	fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
}

beforeEach(() => {
	vi.clearAllMocks();
	window.sessionStorage.clear();
	actions.updatePondSettings.mockResolvedValue({ success: true });
	actions.updateDeviceDailyCap.mockResolvedValue({ success: true, dailyCapG: 2500 });
	draftActions.loadPondSettingsDraft.mockResolvedValue({ success: true, draft: null });
	draftActions.savePondSettingsDraft.mockResolvedValue({
		success: true,
		savedAt: "2026-10-30T10:00:00.000Z",
	});
	draftActions.discardPondSettingsDraft.mockResolvedValue({ success: true });
});

describe("typed values survive a failed save", () => {
	it("keeps every edited value when the server rejects the save", async () => {
		actions.updatePondSettings.mockResolvedValue({
			success: false,
			error: "At most 24 feeds per day.",
			fieldErrors: [
				{ field: "feedsPerDay", code: "feeds_max", message: "At most 24 feeds per day." },
			],
			conflicts: [],
		});
		renderForm();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "3" } });
		fireEvent.change(screen.getByLabelText("Population (fish)"), { target: { value: "120" } });
		fireEvent.change(screen.getByLabelText("Pond Area (m²)"), { target: { value: "600" } });
		submit();

		await waitFor(() => expect(actions.updatePondSettings).toHaveBeenCalled());
		expect(actions.updatePondSettings).toHaveBeenCalledWith("pond-1", 2, 3, 15, 120, {
			areaM2: 600,
			averageDepthM: 1.5,
			feedPricePerKg: 30,
		});

		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(3);
		expect(screen.getByLabelText("Population (fish)")).toHaveValue(120);
		expect(screen.getByLabelText("Pond Area (m²)")).toHaveValue(600);
		// The draft is kept for the next visit, not discarded on failure: it is
		// written to the database (I-99) after the debounce.
		await waitFor(
			() =>
				expect(draftActions.savePondSettingsDraft).toHaveBeenCalledWith(
					"pond-1",
					expect.objectContaining({ feedsPerDay: "3", population: "120", areaM2: "600" }),
				),
			{ timeout: 3000 },
		);
	});

	it("shows the server field error under the field and in the summary", async () => {
		actions.updatePondSettings.mockResolvedValue({
			success: false,
			error: "At most 24 feeds per day.",
			fieldErrors: [
				{ field: "feedsPerDay", code: "feeds_max", message: "At most 24 feeds per day." },
			],
			conflicts: [],
		});
		renderForm();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "3" } });
		submit();

		await waitFor(() =>
			expect(screen.getAllByText(/At most 24 feeds per day/).length).toBeGreaterThanOrEqual(2),
		);
		const input = screen.getByLabelText("Feeds Per Day");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAttribute("aria-describedby", "feedsPerDay-error feedsPerDay-hint");

		// The summary link moves focus to the exact field.
		const summaryLink = screen
			.getAllByRole("button", { name: /Feeds Per Day/ })
			.find((button) => button.textContent?.includes("At most 24"));
		expect(summaryLink).toBeTruthy();
		fireEvent.click(summaryLink as HTMLElement);
		expect(input).toHaveFocus();
	});

	it("validates in the browser without losing a value or calling the server", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Daily Feeding Rate (%)"), {
			target: { value: "0" },
		});
		submit();

		expect(await screen.findByText("Feeding rate must be at least 0.1%.")).toBeTruthy();
		expect(actions.updatePondSettings).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Daily Feeding Rate (%)")).toHaveValue(0);
	});

	it("clears the draft after a successful save", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "3" } });
		submit();

		await waitFor(() => expect(actions.updatePondSettings).toHaveBeenCalled());
		await waitFor(() => expect(window.sessionStorage.getItem(pondDraftKey("pond-1"))).toBeNull());
		// The database draft is dropped too, so the next visit starts from the
		// saved values (I-99).
		await waitFor(() =>
			expect(draftActions.discardPondSettingsDraft).toHaveBeenCalledWith("pond-1"),
		);
		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(3);
	});
});

describe("a restored draft", () => {
	it("brings back unsaved values and can be discarded", async () => {
		window.sessionStorage.setItem(
			pondDraftKey("pond-1"),
			JSON.stringify({
				version: 1,
				values: {
					feedingRate: "3.5",
					feedsPerDay: "4",
					sampleInterval: "20",
					population: "150",
					areaM2: "600",
					averageDepthM: "2",
					feedPricePerKg: "40",
				},
			}),
		);
		renderForm();

		expect(await screen.findByText("Restored the values you had not saved yet.")).toBeTruthy();
		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(4);

		fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(2);
		expect(window.sessionStorage.getItem(pondDraftKey("pond-1"))).toBeNull();
	});
});

const DATABASE_DRAFT = {
	values: {
		feedingRate: "3.5",
		feedsPerDay: "4",
		sampleInterval: "20",
		population: "150",
		areaM2: "600",
		averageDepthM: "2",
		feedPricePerKg: "40",
	},
	updatedAt: "2026-10-30T09:00:00.000Z",
	deviceId: "device-1",
};

const OFFLINE_DRAFT = {
	version: 1,
	values: {
		feedingRate: "3.5",
		feedsPerDay: "4",
		sampleInterval: "20",
		population: "150",
		areaM2: "600",
		averageDepthM: "2",
		feedPricePerKg: "40",
	},
};

describe("the database draft (I-99)", () => {
	it("restores the database draft with its time and discards it on request", async () => {
		draftActions.loadPondSettingsDraft.mockResolvedValue({
			success: true,
			draft: DATABASE_DRAFT,
		});
		renderForm();

		expect(await screen.findByText(/Restored your unsaved changes/)).toBeTruthy();
		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(4);

		fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

		expect(draftActions.discardPondSettingsDraft).toHaveBeenCalledWith("pond-1");
		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(2);
	});

	it("prefers the database draft over a stale offline copy", async () => {
		window.sessionStorage.setItem(
			pondDraftKey("pond-1"),
			JSON.stringify({
				version: 1,
				values: { ...OFFLINE_DRAFT.values, population: "999" },
			}),
		);
		draftActions.loadPondSettingsDraft.mockResolvedValue({
			success: true,
			draft: DATABASE_DRAFT,
		});
		renderForm();

		await waitFor(() => expect(screen.getByLabelText("Population (fish)")).toHaveValue(150));
		expect(window.sessionStorage.getItem(pondDraftKey("pond-1"))).toBeNull();
	});

	it("falls back to sessionStorage when the load action fails (offline)", async () => {
		draftActions.loadPondSettingsDraft.mockRejectedValue(new Error("offline"));
		window.sessionStorage.setItem(pondDraftKey("pond-1"), JSON.stringify(OFFLINE_DRAFT));
		renderForm();

		expect(await screen.findByText("Restored the values you had not saved yet.")).toBeTruthy();
		expect(screen.getByLabelText("Feeds Per Day")).toHaveValue(4);
	});

	it("debounces the draft write and sends the typed values", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "6" } });

		await waitFor(
			() =>
				expect(draftActions.savePondSettingsDraft).toHaveBeenCalledWith(
					"pond-1",
					expect.objectContaining({ feedsPerDay: "6" }),
				),
			{ timeout: 3000 },
		);
	});

	it("keeps a sessionStorage fallback when the draft write fails (offline)", async () => {
		draftActions.savePondSettingsDraft.mockRejectedValue(new Error("offline"));
		renderForm();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "7" } });

		await waitFor(
			() =>
				expect(window.sessionStorage.getItem(pondDraftKey("pond-1"))).toContain(
					'"feedsPerDay":"7"',
				),
			{ timeout: 3000 },
		);
	});
});

describe("device conflicts", () => {
	it("offers the pond value for the daily ceiling and applies it to the device", async () => {
		renderForm();

		// 100 fish x 1 kg x 2.5% = 2,500 g/day, over the 2,000 g device ceiling.
		fireEvent.change(screen.getByLabelText("Daily Feeding Rate (%)"), {
			target: { value: "2.5" },
		});

		const usePondValue = await screen.findByRole("button", { name: "Use pond value (2,500 g)" });
		expect(
			screen.getAllByText(
				"Pond settings win. The feeder must follow this pond, so change the device setting below.",
			).length,
		).toBeGreaterThan(0);

		fireEvent.click(usePondValue);

		await waitFor(() =>
			expect(actions.updateDeviceDailyCap).toHaveBeenCalledWith("device-1", 2500),
		);
	});

	it("links to the exact device setting for a conflict it cannot fix", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "1" } });

		const links = await screen.findAllByRole("link", { name: /Open the device setting/ });
		const calibration = links.find(
			(link) => link.getAttribute("href") === "/dashboard/settings/hardware#calibration",
		);
		expect(calibration).toBeTruthy();

		fireEvent.click(calibration as HTMLElement);
		expect(help.requestHelpTarget).toHaveBeenCalledWith(
			"calibration-form",
			"/dashboard/settings/hardware",
		);
	});

	it("says the saved plan was already over the relay window (#430)", async () => {
		// One meal of 2,000 g is over the 1,200 g window, and the saved plan
		// asked for 2,500 g — so the conflict is not the reader's doing.
		render(
			<PondSettingsForm
				pond={{ ...POND, population: 200 }}
				avgWeightKg={1}
				device={DEVICE}
				savedPerMealG={2500}
			/>,
		);

		expect(
			await screen.findByText(
				"The saved pond settings already ask for 2,500 g per meal — more than the 1,200 g this feeder can run in one relay window. Your change did not cause this.",
			),
		).toBeTruthy();
	});

	it("does not blame the reader when the saved plan still fitted", async () => {
		render(
			<PondSettingsForm
				pond={{ ...POND, population: 200 }}
				avgWeightKg={1}
				device={DEVICE}
				savedPerMealG={900}
			/>,
		);

		await screen.findAllByText(/One meal is longer than the relay window/);
		expect(screen.queryByText(/The saved pond settings already ask for/)).toBeNull();
	});
});
