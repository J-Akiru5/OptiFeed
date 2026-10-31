import { STALE_DISPATCHED_MS } from "@/lib/constants";
import { DEVICE_HEALTH_EVENT, healthFromMetadata } from "@/lib/device-health-model";
import { isDeviceUnreachable } from "@/lib/device-status";
import { manilaDayRange } from "@/lib/feed/day";
import {
	MAX_ACCEPTED_FEED_GRAMS,
	feedNowLimitMessage,
	resolveDailyCapG,
	resolveFeedNowLimitG,
} from "@/lib/limits";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
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
	| "safe_mode"
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

/**
 * Queue a manual feed for a device.
 *
 * Order matters: scope, fallow, stale cleanup, offline, basic amount validation,
 * duplicate checks, the remaining daily ceiling, relay-time cap, then the
 * write. The daily ceiling is the only gram cap; a refusal returns a code and
 * message and writes no FeedRequest, so a remote command that safety rejects
 * can never look like it was accepted.
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
	if (isDeviceUnreachable(device.lastSeenAt, new Date(), await getDeviceStatusPolicy())) {
		return {
			ok: false,
			code: "offline",
			error: "Device is offline — feed request rejected. Retry once the device reconnects.",
		};
	}

	// A unit in safe mode has its relay locked off and refuses every dose, so
	// queueing one only strands it as "in progress". The state comes from the
	// newest `device_health` row (see lib/device-health.ts); a unit that never
	// reported one is treated as healthy.
	const latestHealth = await db.deviceStateEvent.findFirst({
		where: { deviceId: input.deviceId, eventType: DEVICE_HEALTH_EVENT },
		orderBy: { createdAt: "desc" },
		select: { metadata: true },
	});
	if (latestHealth && healthFromMetadata(latestHealth.metadata).safeMode) {
		return {
			ok: false,
			code: "safe_mode",
			error:
				"The feeder is in safe mode after repeated resets and refuses every dose. Check its power supply; it clears after 30 quiet minutes, or hold the Wi-Fi reset button for 5 seconds.",
		};
	}

	const requestedGrams = input.grams ?? device.gramsPerFeeding;
	if (!Number.isFinite(requestedGrams) || requestedGrams < 1) {
		return { ok: false, code: "invalid_grams", error: "Feed amount must be at least 1 g" };
	}
	// Sanity bound only, not a feed cap: the daily ceiling below is the limit.
	if (requestedGrams > MAX_ACCEPTED_FEED_GRAMS) {
		return {
			ok: false,
			code: "invalid_grams",
			error: `Feed amount cannot exceed ${MAX_ACCEPTED_FEED_GRAMS} g.`,
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

	// The platform factor and a calibrated hopper may only lower the daily ceiling.
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
		dailyCapG,
		usedTodayG,
	});

	// Issue #387 / #398: the remaining daily ceiling is the only gram cap. An
	// explicit amount over it is refused with the numbers and where to change
	// it; the default dose is clamped so the button still works for whatever
	// allowance is left.
	const explicitRequest = typeof input.grams === "number";
	if (explicitRequest && requestedGrams > feedNowLimit.effectiveG + 1e-9) {
		return { ok: false, code: "daily_cap", error: feedNowLimitMessage(feedNowLimit) };
	}

	const feedGrams = explicitRequest
		? requestedGrams
		: Math.min(requestedGrams, feedNowLimit.effectiveG);
	if (feedGrams < 1) {
		return {
			ok: false,
			code: "daily_cap",
			error: `${feedNowLimitMessage(feedNowLimit)} Try again after midnight (Asia/Manila).`,
		};
	}

	if (
		device.gramsPerSecond > 0 &&
		feedGrams / device.gramsPerSecond > limits.maxDispenseMs / 1000
	) {
		return {
			ok: false,
			code: "dispense_too_long",
			error: `Dose would need more than ${limits.maxDispenseMs / 1000} s of relay time at ${device.gramsPerSecond} g/s — add more meals per day or reduce the feed amount.`,
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
