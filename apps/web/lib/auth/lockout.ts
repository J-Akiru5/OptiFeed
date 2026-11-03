import prisma from "@/lib/prisma";

// Hard lockout: 5 failed login attempts per (farmId, IP) lock that pair for
// 15 minutes. Split by IP so a stranger hammering the login cannot lock
// the real farmer out of their own account.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Farm-wide signal (F-031, revised for #721): >= 10 failed attempts across ALL
// IPs within a 15-minute window raises one security notification. It is an
// alert, not a lock: the previous hard farm-wide lock let an attacker with two
// source IPs hold every farmer offline for 15 minutes at a time (CWE-400).
// The accepted tradeoff is that distributed guessing below the per-pair lock
// is not stopped by a farm-wide gate; the per-(farm, IP) lock, the rate limiter
// and the notification remain, and a legitimate farmer can always sign in.
const FARM_MAX_ATTEMPTS = 10;
const FARM_WINDOW_MS = 15 * 60 * 1000;

export interface LockoutResult {
	locked: boolean;
	secondsRemaining?: number;
}

export async function checkLockout(farmId: string, ip: string): Promise<LockoutResult> {
	const record = await prisma.loginLockout.findUnique({
		where: { farmId_ip: { farmId, ip } },
	});
	const now = Date.now();

	if (record) {
		// Lockout window has passed — reset this pair for a fresh set of attempts
		if (record.lockedUntil && record.lockedUntil.getTime() <= now) {
			await prisma.loginLockout.update({
				where: { farmId_ip: { farmId, ip } },
				data: { failedAttempts: 0, lockedUntil: null },
			});
		} else if (record.lockedUntil) {
			// Currently locked
			const secondsRemaining = Math.ceil((record.lockedUntil.getTime() - now) / 1000);
			return { locked: true, secondsRemaining };
		}
	}

	// The farm-wide counter is an alert signal only (#721). Checking
	// UserLockout here would let two source IPs hold every farmer offline, so
	// login is blocked solely by this pair's own hard lock.
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

	// Farm-wide counter (F-031) — 15-minute window, alert at 10. It never
	// writes a future lock: #721 removed the farm-wide denial-of-service. Any
	// legacy `lockedUntil` is cleared so the row cannot be mistaken for an
	// active block.
	const global = await prisma.userLockout.findUnique({ where: { farmId } });
	if (
		!global ||
		!global.lastFailedAt ||
		global.lastFailedAt.getTime() <= now.getTime() - FARM_WINDOW_MS
	) {
		// Window expired (or first failure) — restart the counter fresh.
		await prisma.userLockout.upsert({
			where: { farmId },
			create: { farmId, failedAttempts: 1, lastFailedAt: now },
			update: { failedAttempts: 1, lastFailedAt: now, lockedUntil: null },
		});
		return;
	}

	const newGlobal = global.failedAttempts + 1;
	await prisma.userLockout.update({
		where: { farmId },
		data: { failedAttempts: newGlobal, lastFailedAt: now, lockedUntil: null },
	});

	if (newGlobal === FARM_MAX_ATTEMPTS) {
		await notifyBruteForce(farmId, ip);
	}
}

export async function resetLockout(farmId: string, ip: string): Promise<void> {
	await prisma.loginLockout.upsert({
		where: { farmId_ip: { farmId, ip } },
		create: { farmId, ip, failedAttempts: 0 },
		update: { failedAttempts: 0, lockedUntil: null },
	});
	// A successful login clears the farm-wide signal too, so the next alert
	// window starts clean instead of inheriting failures from other IPs.
	await prisma.userLockout.upsert({
		where: { farmId },
		create: { farmId, failedAttempts: 0 },
		update: { failedAttempts: 0, lockedUntil: null },
	});
}

// One-shot farm notification when the farm-wide cap is first crossed.
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
				message: `Unusual number of failed login attempts from ${ip}. If this wasn't you, change the password.`,
				linkTo: "/dashboard/settings/profile",
			},
		});
	} catch (error) {
		// Notification failure must never break the login flow.
		console.error("[lockout] failed to notify brute-force attempt:", error);
	}
}
