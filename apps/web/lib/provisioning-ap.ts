import qrcode from "qrcode-generator";

/**
 * Prefix of the setup access point a feeder broadcasts while it has no Wi-Fi
 * credentials. Must equal `PROVISIONING_AP_PREFIX` in
 * firmware/firmware-main/firmware-main.ino — lib/__tests__/provisioning-ap.test.ts
 * fails if the two drift apart. Flashed units broadcast the prefix they were
 * built with, so changing it in either place requires a reflash.
 */
export const AP_PREFIX = "PakaonAI-";

/**
 * Setup network name for a device MAC. Mirrors firmware `provisioningApSsid()`
 * exactly: keep only hex digits, uppercase them, take the last four and
 * left-pad with "0" when fewer than four remain.
 */
export function provisioningApSsid(mac: string): string {
	let hex = (mac.match(/[0-9a-fA-F]/g) ?? []).join("").toUpperCase();
	while (hex.length < 4) hex = `0${hex}`;
	return `${AP_PREFIX}${hex.slice(-4)}`;
}

const WIFI_SPECIAL_CHARS = new Set(["\\", ";", ",", ":", '"']);

/** Escape a value for a `WIFI:` QR field: `\ ; , : "` get a leading backslash. */
export function escapeWifiField(value: string): string {
	return [...value].map((char) => (WIFI_SPECIAL_CHARS.has(char) ? `\\${char}` : char)).join("");
}

/**
 * Payload of the open-network join QR. It carries the SSID only — never a
 * password, device token or any other credential.
 */
export function wifiSetupPayload(ssid: string): string {
	return `WIFI:T:nopass;S:${escapeWifiField(ssid)};;`;
}

export type QrSvgData = {
	/** Modules per side, excluding the quiet zone. */
	size: number;
	/** SVG viewBox including the quiet zone. */
	viewBox: string;
	/** Edge length of the viewBox in modules. */
	extent: number;
	/** One path of unit squares for every dark module. */
	path: string;
};

/** Address of the setup portal served by the feeder's access point. */
export const SETUP_PORTAL_ADDRESS = "192.168.4.1";

/** Quiet zone required around a QR symbol, in modules (ISO/IEC 18004). */
export const QR_QUIET_ZONE = 4;

/**
 * Lay out a QR code as vector data: error correction M, automatic version,
 * byte mode, with a 4-module quiet zone. The caller renders `path` in an SVG
 * — nothing is rasterized.
 */
export function qrSvgData(text: string): QrSvgData {
	const qr = qrcode(0, "M");
	qr.addData(text, "Byte");
	qr.make();
	const size = qr.getModuleCount();
	let path = "";
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
		}
	}
	const extent = size + QR_QUIET_ZONE * 2;
	return {
		size,
		viewBox: `${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${extent} ${extent}`,
		extent,
		path,
	};
}
