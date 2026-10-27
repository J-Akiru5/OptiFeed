import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { $queryRaw: vi.fn() },
}));

import prisma from "@/lib/prisma";
import {
	checkApiRateLimit,
	checkDeviceRateLimit,
	checkDeviceTokenRevealRateLimit,
	checkLoginRateLimit,
	selectClientIp,
} from "../rate-limit";

const queryRaw = vi.mocked(prisma.$queryRaw);

/** Simulate the upsert returning the given count. */
function returnsCount(count: number) {
	queryRaw.mockResolvedValueOnce([{ count: BigInt(count) }] as never);
}

describe("Postgres rate limiter", () => {
	beforeEach(() => {
		queryRaw.mockReset();
	});

	it("allows requests up to the limit", async () => {
		returnsCount(1);
		const first = await checkLoginRateLimit("1.2.3.4");
		expect(first.success).toBe(true);
		expect(first.remaining).toBe(4);

		returnsCount(5);
		const fifth = await checkLoginRateLimit("1.2.3.4");
		expect(fifth.success).toBe(true);
		expect(fifth.remaining).toBe(0);
	});

	it("blocks once the count exceeds the limit", async () => {
		returnsCount(6);
		const sixth = await checkLoginRateLimit("1.2.3.4");
		expect(sixth.success).toBe(false);
	});

	it("counts via a single atomic upsert per check", async () => {
		returnsCount(1);
		await checkApiRateLimit("user-1");
		expect(queryRaw).toHaveBeenCalledTimes(1);
		const [sql] = queryRaw.mock.calls[0] as unknown as [string];
		expect(String(sql)).toContain("ON CONFLICT");
	});

	it("login fails CLOSED when the store is unavailable", async () => {
		queryRaw.mockRejectedValueOnce(new Error("db down"));
		const result = await checkLoginRateLimit("1.2.3.4");
		expect(result.success).toBe(false);
	});

	it("device limit fails OPEN when the store is unavailable", async () => {
		queryRaw.mockRejectedValueOnce(new Error("db down"));
		const result = await checkDeviceRateLimit("esp32-device-1", "feed");
		expect(result.success).toBe(true);
	});

	it("token reveals are keyed per actor and allow ten per hour", async () => {
		returnsCount(10);
		expect((await checkDeviceTokenRevealRateLimit("admin-1")).success).toBe(true);
		returnsCount(11);
		expect((await checkDeviceTokenRevealRateLimit("admin-1")).success).toBe(false);

		const first = queryRaw.mock.calls[0] as unknown as [string, string, Date];
		expect(first[1]).toBe("rl:token-reveal:admin-1");
		// The window is an hour, aligned to the hour boundary.
		expect(first[2].getTime() % (60 * 60 * 1000)).toBe(0);

		returnsCount(1);
		await checkDeviceTokenRevealRateLimit("admin-2");
		expect((queryRaw.mock.calls[2] as unknown[])[1]).toBe("rl:token-reveal:admin-2");
	});

	it("token reveals fail OPEN when the store is unavailable", async () => {
		queryRaw.mockRejectedValueOnce(new Error("db down"));
		const result = await checkDeviceTokenRevealRateLimit("admin-1");
		expect(result.success).toBe(true);
	});

	it("keys each device endpoint separately so the 5s polls cannot collide", async () => {
		returnsCount(1);
		await checkDeviceRateLimit("device-a", "feed");
		expect((queryRaw.mock.calls[0] as unknown[])[1]).toBe("rl:device:feed:device-a");

		returnsCount(1);
		await checkDeviceRateLimit("device-a", "schedule");
		expect((queryRaw.mock.calls[1] as unknown[])[1]).toBe("rl:device:schedule:device-a");

		returnsCount(1);
		await checkDeviceRateLimit("device-b", "feed");
		expect((queryRaw.mock.calls[2] as unknown[])[1]).toBe("rl:device:feed:device-b");
	});
});

// F-014: the leftmost X-Forwarded-For entry is client-written and spoofable.
// Rate limiting must key on the rightmost entry — the hop appended by the
// single trusted proxy (Vercel's edge) — or an attacker rotates a fake
// header per request and gets a fresh bucket every time.
describe("selectClientIp (F-014 XFF hardening)", () => {
	it("takes the rightmost entry, not the spoofed leftmost one", () => {
		expect(selectClientIp("1.2.3.4, 9.9.9.9")).toBe("9.9.9.9");
	});

	it("ignores garbage the client wrote into the left of the chain", () => {
		expect(selectClientIp("not-an-ip, 203.0.113.7")).toBe("203.0.113.7");
	});

	it("trims whitespace around the trusted entry", () => {
		expect(selectClientIp("1.2.3.4,   198.51.100.23  ")).toBe("198.51.100.23");
	});

	it("accepts IPv6 entries", () => {
		expect(selectClientIp("2001:db8::1")).toBe("2001:db8::1");
	});

	it("falls back when the rightmost entry is not an IP", () => {
		expect(selectClientIp("1.2.3.4, boom")).toBe("127.0.0.1");
	});

	it("falls back when the header is absent or empty", () => {
		expect(selectClientIp(null)).toBe("127.0.0.1");
		expect(selectClientIp("")).toBe("127.0.0.1");
		expect(selectClientIp("   ")).toBe("127.0.0.1");
	});

	it("rejects overlong values so bucket keys stay bounded", () => {
		expect(selectClientIp(`1.2.3.4, ${"a".repeat(46)}`)).toBe("127.0.0.1");
	});
});
