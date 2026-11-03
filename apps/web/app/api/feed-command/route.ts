import { withApi } from "@/lib/api/instrumentation";
import { PH_UTC_OFFSET_MINUTES, REQUEST_EXPIRY_MS } from "@/lib/constants";
import { isDeviceApproved, verifyDeviceToken } from "@/lib/device-auth";
import { claimPendingFeedRequest } from "@/lib/feed/commands";
import { buildFirmwareConfig } from "@/lib/firmware/config";
import { hopperFilterOverrides } from "@/lib/firmware/hopper-filter";
import {
	BUTTON_FEED_GRAMS_MAX,
	BUTTON_FEED_GRAMS_MIN,
	GRAMS_PER_SECOND_MAX,
	GRAMS_PER_SECOND_MIN,
	MAX_ACCEPTED_FEED_GRAMS,
	TEMP_OFFSET_C_MAX,
	TEMP_OFFSET_C_MIN,
	clamp,
	resolveDailyCapG,
} from "@/lib/limits";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { checkDeviceRateLimit } from "@/lib/rate-limit";
import { getDeviceStatusSetting } from "@/lib/settings/device-status";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { getFirmwareGates } from "@/lib/settings/firmware-gates";
import { getOrgHopperLowPctForDevice } from "@/lib/settings/org-hopper";
import type { FeedRequest } from "@prisma/client";

export const dynamic = "force-dynamic";

type DeviceConfig = {
	id: string;
	pondId: string | null;
	gramsPerFeeding: number;
	buttonFeedGrams: number;
	hopperEmptyCm: number | null;
	hopperFullCm: number | null;
	gramsPerSecond: number;
	tempOffsetC: number;
	hopperCapacityG: number | null;
	dailyCapG: number | null;
	// #659: per-device hopper filter tuning; null keeps the firmware default.
	hopperRefillMarginPct: number | null;
	hopperRejectBelowCm: number | null;
	hopperRejectAboveMarginCm: number | null;
	hopperEmaAlpha: number | null;
	hopperJumpPct: number | null;
	hopperPersistCycles: number | null;
	hopperStateHoldS: number | null;
};

function deviceConfig(device: DeviceConfig) {
	return {
		grams_per_feeding: clamp(device.gramsPerFeeding, 0, MAX_ACCEPTED_FEED_GRAMS),
		button_feed_grams: clamp(device.buttonFeedGrams, BUTTON_FEED_GRAMS_MIN, BUTTON_FEED_GRAMS_MAX),
		hopper_empty_cm: device.hopperEmptyCm,
		hopper_full_cm: device.hopperFullCm,
		grams_per_second: clamp(device.gramsPerSecond, GRAMS_PER_SECOND_MIN, GRAMS_PER_SECOND_MAX),
		temp_offset_c: clamp(device.tempOffsetC, TEMP_OFFSET_C_MIN, TEMP_OFFSET_C_MAX),
		// The device RTC runs on farm-local time. These two fields let the
		// firmware link it to UTC and reset the daily counter at farm midnight.
		server_time_utc: new Date().toISOString(),
		farm_offset_minutes: PH_UTC_OFFSET_MINUTES,
	};
}

/**
 * The 1.7.0 `config` object (I-100). Device values and the resolved daily
 * ceiling overlay the stored platform gates, then every value is clamped into
 * the envelope the firmware enforces. `rev` is a hash of the whole object, so
 * the heartbeat echo tells ops whether the unit applied this exact config.
 */
async function firmwareConfigFor(device: DeviceConfig) {
	const [feedingLimits, gates, deviceStatus, orgHopperLowPct] = await Promise.all([
		getFeedingLimits(),
		getFirmwareGates(),
		getDeviceStatusSetting(),
		// #456: never throws; an unreadable org row yields the 20 % default here
		// rather than aborting the whole poll response.
		getOrgHopperLowPctForDevice(device),
	]);

	const dailyCapG = resolveDailyCapG({
		configuredCapG: device.dailyCapG,
		hopperCapacityG: device.hopperCapacityG,
		dailyCapFactor: feedingLimits.dailyCapFactor,
	});

	return buildFirmwareConfig({
		device: {
			gramsPerFeeding: device.gramsPerFeeding,
			buttonFeedGrams: device.buttonFeedGrams,
			gramsPerSecond: device.gramsPerSecond,
			tempOffsetC: device.tempOffsetC,
			hopperFullCm: device.hopperFullCm,
			hopperEmptyCm: device.hopperEmptyCm,
			dailyCapG,
			maxDispenseMs: feedingLimits.maxDispenseMs,
			// #659: only the keys this device has a value for are sent; the rest
			// keep the firmware's compile-time default.
			hopperFilter: hopperFilterOverrides({
				hopperRefillMarginPct: device.hopperRefillMarginPct,
				hopperRejectBelowCm: device.hopperRejectBelowCm,
				hopperRejectAboveMarginCm: device.hopperRejectAboveMarginCm,
				hopperEmaAlpha: device.hopperEmaAlpha,
				hopperJumpPct: device.hopperJumpPct,
				hopperPersistCycles: device.hopperPersistCycles,
				hopperStateHoldS: device.hopperStateHoldS,
			}),
		},
		gates,
		deviceStatus: {
			weakAfterMin: deviceStatus.weakAfterMin,
			offlineAfterMin: deviceStatus.offlineAfterMin,
		},
		org: { hopperLowPct: orgHopperLowPct },
	});
}

