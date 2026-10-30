/**
 * The Asia/Manila day window (UTC+8) used by every daily feed ceiling.
 *
 * The timestamp columns store UTC, so a Manila day starts at 16:00 UTC on the
 * previous calendar day. Manual feeds, calibration runs and the Feed Now limit
 * must all aggregate over this window; one helper prevents them drifting apart.
 */
export function manilaDayRange(nowMs: number = Date.now()): { start: Date; end: Date } {
	const HOUR_MS = 60 * 60 * 1000;
	const DAY_MS = 24 * HOUR_MS;
	const startOfLocalDay = Math.floor((nowMs + 8 * HOUR_MS) / DAY_MS) * DAY_MS - 8 * HOUR_MS;
	return { start: new Date(startOfLocalDay), end: new Date(startOfLocalDay + DAY_MS) };
}
