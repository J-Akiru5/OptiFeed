import prisma from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ingestSchema = z.object({
	device_id: z.string().min(1),
	timestamp: z.string().datetime({ offset: true }),
	relay_state: z.boolean(),
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

	const parsed = ingestSchema.safeParse(body);
	if (!parsed.success) {
		return new Response("Unprocessable Entity", { status: 422 });
	}

	const payload = parsed.data;
	if (payload.device_id !== device.mac) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < RATE_LIMIT_MS) {
		return new Response("Too Many Requests", { status: 429 });
	}

	const timestamp = new Date(payload.timestamp);

	await prisma.$transaction([
		prisma.energyDevice.update({
			where: { id: device.id },
			data: { lastSeenAt: new Date() },
		}),
		prisma.energyReading.create({
			data: {
				deviceId: device.id,
				timestamp,
				relayState: payload.relay_state,
			},
		}),
	]);

	return new Response(null, { status: 204 });
}
