import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Component-level checks for the T-09d settings forms: units in the labels,
 * errors announced to assistive technology, and the header clock using the
 * shared date helper instead of the browser locale.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/energy", () => ({
	saveHopperCalibration: vi.fn(),
	saveTemperatureCalibration: vi.fn(),
	saveDurationCalibration: vi.fn(),
}));
vi.mock("@/lib/actions/calibration", () => ({
	getCalibrationTestStatus: vi.fn(),
	runCalibrationTest: vi.fn(),
	runTargetCheck: vi.fn(),
	saveCalibrationFromTest: vi.fn(),
	saveRecalibrationInterval: vi.fn(),
	submitTargetCheck: vi.fn(),
}));
vi.mock("@/lib/actions/password", () => ({ changeOwnPassword: vi.fn() }));

import { DurationCalibrationForm } from "@/components/DurationCalibrationForm";
import { HopperCalibrationForm } from "@/components/HopperCalibrationForm";
import { LiveClock } from "@/components/LiveClock";
import { TemperatureCalibrationForm } from "@/components/TemperatureCalibrationForm";
import { RecalibrationIntervalForm } from "@/components/calibration/RecalibrationIntervalForm";
import { ChangePasswordForm } from "@/components/change-password-form";
import { saveHopperCalibration } from "@/lib/actions/energy";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("hopper calibration form", () => {
	it("labels each input with its unit and keeps 44 px controls", () => {
		const html = renderToStaticMarkup(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={5}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
			/>,
		);

		expect(html).toContain("Full Distance (cm)");
		expect(html).toContain("Empty Distance (cm)");
		expect(html).toContain("Tank Diameter (cm)");
		expect(html).toContain("Feed Density (g/cm³)");
		expect(html).toContain("Sensor reading when hopper is full");
		expect(html).toContain("min-h-11");
	});

	it("computes the capacity from the tank diameter (issue #415)", () => {
		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={5}
				hopperEmptyCm={30}
				hopperCapacityG={4750}
			/>,
		);

		// Before a diameter is known the stored capacity is kept and shown.
		expect(screen.getByTestId("hopper-capacity-summary")).toHaveTextContent("4,750 g");

		fireEvent.change(screen.getByLabelText("Tank Diameter (cm)"), { target: { value: "20" } });

		// 20 cm tank, 25 cm usable height, 0.65 g/cm³ default: 5,105 g.
		const summary = screen.getByTestId("hopper-capacity-summary");
		expect(summary).toHaveTextContent("5,105 g");
		expect(summary).toHaveTextContent("7.85 L");
		expect(summary).toHaveTextContent("0.65 g/cm³");
	});

	it("sends the geometry so the server recomputes the capacity", async () => {
		vi.mocked(saveHopperCalibration).mockResolvedValue({ success: true });

		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={5}
				hopperEmptyCm={30}
				hopperCapacityG={4750}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Tank Diameter (cm)"), { target: { value: "20" } });
		// A measured feed density overrides the default.
		fireEvent.change(screen.getByLabelText("Feed Density (g/cm³)"), {
			target: { value: "0.6" },
		});
		expect(screen.getByTestId("hopper-capacity-summary")).toHaveTextContent("4,712 g");

		fireEvent.click(screen.getByRole("button", { name: "Save Calibration" }));

		await waitFor(() =>
			expect(saveHopperCalibration).toHaveBeenCalledWith("dev-1", {
				hopperFullCm: 5,
				hopperEmptyCm: 30,
				hopperDiameterCm: 20,
				hopperBulkDensityGCm3: 0.6,
			}),
		);
	});

	it("announces a save failure with role=alert", async () => {
		vi.mocked(saveHopperCalibration).mockResolvedValue({
			success: false,
			error: "Could not save the calibration.",
		});

		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={5}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Calibration" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the calibration.");
	});

	it("lets a zero distance be cleared and retyped (issue #307)", async () => {
		vi.mocked(saveHopperCalibration).mockResolvedValue({ success: true });

		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={0}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
			/>,
		);

		const full = screen.getByLabelText("Full Distance (cm)");
		expect(full).toHaveValue(0);

		// The old numeric state ran Number("") → 0, which put the zero straight
		// back and made the field impossible to clear.
		fireEvent.change(full, { target: { value: "" } });
		expect(full).toHaveValue(null);

		fireEvent.change(full, { target: { value: "1" } });
		expect(full).toHaveValue(1);

		fireEvent.click(screen.getByRole("button", { name: "Save Calibration" }));

		await waitFor(() =>
			expect(saveHopperCalibration).toHaveBeenCalledWith("dev-1", {
				hopperFullCm: 1,
				hopperEmptyCm: 30,
				hopperCapacityG: 7000,
			}),
		);
	});

	it("steps the hopper distance in whole centimetres (issue #307)", () => {
		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={1}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
			/>,
		);

		const full = screen.getByLabelText("Full Distance (cm)");
		const increase = screen.getByRole("button", { name: "Increase Full Distance (cm)" });

		expect(full).toHaveAttribute("step", "1");
		expect(full).toHaveAttribute("inputMode", "decimal");

		fireEvent.click(increase);
		expect(full).toHaveValue(2);
		fireEvent.click(increase);
		expect(full).toHaveValue(3);
		fireEvent.click(increase);
		expect(full).toHaveValue(4);
	});

	it("accepts one decimal for a hopper distance (owner decision, 2026-10-29)", async () => {
		vi.mocked(saveHopperCalibration).mockResolvedValue({ success: true });

		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={12.3}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
			/>,
		);

		const full = screen.getByLabelText("Full Distance (cm)");
		expect(full).toHaveValue(12.3);

		fireEvent.click(screen.getByRole("button", { name: "Save Calibration" }));

		await waitFor(() =>
			expect(saveHopperCalibration).toHaveBeenCalledWith("dev-1", {
				hopperFullCm: 12.3,
				hopperEmptyCm: 30,
				hopperCapacityG: 7000,
			}),
		);
	});

	it("lays the numeric fields out in a responsive three-column grid", () => {
		const { container } = render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={5}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
			/>,
		);

		const grid = container.querySelector("div.grid");
		expect(grid).not.toBeNull();
		expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2", "xl:grid-cols-3");
	});

	it("refuses a hopper whose empty distance is not greater than the full distance", () => {
		render(
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={30}
				hopperEmptyCm={5}
				hopperCapacityG={7000}
			/>,
		);

		expect(screen.getByRole("alert")).toHaveTextContent(
			"The empty distance must be greater than the full distance.",
		);
		expect(screen.getByRole("button", { name: "Save Calibration" })).toBeDisabled();
	});
});

