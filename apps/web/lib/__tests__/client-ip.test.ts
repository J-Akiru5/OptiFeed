import { describe, expect, it } from "vitest";

import { UNKNOWN_CLIENT_IP, parseClientIp, selectClientIp } from "../client-ip";

// F-014 / issue #329: the left-most X-Forwarded-For entry is written by the
// client and is spoofable. The deployment assumption is one trusted hop —
// Vercel's edge — which owns the final entry (it rewrites the header with the
// address it observed and does not forward client-supplied entries). The same
// rule is the generic trusted-proxy-count = 1 model: only the last hop counts.
describe("client address derivation (F-014 / #329)", () => {
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
