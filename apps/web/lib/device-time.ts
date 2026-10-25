/**
 * `<input type="datetime-local">` values are wall-clock values with no zone.
 * The app stores and sends absolute UTC instants, so both directions need an
 * explicit conversion. Treating the input value as UTC shifts the clock by the
 * browser's offset (8 hours in the Philippines) — issue #149.
 */

/** Format an instant as the local wall time a datetime-local input expects. */
export function toLocalDateTimeInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}

/**
 * Convert a datetime-local value (local wall time) to the absolute UTC instant
 * sent to the server and the device. Returns null for an invalid value.
 */
export function localDateTimeToIso(value: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}
