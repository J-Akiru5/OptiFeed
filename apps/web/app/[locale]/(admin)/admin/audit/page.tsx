import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
	AdminCard,
	AdminCardRow,
	AdminTHead,
	AdminTable,
	AdminTd,
	AdminTh,
	AdminTr,
} from "@/components/admin/admin-table";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { getAuditLog } from "@/lib/actions/admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { parsePage } from "@/lib/pagination";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AdminAuditPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [eventsPage, t, tAudit, tCommon, tDates] = await Promise.all([
		getAuditLog({ page }),
		getTranslations("dashboard.adminAudit"),
		getTranslations("dashboard.audit"),
		getTranslations("dashboard.adminCommon"),
		getTranslations("dates"),
	]);
	const events = eventsPage.rows;
	const pageCount = Math.max(1, Math.ceil(eventsPage.total / eventsPage.pageSize));
	const firstRow = eventsPage.total === 0 ? 0 : (eventsPage.page - 1) * eventsPage.pageSize + 1;
	const lastRow = Math.min(eventsPage.page * eventsPage.pageSize, eventsPage.total);

	const formatted = (date: Date) => formatDateTimeLocal(date, tDates).full;
	const eventTypeLabel = (eventType: string) => {
		const key = `eventType_${eventType}`;
		return tAudit.has(key) ? tAudit(key) : eventType;
	};
	const sourceLabel = (source: string) => {
		const key = `source_${source}`;
		return tAudit.has(key) ? tAudit(key) : source;
	};

	return (
		<div className="space-y-6">
			<AdminPageHeader icon={FileText} title={t("title")} description={t("desc")} />

			{events.length === 0 ? (
				<AdminEmptyState icon={FileText} title={t("emptyTitle")} description={t("emptyDesc")} />
			) : (
				<ListView
					pageKey="admin-audit"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
					<AdminTable caption={t("caption")} minWidth="min-w-[52rem]">
						<AdminTHead>
							<AdminTh>{t("columnTime")}</AdminTh>
							<AdminTh>{t("columnDevice")}</AdminTh>
							<AdminTh>{t("columnEvent")}</AdminTh>
							<AdminTh>{t("columnSource")}</AdminTh>
							<AdminTh>{t("columnActor")}</AdminTh>
						</AdminTHead>
						<tbody>
							{events.map((event) => (
								<AdminTr key={event.id}>
									<AdminTd className="text-xs whitespace-nowrap text-[#3D5568] dark:text-gray-400">
										{formatted(event.createdAt)}
									</AdminTd>
									<AdminTd className="text-xs font-bold text-[#0A3D62] dark:text-gray-100">
										{event.device.label}
									</AdminTd>
									<AdminTd>
										<span className="inline-flex rounded-full bg-[#0A3D62]/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#0A3D62] uppercase dark:bg-white/10 dark:text-[#8fc0ea]">
											{eventTypeLabel(event.eventType)}
										</span>
									</AdminTd>
									<AdminTd className="text-xs text-[#3D5568] dark:text-gray-400">
										{sourceLabel(event.source)}
									</AdminTd>
									<AdminTd className="text-xs text-[#3D5568] dark:text-gray-400">
										{event.actorId || tCommon("none")}
									</AdminTd>
								</AdminTr>
							))}
						</tbody>
					</AdminTable>

					<ItemCardGrid label={t("caption")}>
						{events.map((event) => (
							<AdminCard key={event.id}>
								<div className="flex items-start justify-between gap-3">
									<p className="min-w-0 font-black text-[#0A3D62] dark:text-gray-100">
										{event.device.label}
									</p>
									<span className="shrink-0 rounded-full bg-[#0A3D62]/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#0A3D62] uppercase dark:bg-white/10 dark:text-[#8fc0ea]">
										{eventTypeLabel(event.eventType)}
									</span>
								</div>
								<div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
									<AdminCardRow label={t("columnTime")}>{formatted(event.createdAt)}</AdminCardRow>
									<AdminCardRow label={t("columnSource")}>{sourceLabel(event.source)}</AdminCardRow>
									<AdminCardRow label={t("columnActor")}>
										{event.actorId || tCommon("none")}
									</AdminCardRow>
								</div>
							</AdminCard>
						))}
					</ItemCardGrid>
				</ListView>
			)}

			{eventsPage.total > 0 && (
				<Pagination
					basePath="/admin/audit"
					page={eventsPage.page}
					pageCount={pageCount}
					showing={tCommon("pagination.showing", {
						from: firstRow,
						to: lastRow,
						total: eventsPage.total,
					})}
					previousLabel={tCommon("pagination.previous")}
					nextLabel={tCommon("pagination.next")}
					label={tCommon("pagination.label")}
				/>
			)}
		</div>
	);
}
