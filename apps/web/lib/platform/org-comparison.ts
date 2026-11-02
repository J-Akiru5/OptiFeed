import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	type ComparisonSelection,
	type OrgComparison,
	buildOrgComparison,
	parseComparisonSelection,
} from "@/lib/platform/org-comparison-rules";
import type { BandState } from "@/lib/platform/status-band-rules";
import { getTenantHealthDataset } from "@/lib/platform/tenant-health";

/**
 * Organization comparison loader (issue #479, M3C.9).
 *
 * No new queries: it calls the tenant health dataset, which is the same six
 * bounded reads that build the tenant table, and then picks the selected rows.
 * One read path means the comparison cannot disagree with the table it sits
 * next to, and it inherits the same caps (`truncated`) and the same failure
 * shape (`sourceError` with no rows, never an empty healthy-looking result).
 *
 * Read-only and platform-gated, like every command-center page.
 */

export interface ComparisonOption {
	orgId: string;
	orgName: string;
	state: BandState;
}

export interface OrgComparisonPage {
	checkedAt: Date;
	/** Ids the operator asked for, after de-duplication and the cap. */
	selection: ComparisonSelection;
	comparison: OrgComparison;
	/** Every organization that could be picked, worst first. */
	options: ComparisonOption[];
	available: number;
	/** True when a tenant-health read hit its cap, so `available` is a floor. */
	truncated: boolean;
	sourceError: boolean;
	policyAvailable: boolean;
}

export async function getOrgComparison(
	rawSelection: string | string[] | undefined,
	now: Date = new Date(),
): Promise<OrgComparisonPage> {
	await requirePlatformAdmin();

	const dataset = await getTenantHealthDataset(now);

	if (dataset.sourceError) {
		const failed: OrgComparisonPage = {
			checkedAt: now,
			selection: { selected: [], droppedOrgIds: [], truncated: false },
			comparison: buildOrgComparison([], []),
			options: [],
			available: 0,
			truncated: false,
			sourceError: true,
			policyAvailable: false,
		};
		return failed;
	}

	const availableIds = dataset.rows.map((row) => row.orgId);
	const selection = parseComparisonSelection(rawSelection, availableIds);
	const comparison = buildOrgComparison(dataset.rows, selection.selected);

	return {
		checkedAt: now,
		selection,
		comparison,
		options: dataset.rows.map((row) => ({
			orgId: row.orgId,
			orgName: row.orgName,
			state: row.state,
		})),
		available: dataset.rows.length,
		truncated: dataset.truncated,
		sourceError: false,
		policyAvailable: dataset.policyAvailable,
	};
}
