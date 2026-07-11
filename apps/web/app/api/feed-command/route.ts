import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
		select: { id: true, mac: true, gramsPerFeeding: true },
	});

	if (!device || device.mac !== deviceId) {
		return new Response("Unauthorized", { status: 401 });
	}

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
		});
	}

	return Response.json({
		feed_requested: false,
		feed_request_id: null,
		grams: 0,
		grams_per_feeding: device.gramsPerFeeding,
	});
}
