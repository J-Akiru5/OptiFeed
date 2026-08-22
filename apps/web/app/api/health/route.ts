import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		await prisma.$queryRaw`SELECT 1`;
		return Response.json({
			status: "ok",
			db: "connected",
			timestamp: new Date().toISOString(),
		});
	} catch {
		return Response.json(
			{ status: "error", db: "disconnected", timestamp: new Date().toISOString() },
			{ status: 503 },
		);
	}
}
