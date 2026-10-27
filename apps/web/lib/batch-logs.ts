import type { BatchSummary } from "@/lib/batch-summary";
import { resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";

export const MAX_BATCH_LABEL_LENGTH = 64;

export type BatchFilter = { kind: "label"; label: string } | { kind: "unlabeled" };

export interface BatchLogEntry {
	id: string;
	recordedAt: Date;
	sampleCount: number;
	sampleWeightKg: number;
	avgWeightKg: number;
	sampleLengthCm: number;
	source: string | null;
	fishSamples: Array<{ id: string; weightGrams: number; lengthCm: number }>;
}

export interface BatchLogSummary {
	entryCount: number;
	totalSampleCount: number;
	totalWeightKg: number;
	avgWeightKg: number | null;
	firstRecordedAt: Date | null;
	lastRecordedAt: Date | null;
}

export interface BatchLogPage {
	total: number;
	entries: BatchLogEntry[];
	summary: BatchLogSummary;
}

export interface BatchSummaryPage {
	rows: BatchSummary[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * One numbered page of saved-batch cards.
 *
 * A batch is a group, not a row, so the rows are grouped in the database and
 * only the requested groups are selected. The unpaginated group-key pass only
 * counts batches; it never loads biomass rows into memory.
 */
export async function getBatchSummaryPage(params: {
	pondId: string;
	page: number;
	pageSize: number;
}): Promise<BatchSummaryPage> {
	const where = { pondId: params.pondId, batchLabel: { not: null } };
	const requestedPage = Math.max(1, Math.floor(params.page) || 1);
	const pageSize = Math.max(1, Math.floor(params.pageSize) || 1);

	const [groups, allGroups] = await Promise.all([
		prisma.biomassLog.groupBy({
			by: ["batchLabel"],
			where,
			_count: { _all: true },
			_sum: { sampleCount: true, sampleWeightKg: true },
			_max: { recordedAt: true },
			orderBy: { _max: { recordedAt: "desc" } },
			skip: (requestedPage - 1) * pageSize,
			take: pageSize,
		}),
		prisma.biomassLog.groupBy({
			by: ["batchLabel"],
			where,
			_count: { _all: true },
		}),
	]);

	const paging = resolvePagination(requestedPage, pageSize, allGroups.length);
	const selected =
		paging.page === requestedPage
			? groups
			: await prisma.biomassLog.groupBy({
					by: ["batchLabel"],
					where,
					_count: { _all: true },
					_sum: { sampleCount: true, sampleWeightKg: true },
					_max: { recordedAt: true },
					orderBy: { _max: { recordedAt: "desc" } },
					skip: paging.offset,
					take: paging.pageSize,
				});

	const rows: BatchSummary[] = selected.map((group) => {
		const totalSampleCount = group._sum.sampleCount ?? 0;
		const totalWeightKg = Math.round((group._sum.sampleWeightKg ?? 0) * 1000) / 1000;
		return {
			label: group.batchLabel,
			entryCount: group._count._all,
			lastSavedAt: group._max.recordedAt ?? new Date(0),
			totalSampleCount,
			totalWeightKg,
			avgWeightKg:
				totalSampleCount > 0 ? Math.round((totalWeightKg / totalSampleCount) * 1000) / 1000 : 0,
		};
	});

	return { rows, total: allGroups.length, page: paging.page, pageSize: paging.pageSize };
}

/**
 * Resolve the batch selector from the URL. `unlabeled=1` is an explicit flag
 * rather than a magic label so a real batch named "__unlabeled__" still works.
 */
export function parseBatchFilter(
	labelParam: string | undefined,
	unlabeledParam: string | undefined,
): BatchFilter | null {
	if (unlabeledParam === "1") return { kind: "unlabeled" };
	const label = labelParam?.trim();
	if (!label || label.length > MAX_BATCH_LABEL_LENGTH) return null;
	return { kind: "label", label };
}

export async function getBatchLogPage(params: {
	pondId: string;
	filter: BatchFilter;
	page: number;
	pageSize: number;
}): Promise<BatchLogPage> {
	const where =
		params.filter.kind === "unlabeled"
			? { pondId: params.pondId, batchLabel: null }
			: { pondId: params.pondId, batchLabel: params.filter.label };

	const [aggregate, entries] = await Promise.all([
		prisma.biomassLog.aggregate({
			where,
			_count: { _all: true },
			_sum: { sampleCount: true, sampleWeightKg: true },
			_min: { recordedAt: true },
			_max: { recordedAt: true },
		}),
		prisma.biomassLog.findMany({
			where,
			orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
			skip: (params.page - 1) * params.pageSize,
			take: params.pageSize,
			select: {
				id: true,
				recordedAt: true,
				sampleCount: true,
				sampleWeightKg: true,
				avgWeightKg: true,
				sampleLengthCm: true,
				source: true,
				fishSamples: {
					select: { id: true, weightGrams: true, lengthCm: true },
				},
			},
		}),
	]);

	const total = aggregate._count._all;
	const totalSampleCount = aggregate._sum.sampleCount ?? 0;
	const totalWeightKg = Math.round((aggregate._sum.sampleWeightKg ?? 0) * 1000) / 1000;
	const avgWeightKg =
		totalSampleCount > 0 ? Math.round((totalWeightKg / totalSampleCount) * 1000) / 1000 : null;

	return {
		total,
		entries,
		summary: {
			entryCount: total,
			totalSampleCount,
			totalWeightKg,
			avgWeightKg,
			firstRecordedAt: aggregate._min.recordedAt,
			lastRecordedAt: aggregate._max.recordedAt,
		},
	};
}
