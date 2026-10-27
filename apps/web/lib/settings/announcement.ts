import {
	ANNOUNCEMENT_KEY,
	type Announcement,
	isAnnouncementActive,
	normalizeAnnouncement,
} from "@/lib/announcement";
import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * Read the active platform announcement (E16.4, task I-15).
 *
 * Wrapped in React `cache` because both the dashboard and the admin layout
 * render it in the same request. Fails closed: a missing row, a corrupt value,
 * an expired end date or an unreadable table all render no banner. The banner
 * is decoration for the app, never a reason for a page to fail.
 */
export const getActiveAnnouncement = cache(async (): Promise<Announcement | null> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: ANNOUNCEMENT_KEY },
			select: { value: true },
		});
		const announcement = normalizeAnnouncement(row?.value);
		if (!announcement) return null;
		return isAnnouncementActive(announcement) ? announcement : null;
	} catch {
		return null;
	}
});

/** Read the stored announcement even when expired, for the admin page. */
export async function getStoredAnnouncement(): Promise<Announcement | null> {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: ANNOUNCEMENT_KEY },
			select: { value: true },
		});
		return normalizeAnnouncement(row?.value);
	} catch {
		return null;
	}
}
