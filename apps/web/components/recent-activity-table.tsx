import {
	AdminCard,
	AdminCardList,
	AdminCardRow,
	AdminTHead,
	AdminTable,
	AdminTd,
	AdminTh,
	AdminTr,
} from "@/components/admin/admin-table";

interface RecentActivityProps {
	events: {
		id: string;
		eventType: string;
		source: string;
		createdAt: Date;
		device: { label: string };
	}[];
	/** Translated table headings and empty message, supplied by the page. */
	labels: {
		time: string;
		device: string;
		event: string;
		source: string;
		empty: string;
	};
	/** Locale-aware date formatter from `lib/date-local`. */
	formatDate: (date: Date) => string;
	/** Event type key → display label, from the audit-log catalogue. */
	formatEventType: (eventType: string) => string;
	/** Source key (`device`, `system`, `user`) → display label. */
	formatSource: (source: string) => string;
}

/**
 * Recent device activity, as a table on desktop and cards below `md` so the
 * page never scrolls sideways on a phone.
 */
export function RecentActivityTable({
	events,
	labels,
	formatDate,
	formatEventType,
	formatSource,
}: RecentActivityProps) {
	return (
		<div>
			<AdminTable minWidth="min-w-[36rem]">
				<AdminTHead>
					<AdminTh>{labels.time}</AdminTh>
					<AdminTh>{labels.device}</AdminTh>
					<AdminTh>{labels.event}</AdminTh>
					<AdminTh>{labels.source}</AdminTh>
				</AdminTHead>
				<tbody>
					{events.map((event) => (
						<AdminTr key={event.id}>
							<AdminTd className="text-xs whitespace-nowrap text-[#3D5568] dark:text-gray-400">
								{formatDate(event.createdAt)}
							</AdminTd>
							<AdminTd className="text-xs font-bold text-[#0A3D62] dark:text-gray-100">
								{event.device.label}
							</AdminTd>
							<AdminTd>
								<span className="inline-flex rounded-full bg-[#0A3D62]/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#0A3D62] uppercase dark:bg-white/10 dark:text-[#8fc0ea]">
									{formatEventType(event.eventType)}
								</span>
							</AdminTd>
							<AdminTd className="text-xs text-[#3D5568] dark:text-gray-400">
								{formatSource(event.source)}
							</AdminTd>
						</AdminTr>
					))}
				</tbody>
			</AdminTable>

			<AdminCardList>
				{events.map((event) => (
					<AdminCard key={event.id}>
						<div className="flex items-start justify-between gap-3">
							<p className="min-w-0 font-black text-[#0A3D62] dark:text-gray-100">
								{event.device.label}
							</p>
							<span className="shrink-0 rounded-full bg-[#0A3D62]/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#0A3D62] uppercase dark:bg-white/10 dark:text-[#8fc0ea]">
								{formatEventType(event.eventType)}
							</span>
						</div>
						<div className="mt-2">
							<AdminCardRow label={labels.time}>{formatDate(event.createdAt)}</AdminCardRow>
							<AdminCardRow label={labels.source}>{formatSource(event.source)}</AdminCardRow>
						</div>
					</AdminCard>
				))}
			</AdminCardList>

			{events.length === 0 && (
				<div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-900">
					<p className="text-sm font-bold text-[#3D5568] dark:text-gray-400">{labels.empty}</p>
				</div>
			)}
		</div>
	);
}
