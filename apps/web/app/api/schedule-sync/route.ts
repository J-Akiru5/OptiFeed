import { withApi } from "@/lib/api/instrumentation";
import { isDeviceApproved, verifyDeviceToken } from "@/lib/device-auth";
import {
	BUTTON_FEED_GRAMS_MAX,
	BUTTON_FEED_GRAMS_MIN,
	FEEDING_RATE_PCT_MAX,
	FEEDING_RATE_PCT_MIN,
	FEEDS_PER_DAY_MAX,
	FEEDS_PER_DAY_MIN,
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

// Formats a Prisma Time (DateTime mapped to JS Date) to "HH:MM" 24h string.
function formatTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

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
	};
}

function scheduleValues(feedsPerDay: number | null, feedingRatePct: number | null) {
	return {
		feeds_per_day:
			feedsPerDay === null
				? null
				: Math.round(clamp(feedsPerDay, FEEDS_PER_DAY_MIN, FEEDS_PER_DAY_MAX)),
		feeding_rate_pct:
			feedingRatePct === null
				? null
				: clamp(feedingRatePct, FEEDING_RATE_PCT_MIN, FEEDING_RATE_PCT_MAX),
	};
}

const MANUAL_TIME_SYNC_WINDOW_MS = 10 * 60_000;

type TimeSyncFields = {
	server_time: string;
	time_sync: string | null;
};

/**
 * Clock fields the ESP32 applies on every poll:
 * - `time_sync` is a manual calibration requested from the dashboard within
 *   the last 10 minutes; the firmware applies it verbatim.
 * - `server_time` is the current UTC instant; the firmware uses it to correct
 *   RTC drift when no manual time is pending (#149).
 */
async function timeSyncFields(deviceId: string): Promise<TimeSyncFields> {
	const manual = await prisma.deviceStateEvent.findFirst({
		where: {
			deviceId,
			eventType: "set_time",
			source: "user",
			deviceTime: { not: null },
			createdAt: { gte: new Date(Date.now() - MANUAL_TIME_SYNC_WINDOW_MS) },
		},
		orderBy: { createdAt: "desc" },
		select: { deviceTime: true },
	});
	return {
		server_time: new Date().toISOString(),
		time_sync: manual?.deviceTime ?? null,
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

		const { success } = await checkDeviceRateLimit(deviceId, "schedule");
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

			const timeSync = await timeSyncFields(device.id);

			if (!device.pondId) {
				return Response.json({
					...timeSync,
					schedule_changed: false,
					command_id: null,
					schedule_start: null,
					schedule_end: null,
					...scheduleValues(null, null),
					...deviceConfig(device),
				});
			}

			// Find the latest pending/sent schedule command for this device.
			const pendingCommand = await prisma.scheduleCommand.findFirst({
				where: {
					deviceId: device.id,
					status: { in: ["pending", "sent"] },
				},
				orderBy: { createdAt: "desc" },
			});

			if (pendingCommand) {
				// The command is re-sent on every poll until the device acks it, so
				// a lost response is recovered. Only the pending → sent transition
				// is audited: writing `command_sent` on every 5 s poll would grow
				// DeviceStateEvent without bound.
				const marked = await prisma.scheduleCommand.updateMany({
					where: { id: pendingCommand.id, status: "pending" },
					data: { status: "sent" },
				});

				if (marked.count > 0) {
					await prisma.deviceStateEvent.create({
						data: {
							deviceId: device.id,
							eventType: "command_sent",
							source: "system",
							metadata: {
								commandId: pendingCommand.id,
								scheduleStart: formatTime(pendingCommand.scheduleStart),
								scheduleEnd: formatTime(pendingCommand.scheduleEnd),
								feedsPerDay: pendingCommand.feedsPerDay,
								feedingRatePct: pendingCommand.feedingRatePct,
							},
						},
					});
				}

				return Response.json({
					...timeSync,
					schedule_changed: true,
					command_id: pendingCommand.id,
					schedule_start: formatTime(pendingCommand.scheduleStart),
					schedule_end: formatTime(pendingCommand.scheduleEnd),
					...scheduleValues(pendingCommand.feedsPerDay, pendingCommand.feedingRatePct),
					...deviceConfig(device),
				});
			}

			// No pending changes — return current pond settings as baseline.
			const pond = await prisma.pond.findUnique({
				where: { id: device.pondId },
				select: { scheduleStart: true, scheduleEnd: true, feedsPerDay: true, feedingRatePct: true },
			});

			if (pond) {
				return Response.json({
					...timeSync,
					schedule_changed: false,
					command_id: null,
					schedule_start: formatTime(pond.scheduleStart),
					schedule_end: formatTime(pond.scheduleEnd),
					...scheduleValues(pond.feedsPerDay, pond.feedingRatePct),
					...deviceConfig(device),
				});
			}

			return Response.json({
				...timeSync,
				schedule_changed: false,
				command_id: null,
				schedule_start: null,
				schedule_end: null,
				...scheduleValues(null, null),
				...deviceConfig(device),
			});
		} catch (error) {
			reportError(error, { route: "schedule-sync", deviceId: device?.id ?? deviceId });
			// Return safe defaults so ESP32 doesn't hang
			return Response.json({
				server_time: new Date().toISOString(),
				time_sync: null,
				schedule_changed: false,
				command_id: null,
				schedule_start: null,
				schedule_end: null,
				feeds_per_day: null,
				feeding_rate_pct: null,
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
	// envelope. Instrumentation headers still apply.
	{
		route: "GET /api/schedule-sync",
		shape: "passthrough",
		cacheControl: "no-store",
		timeoutMs: 5_000,
	},
);
