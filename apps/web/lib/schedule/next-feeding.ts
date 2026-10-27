/**
 * When the feeder dispenses next, from the effective schedule.
 *
 * The firmware spreads `feedsPerDay` meals evenly between the start and end
 * hour, so the slot list is `start + i * interval`. This mirrors the dashboard
 * home page's computation exactly (including the machine-local `setHours`
 * semantics) so the hero and the next-feeding strip can never disagree.
 *
 * Times are stored as `@db.Time`, which Prisma hands back as a `Date` whose UTC
 * hours are the configured hour of day — hence `getUTCHours()`.
 */
export interface NextFeedingInput {
	scheduleStart: Date;
	scheduleEnd: Date;
	feedsPerDay: number;
	now?: Date;
}

export function nextFeedingAt({
	scheduleStart,
	scheduleEnd,
	feedsPerDay,
	now = new Date(),
}: NextFeedingInput): Date {
	const startHour = scheduleStart.getUTCHours();
	const endHour = scheduleEnd.getUTCHours();
	const feeds = Math.max(1, feedsPerDay);
	const interval = (endHour - startHour) / Math.max(1, feeds - 1);

	for (let index = 0; index < feeds; index++) {
		const candidate = new Date(now);
		candidate.setHours(startHour + index * interval, 0, 0, 0);
		if (candidate > now) return candidate;
	}

	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(startHour, 0, 0, 0);
	return tomorrow;
}
