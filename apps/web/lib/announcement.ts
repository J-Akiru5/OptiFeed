import { z } from "zod";

/**
 * Platform announcement, shared by the writer (server action), the reader
 * (tenant layouts) and their tests (E16.4, task I-15).
 *
 * One row in `PlatformSetting` under `announcement.current`; no schema change.
 * The value is user input read by every tenant layout, so both the stored shape
 * and the dates are validated on the way in and on the way out. An expired
 * announcement is simply not active; nothing has to delete it.
 */

export const ANNOUNCEMENT_KEY = "announcement.current";
export const ANNOUNCEMENT_SEVERITIES = ["info", "warning"] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export const ANNOUNCEMENT_TITLE_MAX = 100;
export const ANNOUNCEMENT_BODY_MAX = 500;

export interface Announcement {
	id: string;
	title: string;
	body: string;
	severity: AnnouncementSeverity;
	/** ISO instant after which the banner stops; null means no end date. */
	endsAt: string | null;
	publishedAt: string;
	createdById: string | null;
}

export const announcementInputSchema = z.object({
	title: z.string().trim().min(3).max(ANNOUNCEMENT_TITLE_MAX),
	body: z.string().trim().min(3).max(ANNOUNCEMENT_BODY_MAX),
	severity: z.enum(ANNOUNCEMENT_SEVERITIES),
	/** `YYYY-MM-DD` or null. Converted to the end of that UTC day. */
	endsOn: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable(),
});

type AnnouncementInput = z.infer<typeof announcementInputSchema>;

/**
 * End of the chosen day as an ISO instant, or null when the date is not a real
 * calendar day (2026-02-31 is rejected rather than rolled into March).
 */
export function endOfDayIso(dateOnly: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
	const end = new Date(`${dateOnly}T23:59:59.999Z`);
	if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== dateOnly) return null;
	return end.toISOString();
}

function isIsoInstant(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) return false;
	const parsed = new Date(value);
	return !Number.isNaN(parsed.getTime());
}

/**
 * Validate a stored JSON value.
 *
 * Anything malformed returns null instead of a half-rendered banner: the
 * setting is user input and a reader must fail closed.
 */
export function normalizeAnnouncement(value: unknown): Announcement | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;

	const id = typeof row.id === "string" ? row.id : null;
	const title = typeof row.title === "string" ? row.title.trim() : "";
	const body = typeof row.body === "string" ? row.body.trim() : "";
	const severity = row.severity;
	const publishedAt = row.publishedAt;
	const endsAt = row.endsAt ?? null;

	if (!id || id.length > 100) return null;
	if (title.length < 3 || title.length > ANNOUNCEMENT_TITLE_MAX) return null;
	if (body.length < 3 || body.length > ANNOUNCEMENT_BODY_MAX) return null;
	if (!ANNOUNCEMENT_SEVERITIES.includes(severity as AnnouncementSeverity)) return null;
	if (!isIsoInstant(publishedAt)) return null;
	if (endsAt !== null && !isIsoInstant(endsAt)) return null;

	return {
		id,
		title,
		body,
		severity: severity as AnnouncementSeverity,
		endsAt: endsAt === null ? null : (endsAt as string),
		publishedAt,
		createdById: typeof row.createdById === "string" ? row.createdById : null,
	};
}

/** Active means published and not past its end date (inclusive to the end). */
export function isAnnouncementActive(announcement: Announcement, now: Date = new Date()): boolean {
	const published = new Date(announcement.publishedAt).getTime();
	if (!Number.isFinite(published) || published > now.getTime()) return false;
	if (announcement.endsAt === null) return true;
	const ends = new Date(announcement.endsAt).getTime();
	return Number.isFinite(ends) && ends > now.getTime();
}
