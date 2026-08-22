import prisma from "@/lib/prisma";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface LockoutResult {
	locked: boolean;
	secondsRemaining?: number;
}

export async function checkLockout(farmId: string): Promise<LockoutResult> {
	const record = await prisma.userLockout.findUnique({ where: { farmId } });
	if (!record) return { locked: false };

	// Lockout window has passed — reset counter for a fresh set of attempts
	if (record.lockedUntil && record.lockedUntil <= new Date()) {
		await prisma.userLockout.update({
			where: { farmId },
			data: { failedAttempts: 0, lockedUntil: null },
		});
		return { locked: false };
	}

	// Currently locked
	if (record.lockedUntil && record.lockedUntil > new Date()) {
		const secondsRemaining = Math.ceil((record.lockedUntil.getTime() - Date.now()) / 1000);
		return { locked: true, secondsRemaining };
	}

	// Not locked, counter below threshold
	return { locked: false };
}

export async function recordFailedAttempt(farmId: string): Promise<void> {
	const record = await prisma.userLockout.findUnique({ where: { farmId } });

	if (!record) {
		await prisma.userLockout.create({
			data: {
				farmId,
				failedAttempts: 1,
				lastFailedAt: new Date(),
			},
		});
		return;
	}

	const newCount = record.failedAttempts + 1;
	const shouldLock = newCount >= MAX_ATTEMPTS;

	await prisma.userLockout.update({
		where: { farmId },
		data: {
			failedAttempts: newCount,
			lastFailedAt: new Date(),
			lockedUntil: shouldLock
				? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
				: record.lockedUntil,
		},
	});
}

export async function resetLockout(farmId: string): Promise<void> {
	await prisma.userLockout.upsert({
		where: { farmId },
		create: { farmId, failedAttempts: 0 },
		update: { failedAttempts: 0, lockedUntil: null },
	});
}
