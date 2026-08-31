"use server";

import { redirect } from "@/i18n/routing";
import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "optifeed:pondId";

/**
 * Switch the active pond by setting a cookie.
 * Validates that the pond belongs to the current user.
 */
export async function switchPond(pondId: string) {
	const locale = await getLocale();
	const ownerId = await getCurrentPondOwnerId();

	const pond = await prisma.pond.findFirst({
		where: { id: pondId, ownerId },
		select: { id: true },
	});

	if (!pond) {
		throw new Error("Pond not found or access denied");
	}

	const cookieStore = await cookies();
	cookieStore.set(COOKIE_NAME, pond.id, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 365, // 1 year
	});

	redirect({ href: "/dashboard", locale });
}
