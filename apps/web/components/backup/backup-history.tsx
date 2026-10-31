import type { BackupExportOutcome, BackupExportRecord } from "@/lib/backup/audit";
import { cn } from "@/lib/utils";

/**
 * Export history table shared by the tenant and platform Backup pages.
 *
 * Server-rendered and label-driven: the two consoles have different copy but
 * the same data. Timestamps are shown in UTC with a `Z`, matching the SQL file
 * header and the audit row, so an operator comparing a file with the page never
 * has to translate a timezone.
 *
 * `variant` carries the shell's colour mode. The tenant console supports a dark
 * scheme, and the platform console deliberately paints a light surface, so dark
 * classes are applied only for the tenant variant — otherwise a platform reader
 * on a dark OS would get light text on a white card.
 */

export interface BackupHistoryLabels {
	caption: string;
	when: string;
	who: string;
	scope: string;
	outcome: string;
	rows: string;
	size: string;
	checksum: string;
	reason: string;
	empty: string;
	platformScope: string;
	tenantScopeFallback: string;
	outcomes: Record<BackupExportOutcome, string>;
}

export type BackupSurface = "admin" | "platform";

export function backupSurface(variant: BackupSurface) {
	const admin = variant === "admin";
	return {
		container: cn(
			"overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm",
			admin && "dark:border-gray-700/60 dark:bg-gray-900",
		),
		head: cn(
			"border-b border-gray-200 bg-[#F4F7F6]",
			admin && "dark:border-gray-700/60 dark:bg-gray-800/60",
		),
		headCell: cn(
			"px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#3D5568]",
			admin && "dark:text-gray-300",
		),
		row: cn("border-b border-gray-100 last:border-0 align-top", admin && "dark:border-gray-800"),
		primary: cn("text-[#0A3D62]", admin && "dark:text-[#8fc0ea]"),
		secondary: cn("text-[#3D5568]", admin && "dark:text-gray-300"),
		error: cn("text-[#C42B3A]", admin && "dark:text-red-300"),
	};
}

const OUTCOME_TONES: Record<BackupExportOutcome, string> = {
	succeeded: "bg-[#E8F5EC] text-[#1E7B34]",
	failed: "bg-[#FDE8EA] text-[#C42B3A]",
	cancelled: "bg-[#FFF3E8] text-[#B45309]",
};

/** 1.4 MB / 812 KB / 640 B. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
}

function scopeLabel(record: BackupExportRecord, labels: BackupHistoryLabels): string {
	if (record.scope === "platform") return labels.platformScope;
	return record.orgNames.length > 0 ? record.orgNames.join(", ") : labels.tenantScopeFallback;
}

export function BackupHistory({
	records,
	labels,
	variant = "platform",
}: {
	records: readonly BackupExportRecord[];
	labels: BackupHistoryLabels;
	variant?: BackupSurface;
}) {
	const surface = backupSurface(variant);

	if (records.length === 0) {
		return (
			<p
				className={cn(
					"rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm font-bold text-[#3D5568]",
					variant === "admin" && "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300",
				)}
			>
				{labels.empty}
			</p>
		);
	}

	return (
		<div className={surface.container}>
			<table className="w-full min-w-[48rem] text-sm">
				<caption className="sr-only">{labels.caption}</caption>
				<thead>
					<tr className={surface.head}>
						{[
							labels.when,
							labels.who,
							labels.scope,
							labels.outcome,
							labels.rows,
							labels.size,
							labels.checksum,
							labels.reason,
						].map((label) => (
							<th key={label} scope="col" className={surface.headCell}>
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{records.map((record) => (
						<tr key={record.id} className={surface.row}>
							<td className={cn("px-4 py-3 font-mono text-xs", surface.primary)}>
								<span className="block">{record.createdAt.toISOString().replace(".000", "")}</span>
								<code className={cn("mt-1 block text-[10px] break-all", surface.secondary)}>
									{record.filename}
								</code>
							</td>
							<td className={cn("px-4 py-3 text-xs font-bold", surface.primary)}>
								{record.actorLabel}
							</td>
							<td className={cn("px-4 py-3 text-xs", surface.secondary)}>
								{scopeLabel(record, labels)}
							</td>
							<td className="px-4 py-3">
								<span
									className={cn(
										"inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
										OUTCOME_TONES[record.outcome],
									)}
								>
									{labels.outcomes[record.outcome]}
								</span>
								{record.error && (
									<span className={cn("mt-1 block max-w-[16rem] text-[10px]", surface.error)}>
										{record.error}
									</span>
								)}
							</td>
							<td className={cn("px-4 py-3 text-xs tabular-nums", surface.primary)}>
								{record.totalRows.toLocaleString("en-US")}
							</td>
							<td className={cn("px-4 py-3 text-xs tabular-nums", surface.primary)}>
								{formatBytes(record.bytes)}
							</td>
							<td className="px-4 py-3">
								<code
									className={cn("block max-w-[10rem] text-[10px] break-all", surface.secondary)}
								>
									{record.sha256 ?? "—"}
								</code>
							</td>
							<td className={cn("px-4 py-3 text-xs", surface.secondary)}>
								<span className="block max-w-[16rem] whitespace-normal">{record.reason}</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
