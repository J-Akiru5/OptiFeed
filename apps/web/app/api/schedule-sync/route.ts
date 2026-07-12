import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Formats a Prisma Time (DateTime mapped to JS Date) to "HH:MM" 24h string.
function formatTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export async function GET(request: Request) {
	const token = request.headers.get("x-device-token");
	if (!token) {
		return new Response("Unauthorized", { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const deviceId = searchParams.get("device_id");
	if (!deviceId) {
		return new Response("Unprocessable Entity", { status: 422 });
	}

	const device = await prisma.energyDevice.findUnique({
		where: { token },
		select: { id: true, mac: true, gramsPerFeeding: true, buttonFeedGrams: true, pondId: true },
	});

	if (!device || device.mac !== deviceId) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (!device.pondId) {
		return Response.json({
			schedule_changed: false,
			command_id: null,
			schedule_start: null,
			schedule_end: null,
			feeds_per_day: null,
			feeding_rate_pct: null,
			grams_per_feeding: device.gramsPerFeeding,
			button_feed_grams: device.buttonFeedGrams,
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
		// Mark as "sent" so we don't return it again until it's acked or failed.
		await prisma.scheduleCommand.update({
			where: { id: pendingCommand.id },
			data: { status: "sent" },
		});

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

		return Response.json({
			schedule_changed: true,
			command_id: pendingCommand.id,
			schedule_start: formatTime(pendingCommand.scheduleStart),
			schedule_end: formatTime(pendingCommand.scheduleEnd),
			feeds_per_day: pendingCommand.feedsPerDay,
			feeding_rate_pct: pendingCommand.feedingRatePct,
			grams_per_feeding: device.gramsPerFeeding,
			button_feed_grams: device.buttonFeedGrams,
		});
	}

	// No pending changes — return current pond settings as baseline.
	const pond = await prisma.pond.findUnique({
		where: { id: device.pondId },
		select: { scheduleStart: true, scheduleEnd: true, feedsPerDay: true, feedingRatePct: true },
	});

	if (pond) {
		return Response.json({
			schedule_changed: false,
			command_id: null,
			schedule_start: formatTime(pond.scheduleStart),
			schedule_end: formatTime(pond.scheduleEnd),
			feeds_per_day: pond.feedsPerDay,
			feeding_rate_pct: pond.feedingRatePct,
			grams_per_feeding: device.gramsPerFeeding,
			button_feed_grams: device.buttonFeedGrams,
		});
	}

	return Response.json({
		schedule_changed: false,
		command_id: null,
		schedule_start: null,
		schedule_end: null,
		feeds_per_day: null,
		feeding_rate_pct: null,
		grams_per_feeding: device.gramsPerFeeding,
		button_feed_grams: device.buttonFeedGrams,
	});
}