describe("temperature calibration form", () => {
	it("labels the offset with °C and previews the raw and calibrated reading", () => {
		const html = renderToStaticMarkup(
			<TemperatureCalibrationForm deviceId="dev-1" currentTempOffsetC={-0.7} currentTempC={28.5} />,
		);

		expect(html).toContain("Temperature Offset (°C)");
		expect(html).toContain("Raw reading");
		expect(html).toContain("28.5°C");
		expect(html).toContain("27.8°C");
		expect(html).toContain('aria-live="polite"');
	});

	it("can clear a zero offset and retype it", () => {
		render(
			<TemperatureCalibrationForm deviceId="dev-1" currentTempOffsetC={0} currentTempC={28.5} />,
		);

		const offset = screen.getByLabelText("Temperature Offset (°C)");
		fireEvent.change(offset, { target: { value: "" } });
		expect(offset).toHaveValue(null);
	});

	it("lays the offset and preview out in the shared three-column grid", () => {
		const { container } = render(
			<TemperatureCalibrationForm deviceId="dev-1" currentTempOffsetC={0} currentTempC={28.5} />,
		);

		const grid = container.querySelector("div.grid");
		expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2", "xl:grid-cols-3");
	});
});

describe("duration calibration form", () => {
	it("uses the shared numeric pattern for every input", () => {
		const { container } = render(
			<DurationCalibrationForm
				deviceId="dev-1"
				currentGramsPerSecond={4.25}
				currentGramsPerFeeding={150}
			/>,
		);

		expect(screen.getByLabelText("Test duration (seconds)")).toHaveAttribute("step", "1");
		expect(screen.getByLabelText("Target dose (grams)")).toHaveAttribute("step", "0.1");
		expect(screen.getByLabelText("Grams per second (g/s)")).toHaveAttribute("step", "0.1");
		// A stored two-decimal rate must not open the manual field invalid.
		expect(screen.getByLabelText("Grams per second (g/s)")).toHaveValue(4.25);
		expect(screen.getByLabelText("Grams per second (g/s)")).not.toHaveAttribute("aria-invalid");
		expect(container.querySelectorAll("div.grid").length).toBeGreaterThanOrEqual(3);
	});
});

describe("recalibration interval form", () => {
	it("can clear the day count and retype it", () => {
		render(<RecalibrationIntervalForm deviceId="dev-1" currentIntervalDays={30} />);

		const days = screen.getByLabelText("Recalibrate every (days)");
		expect(days).toHaveValue(30);

		fireEvent.change(days, { target: { value: "" } });
		expect(days).toHaveValue(null);

		fireEvent.change(days, { target: { value: "45" } });
		expect(days).toHaveValue(45);
		expect(screen.getByRole("button", { name: "Save interval" })).toBeEnabled();
	});
});

describe("change password form", () => {
	it("announces validation errors with role=alert", () => {
		render(<ChangePasswordForm />);

		const form = screen.getByRole("button", { name: "Update password" }).closest("form");
		expect(form).not.toBeNull();
		fireEvent.submit(form as HTMLFormElement);

		expect(screen.getByRole("alert")).toHaveTextContent("Current password is incorrect.");
	});
});

describe("LiveClock", () => {
	it("renders the localized time from lib/date-local", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-08T16:19:00"));

		render(<LiveClock />);

		expect(screen.getByText("4:19 PM")).toBeInTheDocument();
	});

	it("does not use the browser's toLocaleTimeString", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const source = readFileSync(join(__dirname, "../../components/LiveClock.tsx"), "utf8");
		expect(source).not.toContain("toLocaleTimeString");
		expect(source).toContain("formatDateTimeLocal");
	});
});
