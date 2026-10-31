import { withApi } from "@/lib/api/instrumentation";
import { PH_UTC_OFFSET_MINUTES, REQUEST_EXPIRY_MS } from "@/lib/constants";
import { isDeviceApproved, verifyDeviceToken } from "@/lib/device-auth";
import { buildFirmwareConfig } from "@/lib/firmware/config";
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

export const dynamic = "force-dynamic";

type DeviceConfig = {
	gramsPerFeeding: number;
	buttonFeedGrams: number;
	hopperEmptyCm: number | null;
	hopperFullCm: number | null;
	gramsPerSecond: number;
	tempOffsetC: number;
	hopperCapacityG: number | null;
	dailyCapG: number | null;
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
	const [feedingLimits, gates, deviceStatus] = await Promise.all([
		getFeedingLimits(),
		getFirmwareGates(),
		getDeviceStatusSetting(),
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
		},
		gates,
		deviceStatus: {
			weakAfterMin: deviceStatus.weakAfterMin,
			offlineAfterMin: deviceStatus.offlineAfterMin,
		},
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

			const pendingRequest = await prisma.feedRequest.findFirst({
				where: {
					deviceId: device.id,
					status: "pending",
				},
				orderBy: { createdAt: "asc" },
			});

			if (pendingRequest) {
				await prisma.feedRequest.update({
					where: { id: pendingRequest.id },
					data: { status: "dispatched" },
				});

				// The 5,000 g clamp is a payload sanity bound, not a feed cap: the
				// daily ceiling is enforced when the request is queued.
				const calibration = pendingRequest.kind === "calibration";

				return Response.json({
					feed_requested: true,
					feed_request_id: pendingRequest.id,
					grams: clamp(pendingRequest.grams, 0, MAX_ACCEPTED_FEED_GRAMS),
					calibration,
					...deviceConfig(device),
					config: await firmwareConfigFor(device),
				});
			}

			return Response.json({
				feed_requested: false,
				feed_request_id: null,
				grams: 0,
				calibration: false,
				...deviceConfig(device),
				config: await firmwareConfigFor(device),
			});
		} catch (error) {
			reportError(error, { route: "feed-command", deviceId: device?.id ?? deviceId });
			// Return safe idle state so ESP32 doesn't hang
			return Response.json({
				feed_requested: false,
				feed_request_id: null,
				grams: 0,
				grams_per_feeding: 150,
				button_feed_grams: 80,
				hopper_empty_cm: null,
				hopper_full_cm: null,
				grams_per_second: 4.0,
				temp_offset_c: 0,
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
