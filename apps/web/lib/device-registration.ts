import { generateDeviceToken, hashToken } from "@/lib/device-auth";
import { canonicalMac } from "@/lib/device-mac";

/**
 * Shared device-registration rules for the two registration paths: the
 * superadmin platform registry (god mode) and the tenant Admin → Devices
 * "Add feeder" flow (issue #190).
 *
 * The platform path keeps its own guards — platform admin, reason, step-up,
 * audit — and only borrows validation and credential minting from here, so
 * extracting this helper cannot widen what a tenant admin can do.
 */

export const MAX_DEVICE_LABEL_LENGTH = 64;

export const INVALID_MAC_MESSAGE = "Enter the 12-digit MAC, for example A4:CF:12:7E:3B:09.";
export const MISSING_LABEL_MESSAGE = "A device label is required.";
export const DUPLICATE_MAC_MESSAGE = "A device with this MAC is already registered.";

export type ValidatedDeviceRegistration =
	| { ok: true; mac: string; label: string }
	| { ok: false; error: string };

/**
 * Validate and canonicalise the operator-entered MAC and label.
 *
 * The MAC must be the chip's eFuse MAC so the setup AP name and the printed
 * sticker match; `canonicalMac` accepts the common spellings and always stores
 * six uppercase colon-separated pairs.
 */
export function validateDeviceRegistration(input: {
	mac: unknown;
	label: unknown;
}): ValidatedDeviceRegistration {
	const mac = canonicalMac(typeof input.mac === "string" ? input.mac : "");
	if (!mac) return { ok: false, error: INVALID_MAC_MESSAGE };

	const label = typeof input.label === "string" ? input.label.trim() : "";
	if (!label) return { ok: false, error: MISSING_LABEL_MESSAGE };
	if (label.length > MAX_DEVICE_LABEL_LENGTH) {
		return {
			ok: false,
			error: `The label can be at most ${MAX_DEVICE_LABEL_LENGTH} characters.`,
		};
	}

	return { ok: true, mac, label };
}

/**
 * Mint the pair stored on `EnergyDevice`: the plaintext token (returned to the
 * caller at most once) and its SHA-256 lookup hash. Never logged or audited.
 */
export function createDeviceCredentials(): { token: string; tokenHash: string } {
	const token = generateDeviceToken();
	return { token, tokenHash: hashToken(token) };
}
