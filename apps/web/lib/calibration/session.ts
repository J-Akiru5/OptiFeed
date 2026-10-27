/**
 * Calibration session ids group the attempts of one sitting (issue #191).
 *
 * The client generates the id (crypto.randomUUID()) and sends it with every
 * attempt in the sitting. The server only accepts an actual UUID or cuid/cuid2
 * token, never an arbitrary string, so the value cannot carry markup, SQL
 * fragments or an oversized payload into the history table.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_PATTERN = /^c[0-9a-z]{24}$/;
const CUID2_PATTERN = /^[a-z][0-9a-z]{23,31}$/;

export function isValidCalibrationSessionId(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return UUID_PATTERN.test(value) || CUID_PATTERN.test(value) || CUID2_PATTERN.test(value);
}
