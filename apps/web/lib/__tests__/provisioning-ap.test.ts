import {
	AP_PREFIX,
	QR_QUIET_ZONE,
	escapeWifiField,
	provisioningApSsid,
	qrSvgData,
	wifiSetupPayload,
} from "@/lib/provisioning-ap";
import { describe, expect, it } from "vitest";

describe("provisioningApSsid", () => {
	it("derives the setup SSID for the seeded demo MAC", () => {
		expect(provisioningApSsid("A4:CF:12:7E:3B:09")).toBe("PakaonAI-3B09");
	});

	it("uses the shared prefix", () => {
		expect(AP_PREFIX).toBe("PakaonAI-");
		expect(provisioningApSsid("A4:CF:12:7E:3B:09").startsWith(AP_PREFIX)).toBe(true);
	});

	it("keeps only hex digits and uppercases them", () => {
		expect(provisioningApSsid("a4-cf-12-7e-3b-09")).toBe("PakaonAI-3B09");
		expect(provisioningApSsid("a4cf127e3b09")).toBe("PakaonAI-3B09");
		expect(provisioningApSsid("  a4:cf:12:7e:3b:0a  ")).toBe("PakaonAI-3B0A");
		// Non-hex characters are dropped, not counted: "G" and "Z" vanish.
		expect(provisioningApSsid("GZ12-34")).toBe("PakaonAI-1234");
	});

	it("left-pads with zeros when fewer than four hex digits remain", () => {
		expect(provisioningApSsid("AB")).toBe("PakaonAI-00AB");
		expect(provisioningApSsid("1:2:3")).toBe("PakaonAI-0123");
		expect(provisioningApSsid("xyz")).toBe("PakaonAI-0000");
		expect(provisioningApSsid("")).toBe("PakaonAI-0000");
	});

	it("is exactly four characters after the prefix, so it fits a 32-byte SSID", () => {
		const ssid = provisioningApSsid("FF:FF:FF:FF:FF:FF");
		expect(ssid).toBe("PakaonAI-FFFF");
		expect(ssid.length).toBeLessThanOrEqual(32);
	});
});

describe("escapeWifiField", () => {
	it("escapes backslash, semicolon, comma, colon and double quote", () => {
		expect(escapeWifiField("a\\b")).toBe("a\\\\b");
		expect(escapeWifiField("a;b")).toBe("a\\;b");
		expect(escapeWifiField("a,b")).toBe("a\\,b");
		expect(escapeWifiField("a:b")).toBe("a\\:b");
		expect(escapeWifiField('a"b')).toBe('a\\"b');
	});

	it("escapes every occurrence and leaves other characters alone", () => {
		expect(escapeWifiField('\\;,:"')).toBe('\\\\\\;\\,\\:\\"');
		expect(escapeWifiField("PakaonAI-3B09 é")).toBe("PakaonAI-3B09 é");
	});
});

describe("wifiSetupPayload", () => {
	it("is an open-network WIFI: payload with no password field", () => {
		expect(wifiSetupPayload("PakaonAI-3B09")).toBe("WIFI:T:nopass;S:PakaonAI-3B09;;");
	});

	it("escapes the SSID before embedding it", () => {
		expect(wifiSetupPayload('we;ird:"x')).toBe('WIFI:T:nopass;S:we\\;ird\\:\\"x;;');
	});

	it("matches the demo MAC end to end", () => {
		expect(wifiSetupPayload(provisioningApSsid("A4:CF:12:7E:3B:09"))).toBe(
			"WIFI:T:nopass;S:PakaonAI-3B09;;",
		);
	});
});

describe("qrSvgData", () => {
	it("returns vector path data with a 4-module quiet zone", () => {
		const qr = qrSvgData(wifiSetupPayload("PakaonAI-3B09"));
		expect(QR_QUIET_ZONE).toBe(4);
		expect(qr.extent).toBe(qr.size + 8);
		expect(qr.viewBox).toBe(`-4 -4 ${qr.extent} ${qr.extent}`);
		// Version 3 (29 modules) holds this payload at error correction M.
		expect(qr.size).toBe(29);
		expect(qr.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
	});

	it("keeps dark modules inside the symbol, never in the quiet zone", () => {
		const qr = qrSvgData("WIFI:T:nopass;S:PakaonAI-3B09;;");
		for (const [, x, y] of qr.path.matchAll(/M(\d+) (\d+)h/g)) {
			expect(Number(x)).toBeGreaterThanOrEqual(0);
			expect(Number(x)).toBeLessThan(qr.size);
			expect(Number(y)).toBeGreaterThanOrEqual(0);
			expect(Number(y)).toBeLessThan(qr.size);
		}
	});

	it("is deterministic and differs per unit", () => {
		const a = qrSvgData(wifiSetupPayload("PakaonAI-3B09"));
		expect(qrSvgData(wifiSetupPayload("PakaonAI-3B09")).path).toBe(a.path);
		expect(qrSvgData(wifiSetupPayload("PakaonAI-3B0A")).path).not.toBe(a.path);
	});
});
