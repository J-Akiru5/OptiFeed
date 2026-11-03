import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { UNKNOWN_CLIENT_IP, parseClientIp, selectClientIp, trustedProxyHops } from "../client-ip";

// F-014 / #329: the left-most X-Forwarded-For entry is written by the client
// and is spoofable. #732 makes the trusted-hop count configurable and fail
// closed when the chain is shorter than the configured number of proxies.
const originalHops = process.env.TRUSTED_PROXY_HOPS;

beforeEach(() => {
	Reflect.deleteProperty(process.env, "TRUSTED_PROXY_HOPS");
});

afterAll(() => {
	if (originalHops === undefined) {
		Reflect.deleteProperty(process.env, "TRUSTED_PROXY_HOPS");
	} else {
		process.env.TRUSTED_PROXY_HOPS = originalHops;
	}
});

describe("trustedProxyHops", () => {
	it("defaults to one trusted hop (Vercel's edge)", () => {
		expect(trustedProxyHops()).toBe(1);
	});

	it("reads a configured hop count", () => {
		process.env.TRUSTED_PROXY_HOPS = "2";
		expect(trustedProxyHops()).toBe(2);
	});

	it("bounds the value to 1..10 and ignores non-integers", () => {
		process.env.TRUSTED_PROXY_HOPS = "0";
		expect(trustedProxyHops()).toBe(1);
		process.env.TRUSTED_PROXY_HOPS = "11";
		expect(trustedProxyHops()).toBe(10);
		process.env.TRUSTED_PROXY_HOPS = "2.5";
		expect(trustedProxyHops()).toBe(1);
		process.env.TRUSTED_PROXY_HOPS = "not-a-number";
		expect(trustedProxyHops()).toBe(1);
	});
});

describe("client address derivation (F-014 / #329 / #732)", () => {
	it("takes the trusted final hop, not a forged left-most entry", () => {
		expect(selectClientIp("203.0.113.66, 198.51.100.4")).toBe("198.51.100.4");
	});

	it("ignores garbage the client wrote to the left of the chain", () => {
		expect(selectClientIp("not-an-ip, 203.0.113.7")).toBe("203.0.113.7");
	});

	it("trims whitespace around the trusted entry", () => {
		expect(selectClientIp("1.2.3.4,   198.51.100.23  ")).toBe("198.51.100.23");
	});

	it("accepts IPv6 entries", () => {
		expect(selectClientIp("2001:db8::1")).toBe("2001:db8::1");
	});

	it("selects the configured hop when a second trusted proxy is present", () => {
		expect(parseClientIp("203.0.113.66, 198.51.100.4, 10.0.0.1", 2)).toBe("198.51.100.4");
		expect(parseClientIp("203.0.113.66, 198.51.100.4, 10.0.0.1")).toBe("10.0.0.1");
	});

	it("returns null when the chain is shorter than the trusted hop count", () => {
		expect(parseClientIp("203.0.113.7", 2)).toBeNull();
		expect(parseClientIp("203.0.113.7, 10.0.0.1", 3)).toBeNull();
		expect(parseClientIp(null, 2)).toBeNull();
	});

	it("returns null when the selected entry is malformed", () => {
		expect(parseClientIp("boom, 1.2.3.4", 2)).toBeNull();
		expect(parseClientIp("1.2.3.4, <script>, 10.0.0.1", 2)).toBeNull();
	});

	it("rejects an explicit hop count outside the bounded range", () => {
		expect(parseClientIp("1.2.3.4, 10.0.0.1", 0)).toBeNull();
		expect(parseClientIp("1.2.3.4, 10.0.0.1", 11)).toBeNull();
		expect(parseClientIp("1.2.3.4, 10.0.0.1", 1.5)).toBeNull();
	});

	it("returns null when the header is absent or empty", () => {
		expect(parseClientIp(null)).toBeNull();
		expect(parseClientIp(undefined)).toBeNull();
		expect(parseClientIp("")).toBeNull();
		expect(parseClientIp("   ")).toBeNull();
	});

	it("returns null when the trusted entry is malformed", () => {
		expect(parseClientIp("1.2.3.4, boom")).toBeNull();
		expect(parseClientIp("1.2.3.4, <script>")).toBeNull();
	});

	it("rejects overlong values so bucket keys stay bounded", () => {
		expect(parseClientIp(`1.2.3.4, ${"a".repeat(46)}`)).toBeNull();
	});

	it("substitutes a fixed placeholder for rate-limit keys", () => {
		expect(selectClientIp("1.2.3.4, boom")).toBe(UNKNOWN_CLIENT_IP);
		expect(selectClientIp(null)).toBe(UNKNOWN_CLIENT_IP);
		expect(selectClientIp("   ")).toBe(UNKNOWN_CLIENT_IP);
	});
});
