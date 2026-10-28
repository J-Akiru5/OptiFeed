import { withApi } from "@/lib/api/instrumentation";
import { PH_UTC_OFFSET_MINUTES, REQUEST_EXPIRY_MS } from "@/lib/constants";
import { isDeviceApproved, verifyDeviceToken } from "@/lib/device-auth";
import {
	BUTTON_FEED_GRAMS_MAX,
	BUTTON_FEED_GRAMS_MIN,
	GRAMS_PER_SECOND_MAX,
	GRAMS_PER_SECOND_MIN,
	MAX_FEED_GRAMS_PER_REQUEST,
	TEMP_OFFSET_C_MAX,
	TEMP_OFFSET_C_MIN,
	clamp,
} from "@/lib/limits";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type DeviceConfig = {
	gramsPerFeeding: number;
	buttonFeedGrams: number;
	hopperEmptyCm: number | null;
	hopperFullCm: number | null;
	gramsPerSecond: number;
	tempOffsetC: number;
};

function deviceConfig(device: DeviceConfig) {
	return {
		grams_per_feeding: clamp(device.gramsPerFeeding, 0, MAX_FEED_GRAMS_PER_REQUEST),
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

		const { success } = await checkDeviceRateLimit(deviceId, "feed");
		if (!success) {
			return new Response("Too Many Requests", { status: 429 });
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

				return Response.json({
					feed_requested: true,
					feed_request_id: pendingRequest.id,
					grams: clamp(pendingRequest.grams, 0, MAX_FEED_GRAMS_PER_REQUEST),
					...deviceConfig(device),
				});
			}

			return Response.json({
				feed_requested: false,
				feed_request_id: null,
				grams: 0,
				...deviceConfig(device),
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
