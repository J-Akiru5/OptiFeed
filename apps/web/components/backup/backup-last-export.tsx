import { type BackupSurface, backupSurface, formatBytes } from "@/components/backup/backup-history";
import type { BackupExportRecord } from "@/lib/backup/audit";

/** Summary of the most recent export attempt, shared by both Backup pages. */

export interface LastExportLabels {
	when: string;
	who: string;
	scope: string;
	outcome: string;
	rows: string;
	size: string;
	checksum: string;
	outcomes: Record<string, string>;
}

export function LastExport({
	record,
	labels,
	empty,
	scopeLabel,
	variant = "platform",
}: {
	record: BackupExportRecord | undefined;
	labels: LastExportLabels;
	empty: string;
	/** Resolves the scope text for a record (org names, or the platform label). */
	scopeLabel: (record: BackupExportRecord) => string;
	variant?: BackupSurface;
}) {
	const surface = backupSurface(variant);

	if (!record) {
		return <p className={`text-sm font-bold ${surface.secondary}`}>{empty}</p>;
	}

	const fields: { label: string; value: string }[] = [
		{ label: labels.when, value: record.createdAt.toISOString().replace(".000", "") },
		{ label: labels.who, value: record.actorLabel },
		{ label: labels.scope, value: scopeLabel(record) },
		{ label: labels.outcome, value: labels.outcomes[record.outcome] ?? record.outcome },
		{ label: labels.rows, value: record.totalRows.toLocaleString("en-US") },
		{ label: labels.size, value: formatBytes(record.bytes) },
	];

	return (
		<div className="space-y-3">
			<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{fields.map((field) => (
					<div key={field.label} className="min-w-0">
						<dt className={`text-[10px] font-black uppercase tracking-wider ${surface.secondary}`}>
							{field.label}
						</dt>
						<dd className={`mt-0.5 text-sm font-bold break-words ${surface.primary}`}>
							{field.value}
						</dd>
					</div>
				))}
			</dl>
			<div>
				<p className={`text-[10px] font-black uppercase tracking-wider ${surface.secondary}`}>
					{labels.checksum}
				</p>
				<code className={`mt-0.5 block text-[11px] break-all ${surface.primary}`}>
					{record.sha256 ?? "—"}
				</code>
			</div>
		</div>
	);
}
