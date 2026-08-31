import { withAuth } from "@/lib/auth/with-auth";
import prisma from "@/lib/prisma";

export const GET = withAuth(async (_request, { ownerId }) => {
	const user = await prisma.user.findUnique({
		where: { farmId: ownerId },
		select: { role: true },
	});

	return Response.json({ role: user?.role ?? null });
});
