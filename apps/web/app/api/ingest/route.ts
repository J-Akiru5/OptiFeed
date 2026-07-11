import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const baseSchema = z.object({
	device_id: z.string().min(1),
	event_type: z.enum(["heartbeat", "feed_dispensed"]),
	timestamp: z.string().min(1),
	event_id: z.string().min(8).optional(),
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

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function POST(request: Request) {
	const token = request.headers.get("x-device-token");
	if (!token) {
		return new Response("Unauthorized", { status: 401 });
	}

	const device = await prisma.energyDevice.findUnique({
		where: { token },
		select: { id: true, mac: true, lastSeenAt: true, pondId: true, label: true },
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
	const eventId = baseParsed.data.event_id ?? null;

	if (eventType === "heartbeat") {
		const parsed = heartbeatSchema.safeParse(body);
		if (!parsed.success) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		try {
			await prisma.$transaction([
				prisma.energyDevice.update({
					where: { id: device.id },
					data: {
						lastSeenAt: new Date(),
						rtcOk: parsed.data.rtc_ok,
						feederActive: parsed.data.feeder_active,
					},
				}),
				prisma.feedEvent.create({
					data: {
						deviceId: device.id,
						eventId,
						eventType: "heartbeat",
						timestamp: parsed.data.timestamp,
						rtcOk: parsed.data.rtc_ok,
						feederActive: parsed.data.feeder_active,
					},
				}),
			]);
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			throw error;
		}
	} else if (eventType === "feed_dispensed") {
		const parsed = feedDispensedSchema.safeParse(body);
		if (!parsed.success) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		const sourceLabel = { scheduled: "Scheduled", dashboard: "Dashboard", button: "Button" }[
			parsed.data.source
		];

		try {
			await prisma.$transaction([
				prisma.energyDevice.update({
					where: { id: device.id },
					data: { lastSeenAt: new Date() },
				}),
				prisma.feedEvent.create({
					data: {
						deviceId: device.id,
						eventId,
						eventType: "feed_dispensed",
						timestamp: parsed.data.timestamp,
						grams: parsed.data.grams,
						source: parsed.data.source,
						feedRequestId: parsed.data.feed_request_id ?? null,
					},
				}),
				...(parsed.data.feed_request_id
					? [
							prisma.feedRequest.updateMany({
								where: {
									id: parsed.data.feed_request_id,
									deviceId: device.id,
									status: "dispatched",
								},
								data: { status: "completed" },
							}),
						]
					: []),
				...(device.pondId
					? [
							prisma.notification.create({
								data: {
									pondId: device.pondId,
									tier: "SUCCESS",
									message: `Manual feed completed — ${parsed.data.grams}g dispensed by ${device.label}`,
								},
							}),
						]
					: []),
			]);
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			throw error;
		}
	}

	return new Response(null, { status: 204 });
}
