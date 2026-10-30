import { OFFLINE_THRESHOLD_MS, STALE_DISPATCHED_MS } from "@/lib/constants";
import { manilaDayRange } from "@/lib/feed/day";
import { feedNowLimitMessage, resolveDailyCapG, resolveFeedNowLimitG } from "@/lib/limits";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
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
	| "per_meal_cap"
	| "dispense_too_long"
	| "in_progress"
	| "daily_cap";

export type ManualFeedOutcome =
	| { ok: true; requestId: string; alreadyPending: boolean }
	| { ok: false; code: ManualFeedFailureCode; error: string };

export type SchedulePauseOutcome =
	| { ok: true; wasPaused: boolean }
	| { ok: false; code: "device_not_found" | "pond_fallow"; error: string };

/**
 * Queue a manual feed for a device.
 *
 * Order matters: scope, fallow, stale cleanup, offline, basic amount validation,
 * duplicate checks, the effective Feed Now ceiling (pond per-meal, remaining
 * daily, absolute hard), relay-time cap, then the write. A refusal returns a
 * code and message and writes no FeedRequest, so a remote command that safety
 * rejects can never look like it was accepted.
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
			dailyCapG: true,
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

	const requestedGrams = input.grams ?? device.gramsPerFeeding;
	if (!Number.isFinite(requestedGrams) || requestedGrams < 1) {
		return { ok: false, code: "invalid_grams", error: "Feed amount must be at least 1 g" };
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

	// Platform safety caps may only tighten the hard-coded maxima.
	const limits = await getFeedingLimits();
	const dailyCapG = resolveDailyCapG({
		configuredCapG: device.dailyCapG,
		hopperCapacityG: device.hopperCapacityG,
		dailyCapFactor: limits.dailyCapFactor,
	});
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
	const feedNowLimit = resolveFeedNowLimitG({
		perMealG: device.gramsPerFeeding,
		dailyCapG,
		usedTodayG,
	});

	// Issue #387 / E30: a manual Feed Now may not exceed the pond per-meal
	// ceiling, the remaining daily ceiling, or the absolute safety ceiling.
	// An explicit amount is refused with the numbers and the setting to change;
	// the default dose is clamped so a pond configured above the hard ceiling
	// still has a usable button.
	const explicitRequest = typeof input.grams === "number";
	if (explicitRequest && requestedGrams > feedNowLimit.effectiveG + 1e-9) {
		const overHard = requestedGrams > feedNowLimit.hardCeilingG + 1e-9;
		const code: ManualFeedFailureCode = overHard
			? "invalid_grams"
			: requestedGrams > feedNowLimit.perMealCeilingG + 1e-9
				? "per_meal_cap"
				: "daily_cap";
		const prefix = code === "daily_cap" ? "Daily feed limit reached — " : "";
		return { ok: false, code, error: `${prefix}${feedNowLimitMessage(feedNowLimit)}` };
	}

	const feedGrams = explicitRequest
		? requestedGrams
		: Math.min(requestedGrams, feedNowLimit.effectiveG);
	if (feedGrams < 1) {
		return {
			ok: false,
			code: "daily_cap",
			error: `Daily feed limit reached — ${feedNowLimitMessage(feedNowLimit)} Try again after midnight (Asia/Manila).`,
		};
	}

	if (
		device.gramsPerSecond > 0 &&
		feedGrams / device.gramsPerSecond > limits.maxDispenseMs / 1000
	) {
		return {
			ok: false,
			code: "dispense_too_long",
			error: `Dose would need more than ${limits.maxDispenseMs / 1000} s of relay time at ${device.gramsPerSecond} g/s — reduce the feed amount.`,
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
