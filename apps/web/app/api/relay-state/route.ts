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
		select: { mac: true, relayState: true },
	});

	if (!device || device.mac !== deviceId) {
		return new Response("Unauthorized", { status: 401 });
	}

	return Response.json({ relay_state: device.relayState });
}
