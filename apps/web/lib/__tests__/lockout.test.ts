import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		loginLockout: {
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			upsert: vi.fn(),
		},
		userLockout: {
			findUnique: vi.fn(),
			update: vi.fn(),
			upsert: vi.fn(),
		},
		pond: { findFirst: vi.fn() },
		notification: { create: vi.fn() },
	},
}));

import {
	checkLockout,
	recordFailedAttempt,
	resetLockout,
	shouldSlowLogin,
} from "@/lib/auth/lockout";
import prisma from "@/lib/prisma";

const loginLockout = vi.mocked(prisma.loginLockout);
const userLockout = vi.mocked(prisma.userLockout);
const pond = vi.mocked(prisma.pond);
const notification = vi.mocked(prisma.notification);

const FARM = "demo-farmer-1";
const IP = "203.0.113.9";

describe("per-(farm, IP) hard lockout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("locks the pair after 5 failed attempts for 15 minutes", async () => {
		loginLockout.findUnique.mockResolvedValue({
			failedAttempts: 4,
			lockedUntil: null,
		} as never);

		await recordFailedAttempt(FARM, IP);

		expect(loginLockout.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { farmId_ip: { farmId: FARM, ip: IP } },
				data: expect.objectContaining({
					failedAttempts: 5,
					lockedUntil: expect.any(Date),
				}),
			}),
		);
	});

	it("reports remaining seconds while locked", async () => {
		loginLockout.findUnique.mockResolvedValue({
			failedAttempts: 5,
			lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
		} as never);

		const result = await checkLockout(FARM, IP);
		expect(result.locked).toBe(true);
		expect(result.secondsRemaining).toBeGreaterThan(0);
	});

	it("unlocks the pair once the window has passed", async () => {
		loginLockout.findUnique.mockResolvedValue({
			failedAttempts: 5,
			lockedUntil: new Date(Date.now() - 1000),
		} as never);

		const result = await checkLockout(FARM, IP);
		expect(result.locked).toBe(false);
		expect(loginLockout.update).toHaveBeenCalled();
	});

	it("a different IP is not locked by another IP's failures", async () => {
		// Attacker IP is locked; the pair (farm, farmer IP) has no record.
		loginLockout.findUnique.mockResolvedValue(null);
		const result = await checkLockout(FARM, "198.51.100.7");
		expect(result.locked).toBe(false);
	});
});

describe("global per-farm slowdown (never a lockout)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shouldSlowLogin is false below the threshold", async () => {
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 19,
			lastFailedAt: new Date(),
		} as never);
		expect(await shouldSlowLogin(FARM)).toBe(false);
	});

	it("shouldSlowLogin is true at >= 20 failures within the hour", async () => {
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 20,
			lastFailedAt: new Date(),
		} as never);
		expect(await shouldSlowLogin(FARM)).toBe(true);
	});

	it("ignores stale counters from more than an hour ago", async () => {
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 50,
			lastFailedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
		} as never);
		expect(await shouldSlowLogin(FARM)).toBe(false);
	});

	it("notifies the farm once when crossing 20 failures", async () => {
		loginLockout.findUnique.mockResolvedValue({ failedAttempts: 1 } as never);
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 19,
			lastFailedAt: new Date(),
		} as never);
		pond.findFirst.mockResolvedValue({ id: "pond-1" } as never);
		notification.create.mockResolvedValue({} as never);

		await recordFailedAttempt(FARM, IP);

		expect(notification.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					pondId: "pond-1",
					category: "security",
					tier: "WARNING",
				}),
			}),
		);
	});
});

describe("resetLockout", () => {
	it("resets the (farm, IP) pair", async () => {
		loginLockout.upsert.mockResolvedValue({} as never);
		await resetLockout(FARM, IP);
		expect(loginLockout.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { farmId_ip: { farmId: FARM, ip: IP } },
			}),
		);
	});
});
