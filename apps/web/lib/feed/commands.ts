import { OFFLINE_THRESHOLD_MS, STALE_DISPATCHED_MS } from "@/lib/constants";
import { MAX_DISPENSE_MS, dailyFeedCapG, feedGramsSchema, formatZodError } from "@/lib/limits";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The one manual-feed and pause code path (plan M5.2, ADR-PK-05 §6).
 *
 * Both the tenant dashboard (`lib/actions/energy.ts`,
 * `lib/actions/schedule.ts`) and superadmin remote control
 * (`lib/actions/platform/devices.ts`) call these functions. Keeping a single
 * implementation is what guarantees god mode cannot bypass the server caps:
 * there is no second path to forget.
 *
 * `db` is either the default client or a transaction client. The platform
 * actions pass their transaction so the device write and the audit row commit
 * together; the tenant actions pass the plain client, exactly as before.
 */

export type CommandDb = PrismaClient | Prisma.TransactionClient;

export type ManualFeedFailureCode =
	| "device_not_found"
	| "pond_fallow"
	| "offline"
	| "invalid_grams"
	| "dispense_too_long"
	| "in_progress"
	| "daily_cap";

export type ManualFeedOutcome =
	| { ok: true; requestId: string; alreadyPending: boolean }
	| { ok: false; code: ManualFeedFailureCode; error: string };

export type SchedulePauseOutcome =
	| { ok: true; wasPaused: boolean }
	| { ok: false; code: "device_not_found" | "pond_fallow"; error: string };

/** Asia/Manila day window (UTC+8), matching the dashboard's daily feed cap. */
function manilaDayRange(nowMs: number = Date.now()): { start: Date; end: Date } {
	const HOUR_MS = 60 * 60 * 1000;
	const DAY_MS = 24 * HOUR_MS;
	const startOfLocalDay = Math.floor((nowMs + 8 * HOUR_MS) / DAY_MS) * DAY_MS - 8 * HOUR_MS;
	return { start: new Date(startOfLocalDay), end: new Date(startOfLocalDay + DAY_MS) };
}

/**
 * Queue a manual feed for a device.
 *
 * Order matters and mirrors the original dashboard implementation: scope,
 * fallow, stale cleanup, offline, per-request cap, relay-time cap, duplicate
 * checks, daily cap, then the write. A refusal returns a code and message and
 * writes no FeedRequest, so a remote command that safety rejects can never
 * look like it was accepted.
 */
