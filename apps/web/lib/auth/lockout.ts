import prisma from "@/lib/prisma";

// Hard lockout: 5 failed PIN attempts per (farmId, IP) lock that pair for
// 15 minutes. Split by IP so a stranger hammering the login cannot lock
// the real farmer out of their own account.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Global per-farm slowdown: >= 20 failed attempts within an hour delays
// the next login attempt and notifies the farm (security category), but
// NEVER locks the farmer out.
const GLOBAL_ATTEMPTS_PER_HOUR = 20;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_SLOWDOWN_MS = 2000;

export interface LockoutResult {
	locked: boolean;
	secondsRemaining?: number;
}

export async function checkLockout(farmId: string, ip: string): Promise<LockoutResult> {
	const record = await prisma.loginLockout.findUnique({
		where: { farmId_ip: { farmId, ip } },
	});
	if (!record) return { locked: false };

	const now = Date.now();

	// Lockout window has passed — reset this pair for a fresh set of attempts
	if (record.lockedUntil && record.lockedUntil.getTime() <= now) {
		await prisma.loginLockout.update({
			where: { farmId_ip: { farmId, ip } },
			data: { failedAttempts: 0, lockedUntil: null },
		});
		return { locked: false };
	}

	// Currently locked
	if (record.lockedUntil && record.lockedUntil.getTime() > now) {
		const secondsRemaining = Math.ceil((record.lockedUntil.getTime() - now) / 1000);
		return { locked: true, secondsRemaining };
	}

	// Not locked, counter below threshold
	return { locked: false };
}

export async function recordFailedAttempt(farmId: string, ip: string): Promise<void> {
	const now = new Date();

	// Per-(farm, IP) hard lockout counter
	const record = await prisma.loginLockout.findUnique({
		where: { farmId_ip: { farmId, ip } },
	});

	if (!record) {
		await prisma.loginLockout.create({
			data: { farmId, ip, failedAttempts: 1, lastFailedAt: now },
		});
	} else {
		const newCount = record.failedAttempts + 1;
		const shouldLock = newCount >= MAX_ATTEMPTS;
		await prisma.loginLockout.update({
			where: { farmId_ip: { farmId, ip } },
			data: {
				failedAttempts: newCount,
				lastFailedAt: now,
				lockedUntil: shouldLock
					? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000)
					: record.lockedUntil,
			},
		});
	}

	// Global per-farm counter — decay hourly, notify once on crossing.
	const global = await prisma.userLockout.findUnique({ where: { farmId } });
	if (!global || (global.lastFailedAt?.getTime() ?? 0) < now.getTime() - GLOBAL_WINDOW_MS) {
		await prisma.userLockout.upsert({
			where: { farmId },
			create: { farmId, failedAttempts: 1, lastFailedAt: now },
			update: { failedAttempts: 1, lastFailedAt: now },
		});
		return;
	}

	const newGlobal = global.failedAttempts + 1;
	await prisma.userLockout.update({
		where: { farmId },
		data: { failedAttempts: newGlobal, lastFailedAt: now },
	});

	if (newGlobal === GLOBAL_ATTEMPTS_PER_HOUR) {
		await notifyBruteForce(farmId, ip);
	}
}

export async function resetLockout(farmId: string, ip: string): Promise<void> {
	await prisma.loginLockout.upsert({
		where: { farmId_ip: { farmId, ip } },
		create: { farmId, ip, failedAttempts: 0 },
		update: { failedAttempts: 0, lockedUntil: null },
	});
}

/**
 * True when this farm has crossed the global failed-attempt threshold in
 * the last hour. The caller applies GLOBAL_SLOWDOWN_MS — a delay, never a
 * lockout, so the real farmer can always get in.
 */
export async function shouldSlowLogin(farmId: string): Promise<boolean> {
	const global = await prisma.userLockout.findUnique({ where: { farmId } });
	if (!global?.lastFailedAt) return false;
	if (global.lastFailedAt.getTime() < Date.now() - GLOBAL_WINDOW_MS) return false;
	return global.failedAttempts >= GLOBAL_ATTEMPTS_PER_HOUR;
}

// One-shot farm notification when the global threshold is first crossed.
async function notifyBruteForce(farmId: string, ip: string): Promise<void> {
	try {
		const pond = await prisma.pond.findFirst({
			where: { ownerId: farmId },
			select: { id: true },
		});
		if (!pond) return;
		await prisma.notification.create({
			data: {
				pondId: pond.id,
				farmId,
				tier: "WARNING",
				category: "security",
				message: `Unusual number of failed login attempts from ${ip}. If this wasn't you, change the PIN.`,
				linkTo: "/dashboard/settings/profile",
			},
		});
	} catch (error) {
		// Notification failure must never break the login flow.
		console.error("[lockout] failed to notify brute-force attempt:", error);
	}
}
