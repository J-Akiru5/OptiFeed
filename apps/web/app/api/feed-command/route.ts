import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const REQUEST_EXPIRY_MS = 60_000;

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
		select: { id: true, mac: true, gramsPerFeeding: true, buttonFeedGrams: true },
	});

	if (!device || device.mac !== deviceId) {
		return new Response("Unauthorized", { status: 401 });
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
			grams: pendingRequest.grams,
			grams_per_feeding: device.gramsPerFeeding,
			button_feed_grams: device.buttonFeedGrams,
		});
	}

	return Response.json({
		feed_requested: false,
		feed_request_id: null,
		grams: 0,
		grams_per_feeding: device.gramsPerFeeding,
		button_feed_grams: device.buttonFeedGrams,
	});
}
