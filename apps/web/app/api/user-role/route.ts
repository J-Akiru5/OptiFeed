import prisma from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
	const farmId = request.nextUrl.searchParams.get("farmId");

	if (!farmId) {
		return NextResponse.json({ role: null }, { status: 400 });
	}

	const user = await prisma.user.findUnique({
		where: { farmId: farmId.toLowerCase() },
		select: { role: true },
	});

	return NextResponse.json({ role: user?.role ?? null });
}
