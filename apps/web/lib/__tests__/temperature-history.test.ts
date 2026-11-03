import { describe, expect, it } from "vitest";

import { readTemperatureCalibration } from "@/lib/calibration/temperature-history";

/**
 * The `temperature_calibrated` metadata is a Json column (#613), so every shape
 * has to be tolerated: the page must render the row rather than throw.
 */

describe("readTemperatureCalibration", () => {
	it("reads the offset and the feeding minimum", () => {
		expect(readTemperatureCalibration({ tempOffsetC: -0.7, minFeedTempC: 24 })).toEqual({
			offsetC: -0.7,
			minFeedTempC: 24,
		});
	});

	it("keeps a missing minimum null", () => {
		expect(readTemperatureCalibration({ tempOffsetC: 0.5 })).toEqual({
			offsetC: 0.5,
			minFeedTempC: null,
		});
	});

	it("rejects non-numeric values instead of rendering NaN", () => {
		expect(readTemperatureCalibration({ tempOffsetC: "cold", minFeedTempC: Number.NaN })).toEqual({
			offsetC: null,
			minFeedTempC: null,
		});
	});

	it("tolerates a null, array or primitive metadata value", () => {
		expect(readTemperatureCalibration(null)).toEqual({ offsetC: null, minFeedTempC: null });
		expect(readTemperatureCalibration([])).toEqual({ offsetC: null, minFeedTempC: null });
		expect(readTemperatureCalibration("x")).toEqual({ offsetC: null, minFeedTempC: null });
	});
});