export async function createManualFeedRequest(
	db: CommandDb,
	input: {
		deviceId: string;
		grams?: number;
		/** When set, the device must belong to a pond owned by this farm. */
		farmId?: string | null;
		/** Actor recorded on the DeviceStateEvent (farmId for tenant, user id for platform). */
		actorId: string;
		triggerSource: string;
	},
): Promise<ManualFeedOutcome> {
	const device = await db.energyDevice.findFirst({
		where: {
			id: input.deviceId,
			...(input.farmId ? { pond: { ownerId: input.farmId } } : {}),
		},
		select: {
			gramsPerFeeding: true,
			gramsPerSecond: true,
			lastSeenAt: true,
			hopperCapacityG: true,
			pond: { select: { isFallow: true } },
		},
	});

	if (!device) {
		return { ok: false, code: "device_not_found", error: "Device not found" };
	}

	if (device.pond?.isFallow) {
		return {
			ok: false,
			code: "pond_fallow",
			error: "This pond is fallow after harvest. Start the next grow-out cycle before feeding.",
		};
	}

	// Expire stale dispatched requests that were picked up by the device but
	// never confirmed, so they cannot block future attempts.
	await db.feedRequest.updateMany({
		where: {
			deviceId: input.deviceId,
			status: "dispatched",
			updatedAt: { lt: new Date(Date.now() - STALE_DISPATCHED_MS) },
		},
		data: { status: "expired" },
	});

	// N10: reject while the device is offline — it cannot pick the request up,
	// so queueing it would silently strand the dose.
	if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS) {
		return {
			ok: false,
			code: "offline",
			error: "Device is offline — feed request rejected. Retry once the device reconnects.",
		};
	}

	const feedGrams = input.grams ?? device.gramsPerFeeding;
	const gramsCheck = feedGramsSchema.safeParse(feedGrams);
	if (!gramsCheck.success) {
		return { ok: false, code: "invalid_grams", error: formatZodError(gramsCheck.error) };
	}

	if (device.gramsPerSecond > 0 && feedGrams / device.gramsPerSecond > MAX_DISPENSE_MS / 1000) {
		return {
			ok: false,
			code: "dispense_too_long",
			error: `Dose would need more than ${MAX_DISPENSE_MS / 1000} s of relay time at ${device.gramsPerSecond} g/s — reduce the feed amount.`,
		};
	}

	const existing = await db.feedRequest.findFirst({
		where: { deviceId: input.deviceId, status: "pending" },
	});
	if (existing) {
		return { ok: true, requestId: existing.id, alreadyPending: true };
	}

	const dispatched = await db.feedRequest.findFirst({
		where: { deviceId: input.deviceId, status: "dispatched" },
	});
	if (dispatched) {
		return {
			ok: false,
			code: "in_progress",
			error: "A feed is already in progress — wait for it to finish before requesting another.",
		};
	}

	const day = manilaDayRange();
	const today = await db.feedRequest.aggregate({
		where: {
			deviceId: input.deviceId,
			status: { in: ["pending", "dispatched", "completed"] },
			createdAt: { gte: day.start, lt: day.end },
		},
		_sum: { grams: true },
	});
	const usedTodayG = today._sum.grams ?? 0;
	const dailyCapG = dailyFeedCapG(device.hopperCapacityG);
	if (usedTodayG + feedGrams > dailyCapG) {
		return {
			ok: false,
			code: "daily_cap",
			error: `Daily feed limit reached — ${Math.round(dailyCapG)} g/day cap with ${Math.round(usedTodayG)} g already used today. Try again after midnight (Asia/Manila).`,
		};
	}

	const request = await db.feedRequest.create({
		data: {
			deviceId: input.deviceId,
			grams: feedGrams,
			status: "pending",
		},
	});

	await db.deviceStateEvent.create({
		data: {
			deviceId: input.deviceId,
			eventType: "manual_trigger",
			source: "user",
			actorId: input.actorId,
			metadata: { grams: feedGrams, triggerSource: input.triggerSource },
		},
	});

	return { ok: true, requestId: request.id, alreadyPending: false };
}

/**
 * Pause or resume a device's feeding schedule.
 *
 * The device rows and event are the same ones the dashboard writes. Resuming a
 * fallow pond is refused by the same rule as the tenant path.
 */
export async function setSchedulePause(
	db: CommandDb,
	input: {
		deviceId: string;
		isPaused: boolean;
		actorId: string;
		/** When set, the device must belong to a pond owned by this farm. */
		farmId?: string | null;
	},
): Promise<SchedulePauseOutcome> {
	const device = await db.energyDevice.findFirst({
		where: {
			id: input.deviceId,
			...(input.farmId ? { pond: { ownerId: input.farmId } } : {}),
		},
		select: { id: true, isPaused: true, pond: { select: { isFallow: true } } },
	});

	if (!device) {
		return { ok: false, code: "device_not_found", error: "Device not found or access denied" };
	}
	if (!input.isPaused && device.pond?.isFallow) {
		return {
			ok: false,
			code: "pond_fallow",
			error:
				"This pond is fallow after harvest. Start the next grow-out cycle before resuming feeding.",
		};
	}

	await db.energyDevice.update({
		where: { id: device.id },
		data: { isPaused: input.isPaused },
	});

	await db.deviceStateEvent.create({
		data: {
			deviceId: device.id,
			eventType: "pause_toggled",
			source: "user",
			actorId: input.actorId,
			metadata: { isPaused: input.isPaused },
		},
	});

	return { ok: true, wasPaused: device.isPaused };
}
