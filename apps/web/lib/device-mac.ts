/**
 * Canonical form of a device MAC: six uppercase hex pairs joined by colons,
 * e.g. "A4:CF:12:7E:3B:09".
 *
 * Accepts the common spellings (colons, dashes, dots, spaces or none, any
 * case) and returns null for anything that is not exactly 12 hex digits once
 * those separators are removed. `EnergyDevice.mac` is compared exactly by the
 * device API routes, so registrations must always store this form.
 */
export function canonicalMac(input: string): string | null {
	const trimmed = input.trim();
	if (!/^[0-9a-fA-F:.\-\s]+$/.test(trimmed)) return null;
	const hex = trimmed.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
	if (hex.length !== 12) return null;
	return hex.match(/.{2}/g)?.join(":") ?? null;
}
