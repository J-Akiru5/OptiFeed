import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The shared calibration number field (issue #307).
 *
 * The form used to store numbers, so clearing a field ran `Number("")`, put the
 * zero back, and made the input impossible to retype. These checks pin the
 * string-based contract, the whole-unit stepper and the min/max/precision
 * rules every calibration form now shares.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

import {
	CalibrationNumberField,
	type CalibrationNumberRules,
	parseCalibrationNumber,
	stepCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";

afterEach(cleanup);

const FULL_CM: CalibrationNumberRules = { min: 0, max: 100, decimals: 0, step: 1 };

describe("parseCalibrationNumber", () => {
	it("treats an empty field as empty, never as zero", () => {
		expect(parseCalibrationNumber("", FULL_CM)).toEqual({ status: "empty" });
		expect(parseCalibrationNumber("   ", FULL_CM)).toEqual({ status: "empty" });
	});

	it("rejects junk instead of coercing it", () => {
		expect(parseCalibrationNumber("abc", FULL_CM)).toEqual({
			status: "invalid",
			reason: "format",
		});
		expect(parseCalibrationNumber("1e3", FULL_CM)).toEqual({
			status: "invalid",
			reason: "format",
		});
		expect(parseCalibrationNumber("12cm", FULL_CM)).toEqual({
			status: "invalid",
			reason: "format",
		});
	});

	it("enforces min and max", () => {
		expect(parseCalibrationNumber("-1", FULL_CM)).toEqual({ status: "invalid", reason: "range" });
		expect(parseCalibrationNumber("101", FULL_CM)).toEqual({
			status: "invalid",
			reason: "range",
		});
		expect(parseCalibrationNumber("0", FULL_CM)).toEqual({ status: "valid", value: 0 });
		expect(parseCalibrationNumber("100", FULL_CM)).toEqual({ status: "valid", value: 100 });
	});

	it("rejects more precision than the field accepts", () => {
		expect(parseCalibrationNumber("1.5", FULL_CM)).toEqual({
			status: "invalid",
			reason: "precision",
		});
		expect(parseCalibrationNumber("4.25", { min: 0, max: 50, decimals: 2 })).toEqual({
			status: "valid",
			value: 4.25,
		});
	});

	it("accepts a comma decimal separator and surrounding spaces", () => {
		expect(parseCalibrationNumber(" 4,5 ", { min: 0, max: 50, decimals: 1 })).toEqual({
			status: "valid",
			value: 4.5,
		});
	});
});

describe("stepCalibrationNumber", () => {
	it("moves whole centimetres one unit at a time", () => {
		let value = "1";
		const seen: string[] = [];
		for (let press = 0; press < 3; press += 1) {
			value = stepCalibrationNumber(value, 1, FULL_CM);
			seen.push(value);
		}
		expect(seen).toEqual(["2", "3", "4"]);
	});

	it("starts one step inside the range when the field is empty", () => {
		expect(stepCalibrationNumber("", 1, FULL_CM)).toBe("1");
		expect(stepCalibrationNumber("", -1, FULL_CM)).toBe("99");
	});

	it("clamps at the bounds", () => {
		expect(stepCalibrationNumber("100", 1, FULL_CM)).toBe("100");
		expect(stepCalibrationNumber("0", -1, FULL_CM)).toBe("0");
	});

	it("steps fractional fields by 0.1 without float drift", () => {
		const rate: CalibrationNumberRules = { min: 0.5, max: 50, decimals: 2, step: 0.1 };
		expect(stepCalibrationNumber("4.2", 1, rate)).toBe("4.3");
		expect(stepCalibrationNumber("4.2", -1, rate)).toBe("4.1");
	});
});

function FieldHarness({
	initialValue,
	...rules
}: { initialValue: string } & CalibrationNumberRules) {
	const [value, setValue] = useState(initialValue);
	return (
		<CalibrationNumberField
			id="harness-field"
			label="Full distance"
			unit="cm"
			value={value}
			onValueChange={setValue}
			{...rules}
		/>
	);
}

describe("CalibrationNumberField", () => {
	it("lets a zero be cleared and retyped", () => {
		render(<FieldHarness initialValue="0" {...FULL_CM} />);

		const input = screen.getByLabelText("Full distance");
		expect(input).toHaveValue(0);

		fireEvent.change(input, { target: { value: "" } });
		expect(input).toHaveValue(null);

		fireEvent.change(input, { target: { value: "1" } });
		expect(input).toHaveValue(1);
	});

	it("steps with accessible buttons clamped to the max", () => {
		render(<FieldHarness initialValue="99" {...FULL_CM} />);

		const input = screen.getByLabelText("Full distance");
		const increase = screen.getByRole("button", { name: "Increase Full distance" });
		const decrease = screen.getByRole("button", { name: "Decrease Full distance" });

		fireEvent.click(increase);
		expect(input).toHaveValue(100);
		fireEvent.click(increase);
		expect(input).toHaveValue(100);
		fireEvent.click(decrease);
		expect(input).toHaveValue(99);
	});

	it("announces a value outside min/max and links the message", () => {
		render(<FieldHarness initialValue="500" {...FULL_CM} />);

		const input = screen.getByLabelText("Full distance");
		const error = screen.getByRole("alert");
		expect(error).toHaveTextContent("Enter a value from 0 to 100.");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input.getAttribute("aria-describedby")).toContain(error.id);
	});

	it("rejects fractional input in a whole-unit field", () => {
		render(<FieldHarness initialValue="1.5" {...FULL_CM} />);

		expect(screen.getByRole("alert")).toHaveTextContent("Use whole numbers only.");
	});

	it("uses numeric input mode for whole units and decimal for fractions", () => {
		const { unmount } = render(<FieldHarness initialValue="5" {...FULL_CM} />);
		expect(screen.getByLabelText("Full distance")).toHaveAttribute("inputMode", "numeric");
		expect(screen.getByLabelText("Full distance")).toHaveAttribute("step", "1");
		unmount();

		render(<FieldHarness initialValue="4.5" min={0} max={50} decimals={1} step={0.1} />);
		expect(screen.getByLabelText("Full distance")).toHaveAttribute("inputMode", "decimal");
		expect(screen.getByLabelText("Full distance")).toHaveAttribute("step", "0.1");
	});
});
