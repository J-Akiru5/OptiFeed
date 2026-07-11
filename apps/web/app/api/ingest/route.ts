import prisma from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const baseSchema = z.object({
	device_id: z.string().min(1),
	event_type: z.enum(["heartbeat", "feed_dispensed"]),
	timestamp: z.string(),
});

const heartbeatSchema = baseSchema.extend({
	rtc_ok: z.boolean(),
	feeder_active: z.boolean(),
});

const feedDispensedSchema = baseSchema.extend({
	grams: z.number().positive(),
	source: z.enum(["scheduled", "dashboard", "button"]),
	feed_request_id: z.string().nullable().optional(),
});

const RATE_LIMIT_MS = 1000;

export async function POST(request: Request) {
	const token = request.headers.get("x-device-token");
	if (!token) {
		return new Response("Unauthorized", { status: 401 });
	}

	const device = await prisma.energyDevice.findUnique({
		where: { token },
		select: { id: true, mac: true, lastSeenAt: true },
	});

	if (!device) {
		return new Response("Unauthorized", { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response("Unprocessable Entity", { status: 422 });
	}

	const baseParsed = baseSchema.safeParse(body);
	if (!baseParsed.success) {
		return new Response("Unprocessable Entity", { status: 422 });
	}

	if (baseParsed.data.device_id !== device.mac) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < RATE_LIMIT_MS) {
		return new Response("Too Many Requests", { status: 429 });
	}

	const eventType = baseParsed.data.event_type;

	if (eventType === "heartbeat") {
		const parsed = heartbeatSchema.parse(body);

		await prisma.$transaction([
			prisma.energyDevice.update({
				where: { id: device.id },
				data: {
					lastSeenAt: new Date(),
					rtcOk: parsed.rtc_ok,
					feederActive: parsed.feeder_active,
				},
			}),
			prisma.feedEvent.create({
				data: {
					deviceId: device.id,
					eventType: "heartbeat",
					timestamp: parsed.timestamp,
					rtcOk: parsed.rtc_ok,
					feederActive: parsed.feeder_active,
				},
			}),
		]);
	} else if (eventType === "feed_dispensed") {
		const parsed = feedDispensedSchema.parse(body);

		await prisma.$transaction([
			prisma.energyDevice.update({
				where: { id: device.id },
				data: { lastSeenAt: new Date() },
			}),
			prisma.feedEvent.create({
				data: {
					deviceId: device.id,
					eventType: "feed_dispensed",
					timestamp: parsed.timestamp,
					grams: parsed.grams,
					source: parsed.source,
					feedRequestId: parsed.feed_request_id ?? null,
				},
			}),
			...(parsed.feed_request_id
				? [
						prisma.feedRequest.updateMany({
							where: {
								id: parsed.feed_request_id,
								deviceId: device.id,
								status: "dispatched",
							},
							data: { status: "completed" },
						}),
					]
				: []),
		]);
	}

	return new Response(null, { status: 204 });
}
