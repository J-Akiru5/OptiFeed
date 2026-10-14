export interface BatchLogRow {
	batchLabel: string | null;
	sampleCount: number;
	sampleWeightKg: number;
	recordedAt: Date;
}

export interface BatchSummary {
	/** Batch label, or null for the "Unlabeled" group. */
	label: string | null;
	entryCount: number;
	lastSavedAt: Date;
	totalSampleCount: number;
	totalWeightKg: number;
	/** totalWeightKg ÷ totalSampleCount (0 when no samples). */
	avgWeightKg: number;
}

/**
 * Groups biomass log rows by batch label (null → "Unlabeled" group) and
 * returns one summary per batch, newest first. Pure so it stays unit-testable.
 */
export function summarizeBatches(rows: BatchLogRow[]): BatchSummary[] {
	const byLabel = new Map<string | null, BatchSummary>();

	for (const row of rows) {
		const key = row.batchLabel;
		const existing = byLabel.get(key);
		if (existing) {
			existing.entryCount += 1;
			existing.totalSampleCount += row.sampleCount;
			existing.totalWeightKg += row.sampleWeightKg;
			if (row.recordedAt > existing.lastSavedAt) {
				existing.lastSavedAt = row.recordedAt;
			}
		} else {
			byLabel.set(key, {
				label: key,
				entryCount: 1,
				lastSavedAt: row.recordedAt,
				totalSampleCount: row.sampleCount,
				totalWeightKg: row.sampleWeightKg,
				avgWeightKg: 0,
			});
		}
	}

	const summaries = [...byLabel.values()];
	for (const summary of summaries) {
		summary.totalWeightKg = Math.round(summary.totalWeightKg * 1000) / 1000;
		summary.avgWeightKg =
			summary.totalSampleCount > 0
				? Math.round((summary.totalWeightKg / summary.totalSampleCount) * 1000) / 1000
				: 0;
	}

	summaries.sort((a, b) => b.lastSavedAt.getTime() - a.lastSavedAt.getTime());
	return summaries;
}
