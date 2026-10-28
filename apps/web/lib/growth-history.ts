import type { DateRange } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { computeSgr, elapsedFarmDays } from "@/lib/sgr";

export const GROWTH_HISTORY_TABS = ["feed", "growth", "biomass"] as const;
export type GrowthHistoryTab = (typeof GROWTH_HISTORY_TABS)[number];

export function isGrowthHistoryTab(value: string | undefined): value is GrowthHistoryTab {
	return !!value && (GROWTH_HISTORY_TABS as readonly string[]).includes(value);
}

interface PageSlice {
	page: number;
	pageSize: number;
	range?: DateRange;
}

export interface FeedLevelHistoryRow {
	id: string;
	recordedAt: Date;
	levelPercent: number;
	distanceCm: number;
}

export interface BiomassHistoryRow {
	id: string;
	recordedAt: Date;
	batchLabel: string | null;
	source: string | null;
	sampleWeightKg: number;
	sampleCount: number;
	sampleLengthCm: number;
	avgWeightKg: number;
	fishSamples: { id: string; weightGrams: number; lengthCm: number }[];
}

export interface GrowthHistoryRow {
	id: string;
	recordedAt: Date;
	batchLabel: string | null;
	avgWeightG: number;
	sampleLengthCm: number;
	weightGainG: number | null;
	lengthGainCm: number | null;
	daysSinceLast: number | null;
	/** SGR against the previous sampling; null for the first sample (or invalid intervals). */
	sgrPctPerDay: number | null;
}

function dateWhere(range?: DateRange) {
	return range && (range.gte || range.lt) ? { recordedAt: range } : {};
}

export async function getFeedLevelHistory(params: PageSlice & { deviceId: string }) {
	const where = { deviceId: params.deviceId, ...dateWhere(params.range) };
	const [total, items] = await Promise.all([
		prisma.feedLevelLog.count({ where }),
		prisma.feedLevelLog.findMany({
			where,
			orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
			skip: (params.page - 1) * params.pageSize,
			take: params.pageSize,
			select: { id: true, recordedAt: true, levelPercent: true, distanceCm: true },
		}),
	]);
	return { total, items: items as FeedLevelHistoryRow[] };
}

export async function getBiomassHistory(params: PageSlice & { pondId: string }) {
	const where = { pondId: params.pondId, ...dateWhere(params.range) };
	const [total, items] = await Promise.all([
		prisma.biomassLog.count({ where }),
		prisma.biomassLog.findMany({
			where,
			orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
			skip: (params.page - 1) * params.pageSize,
			take: params.pageSize,
			include: {
				fishSamples: { select: { id: true, weightGrams: true, lengthCm: true } },
			},
		}),
	]);
	return { total, items: items as BiomassHistoryRow[] };
}

/**
 * Growth summary needs one extra, older row to compute the gain of the last
 * row on the page, so it fetches `pageSize + 1` and drops the extra.
 */
export async function getGrowthHistory(params: PageSlice & { pondId: string }) {
	const where = { pondId: params.pondId, ...dateWhere(params.range) };
	const [total, rows] = await Promise.all([
		prisma.biomassLog.count({ where }),
		prisma.biomassLog.findMany({
			where,
			orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
			skip: (params.page - 1) * params.pageSize,
			take: params.pageSize + 1,
			select: {
				id: true,
				recordedAt: true,
				batchLabel: true,
				avgWeightKg: true,
				sampleLengthCm: true,
			},
		}),
	]);

	const items: GrowthHistoryRow[] = rows.slice(0, params.pageSize).map((row, index) => {
		const older = rows[index + 1] ?? null;
		// Farm calendar days, not UTC milliseconds: a sample at 00:30 Manila and
		// one at 23:30 the same farm day are the same day even though 23 hours
		// separate them in UTC. SGR already counts farm days, so the column now
		// agrees with it.
		const elapsed = older ? elapsedFarmDays(older.recordedAt, row.recordedAt) : null;
		const daysSinceLast = elapsed === null ? null : Math.max(0, Math.round(elapsed));
		return {
			id: row.id,
			recordedAt: row.recordedAt,
			batchLabel: row.batchLabel,
			avgWeightG: row.avgWeightKg * 1000,
			sampleLengthCm: row.sampleLengthCm,
			weightGainG: older ? row.avgWeightKg * 1000 - older.avgWeightKg * 1000 : null,
			lengthGainCm: older ? row.sampleLengthCm - older.sampleLengthCm : null,
			daysSinceLast,
			sgrPctPerDay: older
				? computeSgr(older.avgWeightKg, older.recordedAt, row.avgWeightKg, row.recordedAt)
				: null,
		};
	});

	return { total, items };
}
