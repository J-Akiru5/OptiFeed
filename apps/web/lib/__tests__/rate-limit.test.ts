import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { $queryRaw: vi.fn() },
}));

import prisma from "@/lib/prisma";
import {
	checkAiProviderTestRateLimit,
	checkApiRateLimit,
	checkDeviceRateLimit,
	checkDeviceTokenRevealRateLimit,
	checkLoginRateLimit,
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

	it("allows five AI provider key tests per minute per actor", async () => {
		returnsCount(5);
		expect((await checkAiProviderTestRateLimit("admin-1")).success).toBe(true);
		returnsCount(6);
		expect((await checkAiProviderTestRateLimit("admin-1")).success).toBe(false);

		const first = queryRaw.mock.calls[0] as unknown as [string, string, Date];
		expect(first[1]).toBe("rl:ai-provider-test:admin-1");
		expect(first[2].getTime() % 60_000).toBe(0);
	});

	it("AI key tests fail CLOSED when the store is unavailable", async () => {
		queryRaw.mockRejectedValueOnce(new Error("db down"));
		const result = await checkAiProviderTestRateLimit("admin-1");
		expect(result.success).toBe(false);
	});
});