export const GET = withApi(
	async (request: Request) => {
		const token = request.headers.get("x-device-token");
		if (!token) {
			return new Response("Unauthorized", { status: 401 });
		}

		const { searchParams } = new URL(request.url);
		const deviceId = searchParams.get("device_id");
		if (!deviceId) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		let device: Awaited<ReturnType<typeof verifyDeviceToken>> = null;
		try {
			device = await verifyDeviceToken(token);

			if (!device || device.mac !== deviceId) {
				return new Response("Unauthorized", { status: 401 });
			}

			if (!isDeviceApproved(device)) {
				return new Response("Forbidden", { status: 403 });
			}

			// #330: the bucket is keyed on the *verified* MAC. Keying on the raw
			// `device_id` query param (unauthenticated) let anyone who knows a MAC
			// spend that device's budget and hold it at 429. A rejected token now
			// costs one indexed lookup and writes no bucket row.
			const { success } = await checkDeviceRateLimit(device.mac, "feed");
			if (!success) {
				return new Response("Too Many Requests", { status: 429 });
			}

			// #724: build the config before claiming the pending row. The helpers
			// behind it usually fall back instead of throwing, but if this does
			// fail the catch below answers 503 and the request is still `pending`,
			// so the device's next poll can claim it. Claiming first and failing
			// afterwards would mark a real feed dispatched and silently lose it.
			const config = await firmwareConfigFor(device);

			// Lazy expiry: mark any pending requests older than 60s as expired.
			// No cron needed — checked on every poll.
			await prisma.feedRequest.updateMany({
				where: {
					deviceId: device.id,
					status: "pending",
					createdAt: { lt: new Date(Date.now() - REQUEST_EXPIRY_MS) },
				},
				data: { status: "expired" },
			});

			let pendingRequest: FeedRequest | null = null;
			for (let attempt = 0; attempt < 3 && pendingRequest === null; attempt += 1) {
				const claim = await claimPendingFeedRequest(prisma, device.id);
				if (claim.status === "claimed") {
					pendingRequest = claim.request;
				} else if (claim.status === "empty") {
					break;
				}
				// "lost": another poll took this row; look for the next one.
			}

			if (pendingRequest) {
				// The 5,000 g clamp is a payload sanity bound, not a feed cap: the
				// daily ceiling is enforced when the request is queued.
				const calibration = pendingRequest.kind === "calibration";

				return Response.json({
					feed_requested: true,
					feed_request_id: pendingRequest.id,
					grams: clamp(pendingRequest.grams, 0, MAX_ACCEPTED_FEED_GRAMS),
					calibration,
					...deviceConfig(device),
					config,
				});
			}

			return Response.json({
				feed_requested: false,
				feed_request_id: null,
				grams: 0,
				calibration: false,
				...deviceConfig(device),
				config,
			});
		} catch (error) {
			reportError(error, { route: "feed-command", deviceId: device?.id ?? deviceId });
			// #724: an infrastructure failure is not an idle queue. Answering 200
			// with `feed_requested: false` made the firmware treat the poll as
			// successful and stop retrying, so a pending feed expired undelivered
			// while the dashboard saw a healthy poll. 503 sends the ESP32 back
			// around its existing 5 s loop; the safe idle JSON above is reserved
			// for a genuinely empty queue.
			return new Response("Service Unavailable", {
				status: 503,
				headers: { "Retry-After": "5" },
			});
		}
	},
	// Device (ESP32) contract: flat JSON is external and exempt from the §4
	// envelope. Instrumentation headers still apply; the device ignores them.
	{
		route: "GET /api/feed-command",
		shape: "passthrough",
		cacheControl: "no-store",
		timeoutMs: 5_000,
	},
);
