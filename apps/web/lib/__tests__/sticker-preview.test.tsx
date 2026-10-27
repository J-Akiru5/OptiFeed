import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string, values?: Record<string, unknown>) => {
		const strings: Record<string, string> = {
			"rating.title": "Sticker rating",
			"rating.intro": "These numbers print on every sticker.",
			"rating.voltage": "Voltage (V)",
			"rating.frequency": "Frequency (Hz)",
			"rating.current": "Max current (A)",
			"rating.power": "Max power (VA)",
			"rating.powerOverride": "Override the computed VA",
			"rating.powerHint": "V × A, rounded.",
			"rating.measured": "Measured with a meter",
			"rating.measuredOn": "Measurement date",
			"rating.perPrint": "Changes apply to this print only.",
			"rating.clear": "Clear override",
			"rating.defaultTitle": "Default for all stickers",
			"rating.defaultBody": "Save the rating above as the default.",
			"rating.reason": "Reason",
			"rating.reasonHint": "At least 10 characters.",
			"rating.save": "Save as default",
			"rating.reset": "Reset to label values",
			"rating.saving": "Saving…",
			"rating.saved": "Saved as the default sticker rating.",
			"rating.cleared": "Sticker rating reset to the label values.",
			"rating.failed": "Could not change the sticker rating. Try again.",
			"rating.needReason": "A reason of at least 10 characters is required.",
			"rating.needDate": "Enter the measurement date.",
			"warning.enteredTitle": "Rating entered by hand.",
			"warning.enteredBody": "Values entered by {role}; not measured.",
			"warning.enteredHint": "Measure the current with a multimeter.",
			"warning.measuredTitle": "Measured rating.",
			"warning.measuredBody": "Measured with a meter on {date}.",
			"warning.measuredNoDate": "Measured with a meter.",
			verifyTitle: "Check before you print.",
			verifyIntro: "Estimated values ({volts} V, {hz} Hz, {amps} A).",
			verifyReadLabels: "Read the labels.",
			verifyMeasure: "Measure the current.",
			verifyPower: "Max power is V × A = {power} {unit}.",
		};
		let text = strings[key] ?? key;
		for (const [token, value] of Object.entries(values ?? {})) {
			text = text.replace(`{${token}}`, String(value));
		}
		return text;
	},
}));

const { saveDefault, clearDefault } = vi.hoisted(() => ({
	saveDefault: vi.fn(),
	clearDefault: vi.fn(),
}));

