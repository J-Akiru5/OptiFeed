import {
	STICKER_RATING_KEY,
	type StickerRatingValues,
	normalizeStickerRating,
} from "@/lib/constants/sticker-rating";
import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * The saved default sticker rating (decision E17, issue #197).
 *
 * Written only by a platform admin from the print page. The row may be
 * missing or hold an old/corrupt shape; both fall back to the label constants
 * in `lib/constants/hardware-rating.ts`, so a bad setting can never print a
 * nonsensical rating.
 */
export const getStickerRatingDefault = cache(async (): Promise<StickerRatingValues | null> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: STICKER_RATING_KEY },
			select: { value: true },
		});
		return normalizeStickerRating(row?.value);
	} catch {
		// A missing table/row or a transient read failure must not break a print.
		return null;
	}
});
