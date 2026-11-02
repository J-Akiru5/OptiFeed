/**
 * Water temperature is calibrated **on the device**, not in the app (#622).
 *
 * The firmware adds the stored offset before it transmits
 * (`firmware-main.ino`: `doc["water_temp_c"] = rawTempC + deviceConfig.tempOffsetC`),
 * and ingest stores that value verbatim. Every display surface must therefore
 * render `waterTempC` as-is; adding `tempOffsetC` again shows a temperature
 * that is wrong by a full offset and makes each calibration cycle worse.
 *
 * The calibration form is the one place that needs the sensor's own value and a
 * preview of the next one. It derives both from the reported value and the
 * stored offset, so there is still exactly one application of the offset in the
 * whole system — on the device.
 */

/**
 * The sensor's own value: the reported reading with the stored offset removed.
 * Returns `NaN` for a non-finite input; callers treat that as "no reading".
 */
export function rawWaterTempC(reportedC: number, appliedOffsetC: number): number {
	if (!Number.isFinite(reportedC)) return Number.NaN;
	return reportedC - (Number.isFinite(appliedOffsetC) ? appliedOffsetC : 0);
}

/**
 * What the device will transmit once `draftOffsetC` replaces the stored offset.
 * At `draftOffsetC === appliedOffsetC` this equals `reportedC` exactly.
 */
export function previewWaterTempC(
	reportedC: number,
	appliedOffsetC: number,
	draftOffsetC: number,
): number {
	const raw = rawWaterTempC(reportedC, appliedOffsetC);
	if (!Number.isFinite(raw) || !Number.isFinite(draftOffsetC)) return Number.NaN;
	return raw + draftOffsetC;
}
