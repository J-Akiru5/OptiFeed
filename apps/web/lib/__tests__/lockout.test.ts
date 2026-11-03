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

import { checkLockout, recordFailedAttempt, resetLockout } from "@/lib/auth/lockout";
import prisma from "@/lib/prisma";

const loginLockout = vi.mocked(prisma.loginLockout);
const userLockout = vi.mocked(prisma.userLockout);
const pond = vi.mocked(prisma.pond);
const notification = vi.mocked(prisma.notification);

const FARM = "demo-farmer-1";
const IP = "203.0.113.9";

describe("per-(farm, IP) hard lockout", () => {
	beforeEach(() => {
		vi.resetAllMocks();
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

// F-031 originally added a hard farm-wide lock: 10 failures across all IPs
// locked every IP for 15 minutes. #721 removed the hard gate because two
// source IPs could hold a farm offline indefinitely. The counter and the
// one-shot security notification remain as an alert-only signal.
describe("farm-wide signal: 10 fails / 15 min, alert only (#721)", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("does not write a farm lock at the 10th failure", async () => {
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 9,
			lockedUntil: null,
			lastFailedAt: new Date(),
		} as never);
		loginLockout.findUnique.mockResolvedValue(null);

		await recordFailedAttempt(FARM, IP);

		expect(userLockout.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { farmId: FARM },
				data: expect.objectContaining({
					failedAttempts: 10,
					lockedUntil: null,
				}),
			}),
		);
	});

	it("cannot lock the farm for a third IP, even with a legacy lock row", async () => {
		// Two attacker IPs may have crossed the threshold; a third IP must still
		// be able to sign in. checkLockout must not consult the farm row at all.
		loginLockout.findUnique.mockResolvedValue(null);
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 10,
			lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
			lastFailedAt: new Date(),
		} as never);

		const result = await checkLockout(FARM, "198.51.100.7");

		expect(result).toEqual({ locked: false });
		expect(userLockout.findUnique).not.toHaveBeenCalled();
	});

	it("notifies the farm once when crossing the cap", async () => {
		loginLockout.findUnique.mockResolvedValue(null);
		userLockout.findUnique
			.mockResolvedValueOnce({
				failedAttempts: 9,
				lockedUntil: null,
				lastFailedAt: new Date(),
			} as never)
			.mockResolvedValueOnce({
				failedAttempts: 10,
				lockedUntil: null,
				lastFailedAt: new Date(),
			} as never);
		pond.findFirst.mockResolvedValue({ id: "pond-1" } as never);
		notification.create.mockResolvedValue({} as never);

		await recordFailedAttempt(FARM, "203.0.113.10");
		await recordFailedAttempt(FARM, "203.0.113.11");

		expect(notification.create).toHaveBeenCalledTimes(1);
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

	it("does not notify below the cap", async () => {
		loginLockout.findUnique.mockResolvedValue({ failedAttempts: 1 } as never);
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 5,
			lockedUntil: null,
			lastFailedAt: new Date(),
		} as never);

		await recordFailedAttempt(FARM, IP);

		expect(notification.create).not.toHaveBeenCalled();
	});

	it("a stale counter from outside the window restarts at 1 without locking", async () => {
		userLockout.findUnique.mockResolvedValue({
			failedAttempts: 10,
			lockedUntil: new Date(Date.now() - 5 * 60 * 1000),
			lastFailedAt: new Date(Date.now() - 20 * 60 * 1000),
		} as never);
		loginLockout.findUnique.mockResolvedValue(null);

		await recordFailedAttempt(FARM, IP);

		// Window expired → counter restarts at 1 and any legacy lock is cleared.
		expect(userLockout.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { farmId: FARM },
				update: expect.objectContaining({ failedAttempts: 1, lockedUntil: null }),
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

	it("a successful login also zeroes the farm-wide counter", async () => {
		loginLockout.upsert.mockResolvedValue({} as never);
		userLockout.upsert.mockResolvedValue({} as never);
		await resetLockout(FARM, IP);
		expect(userLockout.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { farmId: FARM },
				update: expect.objectContaining({ failedAttempts: 0, lockedUntil: null }),
			}),
		);
	});
});