vi.mock("@/lib/actions/platform/settings", () => ({
	setStickerRatingDefault: saveDefault,
	clearStickerRatingDefault: clearDefault,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { StickerPreview } from "@/components/admin/sticker-preview";
import { LABEL_STICKER_RATING, type ResolvedStickerRating } from "@/lib/constants/sticker-rating";
import { toast } from "sonner";

const stickerStrings = {
	subtitle: "Precision Feeder Unit",
	tag: "{type} input only",
	tagAc: "AC input",
	sectionRating: "Power rating",
	input: "Input",
	current: "Current",
	power: "Power",
	max: "max",
	unitId: "Unit ID",
	stepScan: "Scan the QR and join {ssid}",
	stepPortal: "Open {address} if the page does not appear",
	stepSave: "Enter farm Wi-Fi and device details, then Save",
	noteTitle: "No setup network showing?",
	noteBody: "Hold the Wi-Fi reset button for 5 s to reopen setup.",
	scan: "Scan to set up Wi-Fi",
	qrLabel: "Wi-Fi setup QR code",
	footerSupply: "{type} supply only",
	footerUnplug: "Unplug before servicing",
	footerDry: "Keep dry",
};

const LABEL: ResolvedStickerRating = {
	...LABEL_STICKER_RATING,
	source: "estimated",
	enteredBy: null,
};

const SAVED: ResolvedStickerRating = {
	voltageV: 230,
	frequencyHz: 60,
	currentA: 1.1,
	powerVA: 253,
	measured: false,
	measuredAt: null,
	source: "entered",
	enteredBy: "platform",
};

function renderPreview(overrides: Partial<Parameters<typeof StickerPreview>[0]> = {}) {
	return render(
		<StickerPreview
			devices={[{ id: "dev-a1", mac: "A4:CF:12:7E:3B:09" }]}
			stickerStrings={stickerStrings}
			initialRating={LABEL}
			defaultRating={LABEL}
			actorRoleLabel="Owner"
			platformAdminRoleLabel="Platform admin"
			canSaveDefault={false}
			initialOverride={false}
			{...overrides}
		/>,
	);
}

function stickerText(container: HTMLElement): string {
	const sticker = container.querySelector(".pk-sticker");
	return (sticker?.innerHTML ?? "").replace(/<[^>]+>/g, "");
}

beforeEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/admin/devices/labels?id=dev-a1");
	saveDefault.mockResolvedValue({ success: true });
	clearDefault.mockResolvedValue({ success: true });
});

describe("rating warning follows the source", () => {
	it("shows the estimated warning for the label values", () => {
		renderPreview();

		expect(screen.getByText("Check before you print.")).toBeInTheDocument();
		expect(screen.getByText(/Estimated values \(220 V, 60 Hz, 1.2 A\)/)).toBeInTheDocument();
	});

	it("names the role when values were entered by hand", () => {
		renderPreview({ initialRating: SAVED, defaultRating: SAVED });

		expect(screen.getByText("Values entered by Platform admin; not measured.")).toBeInTheDocument();
		expect(screen.queryByText("Check before you print.")).not.toBeInTheDocument();
	});

	it("shows a neutral measured note with the date", () => {
		renderPreview({
			initialRating: {
				...LABEL,
				measured: true,
				measuredAt: "2026-10-27",
				source: "measured",
			},
		});

		expect(screen.getByText("Measured rating.")).toBeInTheDocument();
		expect(screen.getByText("Measured with a meter on 2026-10-27.")).toBeInTheDocument();
		expect(screen.queryByText("Check before you print.")).not.toBeInTheDocument();
	});
});

describe("live preview", () => {
	it("updates every sticker when a value changes and marks the source as entered", () => {
		const { container } = renderPreview();

		fireEvent.change(screen.getByLabelText("Voltage (V)"), { target: { value: "230" } });

		expect(stickerText(container)).toContain("230 V");
		expect(screen.getByText("Values entered by Owner; not measured.")).toBeInTheDocument();
		expect(new URLSearchParams(window.location.search).get("voltage")).toBe("230");
		expect(new URLSearchParams(window.location.search).get("id")).toBe("dev-a1");
	});

	it("recomputes the VA from V × A while the override is off", () => {
		const { container } = renderPreview();

		fireEvent.change(screen.getByLabelText("Voltage (V)"), { target: { value: "230" } });

		// 230 × 1.2 = 276
		expect(screen.getByLabelText("Max power (VA)")).toHaveValue(276);
		expect(stickerText(container)).toContain("276 VA");
	});

	it("lets an admin type the VA when the override is on", () => {
		const { container } = renderPreview();

		fireEvent.click(screen.getByLabelText("Override the computed VA"));
		fireEvent.change(screen.getByLabelText("Max power (VA)"), { target: { value: "300" } });

		expect(stickerText(container)).toContain("300 VA");
		expect(new URLSearchParams(window.location.search).get("va")).toBe("300");
	});

	it("switches to the measured note when the meter box is ticked", () => {
		renderPreview();

		fireEvent.click(screen.getByLabelText("Measured with a meter"));

		expect(screen.getByText("Measured rating.")).toBeInTheDocument();
		expect(screen.getByText(/Measured with a meter on \d{4}-\d{2}-\d{2}\./)).toBeInTheDocument();
	});

	it("clears the URL override back to the saved default", () => {
		renderPreview({
			initialRating: { ...SAVED, source: "entered", enteredBy: "actor" },
			defaultRating: SAVED,
		});

		fireEvent.change(screen.getByLabelText("Voltage (V)"), { target: { value: "240" } });
		fireEvent.click(screen.getByRole("button", { name: "Clear override" }));

		expect(screen.getByLabelText("Voltage (V)")).toHaveValue(230);
		expect(screen.getByText("Values entered by Platform admin; not measured.")).toBeInTheDocument();
		expect(new URLSearchParams(window.location.search).get("voltage")).toBeNull();
	});
});

describe("default for all stickers", () => {
	it("is only offered to platform admins", () => {
		renderPreview();
		expect(screen.queryByText("Default for all stickers")).not.toBeInTheDocument();
	});

	it("saves the current values with a reason", async () => {
		renderPreview({ canSaveDefault: true });

		fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
			target: { value: "Measured on the bench" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save as default" }));

		await waitFor(() =>
			expect(saveDefault).toHaveBeenCalledWith(
				{
					voltageV: 220,
					frequencyHz: 60,
					currentA: 1.2,
					powerVA: 264,
					measured: false,
					measuredAt: null,
				},
				"Measured on the bench",
			),
		);
		expect(toast.success).toHaveBeenCalled();
	});

	it("does not call the action without a reason", () => {
		renderPreview({ canSaveDefault: true });

		fireEvent.click(screen.getByRole("button", { name: "Save as default" }));

		expect(saveDefault).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith("A reason of at least 10 characters is required.");
	});

	it("resets the default and returns the preview to the label values", async () => {
		const { container } = renderPreview({
			initialRating: SAVED,
			defaultRating: SAVED,
			canSaveDefault: true,
		});

		fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
			target: { value: "Measured on the bench" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Reset to label values" }));

		await waitFor(() => expect(clearDefault).toHaveBeenCalledWith("Measured on the bench"));
		expect(stickerText(container)).toContain("220 V");
		expect(screen.getByText("Check before you print.")).toBeInTheDocument();
	});
});
