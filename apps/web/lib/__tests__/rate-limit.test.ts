import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { $queryRaw: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { checkApiRateLimit, checkDeviceRateLimit, checkLoginRateLimit } from "../rate-limit";

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
		const result = await checkDeviceRateLimit("esp32-device-1");
		expect(result.success).toBe(true);
	});

	it("keys are namespaced per limiter", async () => {
		returnsCount(1);
		await checkDeviceRateLimit("device-a");
		expect((queryRaw.mock.calls[0] as unknown[])[1]).toBe("rl:device:device-a");

		returnsCount(1);
		await checkDeviceRateLimit("device-b");
		expect((queryRaw.mock.calls[1] as unknown[])[1]).toBe("rl:device:device-b");
	});
});
