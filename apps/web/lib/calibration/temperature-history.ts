/**
 * Temperature calibration history (#613).
 *
 * `saveTemperatureCalibration` already appends a `DeviceStateEvent` with
 * `eventType: "temperature_calibrated"`; the hardware page's calibration
 * history only read `CalibrationRun` (the hopper rate tests), so the save never
 * appeared there. This module reads the stored metadata defensively: the JSON
 * column is untyped, and a row written by an older/newer version must not break
 * the page.
 */

export interface TemperatureCalibrationRecord {
	/** The saved offset in °C, or null when the metadata is unusable. */
	offsetC: number | null;
	/** The pond's warn-only feeding minimum, or null when it is not set. */
	minFeedTempC: number | null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readTemperatureCalibration(metadata: unknown): TemperatureCalibrationRecord {
	if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
		return { offsetC: null, minFeedTempC: null };
	}

	const record = metadata as Record<string, unknown>;
	return {
		offsetC: finiteNumber(record.tempOffsetC),
		minFeedTempC: finiteNumber(record.minFeedTempC),
	};
}
