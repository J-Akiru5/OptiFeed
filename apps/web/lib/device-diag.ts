/**
 * Heartbeat diagnostics sanitizer (issue #454).
 *
 * Firmware 1.6.0+ may include a `diag` object on every heartbeat. It is purely
 * diagnostic: it must never become an authority for dosing, and it must never
 * be able to bloat the device row or smuggle unexpected shapes into the JSON
 * column. Keep it:
 *
 * - a flat-ish object of primitive values (string / number / boolean / null);
 * - arrays allowed only of primitives, length-capped;
 * - one nesting level max (nested objects are replaced with "[object]");
 * - string values truncated; obscure values replaced;
 * - at most DIAG_KEYS_MAX keys and about DIAG_BYTES_MAX bytes of JSON.
 *
 * On anything malformed the whole object is dropped (same advisory policy as
 * `wifi_rssi` / `config_rev`: one buggy heartbeat field must never cost the
 * device its connectivity).
 */

export const DIAG_KEYS_MAX = 24;
export const DIAG_STRING_MAX = 120;
export const DIAG_ARRAY_MAX = 8;
export const DIAG_BYTES_MAX = 2048;
export const DIAG_DEPTH_MAX = 1; // top-level object; nested objects replaced

type Primitive = string | number | boolean | null;

function capPrimitive(value: unknown): Primitive | undefined {
	if (value === null) return null;
	switch (typeof value) {
		case "string":
			return value.length > DIAG_STRING_MAX ? value.slice(0, DIAG_STRING_MAX) : value;
		case "number":
			return Number.isFinite(value) ? value : undefined;
		case "boolean":
			return value;
		default:
			return undefined;
	}
}

/**
 * Returns the sanitised diagnostics object, or null when the heartbeat's diag
 * is absent or unusable ("null" is a valid outcome — the route writes nothing,
 * keeping the last known diagnostics).
 */
export function sanitizeDiag(value: unknown): Record<string, Primitive | Primitive[]> | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object" || Array.isArray(value)) return null;

	const source = value as Record<string, unknown>;
	const cleaned: Record<string, Primitive | Primitive[]> = {};
	let bytes = 0;

	for (const [key, raw] of Object.entries(source).slice(0, DIAG_KEYS_MAX)) {
		// Keys are capped too: firmware ids stay short.
		const safeKey = key.length > DIAG_STRING_MAX ? key.slice(0, DIAG_STRING_MAX) : key;
		let entry: Primitive | Primitive[] | undefined;

		if (Array.isArray(raw)) {
			const items = raw
				.slice(0, DIAG_ARRAY_MAX)
				.map(capPrimitive)
				.filter((item): item is Primitive => item !== undefined);
			entry = items.length > 0 ? items : undefined;
		} else {
			const primitive = capPrimitive(raw);
			if (primitive !== undefined) {
				entry = primitive;
			} else if (
				raw !== null &&
				raw !== undefined &&
				typeof raw === "object" &&
				!Array.isArray(raw)
			) {
				// Real nested object; a dropped number/boolean leaves nothing.
				entry = "[object]";
			}
		}

		if (entry === undefined) continue;
		cleaned[safeKey] = entry;
		bytes += safeKey.length + JSON.stringify(entry).length;
		if (bytes > DIAG_BYTES_MAX) break;
	}

	if (Object.keys(cleaned).length === 0) return null;
	if (bytes > DIAG_BYTES_MAX) return null;
	return cleaned;
}
