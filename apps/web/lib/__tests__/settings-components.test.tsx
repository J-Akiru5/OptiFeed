import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/energy", () => ({
	saveHopperCalibration: vi.fn(),
	saveTemperatureCalibration: vi.fn(),
}));
vi.mock("@/lib/actions/password", () => ({ changeOwnPassword: vi.fn() }));

import { HopperCalibrationForm } from "@/components/HopperCalibrationForm";
import { LiveClock } from "@/components/LiveClock";
import { TemperatureCalibrationForm } from "@/components/TemperatureCalibrationForm";
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
		expect(html).toContain("Hopper Capacity (grams)");
		expect(html).toContain("Sensor reading when hopper is full");
		expect(html).toContain("min-h-11");
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
